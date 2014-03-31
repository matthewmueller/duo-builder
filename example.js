var Builder = require('./');
var co = require('co');
var jade = require('duo-jade');
var entry = __dirname + '/example-app/index.js';

var builder = Builder(entry)
  .to('build/build.js')
  .transform('jade', jade());

// wrap
builder.build = co(builder.build);

console.time('builder');

// build
builder.build(function(err) {
  if (err) throw err;
  console.timeEnd('builder');
  console.log('built!');
});
