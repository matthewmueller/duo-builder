/**
 * Module Dependencies
 */

var uid = require('uid');
var events = require('events');
var infinite = require('component-infinity');
var test = require('./test');
var signup = require('/lib/signup/signup.js')
var login = require('/lib/login/');
var tpl = require('./tpl.jade');
console.log(tpl({
  name: '<b>matt</b>'
}));

/**
 * UID
 */

console.log(uid(10));
console.log(infinite);
console.log(signup);
console.log(login);
