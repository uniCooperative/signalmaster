/*global console*/
var yetify = require('yetify'),
		request = require('request'),
		config = require('getconfig'),
		uuid = require('node-uuid'),
		crypto = require('crypto'),
		fs = require('fs'),
		port = parseInt(process.env.PORT || config.server.port, 10),
		server_handler = function (req, res) {
			res.writeHead(404);
			res.end();
		},
		server = null;

// Create an http(s) server instance to that socket.io can listen to
if (config.server.secure) {
	server = require('https').Server({
		key: fs.readFileSync(config.server.key),
		cert: fs.readFileSync(config.server.cert),
		passphrase: config.server.password
	}, server_handler);
} else {
	server = require('http').Server(server_handler);
}
server.listen(port);

var io = require('socket.io').listen(server);

if (config.logLevel) {
	// https://github.com/Automattic/socket.io/wiki/Configuring-Socket.IO
	io.set('log level', config.logLevel);
}

function describeRoom(name) {
	var clients = io.sockets.clients(name);
	var result = {
		clients: {}
	};
	clients.forEach(function (client) {
		result.clients[client.id] = client.resources;
	});
	return result;
}

function clientsInRoom(name) {
	return io.sockets.clients(name).length;
}

function safeCb(cb) {
	if (typeof cb === 'function') {
		return cb;
	} else {
		return function () {};
	}
}

io.sockets.on('connection', function (client) {
	client.resources = {
		screen: false,
		video: true,
		audio: false
	};

	// pass a message to another id
	client.on('message', function (details) {
		if (!details) return;

		var otherClient = io.sockets.sockets[details.to];
		if (!otherClient) return;

		details.from = client.id;
		otherClient.emit('message', details);
	});

	client.on('shareScreen', function () {
		client.resources.screen = true;
	});

	client.on('unshareScreen', function (type) {
		client.resources.screen = false;
		removeFeed('screen');
	});

	client.on('join', join);

	function removeFeed(type) {
		if (client.room) {
			io.sockets.in(client.room).emit('remove', {
				id: client.id,
				type: type
			});
			if (!type) {
				client.leave(client.room);
				client.room = undefined;
			}
		}
	}

	function join(name, cb) {
		// sanity check
		if (typeof name !== 'string') return;
		// check if maximum number of clients reached
		if (config.rooms && config.rooms.maxClients > 0 && 
				clientsInRoom(name) >= config.rooms.maxClients) {
			safeCb(cb)('full');
			return;
		}
		// leave any existing rooms
		removeFeed();
		safeCb(cb)(null, describeRoom(name));
		client.join(name);
		client.room = name;
	}

	// we don't want to pass "leave" directly because the
	// event type string of "socket end" gets passed too.
	client.on('disconnect', function () {
		removeFeed();
	});
	client.on('leave', function () {
		removeFeed();
	});

	client.on('create', function (name, cb) {
		if (arguments.length == 2) {
			cb = (typeof cb == 'function') ? cb : function () {};
			name = name || uuid();
		} else {
			cb = name;
			name = uuid();
		}
		// check if exists
		if (io.sockets.clients(name).length) {
			safeCb(cb)('taken');
		} else {
			join(name);
			safeCb(cb)(null, name);
		}
	});

	// support for logging full webrtc traces to stdout
	// useful for large-scale error monitoring
	client.on('trace', function (data) {
		console.log('trace', JSON.stringify(
					[data.type, data.session, data.prefix, data.peer, data.time, data.value]
					));
	});

	//get new turnservers form xirsys.com
	var credentials =  {
		ident: "awsdatabase",
		secret: "87776526-6245-4fff-a22c-a7fe5f5d3ed3",
		domain: "unicooperative.github.io",
		application: "default",
		room: "default",
		secure: 1
	};

	request.post('https://api.xirsys.com/getIceServers', {form: credentials}, function (err, resp, body) {
			if (!err) {
				var data = {};
				data = JSON.parse(body) || {};
				var iceservers = data.d || {};
				iceservers = iceservers.iceServers || [];
				client.emit('stunservers', iceservers);
				//client.emit('turnservers', turnservers);
			}
			else 
				client.emit('stunservers', []);
		});
});

if (config.uid) process.setuid(config.uid);

var httpUrl;
if (config.server.secure) {
	httpUrl = "https://localhost:" + port;
} else {
	httpUrl = "http://localhost:" + port;
}
console.log(yetify.logo() + ' -- signal master is running at: ' + httpUrl);
