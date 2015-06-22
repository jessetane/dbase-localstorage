module.exports = HyperbaseLocalStorage

var Server = require('./server')
var StorageEvent = window.StorageEvent

function HyperbaseLocalStorage (prefix) {
  if (!(this instanceof HyperbaseLocalStorage)) {
    return new HyperbaseLocalStorage(prefix)
  }

  this.prefix = prefix || ''
  this._clients = {}
  this._listeners = {}
  this._valueEventBuffer = {}
  this._onstorage = this._onstorage.bind(this)

  window.addEventListener('storage', this._onstorage)
}

HyperbaseLocalStorage.prototype.Server = function () {
  var id = (Math.random() + '').slice(2)
  if (this._clients[id]) {
    return this.Server()
  }
  var client = this._clients[id] = new Server(this)
  client.listeners = {}
  client.id = id
  client.once('end', function () {
    for (var path in client.listeners) {
      for (var type in client.listeners[path]) {
        delete this._listeners[path][type][id]
      }
    }
    delete this._clients[id]
  }.bind(this))
  return client
}

HyperbaseLocalStorage.prototype.destroy = function () {
  for (var i in this._clients) {
    var client = this._clients[i]
    client.end()
  }

  window.removeEventListener('storage', this._onstorage)
}

HyperbaseLocalStorage.prototype.on = function (client, path, type, cbid) {
  var eventTypes = this._listeners[path] = this._listeners[path] || {}
  var clients = eventTypes[type] = eventTypes[type] || {}
  clients[client.id] = true

  eventTypes = client.listeners[path] = client.listeners[path] || {}
  eventTypes[type] = true

  if (cbid) {
    client.send({
      id: cbid
    })
  }

  if (type === 'value') {
    var value = this._readValue(path)

    client.send({
      method: 'event',
      params: {
        path: path,
        type: type,
        data: value
      }
    })
  } else if (type === 'key_added') {
    var meta = window.localStorage[this.prefix + 'm://' + path]
    if (meta) meta = parseMeta(meta)

    var children = []
    for (var key in meta) {
      children.push(key)
    }

    client.send({
      method: 'event',
      params: {
        path: path,
        type: type,
        data: children
      }
    })
  }
}

HyperbaseLocalStorage.prototype.off = function (client, path, type, cbid) {
  var eventTypes = this._listeners[path]
  if (eventTypes) {
    var clients = eventTypes[type]
    if (clients) {
      if (clients[client.id]) {
        delete this._clients[client.id].listeners[path][type]
      }
      delete clients[client.id]
      if (Object.keys(clients).length === 0) {
        delete eventTypes[type]
        if (Object.keys(eventTypes).length === 0) {
          delete this._listeners[path]
        }
      }
    }
  }
  if (cbid) {
    client.send({
      id: cbid
    })
  }
}

HyperbaseLocalStorage.prototype.update = function (client, path, newValue, cbid) {
  this._doupdate(path, newValue)

  if (cbid) {
    client.send({
      id: cbid
    })
  }
}

HyperbaseLocalStorage.prototype._doupdate = function (path, newValue) {
  var metapath = this.prefix + 'm://' + path
  var valuepath = this.prefix + 'v://' + path
  var oldValue = window.localStorage[valuepath] || null
  var key = null

  if (typeof newValue === 'object' && newValue !== null) {
    if (oldValue) {
      delete window.localStorage[valuepath]
    }

    this._updateMeta(path, newValue)
    for (key in newValue) {
      this._doupdate(getChildPath(path, key), newValue[key])
    }
  } else {
    if (!oldValue) {
      var oldMeta = window.localStorage[metapath]
      if (oldMeta) {
        var children = parseMeta(oldMeta)
        for (key in children) {
          this._doremove(getChildPath(path, key))
        }
      }
    }

    this._updateMeta(path, newValue)

    if (newValue === '' || newValue === null || newValue === undefined) {
      newValue = null
    } else {
      newValue = JSON.stringify(newValue)
    }

    if (oldValue !== newValue) {
      if (!newValue) {
        delete window.localStorage[valuepath]
      } else {
        window.localStorage[valuepath] = newValue
      }

      window.dispatchEvent(new StorageEvent('storage', {
        key: valuepath,
        oldValue: oldValue,
        newValue: newValue
      }))
    }
  }
}

HyperbaseLocalStorage.prototype.remove = function (client, path, cbid) {
  this._doremove(path)

  if (cbid) {
    client.send({
      id: cbid
    })
  }
}

