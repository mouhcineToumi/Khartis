var api = mapshaper;
var utils = api.utils;
var cli = api.cli;
var geom = api.geom;
var internal = api.internal;
var Bounds = api.internal.Bounds;
var UserError = api.internal.UserError;
var message = api.internal.message;

internal.writeFiles = function(files, opts, done) {
  var filename;
  if (!utils.isArray(files) || files.length === 0) {
    done("Nothing to export");
  } else if (files.length == 1) {
    saveBlob(files[0].filename, new Blob([files[0].content]), done);
  } else {
    filename = utils.getCommonFileBase(utils.pluck(files, 'filename')) || "output";
    saveZipFile(filename + ".zip", files, done);
  }
};

utils.isReadableFileType = function(filename) {
  var ext = utils.getFileExtension(filename).toLowerCase(),
      fileType = internal.guessInputFileType(filename);
      // APYX : ignore text files
  return fileType !== "text" && (!!internal.guessInputFileType(filename) || internal.couldBeDsvFile(filename) ||
    internal.isZipFile(filename));
}

utils.readZipFile = function(file, cb) {
  var _files = [];
  zip.createReader(new zip.BlobReader(file), importZipContent, onError);

  function onError(err) {
    cb(err);
  }

  function onDone() {
    cb(null, _files);
  }

  function importZipContent(reader) {
    var _entries;
    reader.getEntries(readEntries);

    function readEntries(entries) {
      _entries = entries || [];
      readNext();
    }

    function readNext() {
      if (_entries.length > 0) {
        readEntry(_entries.pop());
      } else {
        reader.close();
        onDone();
      }
    }

    function readEntry(entry) {
      var filename = entry.filename,
          isValid = !entry.directory && utils.isReadableFileType(filename) &&
              !/^__MACOSX/.test(filename); // ignore "resource-force" files
      console.log(filename, isValid);
      if (isValid) {
        entry.getData(new zip.BlobWriter(), function(file) {
          file.name = filename; // Give the Blob a name, like a File object
          _files.push(file);
          readNext();
        });
      } else {
        readNext();
      }
    }
  }
};


function Handler(type, target, callback, listener, priority) {
  this.type = type;
  this.callback = callback;
  this.listener = listener || null;
  this.priority = priority || 0;
  this.target = target;
}

Handler.prototype.trigger = function(evt) {
  if (!evt) {
    evt = new EventData(this.type);
    evt.target = this.target;
  } else if (evt.target != this.target || evt.type != this.type) {
    error("[Handler] event target/type have changed.");
  }
  this.callback.call(this.listener, evt);
}

function EventData(type, target, data) {
  this.type = type;
  this.target = target;
  if (data) {
    utils.defaults(this, data);
    this.data = data;
  }
}

EventData.prototype.stopPropagation = function() {
  this.__stop__ = true;
};

//  Base class for objects that dispatch events
function EventDispatcher() {}


// @obj (optional) data object, gets mixed into event
// @listener (optional) dispatch event only to this object
EventDispatcher.prototype.dispatchEvent = function(type, obj, listener) {
  var evt;
  // TODO: check for bugs if handlers are removed elsewhere while firing
  var handlers = this._handlers;
  if (handlers) {
    for (var i = 0, len = handlers.length; i < len; i++) {
      var handler = handlers[i];
      if (handler.type == type && (!listener || listener == handler.listener)) {
        if (!evt) {
          evt = new EventData(type, this, obj);
        }
        else if (evt.__stop__) {
            break;
        }
        handler.trigger(evt);
      }
    }
  }
};

EventDispatcher.prototype.addEventListener =
EventDispatcher.prototype.on = function(type, callback, context, priority) {
  context = context || this;
  priority = priority || 0;
  var handler = new Handler(type, this, callback, context, priority);
  // Insert the new event in the array of handlers according to its priority.
  var handlers = this._handlers || (this._handlers = []);
  var i = handlers.length;
  while (--i >= 0 && handlers[i].priority < handler.priority) {}
  handlers.splice(i+1, 0, handler);
  return this;
};

// Remove an event handler.
// @param {string} type Event type to match.
// @param {function(BoundEvent)} callback Event handler function to match.
// @param {*=} context Execution context of the event handler to match.
// @return {number} Returns number of handlers removed (expect 0 or 1).
EventDispatcher.prototype.removeEventListener = function(type, callback, context) {
  context = context || this;
  var count = this.removeEventListeners(type, callback, context);
  return count;
};

// Remove event handlers; passing arguments can limit which listeners to remove
// Returns nmber of handlers removed.
EventDispatcher.prototype.removeEventListeners = function(type, callback, context) {
  var handlers = this._handlers;
  var newArr = [];
  var count = 0;
  for (var i = 0; handlers && i < handlers.length; i++) {
    var evt = handlers[i];
    if ((!type || type == evt.type) &&
      (!callback || callback == evt.callback) &&
      (!context || context == evt.listener)) {
      count += 1;
    }
    else {
      newArr.push(evt);
    }
  }
  this._handlers = newArr;
  return count;
};

