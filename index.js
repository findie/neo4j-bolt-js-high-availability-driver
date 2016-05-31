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
     * @param {Array.<ServerLocation|String>} serverLocations
     * @param {Neo4jHAOptions} options
     * @param {function()} ready
     */
    constructor(serverLocations, options, ready) {
        options.strategy = options.strategy || HAStrategies.random;
        options.rwConfig = options.rwConfig || HAReadWrite.masterReadWrite;
        options.checkInterval = options.checkInterval || 500;

        this._strategy = options.strategy;
        this._rwConfig = options.rwConfig;

        this._locations = serverLocations.map(location => {
            if (typeof location === 'string') {
                return {
                    url: location,
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
                    location.url,
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
        if(driver) return driver;

        consle.warn('Selected strategy and rwConfig didd not yield any usable servers, defaulting to master');
        return this.servers[this.masterIndex];
    }

    /**
     *
     * @param {Boolean} writeLock - true if at least one query will perform a write
     */
    session(writeLock) {
        const server = this.getDriverBaseOnStrategyAndQueryWriteState(writeLock);
        return server.driver.session();
    }

    close() {
        clearInterval(this._interv);
        this.servers.forEach(s => s.close());
    }
}

module.exports = Neo4jHA;
module.exports.HAStrategies = HAStrategies;