HyperbaseLocalStorage.prototype._doremove = function (path) {
  var self = this
  var metapath = this.prefix + 'm://' + path
  var valuepath = this.prefix + 'v://' + path
  var meta = window.localStorage[metapath]
  var value = window.localStorage[valuepath]
  var children = null
  var didupdate = false

  if (meta) {
    children = parseMeta(meta)
    for (var key in children) {
      this._doremove(getChildPath(path, key))
    }
  } else if (value) {
    delete window.localStorage[valuepath]
    didupdate = true
  }

  if (didupdate) {
    if (meta) {
      delete window.localStorage[metapath]
    } else {
      window.dispatchEvent(new StorageEvent('storage', {
        key: valuepath,
        oldValue: value,
        newValue: null
      }))
    }

    this._updateMeta(path)
  }
}

HyperbaseLocalStorage.prototype._updateMeta = function (path, newValue) {
  var parentPath = getParentPath(path)

  if (path === parentPath) {
    return
  }

  var parentMetaPath = this.prefix + 'm://' + parentPath
  var meta = window.localStorage[parentMetaPath]
  var children = parseMeta(meta)
  var didupdate = false
  var key = getKey(path)

  if (newValue && !children[key]) {
    didupdate = true
    children[key] = 1
  } else if (!newValue && children[key]) {
    didupdate = true
    delete children[key]
  }

  if (didupdate) {
    if (Object.keys(children).length) {
      children = Object.keys(children).join(',')
      window.localStorage[parentMetaPath] = children
    } else {
      children = null
      delete window.localStorage[parentMetaPath]
    }

    window.dispatchEvent(new StorageEvent('storage', {
      key: parentMetaPath,
      oldValue: meta,
      newValue: children
    }))

    this._updateMeta(parentPath, children)
  }
}

HyperbaseLocalStorage.prototype._onstorage = function (evt) {
  if (!evt.key) return

  var eventTypes, clients
  var parts = evt.key.split('://')
  var path = parts[1]
  var type = parts[0]

  if (type.indexOf(this.prefix) !== 0) {
    return
  }

  if (evt.newValue === evt.oldValue) {
    return
  }

  if (type.slice(-1) === 'm') {
    var oldValue = parseMeta(evt.oldValue)
    var newValue = parseMeta(evt.newValue)
    var n, key

    eventTypes = this._listeners[path]
    if (!eventTypes) {
      return
    }

    clients = eventTypes['key_removed']
    if (clients) {
      var removed = []
      for (key in oldValue) {
        if (!newValue[key]) {
          removed.push(key)
        }
      }
      for (n in clients) {
        this._clients[n].send({
          method: 'event',
          params: {
            type: 'key_removed',
            path: path,
            data: removed
          }
        })
      }
    }

    clients = eventTypes['key_added']
    if (clients) {
      var added = []
      for (key in newValue) {
        if (!oldValue[key]) {
          added.push(key)
        }
      }
      for (n in clients) {
        this._clients[n].send({
          method: 'event',
          params: {
            type: 'key_added',
            path: path,
            data: added
          }
        })
      }
    }
  } else {
    var parents = ('/' + path).split('/')
    while (parents.length) {
      path = parents.slice(1).join('/')
      eventTypes = this._listeners[path]
      if (eventTypes) {
        clients = eventTypes['value']
        if (clients) {
          var numPending = this._valueEventBuffer[path] || 0
          this._valueEventBuffer[path] = ++numPending
          setTimeout(this._handleValueEvent.bind(this, path, numPending, clients))
        }
      }
      parents.pop()
    }
  }
}

HyperbaseLocalStorage.prototype._handleValueEvent = function (path, numPending, clients) {
  var self = this
  if (this._valueEventBuffer[path] === numPending) {
    delete this._valueEventBuffer[path]
    var value = this._readValue(path)
    for (var i in clients) {
      var client = self._clients[i]
      client && client.send({
        method: 'event',
        params: {
          type: 'value',
          path: path,
          data: value
        }
      })
    }
  }
}

HyperbaseLocalStorage.prototype._readValue = function (path) {
  var value = window.localStorage[this.prefix + 'v://' + path]
  if (value) {
    value = JSON.parse(value)
  } else {
    var meta = window.localStorage[this.prefix + 'm://' + path]
    if (meta) {
      meta = parseMeta(meta)
      value = {}
      for (var key in meta) {
        value[key] = this._readValue(getChildPath(path, key))
      }
    }
  }
  return value
}

function parseMeta (meta) {
  var children = {}
  if (meta) {
    meta = meta.split(',')
    for (var i = 0; i < meta.length; i++) {
      children[meta[i]] = true
    }
  }
  return children
}

function getKey (path) {
  path = path || ''
  var parts = path.split('/')
  return parts.slice(-1)[0]
}

function getParentPath (path) {
  var parts = path.split('/')
  parts.pop()
  return parts.join('/')
}

function getChildPath (path, key) {
  return path ? (path + '/' + key) : key
}
