module.exports = Server

var inherits = require('inherits')
var TerminalStream = require('terminal-stream')

inherits(Server, TerminalStream)

function Server (storage) {
  if (!(this instanceof Server)) {
    return new Server(storage)
  }

  this.storage = storage

  TerminalStream.call(this, this.onmessage)
}

Server.prototype.send = function (message) {
  TerminalStream.prototype.send.call(this, JSON.stringify(message))
}

Server.prototype.onmessage = function (message) {
  message = JSON.parse(message)

  switch (message.name) {
    case 'on':
      this.storage.on(this, message.path, message.type, message.cb)
      break
    case 'off':
      this.storage.off(this, message.path, message.type, message.cb)
      break
    case 'update':
      this.storage.update(this, message.path, message.body, message.cb)
      break
    case 'remove':
      this.storage.remove(this, message.path, message.cb)
      break
  }
}
