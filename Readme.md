# Node-Autostart-Server
Inspired by socket-activation via [node-systemd](https://github.com/rubenv/node-systemd), this is a pure node implementation of the concept, which is useful for systems where ``systemd`` is not an option. It will create ``net.Servers`` listening to the the specified sockets and start the corresponding server apps on activity, forwarding all traffic to that app. Designed to be used with [autostart-client](https://npmjs.org/autostart-client), which will automatically shutdown the server after a period of inactivity.

## Installation
This library requires __node v.6.5.0__ or higher for ES6 feature support.

```
$ npm install autostart-server
```

## Usage

The following example will create a proxy, which will forward connections to port ``8080`` to the script ``~/server/main.js``, which should use the ``autostart-client`` library. 

```js
const autostart = require("autostart-server");
const server    = autostart([{
    "name":       "real-server",
    "client":     "./main.js",
    "dir":        "~/server/",
    "src":        8080       
}]);    
```

The construction of an ``AutoStartServer`` accepts two optional parameters:
```
apps        An Iterable of apps which are automatically added to the server (default: [])
config      Baseline configuration for the server                           (default: {})
```
``server.add(app)`` adds ``app`` to the server.

``server.close()`` will close all running apps, and stop listening to the associated ports. ``Client`` style apps will be soft-closed using the ``#asc-exit`` event, while all other events will be terminated using ``process.kill()``.

#### Configuration
The server configuration is an object with the following members (all optional):
```
socketDir   Base-directory for the creation of unix domain sockets (default: os.tmpdir()) 
```

#### App
An app describes a server application to be controlled by the ``autostart-server``. It contains the following members:
```
name        A name for the app. Must be unique over all apps for the server since it is used for identification purposes
dir         Working directory for the executed app
client      Executable file for client style apps. Resolved relative to dir. An app must contain only one of client/script/exe.
script      Executable file for script style apps. Resolved relative to dir. An app must contain only one of client/script/exe.
exe         Executable file for exe style apps. Resolved relative to dir. An app must contain only one of client/script/exe.
src         Socket to listen to in order to forward it too the the app.
dst         Socket to forward data too. For client-type apps the socket will be sent with the "#asc-init" event. (default: {socket: true})
params      CLI-parameters to be passed to the execution of the app                                              (default: [])
options     Options to be passed to the child_process fork/spawn call                                            (default: {})
initTime    Time to wait for the initialization of the app in seconds. Ignored for client style apps.            (default: 5) 
data        Data object to be send to the server. Only used for "client" type apps. 
            Will be send using the "#asc-init" event and can be accessed by the ".data" property of the client.  (default: {})
```

After being added to the server an app will be enhanced with the following additional properties: 
```
count       Number of executions for the app. Only for debuggin purposes. Periodically resetted
file        The file being executed by the app. Extracted from the client, script or exe property, depending on which is present.
type        The type of the app to execute. Either "client", "script" or "exe" depending on the original properties
```

#### AppTypes
The type determines how the app is executed and is derived from the property determining the executable file.

``exe`` is the most general type. This will execute any type of executable using a ``spawn`` call. Executing an ``exe`` using node would be done using e.g.:
```js
server.add({name: "exec", dir: "./exec", exe: "node", params: ["./server.js"], src: 8080, dst: 17328, initTime: 2});
```

``script`` is specific for node-servers. It will be executed using a ``fork`` call so that the executable can be the server script instead of the node process:
```js
server.add({name: "script", dir: "./script", script: "./server.js", src: 8080, dst: 17328, initTime: 2});
```

``client`` specifies a node-server which uses ``autostart-client``. This allows the server to communicate with the app by sending messages. This allows it to send the destination ``socket`` and data via the ``#asc-init`` event to the app, allowing the app to automatically generate the socket for forwarding. Furthermore instead of using a predetermined ``initTime`` the app will communicate when it is ready to receive connections.
```js
server.add({name: "client", dir: "./client", client: "./server.js", src: 8080});
```
#### Sockets
Sockets for ``src`` and ``dst`` can be either portnumbers or specify a unix-domain-socket (named-pipe on windows). These are specified by passing an object containing a ``socket`` property with the name of the socket. Example:
```js
server.add({name: "client", dir: "./client", client: "./server.js", src: 8080, dst: {socket: "client-sock"}});
```
Since client-type apps get passed the socket on initialization the server can automatically generate a unix-domain-socket for use. This is specified by passing ``true`` as the name for the ``socket``.
```js
server.add({name: "client", dir: "./client", client: "./server.js", src: 8080, dst: {socket: true}});
```

### Events
An ``AutoStartServer`` is an ``EventEmitter``, emitting the following events:

#### error
This event will be emitted, when there is an error on either an incoming or an outcoming connection. The event listener will be called with an object containing the following members:
```
type        "incoming" or "outgoing" depending on the connection throwing the error
error       The thrown error object
app         The app description for which the connection error occured
```

