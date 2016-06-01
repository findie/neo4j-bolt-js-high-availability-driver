'use strict';
const neo4j = require('neo4j-driver').v1;
const async = require('async');

const helpers = require('./helpers');
const strategies = require('./strategyLogic');

const HAStrategies = require('./enums').HAStrategies;
const HAReadWrite = require('./enums').HAReadWrite;
const ServerType = require('./enums').ServerType;
const Status = require('./enums').Status;


/**
 * @typedef {Object} HAReadWriteConfig
 * @property {Object} master
 * @property {Boolean} master.read
 * @property {Boolean} master.write
 * @property {Object} slave
 * @property {Boolean} slave.read
 * @property {Boolean} slave.write
 */

/**
 * @typedef {Object} Credentials
 * @property {String} user
 * @property {String} pass
 */

/**
 * @typedef {Object} ServerLocation
 * @property {String} url
 * @property {String} bolt
 * @property {Credentials} [auth={}]
 */

/**
 * @typedef {Object} Neo4jHAOptions
 * @property {Credentials} [auth={}] - global auth over all urls
 * @property {HAStrategies} strategy
 * @property {HAReadWriteConfig} rwConfig
 * @property {Object} neo4jDriverOptions
 * @property {Number} [checkInterval=500]
 */

class Neo4jHA {
    /**
     * @constructor
     * @param {Array.<ServerLocation|String[]>} serverLocations
     * @param {Neo4jHAOptions} options
     * @param {function()} ready
     */
    constructor(serverLocations, options, ready) {
        options.strategy = options.strategy || HAStrategies.random;
        options.rwConfig = options.rwConfig || HAReadWrite.masterReadWriteSlaveRead;
        options.checkInterval = options.checkInterval || 500;

        this._strategy = options.strategy;
        this._rwConfig = options.rwConfig;

        this._locations = serverLocations.map(location => {
            if (Array.isArray(location)) {
                return {
                    url: location[0],
                    bolt: location[1],
                    auth: options.auth || undefined
                }
            }
            return location;
        });

        this.servers = [];

        this._locations.forEach(location => {
            const auth = location.auth ?
                neo4j.auth.basic(location.auth.user, location.auth.pass) :
                null;

            this.servers.push({
                location,
                driver: neo4j.driver(
                    location.bolt,
                    auth,
                    options.neo4jDriverOptions
                ),
                info: null
            });
        });

        this.masterIndex = -1;

        this.checkServers(ready);

        this._interv = setInterval(()=>this.checkServers(), options.checkInterval);
    }

    checkServers(done) {
        async.parallel(
            this.servers.map(instance =>
                (cb) =>
                    helpers.checkServer(instance.location, (info) => cb(null, info))
            ),
            (err, info) => {
                this.masterIndex = -1;
                info.forEach((info, index) => {
                    this.servers[index].info = info;
                    if (info.status === Status.up && info.type === ServerType.master) {
                        this.masterIndex = index;
                    }
                });

                if (done) done();
            }
        );
    }

    getMaster() {
        return this.servers[this.masterIndex];
    }

    getDriverBaseOnStrategyAndQueryWriteState(canWrite) {
        const driver = strategies[this._strategy](this.servers, this._rwConfig, !canWrite);
        if (driver) return driver;

        console.warn('Selected strategy and rwConfig didd not yield any usable servers, defaulting to master');
        return this.servers[this.masterIndex];
    }

    /**
     *
     * @param {Boolean} writeLock - true if at least one query will perform a write
     */
    session(writeLock) {
        return new Session(this, writeLock);
    }

    close() {
        clearInterval(this._interv);
        this.servers.forEach(s => s.close());
    }
}

class Session {
    /**
     * @param {Neo4jHA} driver
     * @param {Boolean} writeLock
     */
    constructor(driver, writeLock) {
        this.writeLock = writeLock;
        this._driver = driver;
        this._getSession();
    }

    _getSession() {
        const server = this._driver.getDriverBaseOnStrategyAndQueryWriteState(this.writeLock);
        if (!server) throw new Error('No server found, did you wait for all servers to reply?');

        this._session = server.driver.session();
        this._server = server;
        this._dummyFn = () => undefined;
    }

    run(query, params) {
        let ranQuery = false;
        const promiseEmulated = {
            then: (cb) => {
                promiseEmulated._then = cb;

                if (!ranQuery) {
                    ranQuery = true;
                    // we ste on next tick in so that we wait for atitiona stuff like catch or subscribe
                    setImmediate(() => this._runQuery(query, params, promiseEmulated));
                }

                return promiseEmulated;
            },
            catch: (cb) => {
                promiseEmulated._catch = cb;

                if (!ranQuery) {
                    ranQuery = true;
                    setImmediate(() => this._runQuery(query, params, promiseEmulated));
                }

                return promiseEmulated;
            },
            subscribe: (subObj) => {
                promiseEmulated._onNext = subObj.onNext;
                promiseEmulated._onComplete = subObj.onCompleted;
                promiseEmulated._onError = subObj.onError;

                if (!ranQuery) {
                    ranQuery = true;
                    setImmediate(() => this._runQuery(query, params, promiseEmulated));
                }

                return promiseEmulated;
            }
        };
        return promiseEmulated;
    }

    _runQuery(query, params, promiseEmulated) {
        let errorFunction = (err) => {
            if (err.code === 'EPIPE' || err.code === 'ECONNREFUSED') {
                return false;
            }

            return true;
        };

        const run = this._session.run(query, params);

        if (promiseEmulated._then || promiseEmulated._catch) {
            run.then((data) => {
                data.servedBy = { location: this._server.location, info: this._server.info };
                if (promiseEmulated._then) promiseEmulated._then(data)
            });

            run.catch((err) => {
                const shouldContinueError = errorFunction(err);

                if (shouldContinueError) {
                    if (promiseEmulated._catch) promiseEmulated._catch(err);
                }

                if (!shouldContinueError) {
                    this._retry(query, params, promiseEmulated);
                }
            });

            return;
        }

        run.subscribe({
            onNext: promiseEmulated._onNext || this._dummyFn,
            onCompleted: (summary) => {
                summary.servedBy = { location: this._server.location, info: this._server.info };
                if (promiseEmulated._onComplete) promiseEmulated._onComplete(summary)
            },
            onError: (err) => {
                const shouldContinueError = errorFunction(err);

                if (shouldContinueError) {
                    if (promiseEmulated._onError) promiseEmulated._onError(err);
                }

                if (!shouldContinueError) {
                    this._retry(query, params, promiseEmulated);
                }
            }
        });
    }

    _retry(query, params, promiseEmulated) {
        this._session.close();
        this._server.info.status = Status.unknown;

        this._getSession();

        setImmediate(() => {
            this._runQuery(query, params, promiseEmulated, 1);
        });
    }

    beginTransaction() {
        return this._session.beginTransaction();
    }

    close() {
        this._session.close();
    }
}

module.exports = Neo4jHA;
module.exports.Status = Status;
module.exports.ServerType = ServerType;
module.exports.HAReadWrite = HAReadWrite;
module.exports.HAStrategies = HAStrategies;
