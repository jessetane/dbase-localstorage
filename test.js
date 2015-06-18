var hyperbaseTest = require('hyperbase/test')
var hyperbaseStorage = require('./')

var storage = hyperbaseStorage()
var server = storage.Server()

hyperbaseTest(server)
