import Ember from 'ember';
import Struct from './struct';
import {geoMatch} from 'mapp/utils/geo-match';

let RowStruct = Struct.extend({
    header: null,
    cells: null,
    layout: null,
    init() {
        this._super();
        this.set('layout', {
            sheet: {
               height: null
            }
        });
    },
    export(opts) {
        return this._super({
            header: this.get('header'),
            cells: this.get('cells').map( c => c.export() ),
            layout: this.get('layout')
        });
    }
});

RowStruct.reopenClass({
    createWithModel(row) {
        let o = this.create();
        o.setProperties({
            cells: row.get('cells').map( (c, i) => {
                return CellStruct.create({
                    column: c.get('column'),
                    row: o
                })
            })
        });
        return o;
    },
    restore(json, refs) {
        let o = this._super(json, refs, {
          header: json.header,
          layout: json.layout
        });
        o.setProperties({
          cells: json.cells.map( c => CellStruct.restore(c, refs) )
        });
        return o;
    }
});

let ColumnMeta = Struct.extend({
  type: null,
  inconsistency: null,
  manual: false,
  
  export() {
    return this._super({
      type: this.get('type'),
      manual: this.get('manual')
    });
  }
});

ColumnMeta.reopenClass({
  restore(json, refs) {
      return this._super(json, refs, {
          type: json.type,
          manual: json.manual
      });
    }
});

