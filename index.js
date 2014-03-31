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
var flatten = require('flatten-array');

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
 * @param {Function} fn
 * @return {Builder} self
 * @api public
 */

Builder.prototype.use = function(ext, fn) {
  var t = [];
  if (ext) t.push(ext);
  if (fn) t.push(fn);
  this.transforms.push(t);
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
  var files = [this.entry];

  while (files.length) {
    // generate json for each file
    var jsons = yield this.parallel(files.map(this.generate, this));

    // get all the dependencies
    var files = flatten(jsons.map(deps));

    // remap file ids
    jsons = jsons.map(this.remap, this);

    // pack up the json files
    yield this.parallel(jsons.map(packup));
  }

  // get the file paths of the dependencies
  function deps(json) {
    return values(json.deps);
  };

  // pack the json into the buildfile
  function *packup(json) {
    yield pack(json, !files.length);
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
  var ext = extname(file);

  var json = {};
  json.id = file;
  json.entry = file == this.entry;
  json.mtime = (yield stat(file)).mtime;
  json.deps = {};

  var src = yield readFile(file, 'utf8');

  this.transforms.forEach(function(t) {
    if (t[1]) {
      src = ext == t[0] ? t[1].call(this, src, json) || '' : src;
    } else {
      src = t[0].call(this, src, json) || '';
    }
  }, this);

  json.src = src;

  // find require's and resolve them
  detective(json.src).forEach(function(req) {
    json.deps[req] = this.resolve(req, file);
  }, this);

  // cache
  this.visited[file] = json;

  return json;
};

/**
 * Inject a global dependency
 *
 * TODO: change signature to support fn's
 *
 * @param {String} req
 * @param {String} src
 * @return {Builder} self
 * @api @public
 */

Builder.prototype.inject = function(req, src) {
  this.visited[req] = {
    id: req,
    src: src,
    entry: false,
    mtime: new Date,
    deps: {}
  };

  return this;
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
  // TODO: make this more generic and allow
  // custom names
  if ('/' == req.slice(-1)) req += 'index.js';

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

  // it's been injected
  if (this.visited[req]) {
    return this.visited[req].id;
  }

  // it's a component
  file = this.entry == file ? '.' : relative(this.dir, file);
  var deps = this.mapping[file];
  if (!deps) throw new Error('cannot resolve "' + req + '" in ' + file);

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
