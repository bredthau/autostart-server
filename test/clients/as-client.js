"use strict";
console.error("Started Test");
const path          = require("path");
const fs            = require("fs");
const shutdown = require("autostart-client");
process.on("exit", () => console.error("Exiting client"));
process.on('unhandledRejection', error => {
    // Will print "unhandledRejection err is not defined"
    console.log('unhandledRejection', error.message+"\n"+error.stack);
});
async function main() {
    const argv = process.argv.slice(2);
    if(argv.includes("--nop"))
        return;
    const standalone = (argv.includes("--standalone"));
    const scGen      = standalone ? shutdown.autoShutdown : shutdown.client;
    const sc = scGen({timeout: (argv.includes("--time") ? argv[argv.indexOf("--time") + 1]: 0.75), deferInit: true});//.attachServer(server);
    sc.addCleanup(() => console.log("Shutting down as-client"));
    const socket = standalone ? argv[argv.indexOf("--standalone") + 1] : await sc.socket;
    console.log("Listen to "+socket);
    await Promise.all([{dst: socket}].concat(standalone ? [] : (await sc.connections).slice(1)).map(async (conn) => {
        const server = await new Promise((res, rej) => {
            const isSSL = argv.includes("--ssl");
            let options = isSSL ? {
                key:  fs.readFileSync("as-privkey.pem"),
                cert: fs.readFileSync("as-cert.pem")
            } : {};
            let makeServer = null;
            if(argv.includes("--h2"))
                makeServer = require("http2")[isSSL ? "createSecureServer" : "createServer"];
            else
                makeServer = (isSSL ? require("https") : require("http")).createServer;
            const server = isSSL || argv.includes("--h2") ? makeServer(options) : makeServer();
            if(argv.includes("--ws")) {
            } else
                server.on("request", (req, res) => {res.end("Hello World!")});
            /*for(let event of ["session", "sessionError", "streamError", "stream", "timeout"])
                server.on(event, (...args) =>{
                    const known = new Set();
                    console.log(`CLIENT: ${event}: ${args.map(x => JSON.stringify(x, (k,v)=> { if(known.has(v)) return null; known.add(v); return v; })).join("; ")}`)
                });*/
            server.on("connect", (sess, sock) => {});
            if(argv.includes("--ws")) {
                const WS = require("ws");
                require("autostart-client/attach/ws");
                const ws = new WS.Server({server});
                sc.attachWebSocket(ws);
                ws.on("connection", conn => {
                    conn.send("Hello World!");
                });
            }

            server.listen(conn.dst, () => res(server));
            sc.attachServer(server);
        });


        /*if(server)
            await new Promise(res => );*/
    }));
    if(!standalone)
        sc.finishInitialization();
    console.error("Client running");

};
main();