let ColumnStruct = Struct.extend({
  
    cells: null, //not exported, visitor pattern
    layout: null,
    meta: null,
    
    init() {
      this._super();
      this.set('cells', Ember.A());
      this.set('meta', ColumnMeta.create({
        type: "text",
        inconsistency: 1,
        manual: false
      }));
      this.set('layout', {
        sheet: {
          width: null
        }
      });
    },
    
    visit(cell) {
      if (!this.get('cells').some( c => c == cell )) {
        this.get('cells').addObject(cell);
      }
    },
    
    header: function() {
      return this.get('cells').find( c => c.get('row.header') );
    }.property('cells.[]'),
    
    body: function() {
      return this.get('cells').filter( c => !c.get('row.header') );
    }.property('cells.[]'),
    
    deferredChange: Ember.debouncedObserver(
      'body.@each.value', 'body.@each.correctedValue', 'meta.type', 'meta.manual', 
      function() {
        this.notifyDefferedChange();
      },
      100),
    
    autoDetectDataType: Ember.debouncedObserver('cells.@each.value', 'meta.manual', function() {
        
        if (!this.get('meta.manual')) {
          
          var p = {
            text: 0,
            numeric: 0,
            geo: 0,
            lat_dms: 0,
            lon_dms: 0,
            lat: 0,
            lon: 0
          };
          
          this.get('body')
            .filter( c => !Ember.isEmpty(c.get('value')) )
            .forEach( (c, i, arr) => {
              if (/^\-?([\d\,\s]+(\.\d+)?|[\d\.\s]+(\,\d+))$/.test(c.get('value'))) {
                  p.numeric += 1/arr.length;
              } else {
                  let match = geoMatch(c.get('value'));
                  if (match) {
                    p.geo += 1/arr.length;
                  } else if (/^1?[1-9]{1,2}°(\s*[1-6]?[1-9]')(\s*[1-6]?[1-9]")?(N|S)?$/.test(c.get('value'))) {
                    p.lat_dms += 1/arr.length;
                  } else if (/^1?[1-9]{1,2}°(\s*[1-6]?[1-9]')(\s*[1-6]?[1-9]")?(E|W)?$/.test(c.get('value'))) {
                    p.lon_dms += 1/arr.length;
                  } else {
                    p.text += 1/arr.length;
                  }
              }
            });

          let type = Object.keys(p).reduce( (r, key) => {
            return r == null || p[key] > p[r] ? key : r;
          }, null);
          
          if (type === "numeric") {
            let header = this.get('header');
            if (/^(?:lon(?:g?\.|gitude)?|lng|x)$/i.test(header.get('value'))) {
              type = "lon";
              p[type] = 1;
            } else if (/^y|lat(?:\.|itude)?$/i.test(header.get('value'))) {
              type = "lat";
              p[type] = 1;
            }
          }
          
          this.setProperties({
            'meta.type': type
          });
          
        }
        
    }, 100),
    
    incorrectCells: function() {
      
      let p = 0,
          inconsistency = {
            "geo": (v) => geoMatch(v),
            "text": (v) => true,
            "numeric": (v) => (/^\-?([\d\,\s]+(\.\d+)?|[\d\.\s]+(\,\d+)?)$/).test(v),
            "lat": (v) => (/^\-?[\d\,\s]+(\.\d+)?$/).test(v),
            "lon": (v) => (/^\-?[\d\,\s]+(\.\d+)?$/).test(v),
            "lat_dms": (v) => (/^\-?1?[1-9]{1,2}°(\s*[1-6]?[1-9]')(\s*[1-6]?[1-9]")?(N|S)?$/).test(v),
            "lon_dms": (v) => (/^\-?1?[1-9]{1,2}°(\s*[1-6]?[1-9]')(\s*[1-6]?[1-9]")?(E|W)?$/).test(v)
          },
          checkFn = inconsistency[this.get('meta.type')];
      
      let cells = this.get('body')
        .filter( c => !Ember.isEmpty(c.get('value')) )
        .filter( (c, i, arr) => {
          return !checkFn(c.get('value')); 
        });
        
      return cells;
      
    }.property('_defferedChangeIndicator'),
    
    correctedCells: function() {
      return this.get('body').filter( (c) => c.get('corrected') );
    }.property('_defferedChangeIndicator'),
    
    inconsistency: function() {
      return this.get('incorrectCells.length') - this.get('correctedCells.length');
    }.property('incorrectCells.length', 'correctedCells.length'),
    
    export() {
      return this._super({
          layout: {
            sheet: {
              width: this.get('layout.sheet.width')
            }
          },
          meta: this.get('meta').export()
      });
    }
});

ColumnStruct.reopenClass({
    restore(json, refs) {
        return this._super(json, refs, {
          layout: {
              sheet: {
                width: json.layout.sheet.width
              }
            },
            meta: ColumnMeta.restore(json.meta, refs)
        });
    }
});

let CellStruct = Struct.extend({
    column: null,
    row: null,
    value: null,
    correctedValue: null,
    
    corrected: function() {
      return !Ember.isEmpty(this.get('correctedValue'));
    }.property('correctedValue'),
    
    index() {
      return this.get('row.cells').indexOf(this);
    },
    
    isFirstOfRow() {
      return this.index() === 0;
    },
    
    isLastOfRow() {
      return this.index() === this.get('row.cells').length - 1;
    },
    
    postProcessedValue: function() {
      let val = this.get('corrected') ? this.get('correctedValue') : this.get('value');
      if (!Ember.isEmpty(val)) {
        if (["numeric", "lon", "lat"].indexOf(this.get('column.meta.type')) !== -1) {
          if (val.indexOf(".") === -1) {
            return parseFloat(val.replace(/[\,\s]+/g, "."));
          } else {
            return parseFloat(val.replace(/[\,\s]+/g, ""));
          }
        } else if (this.get('column.meta.type') === "geo") {
          return geoMatch(val);
        }
        return val;
      } else {
        return null;
      }
    }.property('value', 'column.meta.type', 'corrected', 'correctedValue'),
    
    init() {
      this._super();
      this.set('state', {
          sheet: {
                  edited: false,
                  selected: false,
                  resizing: false
                  }
      });
    },
    
    onColumnChange: function() {
      if (this.get('column')) {
          this.get('column').visit(this);
      }
    }.observes('column').on("init"),
    
    export() {
      return this._super({
          col: this.get('column._uuid'),
          row: this.get('row._uuid'),
          val: this.get('value'),
          cval: this.get('correctedValue')
      });
    }
});

CellStruct.reopenClass({
    restore(json, refs) {
      return this._super(json, refs, {
        value: json.val,
        correctedValue: json.cval,
        column: refs[json.col],
        row: refs[json.row]
      });
    }
});

let DataStruct = Struct.extend({
    
    rows: null,
    columns: null,
    
    header: function() {
      return this.get('rows').filter( r => r.get('header') ).objectAt(0);
    }.property('rows.[]'),
    
    body: function() {
      return this.get('rows').filter( r => !r.get('header') );
    }.property('rows.[]'),
    
    geoColumns: function() {
      
      let sortedCols = this.get('columns').filter( 
        col => ["geo", "lat", "lon", "lat_dms", "lon_dms"].indexOf(col.get('meta.type')) >= 0
      ).sort( (a,b) => a.get('inconsistency') > b.get('inconsistency') ? 1 : -1 );
      
      if (sortedCols[0]) {
        switch (sortedCols[0].get('meta.type')) {
          case "geo":
            return [sortedCols[0]];
          case "lat":
            let lon = sortedCols.find( c => c.get('meta.type') === "lon" );
            return [lon, sortedCols[0]];
          case "lon":
            let lat = sortedCols.find( c => c.get('meta.type') === "lat" );
            return [sortedCols[0], lat];
          case "lat_dms":
            let lonDms = sortedCols.find( c => c.get('meta.type') === "lon_dms" );
            return [lonDms, sortedCols[0]];
          case "lon_dms":
            let latDms = sortedCols.find( c => c.get('meta.type') === "lat_dms" );
            return [sortedCols[0], latDms];
          default:
            throw new Error(`Unknow geo colum type ${sortedCols[0].get('meta.type')}`);
        }
      }
      
      return [];
        
    }.property('columns.[]', 'columns.@each._defferedChangeIndicator'),
    
    size: function() {
      return this.get('rows').length * this.get('columns').length;
    },
    
    selectedCell() {
      for (let row of this.get('rows')) {
        for (let cell of row.get('cells')) {
          if (cell.get('state.sheet.selected')) {
              return cell;
          }
        }       
      }
      return null;
    },
    
    getCellAt(row, col) {
      return this.get('rows').objectAt(row).get('cells').objectAt(col);
    },
    
    addRow() {
      let selectedCell = this.selectedCell(),
          shift = selectedCell && !selectedCell.get('row.header') ? 0:1,
          row = selectedCell ? selectedCell.get('row') : this.get('rows')[this.get('rows.length') - 1],
          index = this.get('rows').indexOf(row);
          
      this.get('rows').insertAt(index + shift, RowStruct.createWithModel(row));
    },
    
    //TODO : non testé
    removeRow(row) {
      this.get('rows').removeObject(row);
    },
    
    addColumn() {
      let selectedCell = this.selectedCell(),
          shift = selectedCell ? 0:1,
          index = selectedCell ? this.get('columns').indexOf(selectedCell.get('column')) : this.get('columns.length') - 1,
          column = ColumnStruct.create();
      
      this.beginPropertyChanges();
      this.get('columns').insertAt(index + shift, column);
      this.get('rows').forEach( r => {
          r.get('cells').insertAt(
              index + shift,
              CellStruct.create({
                  column: column,
                  row: r
              })
          );
      });
      this.endPropertyChanges();
    },
    
    removeColumn(column) {
      this.get('rows').forEach( r => {
        r.set('cells', r.get('cells').filter( c => c.get('column') != column ));
      });
      this.get('columns').removeObject(column);
    },
    
    analyse() {
      let report = {
        errors: [],
        warnings: [] 
      };
      this.analyseHeader(report);
      this.analyseColumnCount(report);
      this.analyseTrim(report);
      
      return report;
    },
    
    analyseHeader(report) {
      if (this.get('header.cells').some( c => Ember.isEmpty(c.get('value')) )) {
        report.errors.push("import.error.header.emptyCell");
      }
    },
    
    analyseColumnCount(report) {
      let min = Math.min.apply(null, this.get('rows').map( c => c.get('cells').length )),
          max = Math.max.apply(null, this.get('rows').map( c => c.get('cells').length ));
      
      if (this.get('columns').length === 1) {
        report.errors.push("import.error.oneColumn");
      }
      
      if (min !== max) {
        report.errors.push("import.error.colNumber");
      }
      
    },
    
    analyseTrim(report) {
      let trim = false;
      this.get('rows').forEach( r => r.get('cells').forEach( c => {
        
        let length = c.get('value').length;
        c.set('value', c.get('value').trim());
        trim = trim || length != c.get('value').length;
        
      }) );
      if (trim) {
        report.warnings.push("import.warning.trim");
      }
    },
    
    export() {
      return this._super({
          rows: this.get('rows').map( x => x.export() ),
          columns: this.get('columns').map( x => x.export() )
      });
    }
    
});

DataStruct.reopenClass({
    createFromRawData(data) {
        
        let columns = [],
            rows = data.map( (r, i) => {
                let row = RowStruct.create();
                row.setProperties({
                    header: i === 0,
                    cells: r.map ( (c, j) => {
                        return CellStruct.create({
                            value: c,
                            column: columns[j] ? columns[j] : (columns[j] = ColumnStruct.create()),
                            row: row
                        });
                    })
                });
                return row;
            });
        
        return this.create({
            rows: rows,
            columns: columns
        });
        
    },
    restore(json, refs = {}) {
        return this._super(json, refs, {
          columns: json.columns.map( x => ColumnStruct.restore(x, refs) ),
          rows: json.rows.map( x => RowStruct.restore(x, refs) )
        });
    }
});

export {DataStruct, RowStruct, ColumnStruct, CellStruct};
