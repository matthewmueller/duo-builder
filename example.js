var Builder = require('./');
var co = require('co');
var jade = require('jade');
var entry = __dirname + '/example-app/index.js';
var builder = Builder(entry)
  .use('.jade', compileJade);

co(builder.build).call(builder, function(err) {
  // console.timeEnd('builder');
  if (err) {
    console.log(err);
    throw new Error(err);
  }
  else console.log('built!');
  // console.log(JSON.stringify(builder.pack, true, 2));
});

var fs = require('fs');
var runtime = fs.readFileSync(__dirname + '/node_modules/jade/lib/runtime.js', 'utf8');
builder.inject('jade-runtime', runtime)

function compileJade(src, json) {
  return 'var jade = require(\'jade-runtime\');\n\n' +
         'module.exports = ' + jade.compileClient(src) + ';';
}
