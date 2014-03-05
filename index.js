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
  this.pack = [];
  this.ids = {};
  this._concurrency = 10;
  this.out = [];
  this.id = 0;
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
  var files = [this.entry];
  var out = [];

  while (files.length) {
    var jsons = yield files.map(this.walk, this);
    out = out.concat(jsons);

    files = [];
    jsons.forEach(function(json) {
      files = files.concat(values(json.deps));
    });

    // console.log(files);

  }

  console.log(JSON.stringify(out, true, 2));
  //
  // files.forEach(function(file) {
  //   var jsons = yield file
  // })
  // var json = yield this.walk(this.entry);
  // console.log(json);
  // yield this.buildPack(this.entry, 'component.json');
  // console.log(this.pack);
  // var pack = Packer();
  // pack.pipe(fs.createWriteStream(join(this.dir, 'build.js')))
  // yield write(pack, JSON.stringify(this.pack));
  // pack.end();
  // console.log(pack.writable);
  // console.log('a', yield read(pack));
  // console.log('b', yield read(pack));
  // console.log(yield read(pack));
  // console.log('ok');
  return this;
};

/**
 * Prepare the JSON
 */

Builder.prototype.prepare = function *(file) {
  var json = yield this.walk(file);

  for (var dep in json.deps) {

  }
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

Builder.prototype.buildPack = function *(file) {
  var isEntry = file == this.entry;

  if (this.visited[file]) return this.visited[file];
  // add .js if no file extension given
  // file = extname(file) ? file : file + '.js';


  var pack = {};
  pack.id = path.resolve(file);
  // TODO: fix... recursive at the moment...
  // pack.src = yield readFile(file, 'utf8');
  pack.entry = isEntry;
  pack.deps = {};

  detective(pack.src).forEach(resolve, this);

  this.visited[file] = pack;

  // recursively load the dependencies
  yield pack;

  return pack;

  // resolve the requires
  function resolve(req) {
    var path = this.resolve(req, isEntry ? 'component.json' : file);
    pack.deps[req] = this.build(path);
  };
};

/**
 * Build the javascript
 */

Builder.prototype.js = function *() {
  var manifest = join(this.dir, 'component.json');

  console.log(manifest);
  var deps = this.mapping[manifest];
  console.log(deps);
  return null;
}

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
