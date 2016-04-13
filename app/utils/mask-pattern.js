let lines = function(opts = {}) {
  let orientation = opts.orientation || ["diagonal"],
      shapeRendering = "auto",
      size = opts.size || 10,
      stroke = "#FFFFFF",
      strokeWidth = opts.stroke || 2,
      scale = opts.scale || 1,
      id = () => `${orientation.join('-').replace('/', '')}-${(strokeWidth+"").replace(".", "-")}`,
      path = function(orientation) {
        switch (orientation % 180) {
          case 0:
            return (function(s) {
              return "M 0," + (s / 2) + " l " + s + ",0";
            })(size);
          case 45:
            return (function(s) {
              return "M 0," + s + " l " + s + "," + (-s) + " M " + (-s / 4) + "," + (s / 4) + " l " + (s / 2) + "," + (-s / 2) + "\nM " + (3 / 4 * s) + "," + (5 / 4 * s) + " l " + (s / 2) + "," + (-s / 2);
            })(size);
          case 90:
            return (function(s) {
              return "M " + (s / 2) + ", 0 l 0, " + s;
            })(size);
          case 135:
            return (function(s) {
              return "M 0,0 l " + s + "," + s + " M " + (-s / 4) + "," + (3 / 4 * s) + " l " + (s / 2) + "," + (s / 2) + "\nM " + (s * 3 / 4) + "," + (-s / 4) + " l " + (s / 2) + "," + (s / 2);
            })(size);
          /*case "1of8":
            return (function(s) {
              return "M " + (s / 4) + ",0 l " + (s / 2) + "," + s + " M " + (-s / 4) + ",0 l " + (s / 2) + "," + s + "\nM " + (s * 3 / 4) + ",0 l " + (s / 2) + "," + s;
            })(size);
          case "2of8":
            return (function(s) {
              return "M 0," + s + " l " + s + "," + (-s) + " M " + (-s / 4) + "," + (s / 4) + " l " + (s / 2) + "," + (-s / 2) + "\nM " + (3 / 4 * s) + "," + (5 / 4 * s) + " l " + (s / 2) + "," + (-s / 2);
            })(size);*/
          
          /*case "3of8":
            return (function(s) {
              return "M 0," + (3 / 4 * s) + " l " + s + "," + (-s / 2) + " M 0," + (s / 4) + " l " + s + "," + (-s / 2) + "\nM 0," + (s * 5 / 4) + " l " + s + "," + (-s / 2);
            })(size);*/
          /*case "4of8":
            return (function(s) {
              return "M 0," + (s / 2) + " l " + s + ",0";
            })(size);*/
          
          /*case "5of8":
            return (function(s) {
              return "M 0," + (-s / 4) + " l " + s + "," + (s / 2) + "M 0," + (s / 4) + " l " + s + "," + (s / 2) + "\nM 0," + (s * 3 / 4) + " l " + s + "," + (s / 2);
            })(size);*/
          /*case "7of8":
            return (function(s) {
              return "M " + (-s / 4) + ",0 l " + (s / 2) + "," + s + " M " + (s / 4) + ",0 l " + (s / 2) + "," + s + "\nM " + (s * 3 / 4) + ",0 l " + (s / 2) + "," + s;
            })(size);*/
          default:
            return (function(s) {
              return "M " + (s / 2) + ", 0 l 0, " + s;
            })(size);
        }
      };
      
  let proc = function() {
    
    let defs = this.selectAll("defs");
    
    if (defs.empty()) {
      defs = this.append("defs");
    }
      
    let pattern = defs.selectAll(`#pattern-${id()}`),
        mask = defs.selectAll(`#mask-${id()}`);
    
    if (pattern.empty()) {
      
      pattern = defs.append("pattern")
        .attr({
          id: `pattern-${id()}`,
          patternUnits: "userSpaceOnUse",
          width: size,
          height: size
        });
      
      for (let i = 0; i < orientation.length; i++) {
        pattern.append("path").attr({
          d: path(orientation[i]),
          "stroke-width": strokeWidth,
          "shape-rendering": shapeRendering,
          "stroke": stroke,
          "stroke-linecap": "square"
        });
      }
      
    }
    
    if (mask.empty()) {
      
      defs.append("mask")
        .attr({
          id: `mask-${id()}`,
          width: "10000",
          height: "10000"
        })
        .append("rect").attr({
          x: "-5000",
          y: "-5000",
          width: "10000",
          height: "10000",
          transform: `scale(${scale})`
        })
        .style("fill", `url(${window.location}#pattern-${id()})`);
          
    }
        
  }
  
  proc.url = function(ns = null) {
   return `${window.location}#mask${ns ? ns+"-" : ""}-${id()}`;
  }
  
  return proc;
   
};

const NONE = function() {};
NONE.url = () => "none";

export default {lines, NONE};
