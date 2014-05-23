
var inspect = require('util').inspect;
var join = require('path').join;
var assert = require('assert');
var Builder = require('..');
var fs = require('co-fs');
var vm = require('vm');

describe('Build', function(){
  describe('.entries()', function(){
    it('should return the entries', function *(){
      var entry = fixture('module');
      var builder = Builder(entry);
      var entries = yield builder.entries();
      var stat = yield fs.stat(entry);
      assert.deepEqual(entries, [{
        id: entry,
        entry: true,
        mtime: stat.mtime,
        deps: {},
        src: '\nmodule.exports = \'tiny module\';\n'
      }]);
    })
  });

  describe('.build()', function(){
    it('should build successfully on `require("not found")`', function *(){
      var box = yield build('requires');
      assert('requires' == box.out);
    });

    it('should work with relative directories and default to `./dir/index.js`', function *(){
      var box = yield build('directories');
      assert('directories' == box.out);
    });

    it('should work on tiny modules', function *(){
      var box = yield build('module');
      assert('tiny module' == box.out);
    });

    it('should work on modules with deps', function *(){
      var box = yield build('events');
      var events = box.require(6);
      assert('Events' == events.name);
      assert(events.prototype.sub);
      assert(events.prototype.bind);
      assert(events.prototype.unbind);
      assert(events.prototype.unbindAll);
      assert(events.prototype.unbindAllOf);
    });

    it('should check filenames first before checking directory', function *(){
      var box = yield build('edge-case-directory');
      assert('edge-case-directory' == box.require(3));
    })

    it('should be idempotent', function *(){
      var a = yield build('events');
      var b = yield build('events');
      assert(a.js && b.js);
      assert(a.js == b.js);
    })
  })
});

function *build(module){
  var path = fixture(module);
  var js = yield Builder(path).build();
  var req = { window: {} };
  var out = { window: {} };
  vm.runInNewContext('req = ' + js, req, fixture);
  vm.runInNewContext('out = ' + js + '(1)', out, fixture);
  return { require: req.req, js: js, out: out.out };
}

function fixture(name){
  return join.apply(null, [
    __dirname,
    'fixtures',
    name,
    'index.js'
  ]);
}
