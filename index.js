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
 * @property {Number} [retryOnError=10]
 * @property {Boolean} [badConnectionsCountAsErrors=false]
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
        options.retryOnError = options.retryOnError === undefined ? 10 : options.retryOnError;
        options.badConnectionsCountAsErrors = options.badConnectionsCountAsErrors || false;

        this._strategy = options.strategy;
        this._rwConfig = options.rwConfig;
        this._retryOnError = options.retryOnError;
        this._badConnectionsCountAsErrors = options.badConnectionsCountAsErrors;

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

    getDriverBaseOnStrategyAndQueryWriteState(canWrite, rwConfig, strategy) {
        rwConfig = rwConfig || this._rwConfig;
        strategy = typeof strategy === 'number' ? strategy : this._strategy;

        const driver = strategies[strategy](this.servers, rwConfig, !canWrite);
        if (driver) return driver;

        console.warn('Selected strategy and rwConfig didd not yield any usable servers, defaulting to master');
        return this.servers[this.masterIndex];
    }

    /**
     *
     * @param {Boolean} writeLock - true if at least one query will perform a write
     * @param {HAReadWrite} customRWConfig
     * @param {HAStrategies} customStrategy
     */
    session(writeLock, customRWConfig, customStrategy) {
        return new Session(this, writeLock, customRWConfig, customStrategy);
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
     * @param {HAReadWrite} customRWConfig
     * @param {HAStrategies} customStrategy
     */
    constructor(driver, writeLock, customRWConfig, customStrategy) {
        this.writeLock = writeLock;
        this._customRWConfig = customRWConfig;
        this._customStrategy = customStrategy;
        this._driver = driver;
        this._getSession();
    }

    _getSession() {
        const server = this._driver
            .getDriverBaseOnStrategyAndQueryWriteState(
                this.writeLock,
                this._customRWConfig,
                this._customStrategy
            );
        this._server = server;
        if (!server) {
            // if there is no server chosen
            // it may mean a couple of things
            // we didn't wait for the ready callback
            // no servers are up
            // server is not in HA mode

            // we warn
            console.warn('All servers are down or the servers are not in HA mode!');
            // in this case
            // we chose the 1st server
            this._server = this._driver.servers[0];
        }

        this._session = this._server.driver.session();
        this._dummyFn = () => undefined;
    }

    run(query, params) {
        const promiseEmulated = {};

        const promise = new Promise((resolve, reject) => {
            promiseEmulated._then = resolve;
            promiseEmulated._catch = reject;
        });

        promise.subscribe = (subObj) => {
            promiseEmulated._onNext = subObj.onNext;
            promiseEmulated._onComplete = subObj.onCompleted;
            promiseEmulated._onError = subObj.onError;
            promiseEmulated.__subscribed__ = true;
            return promise;
        };

        // we set on next tick in so that we wait for aditional stuff like then, catch or subscribe
        setImmediate(() => this._runQuery(query, params, promiseEmulated, 0));

        return promise;
    }

    _runQuery(query, params, promiseEmulated, retryCount) {
        let errorFunction = (err) => {
            const connError = err.code === 'EPIPE' || err.code === 'ECONNREFUSED';

            if (connError && this._driver._badConnectionsCountAsErrors) retryCount++;
            if (!connError) retryCount++;

            if (retryCount > this._driver._retryOnError) {
                return true;
            }

            return false;
        };

        const run = this._session.run(query, params);


        if (promiseEmulated.__subscribed__) {
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
                        this._retry(query, params, promiseEmulated, retryCount);
                    }
                }
            });

            return;
        }

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
                this._retry(query, params, promiseEmulated, retryCount);
            }
        });
    }

    _retry(query, params, promiseEmulated, retryCount) {
        this._session.close();
        this._server.info.status = Status.unknown;

        this._getSession();

        setImmediate(() => {
            this._runQuery(query, params, promiseEmulated, retryCount);
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
module.exports.driver = neo4j;
