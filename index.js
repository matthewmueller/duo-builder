/**
 * Module dependencies
 */

var path = require('path');
var detective = require('detective');
var minimatch = require('minimatch');
var dirname = path.dirname;
var join = path.join;
var extname = path.extname;
var relative = path.relative;
var debug = require('debug')('duo-builder');
var Packer = require('browser-pack');
var cofs = require('co-fs');
var readFile = cofs.readFile;
var fs = require('fs');
var parallel = require('co-parallel');
var write = require('co-write');
var read = require('co-read');
var values = require('object-values');
var through = require('through');
var req = require('./require.js');

/**
 * Expose `Builder`
 */

module.exports = Builder;

/**
 * Initialize `Builder`
 *
 * @param {String} entry
 * @return {Builder}
 * @api public
 */

function Builder(entry) {
  if (!(this instanceof Builder)) return new Builder(entry);
  this.entry = path.resolve(entry);
  this.dir = dirname(entry);
  this.depdir = join(this.dir, 'components');
  this.mapping = require(join(this.depdir, 'mapping.json'));
  this.transforms = [];
  this.visited = {};
  // this.pack = [];
  this.ids = {};
  this._concurrency = 10;
  this.out = [];
  this.buildfile = join(this.dir, 'build.js');
  this.id = 0;
}

/**
 * to
 */

Builder.prototype.to = function(file) {
  this.buildfile = join(this.dir, file);
  return this;
}

/**
 * use
 */

Builder.prototype.use = function(ext, gen) {
  this.transforms.push([ext, gen]);
  return this;
}

/**
 * build
 */

Builder.prototype.build = function *() {
  var build = fs.createWriteStream(this.buildfile);
  var files = [this.entry];
  var packed = {};

  // prelude
  yield write(build, 'var require = ' + req + '({\n');

  while (files.length) {
    var jsons = yield this.parallel(files.map(this.walk, this));

    files = [];
    jsons.forEach(function(json) {
      files = files.concat(values(json.deps));
    });

    jsons = jsons.map(this.remap, this);
    yield this.parallel(jsons.map(tobuild));
  }

  // epilogue
  yield write(build, '}, {}, [' + this.ids[this.entry] + '])\n');

  function *tobuild(json) {
    var deps = JSON.stringify(json.deps);
    var str = json.id + ': [' + wrap(json.src) + ', ' + deps + ']';
    str = files.length ? str + ',\n\n' : str;
    yield write(build, str);
  }

  function wrap(src) {
    out = 'function(require, module, exports) {\n\n'
    out += src;
    out += '\n}';
    return out;
  }

  return this;
};

Builder.prototype.walk = function *(file) {
  if (this.visited[file]) return this.visited[file];

  var json = {};
  json.id = file;
  json.entry = file == this.entry;
  json.src = yield readFile(file, 'utf8');
  json.deps = {};

  // find require's and resolve them
  detective(json.src).forEach(function(req) {
    var path = this.resolve(req, file);
    json.deps[req] = path;
  }, this);

  // cache
  this.visited[file] = json;

  return json;
};

/**
 * Remap the module's filepaths to uids
 */

Builder.prototype.remap = function(json) {
  var self = this;
  json.id = id(json.id);

  for (var req in json.deps) {
    json.deps[req] = id(json.deps[req]);
  }

  return json;

  function id (file) {
    return self.ids[file] = self.ids[file] || ++self.id;
  }
};



//
// Builder.prototype.buildPack = function *(file) {
//   var isEntry = file == this.entry;
//
//   if (this.visited[file]) return this.visited[file];
//   // add .js if no file extension given
//   // file = extname(file) ? file : file + '.js';
//
//
//   var pack = {};
//   pack.id = path.resolve(file);
//   // TODO: fix... recursive at the moment...
//   // pack.src = yield readFile(file, 'utf8');
//   pack.entry = isEntry;
//   pack.deps = {};
//
//   detective(pack.src).forEach(resolve, this);
//
//   this.visited[file] = pack;
//
//   // recursively load the dependencies
//   yield pack;
//
//   return pack;
//
//   // resolve the requires
//   function resolve(req) {
//     var path = this.resolve(req, isEntry ? 'component.json' : file);
//     pack.deps[req] = this.build(path);
//   };
// };
//
// /**
//  * Build the javascript
//  */
//
// Builder.prototype.js = function *() {
//   var manifest = join(this.dir, 'component.json');
//
//   console.log(manifest);
//   var deps = this.mapping[manifest];
//   console.log(deps);
//   return null;
// }

/**
 * Run functions in parallel
 */

Builder.prototype.parallel = function(arr) {
  return parallel(arr, this._concurrency);
}

/**
 * Resolve a dependency
 *
 * @param {String} req
 * @param {String} dir
 * @return {String}
 */

Builder.prototype.resolve = function (req, file) {

  // absolute dependencies (resolve to project root)
  if ('/' == req[0]) {
    req = extname(req) ? req : req + '.js';
    return join(this.dir, req);
  }

  // relative dependencies
  if ('.' == req[0]) {
    req = extname(req) ? req : req + '.js';
    return join(dirname(file), req);
  }

  // it's a component
  file = this.entry == file ? '.' : relative(this.dir, file);
  var deps = this.mapping[file];
  if (!deps) throw new Error('mapping not found: ' + req + ' ' + file);

  return this.findManifest(req, deps);
}

/**
 * Find manifest
 */

Builder.prototype.findManifest = function(req, deps) {
  for (var i = 0, dep; dep = deps[i]; i++) {
    if (~dep.indexOf('-' + req + '@')) {
      return join(this.dir, dep);
    }
  }

  return null;
}
