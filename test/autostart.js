"use strict";
const as = require("../index.js");
const http          = require("http");
let   http2         = null;//dynamically initialized due to missing on older node versions
const https         = require("https");
const WebSocket     = require("ws");
const path          = require("path");
const assert        = require("chai").assert;
const fs            = require('fs');
//synchronous console for better error handling
//if (process.stdout._handle) process.stdout._handle.setBlocking(true);
global.Promise       = require("bluebird");
let eventDebug = require('event-debug');
eventDebug = () => {};

Promise.config({ longStackTraces: true });
let basePort = 62119;

function makePort() { return basePort++; }
function createServer(opts, conf = {}) {
    const src    = makePort();
    const server = as([Object.assign({
                                    name:       "test",
                                    dir:        path.join(__dirname, "clients"),
                                    initTime:   0.1,
                                    src
                                }, opts)], Object.assign({socketDir: __dirname}, conf));
    eventDebug(server);
    server.on("connection", c => eventDebug(c));
    server.on("app.start", (app, child) => eventDebug(child));
    return {server, port: src };
}

function isSSL(protocol) { return protocol === https; }
function isSocket(port)  { return typeof port === "string"; }
const sslOptions = Object.freeze({
    ca: [fs.readFileSync(path.join(__dirname, "clients", "as-cert.pem"), {encoding: 'utf-8'})],
    rejectUnauthorized: true,
    requestCert: true,
    agent: false
});
async function addErrorHandler(server, opts, connDescr, func) {
    if(!opts.expectError && server)
        server.on("error", e => {
            assert.isOk(false, "Unexpected server error ("+connDescr+"):\n   "+JSON.stringify(e));
        });
    if(opts.expectError) {
        await func();
        await new Promise((res, rej) => setTimeout(res, 50));
    }
    else
        try {
            await func();
            await new Promise((res, rej) => setTimeout(res, 50));
        } catch(e) {
            assert.isOk(false, "Unexpected server error ("+connDescr+"):\n   "+e+"\n    "+e.stack);
        }
}

async function testClientServerH2(port, server, opts = {}) {
    if(!http2)
        http2 = require("http2");

    const {protocol = http} = opts;
    const url = `http${isSSL(protocol) ? "s" : ""}://${typeof port === "number" ? "localhost:"+port : ("unix:/"+port+":")}`;
    await addErrorHandler(server, opts, url, async () => {
        const data = await new Promise((resolve, reject) => {
            server && server.on("error", e => reject(e));
            const client  = http2.connect(url, Object.assign({timeout: 1000}, ...(isSSL(protocol) ? [sslOptions] : []), opts));
            client.on('error', reject);

            client.on("timeout", () => {request.abort(); reject(new Error("Timeout")); });
            const request = client.request({ ':path': '/' });
            request.on('error', reject);
            request.setEncoding('utf8');
            let data = '';
            request.on('data', (chunk) => { data += chunk;});
            request.on('end', () => {
                client.close();
                resolve(data);
            });
            request.end();
        });
        assert.equal(data, "Hello World!");
    });
}
async function testClientServer(port, server, opts = {}) {
    const {protocol = http} = opts;
    await addErrorHandler(server, opts, port, async () => {
        const data = await new Promise((resolve, reject) => {
            server && server.on("error", e => reject(e));
            let rawData = '';
            const proOps = Object.assign({timeout: 1000}, typeof port === "number" ? {port}: {socketPath : port}, ...(isSSL(protocol) ? [sslOptions] : []), opts.request || {});
            console.log(JSON.stringify(proOps, null, 4));
            const request = protocol.get(proOps, (response) => {
                if(response.statusCode !== 200)
                    reject(new Error("Wrong status"));
                response.setEncoding('utf8');
                eventDebug(response);
                response.on('data', (chunk) => rawData += chunk)
                        .on('end', () => {})
                        .on('error', (e) => reject(e));
            }).on("socket", (sock) => {
                sock.on("error", e => reject(e))
                    .on("close", () => resolve(rawData));

            }).on("error", e => reject(e))
              .on("timeout", () => {request.abort(); reject(new Error("Timeout")); });
              //.on("close", () => resolve(rawData));
            eventDebug(request);
        });

        assert.equal(data, "Hello World!");
    });
}

