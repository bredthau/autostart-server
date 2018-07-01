const as = require("../index.js");
const http          = require("http");
const path          = require("path");
const assert        = require("chai").assert;
const cp            = require("child_process");
const os            = require('os');
function makeSocket(name) { return (process.platform.match(/win32/ig) ? "\\\\.\\pipe\\"+name : os.tmpDir()+'/'+name+'.sock'); }

let baseSrc = 37821;

function createServer(opts, conf = {}) {
    const src = ++baseSrc;
    return {server: as([Object.assign({
        name:       "test",
        dir:        path.join(__dirname, "clients"),
        initTime:   0.1,
        src
    }, opts)], conf), port: src };
}

async function testClientServer(port, server, opts = {}, cb = () => {}) {
    const data = await new Promise((res, rej) => {
        server.on("error", rej);
        cb(http.get(Object.assign({port, timeout: 1000}, opts), (response) => {
            assert.equal(response.statusCode, 200);
            response.setEncoding('utf8');
            res(new Promise((res, rej) => {
                let rawData = '';
                response.on('data', (chunk) => rawData += chunk)
                    .on('end', () => res(rawData))
                    .on('error', (e) => rej(e));
            }));
        }).on("socket", (sock) => { sock.on("error", rej); })
          .on("error", (e) => rej(e)));
    });
    assert.equal(data, "Hello World!");
}

describe("autostart", () => {
    it("server", async () => {
        const {server, port} = createServer({ client: "as-client.js", dst: 63522 });
        await testClientServer(port, server);
        server.close();
    });
    it("internal-socket", async () => {
        const {server, port} = createServer({ client: "as-client.js", dst: {socket: "als_test"} });
        await testClientServer(port, server);
        server.close();
    });
    it("located-socket", async () => {
        const {server, port} = createServer({ client: "as-client.js", dst: {socket: "als_test2"} }, {socketDir: "."});
        await testClientServer(port, server);
        server.close();
    });
    it("auto-socket", async () => {
        const {server, port} = createServer({ client: "as-client.js", dst: {socket: true} });
        await testClientServer(port, server);
        server.close();
    });
    it("implicit-socket", async () => {
        const {server, port} = createServer({ client: "as-client.js"});
        await testClientServer(port, server);
        server.close();
    });
    it("socket-error", async () => {
        const {server, port} = createServer({ client: "as-client.js"}, {}, req => req.on("socket", (sock) => sock.emit("error")));
        await testClientServer(port, server);
        server.close();
    });
    it("standalone", async () => {
        const {server, port} = createServer({ script: "as-client.js", dst:63521, params: ["-s"] });
        await testClientServer(port, server);
        server.close();
    });
    it("exec", async () => {
        const {server, port} = createServer({ exe: "node", dst:63523, params: ["./as-client.js", "-s", 63523] });
        await testClientServer(port, server);
        server.close();
    });
    it("illegal-socket", async () => {
        assert.throws(() => createServer({ client: "as-client.js", dst:{}}));
    });
    it("inactive", async () => {
        const {server} = createServer({ client: "as-client.js" });
        server.close();
    });
    it("server-timeout", async () => {
        const {server, port} = createServer({ exe: "node", dst:63528, params: ["./as-client.js", "-s", 63528] });
        //const {server, port} = createServer({ client: "as-client.js", dst: 63528 });
        await testClientServer(port, server, {timeout: 1});
        server.close();
    });
    it("restart", async () => {
        const {server, port} = createServer({ client: "as-client.js"});
        await testClientServer(port, server);
        await new Promise((res, rej) => setTimeout(res, 1500));
        await testClientServer(port, server);
        server.close();
    });

    it("remove-event-listener", async () => {
        const {server, port} = createServer({ script: "as-client.js", params: ["-n"]});
        let throws = false;
        const listen = () => throws = true;
        server.on("error", listen);
        server.off("error", listen);
        server.on("error", () => {});
        await testClientServer(port, server).catch(() => {});
        assert.notOk(throws);
        server.close();
    });
    it("no-server", async () => {
        const {server, port} = createServer({ script: "as-client.js", params: ["-n"]});
        let throws = false;
        await testClientServer(port, server).catch(e => throws = true);
        assert.ok(throws);
        server.close();
    });

    it("error-event", async () => {
        const {server, port} = createServer({ script: "as-client.js", params: ["-n"]});
        let throws = false;
        server.on("error", () => throws = true);
        await testClientServer(port, server).catch(() => {});
        assert.ok(throws);
        server.close();
    });
});