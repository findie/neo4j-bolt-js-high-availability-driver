# Neo4j High Availability Bolt Javascript Driver
_Neo4j cluster session and transparent failover_

# About
This driver is a wrapper over the [official Neo4j bolt driver](https://github.com/neo4j/neo4j-javascript-driver) and adds a layer of High Availability and transparent failovers

# How to install
`npm i --save neo4j-ha-bolt-driver`

# Quick example

```javascript
const servers = [
    ['http://127.0.0.1:7474', 'bolt://127.0.0.1:7687'],
    ['http://127.0.0.1:7475', 'bolt://127.0.0.1:7688']
];

const auth = { user: 'neo4j', pass: 'password' };
const strategy = Neo4jHA.HAStrategies.roundRobin;
const rwConfig = Neo4jHA.HAReadWrite.masterReadWriteSlaveRead;
const checkInterval = 500;

console.log('connecting...');
const driver = new Neo4jHA(servers, { auth, strategy, rwConfig, checkInterval }, () => {
    console.log('ready');
    let session;
  
    // we get a session and we tell the driver that we will perform at least one write
    // the strategy is Round Robin but because we want to write 
    // and the read/write config is set to masterReadWriteSlaveRead (only master can write) 
    // this means that it will get a session to the master 
    session = driver.session(true);
    
    // don't forget to close sessions when you're done with them
    session.close();
    
    // now we request a read-only  session, so all servers are eligible for conenctions
    // the first server in the list is chosen
    session = driver.session(false);
    session.close();
    
    // requesting another read-only session will choose the second server
    // because of the Round Robin 
    session = driver.session();
    session.close();
}

// when you are done with the driver, just close it
driver.close();
```

___

## Enums 

#### HAStrategies
- `random`: It will pick a random server from the pool
- `roundRobin`: It will round robin through the server pool
- `nearest`: It will pick the server with the lowest latency

#### HAReadWrite
- `masterOnly`: Master will be the only queried server
- `masterWriteOnlySlaveReadOnly`: Master is write-only and slaves are read-only
- `masterReadWriteSlaveRead`: Master is read-write and slaves are read-only
- `all`: All servers are read-write
- Custom HAReadWrite Structure
```javascript
{
        master: { read: Boolean, write: Boolean },
        slave: { read: Boolean, write: Boolean }
}
```

#### Status
- `error   (-2)`: Server is returning an error in the HA check
- `unknown (-1)`: Server is in an unknown state
- `down    ( 0)`: Server is unreachable
- `up      ( 1)`: Server is in the cluster

#### ServerType
- `unknown ( 0)`: Server is in an unknown state
- `slave   ( 1)`: Server is a slave
- `master  ( 2)`: server is master

___

# Instantiating a driver
`const driver = new Neo4jHA(serverList, options, readyCallback);`

Where:
- `serverList`: is an array of 
    - `[HTTP URL, BOLT URL]`
    - `{bolt: Bolt URL, url: HTTP URL, auth: {user, pass}}`
- `options`:
    - `auth`: {user, pass} - for all the connections
    - `strategy`: HAStrategies
    - `rwConfig`: HAReadWriteConfig
    - `neo4jDriverOptions`: options passed on the the raw neo4j bolt driver
    - `checkInterval`: interval to check servers availability
    - `retryOnError`: number of times to retry the query until the error is surfaced in callback
    - `badConnectionsCountAsErrors`: true if a server connection error is counted as an error 
- `readyCallback`: callback when all servers status is known 

# Usage
`const session = driver.session(writeLock[, rwConfig, strategy]);`

Where: 
- `writeLock`: Boolean - Tell the driver ifif there will ve any writes in the session
- `rwConfig`: custom HAReadWriteConfig for that session
- `strategy`: custom HAStrategies for that session

___

# License
License can be found [here](https://github.com/findie/neo4j-bolt-js-high-availability-driver/blob/master/LICENSE.MD)