async function testWSClientServer(port, server, opts = {}) {
    const {protocol = http} = opts;
    let protocolBase = "ws" + (protocol === https ? "s" : "");
    if(isSocket(port))
        protocolBase += "+unix";
    const url = protocolBase+"://"+(isSocket(port) ? port : "localhost:"+port);
    await addErrorHandler(server, opts, url, async () => {
        const data = await new Promise((resolve, reject) => {
            server && server.on("error", e => reject(e));
            const ws = new WebSocket(url, Object.assign({}, ...(isSSL(protocol) ? [sslOptions] : []), opts));
            eventDebug(ws);
            ws.on("error", reject);
            ws.on("open", () => ws.send("Hello"));
            ws.on("message", msg => {
                ws.close();
                resolve(msg);
            });
        });
        assert.equal(data, "Hello World!");
    });
}
const nodeVersion = +process.version.slice(1).split(".").slice(0,2).join(".");
process.on('unhandledRejection', error => {
    // Will print "unhandledRejection err is not defined"
    console.log('unhandledRejection', error.message+"\n"+error.stack);
});

describe("autostart", () => {
    describe("basic", () => {
        it("server", async () => {
            //try {
                const port = makePort();
                const {server} = createServer({client: "as-client.js", src: {port}, dst: makePort()});
                await testClientServer(port, server);
                await server.close();
            //}catch(e) {console.log(e+"\n"+e.stack);}
        });
        it("connections", async () => {
            const port = makePort();
            const {server} = createServer({ client: "as-client.js", connections: [{src: port, dst: makePort()}] });
            await testClientServer(port, server);
            await server.close();
        });

        it("internal-socket", async () => {
            const {server, port} = createServer({ client: "as-client.js", dst: {socket: "als_test"} });
            await testClientServer(port, server);
            await server.close();
        });
        it("located-socket", async () => {
            const {server, port} = createServer({ client: "as-client.js", dst: {socket: "als_test2"} }, {socketDir: "."});
            await testClientServer(port, server);
            await server.close();
        });
        it("auto-socket", async () => {
            const {server, port} = createServer({ client: "as-client.js", dst: {socket: true} });
            await testClientServer(port, server);
            await server.close();
        });
        it("implicit-socket", async () => {
            const {server, port} = createServer({ client: "as-client.js"});
            await testClientServer(port, server);
            await server.close();
        });
        it("multi-connections", async () => {
            const [p1, p2] = [makePort(), makePort()];
            const {server} = createServer({ client: "as-client.js", connections: [{src: p1}, {src: p2}]});
            await testClientServer(p1, server);
            await testClientServer(p2, server);
            await server.close();
        });
        it("simultaneous-multi-connections", async () => {
            const [p1, p2] = [makePort(), makePort()];
            const {server} = createServer({ client: "as-client.js", connections: [{src: p1}, {src: p2}]});
            await Promise.all([testClientServer(p1, server), testClientServer(p2, server)]);
            await server.close();
        });
        it("iteration", async () => {
            const {server, port} = createServer({ name: "as", client: "as-client.js" });
            console.log("Port: "+port);
            server.add({name: "test",  client: "as-client", src: makePort()});
            server.add({name: "test2", client: "as-client", src: makePort()});
            await testClientServer(port, server);
            assert.deepEqual([...server.all()], ["as", "test", "test2"]);
            await server.close(true);
        });

        it("restart", async () => {
            const {server, port} = createServer({ client: "as-client.js"});
            await testClientServer(port, server);
            await new Promise((res, rej) => setTimeout(res, 2000));
            await testClientServer(port, server);
            await server.close(true);
        }).timeout(5000);
        it("ssl-connection", async () => {
            const {server, port} = createServer({ client: "as-client.js", params: ["--ssl"]});
            await testClientServer(port, server, { protocol: https });
            await server.close();
        });
        it("app-events", async () => {
            const {server, port} = createServer({ client: "as-client.js"});
            let appD = {};
            server.on("app.start", (app, proc) => appD = app);
            await testClientServer(port, server);
            assert.equal(appD.file, "as-client.js");
            let stopped = false;
            server.on("app.stop", (app, proc) => stopped = true);
            await server.close(true);
            assert.isOk(stopped);

        });

        it("remove-event-listener", async () => {
            const {server, port} = createServer({ client: "as-client.js"});
            let started = false;
            let start2  = false;
            const listen = () => started = true;
            server.on("app.start", listen);
            server.off("app.start", listen);
            server.on("app.start", () => start2 = true);
            await testClientServer(port, server);
            assert.notOk(started);
            assert.isOk(start2);
            await server.close(true);
        });

        it("inactive", async () => {
            const {server} = createServer({ client: "as-client.js" });
            await server.close(true);
        });
    });
    describe("Execution", () => {
        describe("manual-start", () => {
            it("client", async () => {
                const dPort = makePort();
                const {server, port} = createServer({ name: "as", client: "as-client.js", dst: dPort });
                await server.start("as");
                await testClientServer(dPort, server);
                await server.stop("as");
                let throws = false;
                await (testClientServer(dPort, server, {expectError: true}).catch(e => throws = true));
                assert.isOk(throws);
                await server.close(true);
            });
            it("exec", async () => {
                const dPort = makePort();
                const {server, port} = createServer({ name: "as", exe: "node", dst:dPort, params: ["as-client.js", "--standalone", dPort], initTime: 0.8 });
                await server.start("as");
                await testClientServer(dPort, server);
                console.log(await server.stop("as", true));
                let throws = false;
                await (testClientServer(dPort, server, {expectError: true}).catch(e => throws = true));
                assert.isOk(throws);
                await server.close(true);
            });
            it("standalone", async () => {
                const dPort = makePort();
                const {server, port} = createServer({ name: "as", script: "as-client.js", dst:dPort, params: ["--standalone", dPort], initTime: 0.5 });
                await server.start("as");
                await testClientServer(dPort, server);
                await server.stop("as");
                let throws = false;
                await (testClientServer(dPort, server, {expectError: true}).catch(e => throws = true));
                assert.isOk(throws);
                await server.close(true);
            });
        });
        describe("auto-start", () => {
            it("server", async () => {
                const {port, server} = createServer({ client: "as-client.js", dst: makePort() });
                await testClientServer(port, server);
                await server.close();
            });
            it("exec", async () => {
                const dPort = makePort();
                const {server, port} = createServer({ exe: "node", dst:dPort, params: ["as-client.js", "--standalone", dPort, "--inf"], initTime: 0.8 });
                await testClientServer(port, server);
                await server.close();
            });
            it("script", async () => {
                const dPort = makePort();
                const {server, port} = createServer({  script: "as-client.js", dst:dPort, params: ["--standalone", dPort], initTime: 0.5 });
                await testClientServer(port, server);
                await server.close();
            });
        })
    });
    describe("errors", () => {
        it("illegal-socket", async () => {
            assert.throws(() => createServer({ client: "as-client.js", dst:{}}));
        });
        it("socket-error", async () => {
            const {server, port} = createServer({ client: "as-client.js"}, {}, req => req.on("socket", (sock) => sock.emit("error")));
            await testClientServer(port, server);
            await server.close(true);
        });
        it("no-src-socket", async () => {
            assert.throws(() => createServer({ client: "as-client.js", connections: [{dst: {socket: true}}]}));
        });
        it("server-timeout", async () => {
            const dPort = makePort();
            const {server, port} = createServer({ script: "as-client.js", dst:dPort, params: ["--standalone", dPort] });
            //const {server, port} = createServer({ client: "as-client.js", dst: 63528 });
            let throws = false;
            await testClientServer(port, server, {expectError: true, request: {timeout: 1}}).catch(e => throws = true);
            assert.isOk(throws);
            await server.close(true);
        });

        it("no-server", async () => {
            const {server, port} = createServer({ script: "as-client.js", params: ["--nop"]});
            let throws = false;
            await testClientServer(port, server, {expectError: true, request: {timeout: 1000}}).catch(e => throws = true);
            assert.ok(throws);
            await server.close(true);
        }).timeout(3000);
        it("error-event", async () => {
            const {server, port} = createServer({ script: "as-client.js", params: ["--nop"], initTime: 500});
            let throws = false;
            server.on("error", () => throws = true);
            await (testClientServer(port, server, {expectError: true, request: {timeout: 1000}}).catch(() => {}));
            assert.ok(throws);
            await server.close(true);
        }).timeout(3000);

        it("no-client-app", async () => {
            let throws           = false;
            const {server, port} = createServer({client: "./asc.js"});
            const listen = () => throws = true;
            server.on("app.error", listen);
            server.on("error", listen);
            let clientFail = false;
            (await (testClientServer(port, server, {expectError: true, request: {timeout: 500}}).catch(e => clientFail = true)));
            assert.ok(throws);
            assert.ok(clientFail);
            server.close(true);
        });
        it("no-exe-app", async () => {
            let throws = false;
            const {server, port} = createServer({ exe: "./asc"});
            const listen = () => throws = true;
            server.on("error", listen);
            let clientFail = false;
            (await testClientServer(port, server, {expectError: true, request: {timeout: 1000}}).catch(e => clientFail = true));
            assert.ok(throws);
            assert.ok(clientFail);
            server.close(true);
        });
    });

    describe("websockets", () => {
        //net.Sockets hang on .destroy() for websockets
        it("ws-connection", async () => {
            const {server, port} = createServer({ client: "as-client.js", params: ["--ws"], dst: makePort()});
            await testWSClientServer(port, server, { protocol: http });
            await server.close(false);
        });
        it("ws-connection-socket", async () => {
            const {server, port} = createServer({ client: "as-client.js", params: ["--ws"]});
            await testWSClientServer(port, server, { protocol: http });
            await server.close(false);
        });
        it("wss-connection", async () => {
            const {server, port} = createServer({ client: "as-client.js", params: ["--ssl", "--ws", "--time", 10], dst: makePort()});
            await testWSClientServer(port, server, { protocol: https });
            await server.close(false);
        });
        it("wss-connection-socket", async () => {
            const {server, port} = createServer({ client: "as-client.js", params: ["--ssl", "--ws"]});
            await testWSClientServer(port, server, { protocol: https });
            await server.close(false);
        });
    });

    describe("http2", function() {

        if(nodeVersion < 8.4)
            before(function() {
                console.log("http2 through sockets does not work correctly before node 10.6");
                this.skip();
            });
        //net.Sockets hang on .destroy() for http2
        it("http2-connection", async () => {
            const {server, port} = createServer({ client: "as-client.js", params: ["--h2"], dst: makePort()});
            await testClientServerH2(port, server);
            await server.close(false);
        });
        it("http2-ssl-connection", async () => {
            const {server, port} = createServer({ client: "as-client.js", params: ["--h2", "--ssl"], dst: makePort()});
            await testClientServerH2(port, server, {protocol: https});
            await server.close(false);
        });
        it("http2-socket-connection", async function() {
            if(nodeVersion < 10.6){
                console.log("http2 through sockets does not work correctly before node 10.6");
                this.skip();
            }
            const {server, port} = createServer({client: "as-client.js", params: ["--h2"], dst: {socket: true}});
            await testClientServerH2(port, server);
            await server.close(false);
        });
        it("http2-ssl-socket-connection", async function() {
            if(nodeVersion < 10.6) {
                console.log("http2 through sockets does not work correctly before node 10.6");
                this.skip();
            }
            const {server, port} = createServer({client: "as-client.js", params: ["--h2"], dst: {socket: true}});
            await testClientServerH2(port, server);
            await server.close(false);
        });
    });
});