module.exports = DbaseLocalStorage

var queue = require('queue')
var Server = require('./server')
var StorageEvent = window.StorageEvent

function DbaseLocalStorage (prefix) {
  if (!(this instanceof DbaseLocalStorage)) {
    return new DbaseLocalStorage(prefix)
  }

  this.prefix = prefix || ''
  this._clients = {}
  this._listeners = {}
  this._valueEventBuffer = {}
  this._onstorage = this._onstorage.bind(this)

  window.addEventListener('storage', this._onstorage)
}

DbaseLocalStorage.prototype.Server = function () {
  var id = (Math.random() + '').slice(2)
  if (this._clients[id]) {
    return this.Server()
  }
  var client = this._clients[id] = new Server(this)
  client.id = id
  return client
}

DbaseLocalStorage.prototype.destroy = function () {
  for (var i in this._clients) {
    var client = this._clients[i]
    client.end()
  }

  window.removeEventListener('storage', this._onstorage)
}

DbaseLocalStorage.prototype.on = function (client, path, type, cbid) {
  var eventTypes = this._listeners[path] = this._listeners[path] || {}
  var clients = eventTypes[type] = eventTypes[type] || {}
  clients[client.id] = true

  if (type === 'value') {
    var self = this
    this._readValue(path, function (err, value) {
      setTimeout(self._oninitialValue.bind(self, client, path, type, cbid, err, value))
    })
  } else {
    setTimeout(this._oninitial.bind(this, client, path, type, cbid))
  }
}

DbaseLocalStorage.prototype._oninitialValue = function (client, path, type, cbid, err, value) {
  if (cbid) {
    client.send({
      name: 'cb',
      id: cbid,
      body: err ? err.message : err
    })
  }

  if (!err) {
    client.send({
      name: 'ev',
      path: path,
      type: type,
      body: value
    })
  }
}

DbaseLocalStorage.prototype._oninitial = function (client, path, type, cbid) {
  if (type === 'key_added') {
    var meta = window.localStorage[this.prefix + 'm://' + path]
    if (meta) meta = meta.split(',')

    var children = []
    for (var key in meta) {
      children.push(key)
    }

    if (cbid) {
      client.send({
        name: 'cb',
        id: cbid
      })
    }

    client.send({
      name: 'ev',
      path: path,
      type: type,
      body: children
    })
  } else if (cbid) {
    client.send({
      name: 'cb',
      id: cbid
    })
  }
}

DbaseLocalStorage.prototype.off = function (client, path, type) {
  var eventTypes = this._listeners[path]
  if (eventTypes) {
    var clients = eventTypes[type]
    if (clients) {
      delete clients[client.id]
      if (Object.keys(clients).length === 0) {
        delete eventTypes[type]
        if (Object.keys(eventTypes).length === 0) {
          delete this._listeners[path]
        }
      }
    }
  }
}

DbaseLocalStorage.prototype.update = function (client, path, newValue, cbid) {
  this._doupdate(path, newValue, function (err) {
    client.send({
      name: 'cb',
      id: cbid,
      body: err ? err.message : err
    })
  })
}

DbaseLocalStorage.prototype._doupdate = function (path, newValue, cb) {
  var metapath = this.prefix + 'm://' + path
  var valuepath = this.prefix + 'v://' + path
  var oldValue = window.localStorage[valuepath] || null
  var key = null
  var q = queue()

  if (typeof newValue === 'object' && newValue !== null) {
    if (oldValue) {
      delete window.localStorage[valuepath]
    }

    q.push(this._updateMeta.bind(this, path, newValue))
    for (key in newValue) {
      q.push(this._doupdate.bind(this, getChildPath(path, key), newValue[key]))
    }
    q.start(cb)
  } else {
    if (!oldValue) {
      var oldMeta = window.localStorage[metapath]
      if (oldMeta) {
        var children = parseMeta(oldMeta)
        for (key in children) {
          q.push(this._doremove.bind(this, getChildPath(path, key)))
        }
      }
    }

    q.push(this._updateMeta.bind(this, path, newValue))
    q.start(function (err) {
      if (err) return cb(err)

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

      cb()
    })
  }
}

DbaseLocalStorage.prototype.remove = function (client, path, cbid) {
  this._doremove(path, function (err) {
    client.send({
      name: 'cb',
      id: cbid,
      body: err ? err.message : err
    })
  })
}

DbaseLocalStorage.prototype._doremove = function (path, cb) {
  var self = this
  var metapath = this.prefix + 'm://' + path
  var valuepath = this.prefix + 'v://' + path
  var meta = window.localStorage[metapath]
  var value = window.localStorage[valuepath]
  var children = null
  var didupdate = false
  var q = queue()

  if (meta) {
    children = parseMeta(meta)
    for (var key in children) (function (key) {
      q.push(self._doremove.bind(self, getChildPath(path, key)))
      didupdate = true
    })(key)
  } else if (value) {
    delete window.localStorage[valuepath]
    didupdate = true
  }

  q.start(function (err) {
    if (err) return cb(err)
    if (didupdate) {
      if (meta) {
        delete window.localStorage[metapath]
        window.dispatchEvent(new StorageEvent('storage', {
          key: metapath,
          oldValue: meta,
          newValue: null
        }))
      } else {
        window.dispatchEvent(new StorageEvent('storage', {
          key: valuepath,
          oldValue: value,
          newValue: null
        }))
      }

      self._updateMeta(path, null, cb)
    } else {
      cb && cb()
    }
  })
}

DbaseLocalStorage.prototype._updateMeta = function (path, newValue, cb) {
  var parentPath = getParentPath(path)

  if (path === parentPath) {
    return cb && cb()
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

    this._updateMeta(parentPath, children, cb)
  } else {
    cb && cb()
  }
}

DbaseLocalStorage.prototype._onstorage = function (evt) {
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
          name: 'ev',
          type: 'key_removed',
          path: path,
          body: removed
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
          name: 'ev',
          type: 'key_added',
          path: path,
          body: added
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

DbaseLocalStorage.prototype._handleValueEvent = function (path, numPending, clients) {
  var self = this
  if (this._valueEventBuffer[path] === numPending) {
    delete this._valueEventBuffer[path]
    this._readValue(path, function (err, value) {
      if (err) throw err
      for (var i in clients) {
        self._clients[i].send({
          name: 'ev',
          type: 'value',
          path: path,
          body: value
        })
      }
    })
  }
}

DbaseLocalStorage.prototype._readValue = function (path, cb) {
  var value = window.localStorage[this.prefix + 'v://' + path]
  if (value) {
    return cb(null, JSON.parse(value))
  } else {
    var meta = window.localStorage[this.prefix + 'm://' + path]
    if (meta) {
      meta = parseMeta(meta)
      value = {}
      var self = this
      var q = queue()

      for (var key in meta) (function (key) {
        q.push(function (cb) {
          self._readValue(getChildPath(path, key), function (err, subValue) {
            if (err) return cb(err)
            value[key] = subValue
            cb()
          })
        })
      })(key)

      q.start(function (err) {
        cb(err, value)
      })
    } else {
      cb()
    }
  }
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
