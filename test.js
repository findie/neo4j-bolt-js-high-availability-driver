var timeouter = require('./helpers').timeouter;

var Neo4jHA = require('./index');

const servers = [
    ['http://127.0.0.1:7474', 'bolt://127.0.0.1:7687'],
    ['http://127.0.0.1:7475', 'bolt://127.0.0.1:7688']
];

const auth = { user: 'neo4j', pass: 'password' };
const strategy = Neo4jHA.HAStrategies.roundRobin;
const rwConfig = Neo4jHA.HAReadWrite.all;
const retryOnError = 0;
const badConnectionsCountAsErrors = true;

console.log('connecting...');
const driver = new Neo4jHA(servers, {
    auth,
    strategy,
    rwConfig,
    retryOnError,
    badConnectionsCountAsErrors
}, () => {
    console.log('ready');

    setTimeout(() => {
        console.log('\n\n');
        const writeLock = Math.random() > .5;

        const bomb1 = () => null;//timeouter('then');
        const bomb2 = () => null;//timeouter('sub');

        console.log('Query will write=', writeLock);
        const session = driver.session(writeLock, Neo4jHA.HAReadWrite.masterOnly, Neo4jHA.HAStrategies.random);

        session.run('return {a} as a', { a: 'a' })
            .then((a) => {
                console.log(
                    a.records[0]._fields
                );
                console.log(
                    '      Then => !',
                    'served by', a.servedBy.location.bolt,
                    '| master=', a.servedBy.info.type === Neo4jHA.ServerType.master
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
                        '| master=', summary.servedBy.info.type === Neo4jHA.ServerType.master
                    );
                    session2.close();
                    bomb2();
                },
                onError: (e) => {
                    throw e;
                }
            });


        const session3 = driver.session(writeLock);
        Promise.all([
                session3.run('return 1.0 as a'),
                session3.run('return 2.0 as b'),
                session3.run('return 3.0 as c')
            ])
            .catch(e => {
                throw e;
            })
            .then(data => {
                console.log(
                    data[0].records[0]._fields,
                    data[1].records[0]._fields,
                    data[2].records[0]._fields
                );
                console.log(
                    'PromiseAll => !',
                    'served by', data[0].servedBy.location.bolt,
                    '| master=', data[0].servedBy.info.type === Neo4jHA.ServerType.master
                );
                session.close();
            });
    }, 100);
});

