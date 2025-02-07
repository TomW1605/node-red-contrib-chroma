module.exports = function(RED) {
    function chromaNode(config) {
		function checkPath(obj, path)
		{
			if(path.includes('.'))
			{
				if(obj.hasOwnProperty(path.split('.')[0])) return checkPath(obj[path.split('.')[0]], path.split('.').slice(1).join('.'));
				else return false
			}
			else
			{
				return obj.hasOwnProperty(path);
			}
		}
		function getValue(obj, path)
		{
			if (!path) return obj;
			const properties = path.split('.');
			return getValue(obj[properties.shift()], properties.join('.'))
		}
		function setValue(obj, path, value)
		{
			if (path.length === 1)
			{
				obj[path] = value
				return
			}
			return setValue(obj[path.split('.')[0]], path.split('.').slice(1), value)
		}
	
      var chroma = require('chroma-js');
      var chromaPlus = require('./chromaPlus');

      RED.nodes.createNode(this,config);
      this.on('close', function() {
        node.status({fill:'grey', shape:'ring', text:"not initialized|" + config.outFormat});
      });
      var node = this;
      var color = null;
      var inputColorType = '';
      var callbackColor = null;
      const {scalePercent,array2object,colorType} = require('./utils');
      const {functionDef} = require('./definitions');

      var isChromaPlus = function (color) {
        for (let def in functionDef) {
          if (functionDef[def].lib === 'chromaPlus') {
            checkBlock : {
              for (let param of functionDef[def].params) {
                if (!color.hasOwnProperty(param)) break checkBlock;
              }
              return true;
            }
          }
        }
        return false;
      };

      var withError = function (message) {
        node.error(message);
        node.status({fill:"red", shape:'ring', text:message});
        return;
      }

      node.on('input', function(msg) {
        // console.log(msg);
		this.log(checkPath(msg, config.inLocation));
        // set chroma value
        var inputColorType = "";
        var statusColor = "green";
        if (checkPath(msg, config.inLocation)) {
		  var inputColor = getValue(msg, config.inLocation);
          inputColorType = colorType(inputColor);
          if (config.inputRelativeValues==='percent' && inputColorType!=='lab' && inputColorType!=='lch') inputColor=scalePercent(inputColor,0.01);
          if (callbackColor!==null) {
            color=callbackColor(inputColor);
            node.status({fill:'blue', shape:'dot', text:"api("+inputColor+")=" + color.hex() + "|" + config.outFormat});
          } else if (isChromaPlus(inputColor)) {
            color = chromaPlus(inputColor);
            if (color.hasOwnProperty('error')) return withError(color.error);
            node.status({fill:statusColor, shape:'dot', text:((inputColorType) ? inputColorType+'|' : "") + color.hex() + "|" + config.outFormat});
          } else if (chroma.valid(inputColor)) {
            color = chroma(inputColor);
            node.status({fill:statusColor, shape:'dot', text:((inputColorType) ? inputColorType+'|' : "") + color.hex() + "|" + config.outFormat});
          } else if (!msg.hasOwnProperty('api')) return withError('Input not supported! ('+inputColor+')');
        } else {
          node.status({fill:'grey', shape:'dot', text:"no payload|" + (msg.hasOwnProperty('api') ? 'api|' : '') + config.outFormat});
        }
        // apply and api methods to the chroma object
        if (msg.hasOwnProperty('api')) {
          if (typeof msg.api === 'object' && Array.isArray(msg.api)) {
            for (let apiCall of msg.api) {
              if (!Array.isArray(apiCall)) {
                Object.keys(apiCall).forEach((method,index) => {
                  switch (method) {
                    case 'cubehelix':
                    case 'scale':
                      color = chroma[method](apiCall[method]);
                      break;
                    default:  
                      if (color === null) color = chroma("#000000");
                      color = color[method](apiCall[method]);
                  }
                });
              } else {
                return withError('object expected');
              }
            }
            // convert result to chroma object(s)
            if (typeof color === 'function') {
              callbackColor = color;
              statusColor = "yellow";
              if (msg.hasOwnProperty('payload')) {
                inputColorType = "api result";
                color = chroma(color(msg.payload));
                node.status({fill:"blue", shape:'dot', text:"api("+msg.payload+")=" + color.hex() + "|" + config.outFormat});
              } else {
                node.status({fill:statusColor, shape:'dot', text:"api callback ready"});
                msg.payload = callbackColor;
                node.send(msg);
                return;
              }
            }
            if (Array.isArray(color)) {
              var chromaArray = [];
              for (let currentColor of color) {
                if (chroma.valid(currentColor)) {
                  chromaArray.push(chroma(currentColor));
                }
              }
              if (chromaArray.length===0) {
                msg.payload = color;
                return msg;
              }
              color = chromaArray;
            }
          } else return withError('msg.api expects an array of objects')
        }

        // prepare the result
        var preparePayload = function(colorOut) {
          if (config.outFormat === 'passTrough' ||
              typeof colorOut === 'number') return colorOut;
          if (!functionDef.hasOwnProperty(config.outFormat)) return withError("output format unknown!");
          let colorArray = (Array.isArray(colorOut)) ? colorOut : [colorOut];
          var output = [];

          for (let currentColor of colorArray) {
            switch (functionDef[config.outFormat].lib) {
              case 'chroma':
                output.push(currentColor[functionDef[config.outFormat].method](
                  functionDef[config.outFormat].result==='string' ? functionDef[config.outFormat].param :
                  functionDef[config.outFormat].result==='array' ? !config.floatOutput : null));
                if (config.array2object) output[output.length-1]=array2object(output[output.length-1],functionDef[config.outFormat].params);
                if (config.outputRelativeValues==='percent' &&
                    config.outFormat!=='lab' && 
                    config.outFormat!=='lch') output[output.length-1]=scalePercent(output[output.length-1],100);
                break;
              case 'chromaPlus':
                output.push(chromaPlus(array2object(currentColor.rgb(),['r','g','b']))[functionDef[config.outFormat].method]);
                break;
              default:
                return withError("library unknown!");
            }
          }
          return (output.length===1) ? output[0] : output;
        }

        //msg.payload=preparePayload(color);
		setValue(msg, config.inLocation, preparePayload(color));
        node.send(msg);
      });
  }
  RED.nodes.registerType("chroma",chromaNode);
}