EventDispatcher.prototype.countEventListeners = function(type) {
  var handlers = this._handlers,
    len = handlers && handlers.length || 0,
    count = 0;
  if (!type) return len;
  for (var i = 0; i < len; i++) {
    if (handlers[i].type === type) count++;
  }
  return count;
};

function Model() {
  var self = new api.internal.Catalog();
  var deleteLayer = self.deleteLayer;
  utils.extend(self, EventDispatcher.prototype);

  // override Catalog method (so -drop command will work in web console)
  self.deleteLayer = function(lyr, dataset) {
    var active, flags;
    deleteLayer.call(self, lyr, dataset);
    if (self.isEmpty()) {
      // refresh browser if deleted layer was the last layer
      window.location.href = window.location.href.toString();
    } else {
      // trigger event to update layer list and, if needed, the map view
      flags = {};
      active = self.getActiveLayer();
      if (active.layer != lyr) {
        flags.select = true;
      }
      internal.cleanupArcs(active.dataset);
      if (internal.layerHasPaths(lyr)) {
        flags.arc_count = true; // looks like a kludge, try to remove
      }
      self.updated(flags, active.layer, active.dataset);
    }
  };

  self.updated = function(flags, lyr, dataset) {
    var targ, active;
    if (lyr && dataset) {
      self.setDefaultTarget([lyr], dataset);
    }
    targ = self.getDefaultTargets()[0];
    if (lyr && targ.layers[0] != lyr) {
      flags.select = true;
    }
    active = {layer: targ.layers[0], dataset: targ.dataset};
    if (flags.select) {
      self.dispatchEvent('select', active);
    }
    self.dispatchEvent('update', utils.extend({flags: flags}, active));
  };

  self.selectLayer = function(lyr, dataset) {
    self.updated({select: true}, lyr, dataset);
  };

  self.selectNextLayer = function() {
    var next = self.findNextLayer(self.getActiveLayer().layer);
    if (next) self.selectLayer(next.layer, next.dataset);
  };

  self.selectPrevLayer = function() {
    var prev = self.findPrevLayer(self.getActiveLayer().layer);
    if (prev) self.selectLayer(prev.layer, prev.dataset);
  };

  self.findCommandTargets = function(pattern, type) {
    var targ;
    if (pattern && pattern != "default") {
      return internal.findCommandTargets(this, pattern, type);
    }
    targ = this.getDefaultTargets()[0];
    return targ ? [targ] : [];
  };

  return self;
}

