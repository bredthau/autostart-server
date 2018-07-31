# Node-Autostart-Server
Inspired by socket-activation via [node-systemd](https://github.com/rubenv/node-systemd), this is a pure node implementation of the concept, which is useful for systems where ``systemd`` is not an option. It will create ``net.Servers`` listening to the the specified sockets and start the corresponding server apps on activity, forwarding all traffic to that app. Designed to be used with [autostart-client](https://npmjs.org/autostart-client), which will automatically shutdown the server after a period of inactivity.

## Installation
This library requires __node v.7.6.0__ or higher. In principle it should work with node versions since __node v.6.5.0__, however the tests use newer features, so use at your own risk.

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

``server.close()`` will close all running apps, and stop listening to the associated ports. ``Client`` style apps will be soft-closed using the ``#asc-exit`` event, while other app-types will be terminated using ``process.kill()``. ``server.close()``
has an optional boolean argument ``force``. If true it will force an immediate close by destroying all active connections to servers
and killing non client apps using ``SIGKILL`` instead of ``SIGTERM``.

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
connections Array of connections to the app as connection-objects 
src         Socket to listen to in order to forward it too the the app. Only used if app does not have the connections property.
dst         Socket to forward data too. For client-type apps the socket will be sent with the "#asc-init" event. 
            Only used if app does not have a connections property                                              (default: {socket: true})
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
#### Connections
The ``connections`` property lists all connections to be forwarded to the app. A ``ConnectionObject`` has the properties ``connection.src`` and ``connection.dst``, which specify the socket inbound to the server (``connection.src``) and the socket for connecting to the client (``connection.dst``) respectively. If no ``connections`` are specified it will be automatically populated from the ``.src`` and ``.dst`` properties of the ``app`` specification. This means that the following two calls behave identical:
```js
server.add({name: "client", dir: "./client", client: "./server.js", connections: [{src: 8080, dst: 17821}]});
server.add({name: "client", dir: "./client", client: "./server.js", src: 8080, dst: 17821});
```
Using ``.connections`` allows the server to have multiple connections to the client app, e.g.:
```js
server.add({name: "client", dir: "./client", client: "./server.js", connections: [{src: 8080, dst: 17821}, {src: 8081, dst: 17822}]});
```


Sockets for ``src`` and ``dst`` are generally objects, specifying the connection. They can either contain a property ``port``, which specifies an TCP-portnumber or a property ``socket``, specifying a unix-domain-socket (on windows systsm named-pipes are used instead). As a shorthand a number can be used which is interpreted as a TCP-portnumber.  Example:
```js
server.add({name: "client", dir: "./client", client: "./server.js", src: {port: 8080}, dst: {socket: "client-sock"}});
```
Since client-type apps get passed the socket on initialization the server can automatically generate a unix-domain-socket for use. This is specified by passing ``true`` as the name for the ``socket``.
```js
server.add({name: "client", dir: "./client", client: "./server.js", src: 8080, dst: {socket: true}});
```

If nothing is specified for the ``dst`` of a connection, it will be automatically generated as ``{socket: true}``. Note however that this is only useful if the information is somehow communicated to the app. For ``client``-type apps this happens automatically, for other apps this must be done manually. 

### Manual Control
Apps can be started and stopped manually.
 
``server.start("myApp")`` will start the app with name ``myApp`` and return a ``Promise`` which will resolve when the app is ready.

``server.stop("myApp")`` will stop the app with name ``myApp`` if it is running. It returns a ``Promise`` which will resolve when the app has closed or immediatly if ``myApp`` was not active.

``server.all()`` returns an iterator over the names of all registered apps. 

### Events
An ``AutoStartServer`` is an ``EventEmitter``, emitting the following events:

#### error
This event will be emitted, whenever there is an error in the Server. This means that either starting an app failed or there is a problem with either an incoming or an outcoming connection. The event listener will be called with an object containing the following members:
```
type        "app" if starting an app failed, "incoming" or "outgoing" if an incoming respectively outgoing connection failed
error       The thrown error object or errorcode
app         The app description for which the error occured
```

#### connection
Will be emitted when a new connection to the server is established. Event emitters are passed the ``connection`` and the ``app`` description.

#### app.start
This event will be emitted when ever an app is started due to an incoming connection. Event emitters are passed the ``app`` description and the started ``child_process``.


#### app.stop
This event will be emitted whenever an app shuts down (due to inactivity or error). Event emitters are passed the ``app`` description and the started ``child_process``.

#### app.error
This event will be emitted when an app stops due to an error, either because the ``child_process`` could not be started, or because the app stopped with a non-zero exit code. Event emitters are passed the error code or object, the ``app`` description and the started ``child_process``.