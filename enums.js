'use strict';

/**
 * @readonly
 * @enum {Number}
 */
const HAStrategies = {
    random: 0,
    roundRobin: 1,
    nearest: 2,
};

/**
 * @readonly
 * @enum {HAReadWriteConfig}
 */
const HAReadWrite = {
    masterOnly: {
        master: { read: true, write: true },
        slave: { read: false, write: false }
    },
    masterWriteOnly: {
        master: { read: false, write: true },
        slave: { read: true, write: false }
    },
    masterReadWrite: {
        master: {read: true, write: true},
        slave: {read: true, write: false}
    }
};

/**
 * @readonly
 * @enum {Number}
 */
const Status = {
    error: -2,
    unknown: -1,
    down: 0,
    up: 1
};

/**
 * @readonly
 * @enum {Number}
 */
const ServerType = {
    unknown: -1,
    slave: 1,
    master: 2
};

module.exports.Status = Status;
module.exports.ServerType = ServerType;
module.exports.HAReadWrite = HAReadWrite;
module.exports.HAStrategies = HAStrategies;
