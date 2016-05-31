'use strict';
const request = require('request');

const HAStrategies = require('./enums').HAStrategies;
const ServerType = require('./enums').ServerType;
const Status = require('./enums').Status;

/**
 * Checks if server is master
 * @param {ServerLocation} location
 * @param {function({type: ServerType, status: Status, distance: Number})} callback
 */
const checkServer = (location, callback) => {
    const startTime = Date.now();
    const headers = {};
    if (location.auth) {
        headers.authorization = new Buffer(`${location.auth.user}:${location.auth.pass}`).toString('base64');
    }
    headers.accept = 'text/plain';

    request({
        url: `${location.url}/db/manage/server/ha/available`,
        method: "GET",
        headers,
        raw: true
    }, (err, http, data) => {
        const distance = Date.now() - startTime;

        if (err) {
            return callback({
                status: Status.down,
                type: ServerType.unknown,
                distance: -1,
                err
            });
        }

        if (http.statusCode === 404) {
            return callback({
                type: ServerType.unknown,
                status: Status.unknown,
                distance
            });
        }

        if (http.statusCode !== 200) {
            return callback({
                status: Status.error,
                type: ServerType.unknown,
                distance
            });
        }

        if (data.trim() === 'master') {
            return callback({
                status: Status.up,
                type: ServerType.master,
                distance
            });
        }

        if (data.trim() === 'slave') {
            return callback({
                status: Status.up,
                type: ServerType.slave,
                distance
            });
        }

        return callback({
            status: Status.up,
            type: ServerType.unknown,
            distance
        });
    })
};

module.exports.checkServer = checkServer;

const queryIsReadOnly = (query) => {
    query = query.toLowerCase();

    if (~query.indexOf(" set ")) return false;
    if (~query.indexOf(" merge ")) return false;
    if (~query.indexOf(" create ")) return false;

    return true;
};

module.exports.queryIsReadOnly = queryIsReadOnly;