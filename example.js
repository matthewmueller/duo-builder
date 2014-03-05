var Builder = require('./');
var co = require('co');
var pack = require('browser-pack')();
var entry = __dirname + '/example-app/index.js';
var builder = Builder(entry);

console.time('builder');
co(builder.build).call(builder, function(err) {
  console.timeEnd('builder');
  if (err) {
    console.log(err);
    throw new Error(err);
  }
  else console.log('built!');
  // console.log(JSON.stringify(builder.pack, true, 2));
});


// var browserify = require('browserify');
// var b = browserify();
// var fs = require('fs');
// b.add(entry);
// b.bundle().pipe(fs.createWriteStream(__dirname + '/example-app/bundle.js'));
