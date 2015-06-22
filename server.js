module.exports = Server

var inherits = require('inherits')
var TerminalStream = require('terminal-stream')

inherits(Server, TerminalStream)

function Server (storage) {
  if (!(this instanceof Server)) {
    return new Server(storage)
  }

  this.storage = storage

  this.once('unpipe', function () {
    this.end()
  }.bind(this))

  TerminalStream.call(this, this.onmessage)
}

Server.prototype.send = function (message) {
  TerminalStream.prototype.send.call(this, JSON.stringify(message))
}

Server.prototype.onmessage = function (message) {
  message = JSON.parse(message)

  switch (message.method) {
    case 'on':
      this.storage.on(this, message.params.path, message.params.type, message.id)
      break
    case 'off':
      this.storage.off(this, message.params.path, message.params.type, message.id)
      break
    case 'update':
      this.storage.update(this, message.params.path, message.params.data, message.id)
      break
    case 'remove':
      this.storage.remove(this, message.params.path, message.id)
      break
  }
}
