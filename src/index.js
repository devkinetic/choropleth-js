import css from "./css/choropleth.css";

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
    // Classification
    classification: null,
    classificationBreaks: null,
    classificationBreaksEndo: null,
    classificationBreaksAdHoc: null,
    unclassifiedOrdinal: null,
    classificationOrdinal: null,
    // Color scheme
    colorScheme: 'Blues',
    colorCustom: null,
    // props
    labels: false,
    labelsFiltered: false,
    labelsSource: null,
    legend: false,
    legendTemplate: null,
    legendTitle: null,
    legendTickFormat: null,
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
        console.log();

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
   * 
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

  /**
   * Given a path, return just the file extension. Does not support file.ext.ext format.
   * 
   * @param filepath 
   * @returns {string}
   */
  function getFileTypeFromPath(filepath) {
    return filepath.split('\\').pop().split('/').pop().split('.').pop();
  }

  /**
   * Fetches specified Topology data
   * 
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
   * 
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
   * 
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
   * 
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

  function objectLengthModern(object) {
    return Object.keys(object).length;
  }

  function objectLengthLegacy(object) {
      var length = 0;
      for( var key in object ) {
          if( object.hasOwnProperty(key) ) {
              ++length;
          }
      }
      return length;
  }

  function objectLength(object) {
    return Object.keys ? objectLengthModern : objectLengthLegacy;
  }

  function getCustomColors(options, limit = null) {
    var colors = [];
    for (let idx in options.colorCustom) {
      if (options.colorCustom.hasOwnProperty(idx)) {
        if (limit) {
          if (idx <= (limit - 1)) {
            colors.push('#' + options.colorCustom[idx]);
          }
        } else {
          colors.push('#' + options.colorCustom[idx]);
        }
      }
    }
    return colors;
  }

  function getColorScheme(scheme, numColors) {
    var colors = [];
    
    switch (scheme) {
      case 'Category10':
      case 'Accent':
      case 'Dark2':
      case 'Paired':
      case 'Pastel1':
      case 'Pastel2':
      case 'Set1':
      case 'Set2':
      case 'Set3':
      case 'Tableau10':
        colorScheme = d3['scheme' + options.colorScheme];
        for (var i = 0; i > numColors; i++) {
          colors.push(colorScheme[i]);
        }
        break;
      default:
        colors = d3['scheme' + scheme][numColors];
        break;
    }

    return colors;
  }

  function getScale(options, data) {
    var scale = null;

    switch (options.classification) {
      
      // Exogenous
      case 'exo-ad-hoc':
        scale = d3.scaleThreshold();
        break;

      // Endogenous
      case 'endo-natural-breaks':
        scale = d3.scaleThreshold();
        break;

      case 'endo-equal-intervals':
      // https://stackoverflow.com/questions/52398668/calculate-how-many-std-deviations-the-values-of-certain-keys-are-from-the-mean
      case 'endo-equal-intervals-standard':
        scale = d3.scaleQuantize();
        break;

      // case 'endo-quantiles':
      //   scale = d3.scale????;
      //   break;

      // https://ibis.health.state.nm.us/resource/mapchoroclasses.html#part2e
      // case 'endo-geometric':
      //   scale = d3.scale????;
      //   break;

      // case 'endo-nested-means':
      //   scale = d3.scale????;
      //   break;
      
      // Unclassified
      case 'unclassified':
      default:
        scale = (options.unclassifiedOrdinal) ? d3.scaleOrdinal() : d3.scaleLinear();
        break;
    }

    return scale;
  }

  function getDomain(options, data) {

    var domain = [];

    // gather the data into an array (used for some classifications)
    var dataValues = [];
    data.forEach(function(d) { dataValues.push(+d.value); });

    switch (options.classification) {
      
      // Exogenous
      case 'exo-ad-hoc':
        domain = options.classificationBreaksAdHoc;
        break;

      // Endogenous
      case 'endo-natural-breaks':
        domain = ss.jenks(dataValues, options.classificationBreaksEndo);
        break;

      case 'endo-equal-intervals':
        domain = d3.extent(data, d => d.value);
        break;

      // TODO https://stackoverflow.com/questions/52398668/calculate-how-many-std-deviations-the-values-of-certain-keys-are-from-the-mean
      case 'endo-equal-intervals-standard':
        var deviation = d3.deviation(dataValues);
        var mean = d3.mean(dataValues);
        domain = [mean - deviation, mean + deviation];
        break;

      // case 'endo-quantiles':
      //   scale = d3.scale????;
      //   break;

      // https://ibis.health.state.nm.us/resource/mapchoroclasses.html#part2e
      // case 'endo-geometric':
      //   scale = d3.scale????;
      //   break;

      // case 'endo-nested-means':
      //   scale = d3.scale????;
      //   break;
      
      // Unclassified
      case 'unclassified':
      default:
        if (options.unclassifiedOrdinal) {
          for (var key in options.unclassifiedOrdinal) {
            if (options.unclassifiedOrdinal.hasOwnProperty(key)) {
              domain.push(key);
            }
          }
        } else {
          domain = d3.extent(data, d => d.value);
        }
        break;
    }

    return domain;
  }

  function getRange(options, data) {
    var range = [];
    var numColors = 0;

    switch (options.classification) {
      
      // Exogenous
      case 'exo-ad-hoc':
        numColors = options.classificationBreaksAdHoc.length + 1;
        break;

      // Endogenous
      case 'endo-natural-breaks':
      case 'endo-equal-intervals':
      case 'endo-equal-intervals-standard':
        numColors = options.classificationBreaksEndo + 1;
        break;

      // case 'endo-quantiles':
      //   scale = d3.scale????;
      //   break;

      // https://ibis.health.state.nm.us/resource/mapchoroclasses.html#part2e
      // case 'endo-geometric':
      //   scale = d3.scale????;
      //   break;

      // case 'endo-nested-means':
      //   scale = d3.scale????;
      //   break;
      
      // Unclassified
      case 'unclassified':
      default:
        if (options.unclassifiedOrdinal) {
          numColors = objectLength(options.unclassifiedOrdinal);
        } else {
          numColors = 2;
        }
        break;
    }

    return (options.colorScheme == 'custom') ? getCustomColors(options, numColors) : getColorScheme(options.colorScheme, numColors);
  }

  /**
   * Returns color scale based on the settings provided
   * @param options
   * @returns {*}
   */
  function getColorScale(options, data) {
    var scale = getScale(options, data);
    var domain = getDomain(options, data);
    var range = getRange(options, data);

    return (scale, domain, range) ? scale.domain(domain).range(range) : null;
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
    // unformatted values
    var unformatted = [];
    for (var match of tpl.matchAll(/\[\[([A-z0-9_]+)]]/g)) {
      if (unformatted.indexOf(match[1]) !== -1) {
        continue;
      }
      unformatted.push(match[1]);
      if (data.hasOwnProperty(match[1])) {
        tpl = tpl.replaceAll(match[0], data[match[1]]);
      }
    }

    // formatted values using value|format like 12345|$.2s
    var formatted = [];
    for (var match of tpl.matchAll(/\[\[([A-z0-9_]+)\|(.*)]]/g)) {
      if (formatted.indexOf(match[1]) !== -1) {
        continue;
      }
      formatted.push(match[1]);
      if (data.hasOwnProperty(match[1])) {
        tpl = tpl.replaceAll(match[0], d3.format(match[2])(data[match[1]]));
      }
    }

    return tpl;
  }

  function swatches(color, {
    columns = null,
    format,
    unknown: formatUnknown,
    swatchSize = 15,
    swatchWidth = swatchSize,
    swatchHeight = swatchSize,
    marginLeft = 0
  } = {}) {
    var SELF = this;
    const id = `-swatches-${Math.random().toString(16).slice(2)}`;
    const unknown = formatUnknown == null ? undefined : color.unknown();
    const unknowns = unknown == null || unknown === d3.scaleImplicit ? [] : [unknown];
    const domain = color.domain().concat(unknowns);
    if (format === undefined) format = x => x === unknown ? formatUnknown : x;
  
    function entity(character) {
      return `&#${character.charCodeAt(0).toString()};`;
    }

    var swatches = '';
  
    if (columns !== null) {
      swatches = `<div style="display: flex; align-items: center; margin-left: ${+marginLeft}px; min-height: 33px; font: 10px sans-serif;">
        <style>
        .${id}-item {
          break-inside: avoid;
          display: flex;
          align-items: center;
          padding-bottom: 1px;
        }
        
        .${id}-label {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: calc(100% - ${+swatchWidth}px - 0.5em);
        }
        
        .${id}-swatch {
          width: ${+swatchWidth}px;
          height: ${+swatchHeight}px;
          margin: 0 0.5em 0 0;
        }
        </style>
        <div style="width: 100%; columns: ${columns};">`;

      domain.map(value => {
        const label = `${format(value)}`;
        swatches += `<div class="${id}-item">
            <div class="${id}-swatch" style="background:${color(value)};"></div>
            <div class="${id}-label" title="${label.replace(/["&]/g, entity)}">${label}</div>
          </div>`;
      });

      swatches += '</div></div>';
    } else {
      swatches += `<div style="display: flex; align-items: center; min-height: 33px; margin-left: ${+marginLeft}px; font: 10px sans-serif;">
        <style>
        .${id} {
          display: inline-flex;
          align-items: center;
          margin-right: 1em;
        }
        .${id}::before {
          content: "";
          width: ${+swatchWidth}px;
          height: ${+swatchHeight}px;
          margin-right: 0.5em;
          background: var(--color);
        }
        </style>
        <div>`;

      domain.map(value => {
        swatches += `<span class="${id}" style="--color: ${color(value)}">${format(value)}</span>`;
      });

      swatches += '</div></div>';
    }

    SELF.legend.html(swatches);
  }

  // <div>${domain.map(value => SELF.legend.html(`<span class="${id}" style="--color: ${color(value)}">${format(value)}</span>`))}</div></div>`);
  
  function legend(color, {
    title,
    tickSize = 6,
    width = 320, 
    height = 44 + tickSize,
    marginTop = 18,
    marginRight = 0,
    marginBottom = 16 + tickSize,
    marginLeft = 0,
    ticks = width / 64,
    tickFormat,
    tickValues
  } = {}) {
    var SELF = this;
  
    function ramp(color, n = 256) {
      const canvas = document.createElement("canvas");
      canvas.width = n;
      canvas.height = 1;
      const context = canvas.getContext("2d");
      for (let i = 0; i < n; ++i) {
        context.fillStyle = color(i / (n - 1));
        context.fillRect(i, 0, 1, 1);
      }
      return canvas;
    }

    const svg = SELF.legend.append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", [0, 0, width, height])
      .style("overflow", "visible")
      .style("display", "block");
  
    let tickAdjust = g => g.selectAll(".tick line").attr("y1", marginTop + marginBottom - height);
    let x;
  
    // Continuous
    if (color.interpolate) {
      const n = Math.min(color.domain().length, color.range().length);
  
      x = color.copy().rangeRound(d3.quantize(d3.interpolate(marginLeft, width - marginRight), n));
  
      svg.append("image")
          .attr("x", marginLeft)
          .attr("y", marginTop)
          .attr("width", width - marginLeft - marginRight)
          .attr("height", height - marginTop - marginBottom)
          .attr("preserveAspectRatio", "none")
          .attr("xlink:href", ramp(color.copy().domain(d3.quantize(d3.interpolate(0, 1), n))).toDataURL());
    }
  
    // Sequential
    else if (color.interpolator) {
      x = Object.assign(color.copy()
          .interpolator(d3.interpolateRound(marginLeft, width - marginRight)),
          {range() { return [marginLeft, width - marginRight]; }});
  
      svg.append("image")
          .attr("x", marginLeft)
          .attr("y", marginTop)
          .attr("width", width - marginLeft - marginRight)
          .attr("height", height - marginTop - marginBottom)
          .attr("preserveAspectRatio", "none")
          .attr("xlink:href", ramp(color.interpolator()).toDataURL());
  
      // scaleSequentialQuantile doesn’t implement ticks or tickFormat.
      if (!x.ticks) {
        if (tickValues === undefined) {
          const n = Math.round(ticks + 1);
          tickValues = d3.range(n).map(i => d3.quantile(color.domain(), i / (n - 1)));
        }
        if (typeof tickFormat !== "function") {
          tickFormat = d3.format(tickFormat === undefined ? ",f" : tickFormat);
        }
      }
    }
  
    // Threshold
    else if (color.invertExtent) {
      const thresholds
          = color.thresholds ? color.thresholds() // scaleQuantize
          : color.quantiles ? color.quantiles() // scaleQuantile
          : color.domain(); // scaleThreshold
  
      const thresholdFormat
          = tickFormat === undefined ? d => d
          : typeof tickFormat === "string" ? d3.format(tickFormat)
          : tickFormat;
  
      x = d3.scaleLinear()
          .domain([-1, color.range().length - 1])
          .rangeRound([marginLeft, width - marginRight]);
  
      svg.append("g")
        .selectAll("rect")
        .data(color.range())
        .join("rect")
          .attr("x", (d, i) => x(i - 1))
          .attr("y", marginTop)
          .attr("width", (d, i) => x(i) - x(i - 1))
          .attr("height", height - marginTop - marginBottom)
          .attr("fill", d => d);
  
      tickValues = d3.range(thresholds.length);
      tickFormat = i => thresholdFormat(thresholds[i], i);
    }
  
    // Ordinal
    else {
      x = d3.scaleBand()
          .domain(color.domain())
          .rangeRound([marginLeft, width - marginRight]);
  
      svg.append("g")
        .selectAll("rect")
        .data(color.domain())
        .join("rect")
          .attr("x", x)
          .attr("y", marginTop)
          .attr("width", Math.max(0, x.bandwidth() - 1))
          .attr("height", height - marginTop - marginBottom)
          .attr("fill", color);
  
      tickAdjust = () => {};
    }
  
    svg.append("g")
        .attr("transform", `translate(0,${height - marginBottom})`)
        .call(d3.axisBottom(x)
          .ticks(ticks, typeof tickFormat === "string" ? tickFormat : undefined)
          .tickFormat(typeof tickFormat === "function" ? tickFormat : undefined)
          .tickSize(tickSize)
          .tickValues(tickValues))
        .call(tickAdjust)
        .call(g => g.select(".domain").remove())
        .call(g => g.append("text")
          .attr("x", marginLeft)
          .attr("y", marginTop + marginBottom - height - 6)
          .attr("fill", "currentColor")
          .attr("text-anchor", "start")
          .attr("font-weight", "bold")
          .attr("class", "title")
          .text(title));
  
    return svg.node();
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

    this.SVG = this.EL.select('svg.choropleth--map');
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
        SELF.legend = SELF.EL.append('div').attr('class', 'choropleth--legend');
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
    var options = {}

    if (SELF.options.classification != 'unclassified') {
      if (SELF.options.legendTitle) options.title = SELF.options.legendTitle;
      if (SELF.options.legendTickFormat) options.tickFormat = SELF.options.legendTickFormat;
      legend.call(SELF, SELF.colorScale, options);
    } else {
      swatches.call(SELF, SELF.colorScale, options);
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
