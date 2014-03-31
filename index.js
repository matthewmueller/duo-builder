/**
 * Module dependencies
 */

var debug = require('debug')('duo-builder');
var slice = [].slice;
var path = require('path');
var dirname = path.dirname;
var join = path.join;
var extname = path.extname;
var relative = path.relative;
var fs = require('co-fs');
var parallel = require('co-parallel');
var values = require('object-values');
var Pack = require('duo-pack');
var flatten = require('flatten-array');
var requires = require('requires');

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
  this.buildfile = join(this.dir, 'build.js');
  this.depdir = join(this.dir, 'components');
  this.mapping = require(join(this.depdir, 'mapping.json'));
  this._concurrency = 10;
  this.transforms = [];
  this.visited = {};
  this.ids = {};
  this.id = 0;
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

Builder.prototype.transform = function(ext, fn) {
  var t = [];

  if (arguments.length == 2) {
    t[t.length] = ext.split('.').pop();
    t[t.length] = wrap(fn);
  } else {
    t[t.length] = wrap(ext);
  }

  this.transforms.push(t);
  return this;

  function wrap(fn) {
    if (!isGeneratorFunction(fn)) {
      return function *() {
        return fn.apply(this, arguments);
      }
    } else {
      return fn;
    }
  }
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

  return this;

  // get the file paths of the dependencies
  function deps(json) {
    return values(json.deps);
  };

  // pack the json into the buildfile
  function *packup(json) {
    yield pack(json, !files.length);
  }
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
  var transforms = this.transforms;
  var ext = extname(file).slice(1);

  var json = {};
  json.id = file;
  json.entry = file == this.entry;
  json.mtime = (yield fs.stat(file)).mtime;
  json.deps = {};

  var src = yield fs.readFile(file, 'utf8');

  for (var i = 0, t; t = transforms[i]; i++) {
    if (t[1] && ext == t[0]) {
      src = yield t[1](src, json, this) || '';
    } else if (!t[1]) {
      src = yield t[0](src, json, this) || ''
    }
  }

  json.src = src;

  // find require's and resolve them
  requires(json.src).forEach(function(req) {
    json.deps[req.path] = this.resolve(req.path, file);
  }, this);

  // cache
  this.visited[file] = json;

  return json;
};

/**
 * Include a global dependency
 *
 * TODO: change signature to support fn's
 *
 * @param {String} req
 * @param {String} src
 * @return {Builder} self
 * @api @public
 */

Builder.prototype.include = function(req, src) {
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

/**
 * Check if `obj` is a generator function.
 *
 * @param {Mixed} obj
 * @return {Boolean}
 * @api private
 */

function isGeneratorFunction(obj) {
  return obj && obj.constructor && 'GeneratorFunction' == obj.constructor.name;
}
