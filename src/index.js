import css from "./css/choropleth.css";
import * as ss from 'simple-statistics'

ss.jenksMatrices = function(data, n_classes) {

  // in the original implementation, these matrices are referred to
  // as `LC` and `OP`
  //
  // * lower_class_limits (LC): optimal lower class limits
  // * variance_combinations (OP): optimal variance combinations for all classes
  var lower_class_limits = [],
      variance_combinations = [],
      // loop counters
      i, j,
      // the variance, as computed at each step in the calculation
      variance = 0;

  // Initialize and fill each matrix with zeroes
  for (i = 0; i < data.length + 1; i++) {
      var tmp1 = [], tmp2 = [];
      for (j = 0; j < n_classes + 1; j++) {
          tmp1.push(0);
          tmp2.push(0);
      }
      lower_class_limits.push(tmp1);
      variance_combinations.push(tmp2);
  }

  for (i = 1; i < n_classes + 1; i++) {
      lower_class_limits[1][i] = 1;
      variance_combinations[1][i] = 0;
      // in the original implementation, 9999999 is used but
      // since Javascript has `Infinity`, we use that.
      for (j = 2; j < data.length + 1; j++) {
          variance_combinations[j][i] = Infinity;
      }
  }

  for (var l = 2; l < data.length + 1; l++) {

      // `SZ` originally. this is the sum of the values seen thus
      // far when calculating variance.
      var sum = 0, 
          // `ZSQ` originally. the sum of squares of values seen
          // thus far
          sum_squares = 0,
          // `WT` originally. This is the number of 
          w = 0,
          // `IV` originally
          i4 = 0;

      // in several instances, you could say `Math.pow(x, 2)`
      // instead of `x * x`, but this is slower in some browsers
      // introduces an unnecessary concept.
      for (var m = 1; m < l + 1; m++) {

          // `III` originally
          var lower_class_limit = l - m + 1,
              val = data[lower_class_limit - 1];

          // here we're estimating variance for each potential classing
          // of the data, for each potential number of classes. `w`
          // is the number of data points considered so far.
          w++;

          // increase the current sum and sum-of-squares
          sum += val;
          sum_squares += val * val;

          // the variance at this point in the sequence is the difference
          // between the sum of squares and the total x 2, over the number
          // of samples.
          variance = sum_squares - (sum * sum) / w;

          i4 = lower_class_limit - 1;

          if (i4 !== 0) {
              for (j = 2; j < n_classes + 1; j++) {
                  if (variance_combinations[l][j] >=
                      (variance + variance_combinations[i4][j - 1])) {
                      lower_class_limits[l][j] = lower_class_limit;
                      variance_combinations[l][j] = variance +
                          variance_combinations[i4][j - 1];
                  }
              }
          }
      }

      lower_class_limits[l][1] = 1;
      variance_combinations[l][1] = variance;
  }

  return {
      lower_class_limits: lower_class_limits,
      variance_combinations: variance_combinations
  };
};

ss.jenks = function(data, n_classes) {

  // sort data in numerical order
  data = data.slice().sort(function (a, b) { return a - b; });

  // get our basic matrices
  var matrices = ss.jenksMatrices(data, n_classes),
      // we only need lower class limits here
      lower_class_limits = matrices.lower_class_limits,
      k = data.length - 1,
      kclass = [],
      countNum = n_classes;

  // the calculation of classes will never include the upper and
  // lower bounds, so we need to explicitly set them
  kclass[n_classes] = data[data.length - 1];
  kclass[0] = data[0];

  // the lower_class_limits matrix is used as indexes into itself
  // here: the `k` variable is reused in each iteration.
  while (countNum > 1) {
      kclass[countNum - 1] = data[lower_class_limits[k][countNum] - 2];
      k = lower_class_limits[k][countNum] - 1;
      countNum--;
  }

  return kclass;
};

