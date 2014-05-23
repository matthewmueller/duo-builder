
/**
 * Module dependencies
 */

var Emitter = require('events').EventEmitter;
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
var clone = require('clone-component');

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
  Emitter.call(this);
  this.entry = path.resolve(entry);
  this.directory(dirname(entry));
  this._manifest = 'component.json';
  this._development = false;
  this._concurrency = 10;
  this.transforms = [];
  this.visited = {};
  this.ids = {};
  this.id = 0;
}

/**
 * Inherit `Emitter`
 */

Builder.prototype.__proto__ = Emitter.prototype;

/**
 * Specify the base / root directory.
 * 
 * @param {String} dir
 * @return {Builder} self
 * @api public
 */

Builder.prototype.directory = function(dir){
  this.dir = dir;
  this.depdir = join(this.dir, 'components');
  return this;
};

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
 * Development
 */

Builder.prototype.development = function(dev) {
  this._development = undefined == dev ? true : dev;
  return this;
};

/**
 * Set concurrency.
 * 
 * @param {Number} n
 * @return {Builder} self
 * @api public
 */

Builder.prototype.concurrency = function(n){
  this._concurrency = n;
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
 * Get all entries.
 * 
 * @return {Array}
 * @api public
 */

Builder.prototype.entries = function*(){
  var files = [this.entry];
  var entries = [];
  var dupes = {};
  var ret = '';

  // get the mappings.
  this.mapping = this.mapping || (yield json(join(this.depdir, 'mapping.json')));

  // convert files and requires to jsons.
  while (files.length) {
    var jsons = yield this.parallel(files.map(this.generate, this));
    var files = flatten(jsons.map(deps));
    var entries = entries.concat(jsons);
  }

  // remove duplicates
  return entries.filter(function(entry){
    if (dupes[entry.id]) return false;
    dupes[entry.id] = true;
    return true;
  });

  // get deps of json.
  function deps(json){
    return values(json.deps);
  }
};

/**
 * Build & write the bundle
 *
 * @return {Builder} (self)
 * @api public
 */

Builder.prototype.build = function *() {
  var pack = Pack(this.buildfile, { debug: this._development });
  var entries = yield this.entries();
  var ret = '';

  // pack all modules
  while (entries.length) {
    ret += yield packup(entries.pop());
  }

  // done
  return ret;

  // pack the json into the buildfile
  function *packup(json) {
    return yield pack(clone(json), 0 == entries.length);
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
  var reqs = requires(json.src);

  for (var i = 0, req; req = reqs[i]; ++i) {
    var resolved = yield this.resolve(req.path, file);
    if (resolved) json.deps[req.path] = resolved;
  }

  // cache
  this.visited[file] = json;

  // debug
  debug('generated %s', json.id);
  debug('requires %j', reqs.map(function(_){ return _.string; }));
  debug('deps %j', Object.keys(json.deps));

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

  // either use an existing id, or create a new one
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
 * TODO: turn into a generator so we can support:
 *
 *  require('signup/signup') => signup/signup.js
 *  require('signup/signup') => signup/signup/index.js
 * 
 * TODO: make it less ugly.
 *
 * @param {String} req
 * @param {String} dir
 * @return {String}
 */

Builder.prototype.resolve = function *(req, file) {
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
    var dir = dirname(file);
    var resolved;
    var stat;

    // file.js
    var filename = extname(req) ? req : req + '.js';
    var file = join(dir, filename);
    var directory = join(dir, req);

    // try file.js
    try {
      stat = yield fs.stat(file);
      return file;
    } catch (e) {}

    // try ./file
    try {
      stat = yield fs.stat(directory);
      return join(directory, 'index.js');
    } catch (e) {}
  }

  // it's been included by the builder
  if (this.visited[req]) {
    return this.visited[req].id;
  }

  // it's a component
  var parent = this.findSlug(file) || Object.keys(this.mapping)[0];
  var json = this.mapping[parent];
  if (!json) return '';
  var dep = this.findManifest(req, json.deps);
  if (!dep) throw new Error('Cannot find dependency "' + dep + '" of "' + parent + '"');
  return join(this.depdir, dep, json.main);
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
    if (~dep.indexOf(req + '@')) return dep;
  }

  return null;
};

/**
 * Find the component slug from the file path
 *
 * @param {String} file
 * @param {String}
 * @api private
 */

Builder.prototype.findSlug = function(file) {
  var rslug = /[\w-.]+@[^\/]+/;
  var m = file.match(rslug);
  return m && m[0];
};


/**
 * Fetch JSON
 *
 * @param {String} path
 * @return {Object}
 * @api private
 */

Builder.prototype.json = function(path) {
  try {
    return require(path)
  } catch(e) {
    return {};
  }
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

/**
 * Read `path` as json.
 * 
 * @param {String} path
 * @return {Object}
 * @api private
 */

function *json(path){
  return JSON.parse(yield fs.readFile(path, 'utf-8'));
}
