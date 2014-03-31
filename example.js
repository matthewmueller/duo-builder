var Builder = require('./');
var co = require('co');
var jade = require('jade');
var entry = __dirname + '/example-app/index.js';
var builder = Builder(entry)
  .to('build/build.js')
  .use('.jade', compileJade);

// wrap
builder.build = co(builder.build);

console.time('builder');
builder.build(function(err) {
  if (err) throw err;
  console.timeEnd('builder');
  console.log('built!');
});

var fs = require('fs');
var path = require.resolve('jade/runtime.js');
var runtime = fs.readFileSync(path, 'utf8');
builder.include('jade-runtime', runtime)

function compileJade(src, json) {
  return 'var jade = require(\'jade-runtime\');\n\n' +
         'module.exports = ' + jade.compileClient(src) + ';';
}
