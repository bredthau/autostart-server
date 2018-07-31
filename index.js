"use strict";
const net           = require("net");
const cp            = require('child_process');
const crypto        = require('crypto');
const os            = require('os');
const path          = require('path');
const EventEmitter  = require("events");
const Data          = Symbol("Data"),
      StartApp      = Symbol("StartApp"),
      ConnectProxy  = Symbol("ConnectProxy");

let baseConfig = {
    socketDir: os.tmpdir()
};
const log = () => {};//console.error.bind(console);
/* istanbul ignore next */
function makeSocket(name, {socketDir = os.tmpdir()} = {}) { return (process.platform.match(/win32/ig) ? "\\\\.\\pipe\\"+name : path.resolve(process.cwd(), path.join(socketDir, name+'.sock'))); }

function generateSocket(config) {
    const name = crypto.randomBytes(16).toString("hex");
    return makeSocket(name, config);
}
const appTypes = Object.assign({}, ...["client", "script", "exe"].map(x => ({[x]: x})));
function isScript(app) { return app.type === appTypes.client || app.type === appTypes.script; }
function resolveTarget(target, conf, autogen = true) {
    if(target === undefined) {
        if(autogen)
            return generateSocket(conf);
        throw new Error("Unknown target");
    }
    if(typeof target === "object") {
        if(target.socket) {
            if(target.socket === true)
                return generateSocket(conf);
            return makeSocket(target.socket, conf);
        } if(target.port)
            return target.port;
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
    startApp(appEntry) {
        if(appEntry.starting)
            return appEntry.starting;
        const start = new Promise((resolve, reject) => {
            const app    = appEntry.app;
            app.count    = app.count + 1;
            const conf   = Object.assign({cwd: app.dir, silent: true}, app.options || {});
            log && log(`Starting ${app.name} as ${isScript(app) ? "fork" : "spawn"}(${app.file}, ${JSON.stringify(app.params)}, ${JSON.stringify(conf)})`);
            const exe    = isScript(app) ? cp.fork( app.file, app.params, conf)
                                         : cp.spawn(app.file, app.params, conf);
            if(!(app.options ||{}).silent) {
                exe.stdout.pipe(process.stdout);
                exe.stderr.pipe(process.stderr);
            }
            //console.error("Exe");
            appEntry.exit    = new Promise((res, rej) => {
                let exited = false;
                exe.on("exit", (code) => {
                    /* istanbul ignore if*/
                    if(exited) // Guard against invocation of both error and exit.
                        return;// Necessary according to https://nodejs.org/api/child_process.html#child_process_event_error), could not reproduce
                    exited = true;
                    log && log(`${app.name}(${app.count}) exited with code ${code}`);
                    appEntry.process = null;
                    this.emitter.emit("app.stop", app, exe);
                    if(code !== 0)
                        this.emitter.emit("app.error", code, app, exe);
                    if(appEntry.starting) {//app does not start
                        this.emitter.emit("error", {type: "app", error: code, app});
                        reject(code);
                    }
                    res(code);
                });
                exe.on("error", (err) => {
                    /* istanbul ignore if*/
                    if(exited) // Guard against invocation of both error and exit.
                        return;// Necessary according to https://nodejs.org/api/child_process.html#child_process_event_error), could not reproduce
                    exited = true;
                    appEntry.process = null;
                    log && log(`${app.name}(${app.count}) weeored with code ${err}`);
                    this.emitter.emit("app.error", err, app, exe);
                    this.emitter.emit("error", {type: "app", error: err, app});
                    if(app.starting)
                        reject(err);
                    rej(err);
                });
            }).then(c => true).catch(e => false);
            if(app.type === appTypes.client) {
                exe.send({type: "#asc-init", src: app.connections[0].dst, connections: app.connections, data: app.data || {}});
                exe.on("message", m => (m && m.type === "#asc-ready") && resolve(exe));
            } else
                setTimeout(() => resolve(exe), app.initTime * 1000);
        }).then(exe => {
            appEntry.process  = exe;
            appEntry.starting = null;
            this.emitter.emit("app.start", appEntry.app, exe);
            return exe;
        }).catch(e => {
            console.log("Failed starting: "+appEntry.app.name+": "+e+"\n"+e.stack);
            appEntry.starting = null;
            appEntry.process  = null;
            appEntry.exit     = Promise.resolve(false);
            //console.error("Starting failed: "+JSON.stringify(e));
            //throw e;
            return null;
        });
        appEntry.starting  = start;
        return start;
    }
    stopApp(appEntry, force)  {
        console.log("Kill: "+((appEntry.app.type === appTypes.client) ? `send({type: "#asc-exit"})` : `kill(${force ? 9 : 15})`));
        if(appEntry.process)
            (appEntry.app.type === appTypes.client) ? appEntry.process.send({type: "#asc-exit"}) : appEntry.process.kill(force ? 9 : 15);
        return appEntry.exit;
    }
    connectProxy(conf, appEntry, connectionSpec, connection) {
        const app = appEntry.app;
        if(!appEntry.process)
            return this.startApp(appEntry).then((p) => p ? this.connectProxy(conf, appEntry, connectionSpec, connection) : null);

        const proxy = net.connect(connectionSpec.dst);
        proxy.once('connect', () => {
            log && log(`Init pipe to ${app.name}`);
            connection.pipe(proxy);
            proxy.pipe(connection);
            conf.proxy = proxy;
        });
        proxy.on('error', (e) => {
            if(!appEntry.process)
                return this.startApp(appEntry).then((p) => p ? this.connectProxy(conf, appEntry, connectionSpec, connection) : null);
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
            type: appTypes[Object.keys(appTypes).find(x => app[x])],
        });
        app = Object.assign(app, {file: app[app.type]});
        if(!app.connections)
            app.connections = [{src: app.src, dst: app.dst}];
        app.connections = app.connections.map(x => ({src: resolveTarget(x.src, this.config, false), dst: resolveTarget(x.dst, this.config, true)}));
        const appEntry = {app, servers: [], process: null, exit: Promise.resolve(false), starting: null};
        this.apps.set(app.name, appEntry);
        for(let conn of app.connections) {
            const connections = new Set();
            const server   = net.createServer((connection) => {
                this.emitter.emit("connection", connection, app);
                connections.add(connection);
                let proxy = {proxy: null};
                connection.on("error", /* istanbul ignore next */ (e) => {
                    connection.destroy();
                    proxy.proxy && proxy.proxy.destroy();
                    log && log(`Connection Error for ${app.name}:\n` + e);
                    this.emitter.emit("error", {type: "incoming", error: e, app});
                });
                connection.on("close", () => connections.delete(connection));
                this.connectProxy(proxy, appEntry, conn, connection, connections);
            });
            appEntry.servers.push({server, connections});
            server.listen(conn.src, function() {
                log && log(`Forwarding ${this.address().address}:${conn.src} to ${app.name}`);
            });
        }
    }
    close(force = false) {
        const apps = this.apps;
        this.apps  = new Map();
        this.emitter.emit("Closing");
        apps.forEach(x => x.servers.map(s => s.server.getConnections((err, conn) => console.log(x.app.name+": "+conn + "(force: "+force+")"))));
        return Promise.all(Array.from(apps.values()).map(x => {
            return Promise.all(x.servers.map(y => new Promise((res, rej) => {
                try {

                    force && y.connections.forEach(x => { console.error("Destroying "); x.end();  x.destroy();});
                } catch(e) { console.error(e); }
                y.server.close(() => res())
            }))).then(() => this.stopApp(x, force));
        })).then(() => { this.emitter.emit("Closed"); return this; });
    }

}

class AutoStartServer extends EventEmitter {
    constructor(apps = [], config = {}) {
        super();
        this[Data] = new InternalServer(config, this);
        for (const app of apps)
            this.add(app);
    }
    off(evt, listener)        { this.removeListener(evt, listener); }
    all()                     { return this[Data].apps.keys(); }
    add(app)                  { this[Data].add(app); }
    start(name)               { return this[Data].startApp(this[Data].apps.get(name)); }
    stop(name, force = false) { return this[Data].stopApp(this[Data].apps.get(name), force); }
    close(force = false)      { return this[Data].close(force); }
}
const create     = (apps = [], config = {}) => new AutoStartServer(apps, config);
module.exports   = create;