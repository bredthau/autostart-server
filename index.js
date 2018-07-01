const net           = require("net");
const cp            = require('child_process');
const crypto        = require('crypto');
const os            = require('os');
const EventEmitter  = require("events");
const Data          = Symbol("Data"),
      StartApp      = Symbol("StartApp"),
      ConnectProxy  = Symbol("ConnectProxy");

let baseConfig = {
    socketDir: os.tmpdir()
};
const log = () => {};//console.log.bind(console);
/* istanbul ignore next */
function makeSocket(name, config) { return (process.platform.match(/win32/ig) ? "\\\\.\\pipe\\"+name : path.join(config.socketDir, name+'.sock')); }

function generateSocket(config) {
    const name = crypto.randomBytes(16).toString("hex");
    return makeSocket(name, config);
}
const appTypes = Object.assign({}, ...["client", "script", "exe"].map(x => ({[x]: x})));

function resolveTarget(target, conf) {
    if(target === undefined)
        return generateSocket(conf);
    if(typeof target === "object") {
        if(target.socket) {
            if(target.socket === true)
                return generateSocket(conf);
            return makeSocket(target.socket, conf);
        }
        else
            throw new Error("Unrecognizable options given: "+JSON.stringify(socket));
    }
    return target;

}

class InternalServer {
    constructor(config, emitter) {
        this.apps    = new Map();
        this.config  = Object.assign(baseConfig, config);
        this.emitter = emitter;
    }
    startApp(appEntry, cb) {
        const app    = appEntry.app;
        log && log("Starting "+app.name);
        app.count    = app.count + 1;
        const script = app.client || app.script;
        const conf   = Object.assign({cwd: app.dir, silent: false}, app.options || {});
        const exe    = script ? cp.fork(app.file, app.params, conf)
                              : cp.spawn(app.exe, app.params, conf);
        appEntry.process = exe;
        appEntry.exit    = new Promise((res, rej) => {
            exe.on('close', (code) => {
                log && log(`${app.name}(${app.count}) exited with code ${code}`);
                appEntry.process = null;
                res(code);
            });
        });
        if(app.type === appTypes.client) {
            exe.send({type: "#asc-init", src: app.dst, data: app.data || {}});
            exe.on("message", m => (m && m.type === "#asc-ready") && cb());
        } else
            setTimeout(cb, app.initTime * 1000);
    }
    connectProxy(conf, appEntry, connection, chunk) {
        const app = appEntry.app;
        if(!appEntry.process)
            return this.startApp(appEntry, () => this.connectProxy(conf, appEntry, connection, chunk));
        const proxy = net.connect(app.dst);
        proxy.once('connect', () => {
            log && log(`Init pipe to ${app.name}`);
            proxy.write(chunk);
            connection.pipe(proxy);
            proxy.pipe(connection);
            conf.proxy = proxy;
        });
        proxy.on('error', (e) => {
            proxy.destroy();
            conf.proxy = null;
            log && log(`Proxy error: ${e}`);
            connection.unpipe(proxy);
            connection.destroy();
            this.emitter.emit("error", {type: "outgoing", error: e, app});
        });
        return true;
    }


    add(app) {
        app = Object.assign({count: 0, initTime: 5, params: []}, app, {
            src: resolveTarget(app.src, this.config), dst: resolveTarget(app.dst, this.config),
            type: appTypes[Object.keys(appTypes).find(x => app[x])],
        });
        app = Object.assign(app, {file: app[app.type] });
        const server = net.createServer((connection) => {
            let proxy = { proxy: null};
            connection.on("error", (e) => {
                /* istanbul ignore next */
                (() => {
                    connection.destroy();
                    proxy.proxy && proxy.proxy.destroy();
                    log && log(`Connection Error for ${app.name}:\n` + e);
                    this.emitter.emit("error", {type: "incoming", error: e, app});
                })();
            });
            connection.once("data", (chunk) => {
                this.connectProxy(proxy, appEntry, connection, chunk);
            });

        });
        const appEntry = {app, server, process: null, exit: Promise.resolve(0)};
        this.apps.set(app.name, appEntry);
        server.on("error", (e) => {
            this.emitter.emit("error", {type: "incoming", error: e, app});
        });
        server.listen(app.src, function(){
            var addr = this.address();
            log && log(`Forwarding ${addr.address}:${app.src} to ${app.name}`);
        });
    }
    close() {
        const apps = this.apps;
        this.apps  = new Map();
        return Promise.all(Array.from(apps.values()).map(x => {
            if(x.process)
                (x.app.type === appTypes.client) ? x.process.send({type: "#asc-exit"}) : x.process.kill();
            return Promise.all([x.exit,
                                new Promise((res, rej) => x.server.close(() => res()))]);
        }));
    }
}

class AutoStartServer extends EventEmitter {
    constructor(apps = [], config = {}) {
        super();
        this[Data] = new InternalServer(config, this);
        for (const app of apps)
            this.add(app);
    }
    off(evt, listener) { this.removeListener(evt, listener); }
    add(app) { this[Data].add(app); }
    close()  { return this[Data].close(); }
}
const create     = (apps = [], config = {}) => new AutoStartServer(apps, config);
module.exports   = create;