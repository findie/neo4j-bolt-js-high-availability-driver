var timeouter = require('./helpers').timeouter;

var Neo4jHA = require('./index');
var enums = require('./enums');

const servers = [
    ['http://127.0.0.1:7474', 'bolt://127.0.0.1:7687'],
    ['http://127.0.0.1:7475', 'bolt://127.0.0.1:7688']
];
const auth = { user: 'neo4j', pass: 'password' };
const strategy = enums.HAStrategies.roundRobin;
const rwConfig = enums.HAReadWrite.all;

console.log('connecting...');
const driver = new Neo4jHA(servers, { auth, strategy, rwConfig }, () => {
    console.log('ready');

    setInterval(() => {
        console.log('\n\n');
        const writeLock = Math.random() > .5;

        const bomb1 = timeouter('then');
        const bomb2 = timeouter('sub');

        console.log('Query will write=', writeLock);
        const session = driver.session(writeLock);

        session.run('return {a} as a', { a: 'a' })
            .then((a) => {
                console.log(
                    a.records[0]._fields
                );
                console.log(
                    '      Then => !',
                    'served by', a.servedBy.location.bolt,
                    '| master=', a.servedBy.info.type === enums.ServerType.master
                );
                session.close();
                bomb1();
            })
            .catch((e) => {
                throw e;
            });

        const session2 = driver.session(writeLock);

        session2.run('return {a} as a', { a: 'a' })
            .subscribe({
                onNext: function(record) {
                    console.log(
                        record._fields
                    );
                },
                onCompleted: function(summary) {
                    console.log(
                        'onComplete => !',
                        'served by', summary.servedBy.location.bolt,
                        '| master=', summary.servedBy.info.type === enums.ServerType.master
                    );
                    session2.close();
                    bomb2();
                },
                onError: (e) => {
                    throw e;
                }
            });
    }, 100);
});