function ImportControl(model, importedCb, noFilesCb, errorCb, opts) {

  var queuedFiles = [];
  var _importOpts = utils.defaults({no_topology: false, auto_snap: true}, opts);

  var receiveFiles = this.receiveFiles = function(files) {
    files = utils.toArray(files);
    handleZipFiles(files);
    addFilesToQueue(files);
    if (queuedFiles.length === 0) {
      return;
    }
    submitFiles();
  }

  //handlers
  function handleImportError(e) {
    if (e && e.message) {
      errorCb(e.message || "general");
    } else {
      errorCb(e || "general");
    }
  }

  function addFilesToQueue(files) {
    var index = {};
    queuedFiles = queuedFiles.concat(files).reduce(function(memo, f) {
      // filter out unreadable types and dupes
      if (utils.isReadableFileType(f.name) && f.name in index === false) {
        index[f.name] = true;
        memo.push(f);
      }
      return memo;
    }, []);
    // sort alphabetically by filename
    queuedFiles.sort(function(a, b) {
      // Sorting on LC filename is a kludge, so Shapefiles with mixed-case
      // extensions are sorted with .shp component before .dbf
      // (When .dbf files are queued first, they are imported as a separate layer.
      // This is so data layers are not later converted into shape layers,
      // e.g. to allow joining a shape layer to its own dbf data table).
      return a.name.toLowerCase() > b.name.toLowerCase() ? 1 : -1;
    });
  }

  function submitFiles() {
    readNext();
  }

  function readNext() {
    if (queuedFiles.length > 0) {
      readFile(queuedFiles.pop()); // read in rev. alphabetic order, so .shp comes before .dbf
    } else {
      importedCb();
    }
  }

  // @file a File object
  function readFile(file) {
    var name = file.name,
        reader = new FileReader(),
        useBinary = internal.isSupportedBinaryInputType(name) ||
          internal.isZipFile(name) ||
          internal.guessInputFileType(name) == 'json' ||
          internal.guessInputFileType(name) == 'text';

    reader.addEventListener('loadend', function(e) {
      if (!reader.result) {
        handleImportError("file_load", name);
      } else {
        readFileContent(name, reader.result);
      }
    });
    if (useBinary) {
      reader.readAsArrayBuffer(file);
    } else {
      // TODO: improve to handle encodings, etc.
      reader.readAsText(file, 'UTF-8');
    }
  }

  function readFileContent(name, content) {
    var type = internal.guessInputType(name, content),
        importOpts = _importOpts,
        matches = findMatchingShp(name),
        dataset, lyr;

    // TODO: refactor
    if (type == 'dbf' && matches.length > 0) {
      // find an imported .shp layer that is missing attribute data
      // (if multiple matches, try to use the most recently imported one)
      dataset = matches.reduce(function(memo, d) {
        if (!d.layers[0].data) {
          memo = d;
        }
        return memo;
      }, null);
      if (dataset) {
        lyr = dataset.layers[0];
        lyr.data = new internal.ShapefileTable(content, importOpts.encoding);
        if (lyr.shapes && lyr.data.size() != lyr.shapes.length) {
          return handleImportError("dbf_num_records");
        }
        if (!lyr.geometry_type) {
          // kludge: trigger display of table cells if .shp has null geometry
          model.updated({}, lyr, dataset);
        }
        readNext();
        return;
      }
    }

    if (type == 'shx') {
      // save .shx for use when importing .shp
      // (queue should be sorted so that .shx is processed before .shp)
      //cachedFiles[fileName.toLowerCase()] = {filename: fileName, content: content};
      readNext();
      return;
    }

    if (type == 'prj') {
      // assumes that .shp has been imported first
      matches.forEach(function(d) {
        if (!d.info.prj) {
          d.info.prj = content;
        }
      });
      readNext();
      return;
    }

    importFileContent(type, name, content, importOpts);
  }

  function importFileContent(type, path, content, importOpts) {
    var delay = 35;

    importOpts.files = [path];

    setTimeout(function() {
      var dataset;
      try {
        dataset = internal.importFileContent(content, path, importOpts);
        dataset.info.no_repair = importOpts.no_repair;
        model.addDataset(dataset);
        readNext();
      } catch(e) {
        handleImportError((e || e.message) || "general");
      }
    }, delay);
  }

  function findMatchingShp(filename) {
    // use case-insensitive matching
    var base = utils.getPathBase(filename).toLowerCase();
    return model.getDatasets().filter(function(d) {
      var fname = d.info.input_files && d.info.input_files[0] || "";
      var ext = utils.getFileExtension(fname).toLowerCase();
      var base2 = utils.getPathBase(fname).toLowerCase();
      return base == base2 && ext == 'shp';
    });
  }

  function handleZipFiles(files) {
    return files.filter(function(file) {
      var isZip = internal.isZipFile(file.name);
      if (isZip) {
        readZipFile(file);
      }
      return !isZip;
    });
  }

  function readZipFile(file) {
    setTimeout(function() {
      utils.readZipFile(file, function(err, files) {
        if (err) {
          handleImportError(err, file.name);
        } else {
          // don't try to import .txt files from zip files
          // (these would be parsed as dsv and throw errows)
          files = files.filter(function(f) {
            return !/\.txt$/i.test(f.name);
          });
          receiveFiles(files);
        }
      });
    }, 35);
  }

}


/* EXPORT */

