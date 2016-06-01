'use strict';

const enums = require('./enums');

/**
 *
 * @param {Object} server
 * @param {HAReadWrite} rwConfig
 * @param {Boolean} readOnlyQuery
 * @returns {Boolean}
 * @private
 */
const checkIfCanUse = (server, rwConfig, readOnlyQuery) => {
    if (!server.info) return false;

    if (
        server.info.status !== enums.Status.up ||
        server.info.type === enums.ServerType.unknown) {
        return false;
    }

    // master
    if (server.info.type === enums.ServerType.master) {
        if (readOnlyQuery && !rwConfig.master.read) {
            return false;
        }

        if (!readOnlyQuery && !rwConfig.master.write) {
            return false;
        }

        return true;
    }

    //slaves
    if (readOnlyQuery && !rwConfig.slave.read) {
        return false;
    }

    if (!readOnlyQuery && !rwConfig.slave.write) {
        return false;
    }

    return true;
};

/**
 * @param {Array} servers
 * @param {HAReadWrite} rwConfig
 * @param {Boolean} readOnlyQuery
 * @returns {Object}
 */
const random = (servers, rwConfig, readOnlyQuery) => {
    servers = servers.filter(s => checkIfCanUse(s, rwConfig, readOnlyQuery));
    return servers[Math.floor(Math.random() * servers.length) % servers.length];
};

/**
 * @param {Array} servers
 * @param {HAReadWrite} rwConfig
 * @param {Boolean} readOnlyQuery
 * @returns {Object}
 */
const nearest = (servers, rwConfig, readOnlyQuery) => {
    servers = servers.filter(s => checkIfCanUse(s, rwConfig, readOnlyQuery));

    return servers.sort((sA, sB) => sB.info.distance - sA.info.distance)[0];
};

let _rrIndex = 0;
/**
 * @param {Array} servers
 * @param {HAReadWrite} rwConfig
 * @param {Boolean} readOnlyQuery
 * @returns {Object}
 */
const roundRobin = (servers, rwConfig, readOnlyQuery) => {
    servers = servers.filter(s => checkIfCanUse(s, rwConfig, readOnlyQuery));

    _rrIndex = (_rrIndex + 1) % servers.length;
    return servers[_rrIndex];
};

module.exports = [random, roundRobin, nearest];