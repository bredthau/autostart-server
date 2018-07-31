"use strict";
const cp            = require("child_process");
const os            = require("os");
const http          = require("http");
const autostart     = require("../index.js");
const path          = require("path");
const Promise       = require("bluebird");
Promise.config({ longStackTraces: true });
const cTable        = require('console.table');
let   baseSocket    = 62112;
function makeSocket() { return ++baseSocket; }
function* makeData() {
    const port = makeSocket();
    const pc = cp.fork("as-client.js", ["--standalone", port, "--time", 10], {cwd: path.join(__dirname, "clients"), silent: false});
    pc.on("exit",  (code) => console.error(code));
    pc.on("error", (err)  => console.error(err));
    yield { name: "raw", wait: new Promise((res) => setTimeout(res, 500)),  port: port, exit() { return pc.kill(0); }};

    const clientData = {
        name:       "client",
        client:     "as-client.js",
        dir:        path.join(__dirname, "clients"),
        initTime:   0.1,
    };
    const port2 = makeSocket();
    const server  = autostart([Object.assign({ src: port2, dst: makeSocket() }, clientData)], {socketDir: __dirname});
    const wait = Promise.resolve(true);
    server.on("error", e => console.error(JSON.stringify(e)));
    yield { name: "port-forward",   wait, port: port2, exit() { return server.close(); } };

    const port3 = makeSocket();
    const server2 = autostart([Object.assign({ src: port3 }, clientData)], {socketDir: __dirname });
    server2.on("error", e => console.error(JSON.stringify(e)));
    yield { name: "socket-forward", wait, port: port3, exit() { return server2.close(); } };
}
function get(port) {
    return new Promise((resolve, reject) => {
        const request = http.get({port}, (response) => {
            if(response.statusCode !== 200)
                reject(new Error("Wrong status"));
            response.setEncoding('utf8');
            let rawData = '';
            response.on('data', (chunk) => rawData += chunk)
                    .on('end', () => resolve(rawData))
                    .on('error', (e) => reject(e));
        }).on("socket", (sock) => { sock.on("error", reject); })
          .on("error", reject);
    });
}

async function benchTime() {
    const results = [];
    for(let elem of makeData()) {
        try {
            await elem.wait;
            await get(elem.port);
            const start    = process.hrtime();
            await Promise.map(Array(5000).fill(0), () => get(elem.port), {concurrency: 100});
            const diff = process.hrtime(start);
            results.push({
                name:          elem.name,
                "rate (1/s)": (5000/(diff[0] + diff[1] / 1e9)).toFixed(2).padStart(7, " ")
            });
            await elem.exit();
        } catch(e) { console.log(e+"\n"+e.stack); }
    }
    console.table(results);
}
async function memUsage() {
    const iter = makeData();
    iter.next();
    const elem = iter.next().value;
    await elem.wait;
    await get(elem.port);
    for(let i = 0; i < 100; ++i){
        await Promise.map(Array(500).fill(0), () => get(elem.port), {concurrency: 50});
        const used = process.memoryUsage().heapUsed / 1024 / 1024;
        console.log(`The script uses approximately ${used.toFixed(2).padStart(7)} MB`);

    }
    await elem.exit();
}
async function main() {
    await benchTime();
    //await memUsage();
}
main();