(function (window, $) {

  /**
   * Private properties
   */
  var D3 = window.d3, topojson = window.topojson;

  // ad-hoc function mapping for various layers
  var _mapping = {
    'nation': renderPath,
    'states': renderPath,
    'counties': renderPath,
    'zones': renderPoint
  }

  var defaults = {
    location: '/',
    // elements
    element: null,  // container to which SVG will be added
    // sizes
    width: null,
    height: null,
    aspectRatio: null,
    // Data, can be initialized after
    data: null,
    // Geometries
    topography: null,
    topographyGranularity: null,
    extraLayers: [],
    topologyAdditions: null,
    // Color scheme
    colorScheme: 'qualitative',
    colorData: {0:'#cccccc', 1:'#777777'},
    // props
    labels: false,
    labelsFiltered: false,
    labelsSource: null,
    legend: true,
    legendTemplate: null,
    legendLabels: null,
    tooltip: true,
    tooltipTemplate: '<p>Name: [[name]]<br>Value: [[value]]</p>',
    callout: true,
    calloutElements: [],
    calloutElementTemplate: null,
    alterTopography: null,
    // Map positioning
    center: {x: 0.5, y:0.5},
    scaleFactor: 1,
  };

  var _path = '/', _topo = {
    'world': {
      world: {file: 'world.json', data: null},
      countries: {file: 'countries.json', data: null}
    },
    'us-atlas': {
      nation: {file: 'nation-10m.json', data: null},
      states: {file: 'states-10m.json', data: null},
      counties: {file: 'counties-10m.json', data: null}
    }
  };

  var subscribers = {};


  // --------------- Private methods -------------------------//

  function applyUnitClasses(unit, layerName) {
    var classes = [layerName, layerName + '--name-' + unit.properties.name.toLowerCase().replace(" ", "_")];
    if (unit.properties.hasOwnProperty('value')) {
      classes.push(layerName + '--value');
      classes.push(layerName + '--value-' + unit.properties.value);
    }
    return classes.join(' ');
  }

  function transformPointReversed(topology, position) {
    position = position.slice();
    position[0] = (position[0] - topology.transform.translate[0])
      /(topology.transform.scale[0]);
    position[1] = (position[1] - topology.transform.translate[1])
      /(topology.transform.scale[1]);
    return position;
  }

  /**
   * Unit render callback - path
   */
  function renderPath(layer, layerName, layerData) {
    var SELF = this;

    return layer.selectAll('path')
      .data(layerData)
      .enter().append('path')
      .attr('d', SELF.path)
      .attr('class', function (d) { return applyUnitClasses(d, layerName)})
      .style("fill", function (d) {
        return (d.properties.hasOwnProperty('value')) ? SELF.colorScale(d.properties.value) : null;
      });
  }

  /**
   * Unit render callback - point
   */
  function renderPoint(layer, layerName, layerData) {
    var SELF = this;

    return layer.selectAll('circle')
      .data(layerData)
      .enter().append('circle')
      .attr('r', function (d) {
        return '8px';
      })
      .attrs(function (d) {
        return renderPointXY.call(SELF, d)
      })
      .style("fill", function (d) {
        return (d.properties.hasOwnProperty('value')) ? SELF.colorScale(d.properties.value) : null;
      });
  }

  function renderPointXY(d) {
    var SELF = this;
    var
      c = d.geometry.coordinates,
      pos = SELF.projection(typeof d.latlong !== undefined ? transformPointReversed(SELF.options.topography, c) : c);
    return pos ? {'cx': pos[0], 'cy': pos[1]} : null;
  }

  function isObject(item) {
    return (item && typeof item === 'object' && !Array.isArray(item));
  }

  function mergeDeep(target, source) {
    let output = Object.assign({}, target);
    if (isObject(target) && isObject(source)) {
      Object.keys(source).forEach(key => {
        if (isObject(source[key])) {
          if (!(key in target))
            Object.assign(output, { [key]: source[key] });
          else
            output[key] = mergeDeep(target[key], source[key]);
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }
    return output;
  }

  /**
   * Computes mouse event coordinates relative to the choropleth container
   * @param event
   * @returns {{x: number, y: number}}
   */
  function getRelativeCoordinates(event) {
    return {
      x: event.pageX,
      y: event.pageY
    }
  }

  function calcCenterPoint(width, height) {
    return [
      (width ? width : this.options.width) * this.options.center.x,
      (height ? height : this.options.height) * this.options.center.y,
    ]
  }

  /**
   * Filters by property and value
   *
   * @param prop
   * @param value
   * @param obj
   * @returns {boolean}
   */
  function filterByProperty(prop, value, obj) {
    if (null !== value) {
      return obj.properties.hasOwnProperty(prop) && value === obj.properties[prop];
    }
    else {
      return obj.properties.hasOwnProperty(prop);
    }
  }

  function getFileTypeFromPath(filepath) {
    return filepath.split('\\').pop().split('/').pop().split('.').pop();
  }

  /**
   * Fetches specified Topology data
   * @param name
   * @param layer
   * @returns {null|*}
   */
  function getTopography(name, layer) {
    var SELF = this;
    return d3.queue().defer(function (cb) {
        // If we already have map data loaded, just return it.
        if (typeof SELF.options.data === 'object') {
          cb(null, SELF.options.data);
        }

        // If given a file path to the map data, load it
        if (typeof SELF.options.data === 'string') {
          // can be either a json file or csv
          var filetype = getFileTypeFromPath(SELF.options.data);
          if (filetype === 'json' || filetype === 'csv') {
            d3[filetype](SELF.options.data)
            .then(function(file) {
              cb(null, file);
            });
          }
        }
      }).defer(function (cb) {
        // When either set or layer is not defined
        if (!_topo.hasOwnProperty(name) || !_topo[name].hasOwnProperty(layer)) {
          cb(null, null);
        }

        // If we already have topography data loaded, just return it.
        if (_topo[name][layer].data) {
          cb(null, _topo[name][layer].data);
        }

        // Otherwise load data from local plugin storage in the 'topology' folder
        // these are for now just json files
        d3.json(_path + 'topology/' + name + '/' + _topo[name][layer].file)
          .then(function(file) {
            if (typeof SELF.options.alterTopography === 'function') {
              SELF.options.alterTopography.call(SELF, file);
            }
            _topo[name][layer].data = file;
            cb(null,  _topo[name][layer].data);
          });
      });
  }

  /**
   * Adds data properties to topography features.
   * @returns {null}
   */
  function augmentTopography(topo, feature, data) {
    if (typeof topo !== 'object' || typeof data !== 'object') {
      return null;
    }
    if (!topo.objects.hasOwnProperty(feature)) {
      return topo;
    }

    // create an array that maps the FIPS id's in the dataset to check against later
    var dataFips = [];
    for (var i = 0; i < data.length; i++) {
      dataFips[Number(data[i].id)] = i;
    }

    for (var i = 0; i < topo.objects[feature].geometries.length; i++) {
      var id = Number(topo.objects[feature].geometries[i].id);
      if (dataFips.hasOwnProperty(id)) {
        Object.assign(topo.objects[feature].geometries[i].properties, data[dataFips[id]]);
      }
    }
    return topo;
  }

  /**
   * Logging
   * @param msg Message to print
   * @param type Type of message
   */
  function message(msg, type) {
    type = type || 'info';
    msg = msg || false;
    if (msg) {
      msg = 'CHOROPLETH: ' + msg;
      console.log(msg);
      if ('error' === type) {
        throw new Error(msg)
      }
    }
  }

  /**
   * Applies defaults on top of provided settings object
   * @param obj
   * @returns {*}
   */
  //stolen from underscore.js
  function applyDefaults(obj) {
    Array.prototype.slice.call(arguments, 1).forEach(function(source) {
      if (source) {
        for (var prop in source) {
          // Deep copy if property not set
          if (obj[prop] == null) {
            if (typeof source[prop] == 'function') {
              obj[prop] = source[prop];
            }
            else {
              obj[prop] = JSON.parse(JSON.stringify(source[prop]));
            }
          }
        }
      }
    });
    return obj;
  }

  /**
   * Adds some extensions to D3
   */
  function extendD3() {
    // Moves selection to front
    d3.selection.prototype.moveToFront = function () {
      return this.each(function () {
        this.parentNode.appendChild(this);
      });
    };

    // Moves selection to back
    d3.selection.prototype.moveToBack = function () {
      return this.each(function () {
        var firstChild = this.parentNode.firstChild;
        if (firstChild) {
          this.parentNode.insertBefore(this, firstChild);
        }
      });
    };
  }

  /**
   * Returns color scale based on the settings provided
   * @param options
   * @returns {*}
   */
  function getColorScale(options, data) {
    var scale = null;

    // Check if custom call back is provided
    if (typeof options.colorScheme === 'function') {
      return options.colorScheme(options.colorData);
    }

    // Else go over available scheme types
    switch (options.colorScheme) {
      case 'qualitative':
        var domain = [], range = [];
        for (let idx in options.colorData) {
          if (options.colorData.hasOwnProperty(idx)) {
            domain.push(Number(idx));
            range.push(options.colorData[idx]);
          }
        }
        scale = d3.scaleOrdinal().domain(domain).range(range);
        break;
      case 'grayscale':
        var dataExtent = d3.extent(data, d => d.value);
        scale = d3.scaleLinear().domain(dataExtent).range(['#d3d1d1', 'black']);
        break;
      case 'single-hue':
      case 'part-spectral':
      case 'full-spectral':
      case 'bipolar':
      default:
        scale = d3.scaleOrdinal().domain([-1, 0, 1, 2, 3, 4, 5]).range(d3.schemeBlues[7]);
        break;
    }
    return scale;
  }

  /**
   * Renders a template.
   * Substitutes tokens of format '[[token]]' with values from supplied data object
   *
   * @param tpl Template string
   * @param data Object with token:value pairs
   * @returns {*} Rendered string
   */
  function renderTemplate(tpl, data) {
    var processed = [];
    for (var match of tpl.matchAll(/\[\[([A-z0-9_]+)]]/g)) {
      if (processed.indexOf(match[1]) !== -1) {
        continue;
      }
      processed.push(match[1]);
      if (data.hasOwnProperty(match[1])) {
        tpl = tpl.replaceAll(match[0], data[match[1]]);
      }
    }
    return tpl;
  }

  /**
   * Choropleth class
   */
  function Choropleth(options) {

    var SELF = this;

    // Check requirements
    if (typeof d3 === undefined) {
      message('D3.js version 6.x is required.')
    }
    else if ( typeof topojson === undefined) {
      message('topojson is required.')
    }

    // D3 extensions
    extendD3();

    // Preprocess options
    options = options || {};
    this.options = applyDefaults(options, defaults);

    // Init svg
    if (!this.options.element || d3.select(this.options.element).empty()) {
      message('element does not exists', 'error');
    }
    this.EL = d3.select(this.options.element)

    this.SVG = this.EL.select('svg');
    if (this.SVG.empty()) {
      this.SVG = d3.select(this.options.element).append('svg');
    }

    // Calculate sizes
    if (this.options.aspectRatio) {
      this.EL
        .classed('choropleth--proportional', true)
        .select('.choropleth--wrapper')
        .style('padding-bottom', (this.options.aspectRatio * 100) + '%');
    }
    this.options.width = this.getSVGWrapper().getBoundingClientRect().width;
    this.options.height = this.getSVGWrapper().getBoundingClientRect().height;
    this.options.aspectRatio = this.options.aspectRatio || this.options.height / this.options.width;
    this.SVG
      .attr('width', this.options.width)
      .attr('height', this.options.height)
      .style('overflow', 'hidden');

    // Set projection, path and color scheme
    this.projection = d3.geoAlbersUsa().scale([this.options.width * this.options.scaleFactor]).translate(calcCenterPoint.call(SELF));
    this.path = d3.geoPath().projection(this.projection);

    // add resizing
    d3.select(window).on('resize', this.resize.bind(this));

    // Save the above into options for reference
    this.options.projection = this.projection;
    this.options.path = this.path;

    // Each new choropleth instance can redefine location, so that topography
    // can be loaded from a custom source
    _path = this.options.location;

    // Pull topography and render the map.
    // ... when strings are supplied, we assume we need to load/provide topography
    var loaded = getTopography.call(SELF, this.options.topography, this.options.topographyGranularity);

    // Wait for data to be loaded
    loaded.await(function (err, data, topography) {
      SELF.colorScale = getColorScale(SELF.options, data);
      SELF.options.colorScale = SELF.colorScale;
      // replace topography option with loaded objects
      topography = mergeDeep(topography, SELF.options.topologyAdditions);
      topography = augmentTopography(topography, SELF.options.topographyGranularity, data);
      SELF.options.topography = augmentTopography(topography, 'zones', data);
      _render();
    });

    /**
     * Renders entire map.
     * This method is called from constructor
     * For updating map or rendering specific layer use proto methods
     */
    function _render() {
      message('rendering...');
      // render data layer
      SELF.drawDataLayer();
      SELF.drawDataLayer('zones');
      // render additional layers ?
      for (var i = 0; i <= SELF.options.extraLayers.length; i++) {
        SELF.drawLayer(SELF.options.extraLayers[i] );
      }
      // render labels
      if (SELF.options.labels) {
        SELF.drawLabels();
      }
      // render tooltips ()
      if (SELF.options.tooltip) {
        SELF.tooltip = d3.select('body').append('div').attr('class', 'choropleth--tooltip');
      }
      // render callouts
      // render legend
      if (SELF.options.legend) {
        SELF.legend = SELF.EL.append('dl').attr('class', 'choropleth--legend');
        SELF.updateLegend();
      }
    }
  }

  // Proxy to logging
  Choropleth.prototype.log = message;

  // Allows to select (mimic hover) a reagion
  Choropleth.prototype.toggleRegion = function(id, status) {
    var d = this.SVG.select('.region[region-id="' + id + "]");
    if (d.length) {
      console.log(d);
    }
    // Toggle
    if (typeof status === 'undefined') {
    }
    // ..or switch
    else {

    }
  }


  // Adds legend to the mix
  Choropleth.prototype.updateLegend = function () {
    var SELF = this;
    if (!this.options.legend) {
      return;
    }

    // Legend varies based on the color scheme
    // @todo - determine the ways of generating various combinations of
    // scales and classifications

    // Render simple legend
    if (
      SELF.options.colorScheme == 'qualitative' ||
      SELF.options.colorScheme == 'grayscale'
    ) {
      SELF.legend.attr('class', 'choropleth--legend choropleth--legend--' + SELF.options.colorScheme);
      for (var v of this.colorScale.domain()) {
        var c = SELF.colorScale(v);
        if (
          SELF.options.hasOwnProperty('legendLabels') &&
          SELF.options.legendLabels != null &&
          SELF.options.legendLabels.hasOwnProperty(v))
        {
          var l = SELF.options.legendLabels[v];
        } else {
          var l = v.toString();
        }

        SELF.legend.append('dt').attr('class', 'choropleth--legend-value').style('background-color', c);
        SELF.legend.append('dd').attr('class', 'choropleth--legend-label').html(l);
      }
    }
    // Render band legend (band scale)
    else {

    }

  }

  /**
   * Resize callback
   */
  Choropleth.prototype.resize = function() {
    var SELF = this;
    // adjust things when the window size changes
    var width = SELF.getSVGWrapper().getBoundingClientRect().width,
      height = width * SELF.options.aspectRatio;

    // update projection
    this.projection.translate(calcCenterPoint.call(SELF, width, height)).scale([width * this.options.scaleFactor]);

    // resize the map container
    this.SVG
      .attr('width', width + 'px')
      .attr('height', height + 'px');

    // resize all layers
    this.SVG.selectAll('.layer--data').selectAll('path').attr('d', this.path);
    this.SVG.selectAll('.layer--data').selectAll('circle').attrs( function(d) {
      return renderPointXY.call(SELF, d);
    });

  }

  /**
   * Draws a layer
   * Usually layer of topography features from the selected topography object
   * @param layer
   */
  Choropleth.prototype.drawLayer = function(layer) {
    // if (top.)
    this.SVG.append('g')
      .attr('class', 'layer layer--' + layer)
      .selectAll("path")
      .data(topojson.feature(us, us.objects[layer]).features)
      .enter().append("path")
      .attr("d", path)
      .attr('class', layer)
      .style("position", 'relative');
  }

  /**
   * Draws data layer of the map
   * @param layerName Optional
   */
  Choropleth.prototype.drawDataLayer = function(layerName) {
    layerName = layerName || this.options.topographyGranularity;

    var SELF = this, cb = _mapping[layerName];
    if (!SELF.options.topography.objects.hasOwnProperty(layerName)) {
      message('Data layer not found', 'warning');
      return;
    }

    var layer = SELF.SVG.append('g').attr('class', 'layer layer--data layer--' + layerName),
      layerData = topojson.feature(SELF.options.topography, SELF.options.topography.objects[layerName]).features;
    // Layer callback - ad-hoc and needs to be replaced
    layer = cb.call(SELF, layer, layerName, layerData);

    // Add tooltips
    if (SELF.options.tooltip) {
      layer
        .filter(filterByProperty.bind(null, 'value', null))
        .on('mouseover', function (e, obj) {
          var coords = getRelativeCoordinates.call(SELF, e);
          var sel = d3.select(this);
          sel.transition()
            .duration(100)
            .style('opacity', '0.7');
          SELF.tooltip.html(renderTemplate(SELF.options.tooltipTemplate, obj.properties))
            .style('left', (coords.x + 15) + "px")
            .style('top', (coords.y + 30) + "px")
            .style('display', 'block');
        })
        .on('mouseout', function (e, obj) {
          var sel = d3.select(this);
          sel.transition()
            .duration(100)
            .style('opacity', '1')
          SELF.tooltip.style('display', 'none');
        })
        .on('click', function (e, obj) {
          if (!subscribers['click']) {
            return;
          }
          subscribers['click'].forEach( function(cb) {
            cb.call(SELF, e, obj);
          });
        })
    }
  }

  /**
   * Draws labels on the map
   * @param name
   */
  Choropleth.prototype.drawLabels = function(name) {
    name = name || this.options.topographyGranularity;
    var SELF = this;
    // Draw parish name
    SELF.SVG.append('g')
      .attr('class', 'layer layer--labels')
      .selectAll('.label')
      .data(topojson.feature(SELF.options.topography, SELF.options.topography.objects[name]).features)
      .enter()
      .filter(filterByProperty.bind(null, 'value', null))
      .append('text')
      .each(function (d) {
        // Excluded labels
        // @todo make configurable
        if ("78" === d.id || "72" === d.id) {
          return null;
        }
        d3.select(this)
          .attr("transform", function (d) {
            return "translate(" + SELF.path.centroid(d) + ")";
          })
          // .attr("dx", "-3em")
          // .attr("dy", "-0.5em")
          .attr("fill", "black")
          .style("text-anchor", "middle")
          .text(function (d) {
            if (d.properties.hasOwnProperty(SELF.options.labelsSource)) {
              return d.properties[SELF.options.labelsSource];
            }
            else {
              return d.properties.name;
            }
          });
      });
  }

  Choropleth.prototype.on = function(e, cb) {
    if (!['click'].includes(e)) {
      return;
    }
    var SELF = this;
    if (!subscribers[e]) {
      subscribers[e] = [];
    }

    subscribers[e].push(cb);
  }

  Choropleth.prototype.getSVGWrapper = function() {
    return this.options.aspectRatio ? this.EL.select('.choropleth--wrapper').node() : this.EL.select('.choropleth--wrapper').node();
  }


  window.Choropleth = Choropleth;
  window.ChoroplethAPI = {
    getInstance: getInstance,
  }

  function getInstance() {
    return null;
  }

})(window, jQuery);
