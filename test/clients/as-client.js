const http          = require("http");
const path          = require("path");
const shutdown = require("autostart-client");
async function main() {
    if(process.argv[2] === "-n")
        return;
    const standalone = (process.argv[2] === "-s");

    const scGen      = standalone ? shutdown.autoShutdown : shutdown.client;
    const sc = scGen({timeout: 0.5, deferInit: true});//.attachServer(server);
    const socket = standalone ? (process.argv[3] || 63521) : await sc.socket;//  process.argv[2] || 63521;

    const server = await new Promise((res, rej) => {
        const server = http.createServer((req, res) => res.end('Hello World!'));
        server.listen(socket, () => res(server));
    });
    sc.attachServer(server);
    if(!standalone)
        sc.finishInitialization();

};
main();