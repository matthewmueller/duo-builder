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
var stat = cofs.stat;
var fs = require('fs');
var parallel = require('co-parallel');
var write = require('co-write');
var read = require('co-read');
var values = require('object-values');
var through = require('through');
var Pack = require('duo-pack');

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
  this.ids = {};
  this._concurrency = 10;
  this.out = [];
  this.buildfile = join(this.dir, 'build.js');
  this.id = 0;

  try {
    this.cache = require(join(this.depdir, 'cache.json'));
  } catch(e) {
    this.cache = [];
  }
}

/**
 * Specify the `file` to build to
 *
 * @param {String} file
 * @return {Builder} self
 * @api public
 */

Builder.prototype.to = function(file) {
  this.buildfile = join(this.dir, file);
  return this;
};

/**
 * Use a transform
 *
 * @param {String} ext (optional)
 * @param {GeneratorFunction} gen
 * @return {Builder} self
 * @api public
 */

Builder.prototype.use = function(ext, gen) {
  this.transforms.push([ext, gen]);
  return this;
};

/**
 * Build & write the bundle
 *
 * @return {Builder} (self)
 * @api public
 */

Builder.prototype.build = function *() {
  var pack = Pack(this.buildfile);
  var cache = fs.createWriteStream(join(this.depdir, 'cache.json'));
  var files = [this.entry];

  // prelude
  yield write(cache, '[');

  while (files.length) {
    var jsons = yield this.parallel(files.map(this.generate, this));

    files = [];
    jsons.forEach(function(json) {
      files = files.concat(values(json.deps));
    });

    yield this.parallel(jsons.map(tocache));
    jsons = jsons.map(this.remap, this);
    yield this.parallel(jsons.map(build));
  }

  // cache
  yield write(cache, ']');

  function *build(json) {
    yield pack(json, !files.length);
  }

  function *tocache(json) {
    var str = JSON.stringify(json);
    if (files.length) str += ',';
    yield write(cache, str);
  }

  return this;
};

/**
 * Generate the `json` for `file`
 *
 * @param {String} file
 * @return {Object} json
 * @api private
 */

Builder.prototype.generate = function *(file) {
  if (this.visited[file]) return this.visited[file];

  var json = {};
  json.id = file;
  json.entry = file == this.entry;
  json.mtime = (yield stat(file)).mtime;
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
 *
 * @param {Object} json
 * @return {Object}
 * @api private
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

/**
 * Run functions in parallel
 *
 * @param {Array} arr
 * @return {Function}
 * @api private
 */

Builder.prototype.parallel = function(arr) {
  return parallel(arr, this._concurrency);
};

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
};

/**
 * Find the manifest
 *
 * @param {String} req
 * @param {Array} deps
 * @return {String}
 * @api private
 */

Builder.prototype.findManifest = function(req, deps) {
  for (var i = 0, dep; dep = deps[i]; i++) {
    if (~dep.indexOf('-' + req + '@')) {
      return join(this.dir, dep);
    }
  }

  return null;
};
