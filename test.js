var dbaseTest = require('dbase/test')
var dbaseStorage = require('./')

var storage = dbaseStorage()
var server = storage.Server()

dbaseTest(server)
