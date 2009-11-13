HOST = null; // localhost
PORT = 8001;

var fu = require("./fu");
var sys = require("sys");

var MESSAGE_BACKLOG = 200;
var SESSION_TIMEOUT = 60 * 1000;

var channels={};

function createChannel(name) {
  var channel = new function () {
    var messages = [];
    var callbacks = [];

    this.appendMessage = function (nick, type, text) {
      var m = { nick: nick
              , type: type // "msg", "join", "part"
              , text: text
              , timestamp: (new Date()).getTime()
              };

      switch (type) {
        case "msg":
          sys.puts("<" + nick + "> " + text);
          break;
        case "join":
          sys.puts(nick + " join");
          break;
        case "part":
          sys.puts(nick + " part");
          break;
      }

      messages.push( m );

      while (callbacks.length > 0) {
        callbacks.shift().callback([m]);
      }

      while (messages.length > MESSAGE_BACKLOG)
        messages.shift();
    };

    this.query = function (since, callback) {
      var matching = [];
      for (var i = 0; i < messages.length; i++) {
        var message = messages[i];
        if (message.timestamp > since)
          matching.push(message)
      }

      if (matching.length != 0) {
        callback(matching);
      } else {
        callbacks.push({ timestamp: new Date(), callback: callback });
      }
    };

    // clear old callbacks
    // they can hang around for at most 30 seconds.
    setInterval(function () {
      var now = new Date();
      while (callbacks.length > 0 && now - callbacks[0].timestamp > 30*1000) {
        callbacks.shift().callback([]);
      }
    }, 1000);
  };

  channels[name] = channel;
  return channel;
}

createChannel("");

var sessions = {};

function createSession (nick) {
  if (nick.length > 50) return null;
  if (/[^\w_\-^!]/.exec(nick)) return null;

  for (var i in sessions) {
    var session = sessions[i];
    if (session && session.nick === nick) return null;
  }

  var session = { 
    nick: nick, 

    id: Math.floor(Math.random()*99999999999).toString(),

    channel: channels[""],

    timestamp: new Date(),

    poke: function () {
      session.timestamp = new Date();
    },

    destroy: function () {
      session.channel.appendMessage(session.nick, "part");
      delete sessions[session.id];
    },

    switchTo: function (channelName) {
      session.channel.appendMessage(session.nick, "part");
      session.channel = channels[channelName] || createChannel(channelName);
      session.channel.appendMessage(session.nick, "join");
    }
  };

  sessions[session.id] = session;
  return session;
}

// interval to kill off old sessions
setInterval(function () {
  var now = new Date();
  for (var id in sessions) {
    if (!sessions.hasOwnProperty(id)) continue;
    var session = sessions[id];

    if (now - session.timestamp > SESSION_TIMEOUT) {
      session.destroy();
    }
  }
}, 1000);

fu.listen(PORT, HOST);

fu.get("/", fu.staticHandler("index.html"));
fu.get("/style.css", fu.staticHandler("style.css"));
fu.get("/client.js", fu.staticHandler("client.js"));
fu.get("/jquery-1.2.6.min.js", fu.staticHandler("jquery-1.2.6.min.js"));


fu.get("/who", function (req, res) {
  var nicks = [];
  for (var id in sessions) {
    if (!sessions.hasOwnProperty(id)) continue;
    var session = sessions[id];
    nicks.push(session.nick);
  }
  res.simpleJSON(200, { nicks: nicks });
});

fu.get("/join", function (req, res) {
  var nick = req.uri.params["nick"];
  if (nick == null || nick.length == 0) {
    res.simpleJSON(400, {error: "Bad nick."});
    return;
  }
  var session = createSession(nick);
  if (session == null) {
    res.simpleJSON(400, {error: "Nick in use"});
    return;
  }

  //sys.puts("connection: " + nick + "@" + res.connection.remoteAddress);

  session.channel.appendMessage(session.nick, "join");
  res.simpleJSON(200, { id: session.id, nick: session.nick});
});

fu.get("/part", function (req, res) {
  var id = req.uri.params.id;
  var session;
  if (id && sessions[id]) {
    session = sessions[id];
    session.destroy();
  }
  res.simpleJSON(200, { });
});

fu.get("/recv", function (req, res) {
  if (!req.uri.params.since) {
    res.simpleJSON(400, { error: "Must supply since parameter" });
    return;
  }
  var id = req.uri.params.id;
  var session;
  if (id && sessions[id]) {
    session = sessions[id];
    session.poke();
  }

  var since = parseInt(req.uri.params.since, 10);

  var channel = session ? session.channel : channels[""];
  channel.query(since, function (messages) {
    if (session) session.poke();
    res.simpleJSON(200, { messages: messages });
  });
});

var commands = {
  "join": function(session, arg) { session.switchTo(arg); },
  "leave": function(session) { session.switchTo(""); }
};
 
fu.get("/send", function (req, res) {
  var id = req.uri.params.id;
  var text = req.uri.params.text;

  var session = sessions[id];
  if (!session || !text) {
    res.simpleJSON(400, { error: "No such session id" });
    return; 
  }

  session.poke();
  
  var match = text.match(/^\/(\S+)\s*(.+)?$/);
  if (match) {
    sys.puts(match.length + " " + match)
    var command = commands[match[1]];
    if (command) {
      command(session, match[2] ? match[2].split(/\s/) : []);
    }
  } else {
    session.channel.appendMessage(session.nick, "msg", text);
  }
  res.simpleJSON(200, {});
});