var ExportControl = function(model, opts, listLayerCb, confirmSimplifyCb, exportCb, errorCb) {

  var targetLayers = null;
  var simplifyConfirmed = 0;

  this.export = function(layers) {
    if (layers) {
      targetLayers = layers;
      var projections = extractProjections(getTargetLayers());
      if (projections.find(p => p === "[unknown]")) {
        errorCb("unknownProjection");
        return;
      }
      simplify().then(function(simplifyPcts) {
        return processLayers().then(function(targets) {
          exportTargets(targets, function(err, tuples) {
            if (err) {
              handleExportError(err);
            } else {
              tuples.forEach( (tuple, i) => {
                tuple.simplifyPct = simplifyPcts[i]
                tuple.proj4Wkt = projections[i];
              });
              exportCb(tuples);
            }
          });
        })
      }).catch(console.log);
    } else {
      try {
        listLayerCb(initLayerMenu());
      } catch (e) {
        handleExportError(e);
      }
    }
  }

  function handleExportError(e) {
    errorCb((e && e.message) || "unknow");
  }

  function extractProjections(targets) {
    return targets.map( tgt => internal.getProjInfo(tgt.dataset) );
  }

  function simplify(pct) {
    pct = pct || 100;
    var commands = internal.parseCommands("-proj wgs84 -simplify keep-shapes "+pct+"%");
    return Sequence(getTargetLayers().map(function(target) {
      return new Deffered(function(res, rej) {
        applyCommands(target, commands, function(out) {
          var stats = internal.calcSimplifyStats(out.dataset.arcs);
          var doSimplify = function() {
            if (pct > Math.round(opts.arcsLimit / stats.uniqueCount * 100) + 1) {
              pct = Math.round(opts.arcsLimit / stats.uniqueCount * 100 + 1);
            }
            simplify(pct - 1)
              .then(function(v) {
                res(v);
              });
          };
          if (!simplifyConfirmed && pct === 100 && stats.retained > opts.arcsLimit) { //ask confirm
            confirmSimplifyCb(null, function(confirmData) {
              if (confirmData.simplify) {
                doSimplify();
                simplifyConfirmed = 1;
              } else {
                simplifyConfirmed = 2;
                res(pct);
              }
            });
          } else if (simplifyConfirmed == 1 && stats.retained > opts.arcsLimit) {
            doSimplify();
          } else {
            res(pct);
          }
        });
      });
    }));
  }

  function processLayers() {

    var commands = [
      {name:"line", cmds: internal.parseCommands("-innerlines")},
      {name:"centroid", cmds: internal.parseCommands("-points centroid")}
    ];

    return Sequence(getTargetLayers().map(function(target, idx) {
      
      return new Deffered(function(resMain, rej) {
        Sequence(commands.map(function(command) {
          return new Deffered(function(resSub, rej) {
            command.cmds.forEach(function(c) { c.options.target = target.layers[0]._uuid; });
            var copiedDs = internal.copyDataset(target.dataset);
            // var copiedTgt = {
            //   layers: copiedDs.layers.reduce(function(out, lyr, i) {
            //     var oriLyr = target.layers.find(function(lyr2) {return lyr2.match_id === idx+i});
            //     if (oriLyr) {
            //       lyr.name = oriLyr.name+"::"+command.name;
            //       out.push(lyr);
            //     }
            //     return out;
            //   }, []),
            //   dataset: copiedDs
            // };
            model.addDataset(copiedDs);
            applyCommands(target, command.cmds, function(outputTarget) {
              outputTarget.layer.name += "::"+command.name;
              !outputTarget.layers && (outputTarget.layers = [outputTarget.layer]);
              resSub(outputTarget);
            });
          });
        }))
        .then(function(subTargets) { resMain([target].concat(subTargets)); })
      })

    }));
  }

  function getCommandFlags(commands) {
    return commands.reduce(function(memo, cmd) {
      memo[cmd.name] = true;
      return memo;
    }, {});
  }

  function applyCommands(layer, commands, done) {
    var active = layer,
        prevArcs = active.dataset.arcs,
        prevArcCount = prevArcs ? prevArcs.size() : 0;


    internal.runParsedCommands(commands, model, function(err) {
      var flags = getCommandFlags(commands),
          active2 = model.getActiveLayer(),
          postArcs = active2.dataset.arcs,
          postArcCount = postArcs ? postArcs.size() : 0,
          sameArcs = prevArcs == postArcs && postArcCount == prevArcCount;

      // restore default logging options, in case they were changed by the command
      internal.setStateVar('QUIET', false);
      internal.setStateVar('VERBOSE', false);

      if (!sameArcs) {
        flags.arc_count = true;
      }
      if (err) handleExportError(err);
      done(active2);
    });
  }

  // @done function(string|Error|null)
  function exportTargets(targets, done) {
    var opts, tuples;
    try {
      tuples = targets.reduce(function(out, subTargets) {
        var tuple = {};
        opts = {format: getSelectedFormat()};
        tuple.files = internal.exportTargetLayers(subTargets, opts);
        tuple.dict = internal.exportProperties(subTargets[0].layers[0].data, {});
        out.push(tuple);
        return out;
      }, []);
    } catch(e) {
      return done(e);
    }
    done(null, tuples);
  }

  function initLayerMenu() {
    // init layer menu with current editing layer selected
    var layers = [];
    var layerUUID = 0; //fist id will be 1
    model.forEachLayer(function(lyr, dataset) {
      layers.push({
        _uuid: ++layerUUID,
        label: lyr.name || '[unnamed layer]',
        propKeys: getPossibleKeys(lyr.data)
      })
    });
    return layers;
  }

  function getPossibleKeys(data) {
    if (data) {
      var fields = data.getFields(),
          props = internal.exportProperties(data, {});
      
      return fields.map(f => {
        return {
          field: f,
          unique: !props.some(function(seen, row) {
            if (seen.indexOf(row[f]) == -1) {
              seen.push(row[f]);
              return false;
            } else {
              return true;
            }
          }.bind(props, []))
        }
      });
    } else {
      throw new Error("dataEmpty");
    }
  }

  function getSelectedFormat() {
    return "topojson";
  }

  function getTargetLayers() {
    var ids = targetLayers.map(l => l._uuid).join(',');
    return ids ? model.findCommandTargets(ids) : [];
  }
};

