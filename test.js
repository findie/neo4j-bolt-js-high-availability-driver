var Neo4jHA = require('./index');
var enums = require('./enums');

const servers = ['http://192.168.1.93:7474', 'http://192.168.1.56:7474'];
const auth = { user: 'neo4j', pass: 'password' };
const strategy = enums.HAStrategies.roundRobin;

const driver = new Neo4jHA(servers, { auth, strategy }, () => {
    setInterval(() => {
        const willWrite = Math.random() > .5;
        const instance = driver.getDriverBaseOnStrategyAndQueryWriteState(willWrite);

        console.log('Will user server', instance.location.url, 'to write=', willWrite);
    }, 500);
});