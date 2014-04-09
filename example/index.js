var Builder = require('../');
var co = require('co');
var jade = require('duo-jade');

var builder = Builder(__dirname + '/main.js')
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
