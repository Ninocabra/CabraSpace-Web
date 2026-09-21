/**
 * astroweather-nubes.js
 * Pintor del campo de nubes ECMWF para CabraSpace.
 * Compatible con ES5, sin dependencias.
 */
(function (root) {
  'use strict';

  var AWNubes = {
    version: '1.0',

    /**
     * Descodifica la cadena compacta recibida en JSON segun la clave dada.
     * @param {string} cadena Texto de nx*ny caracteres, uno por celda.
     * @param {Object} codificacion { base, paso, max, sin_dato }
     * @returns {Array} Array de nx*ny numeros en 0..100, o null si es sin_dato.
     */
    descodificar: function (cadena, codificacion) {
      if (!cadena || !codificacion) {
        return [];
      }
      var base = codificacion.base;
      var paso = codificacion.paso;
      var max = codificacion.max;
      var sinDato = codificacion.sin_dato;
      var len = cadena.length;
      var salida = new Array(len);

      for (var k = 0; k < len; k++) {
        var ch = cadena.charAt(k);
        if (ch === sinDato) {
          salida[k] = null;
          continue;
        }
        var code = cadena.charCodeAt(k);
        var diff = code - base;
        if (diff < 0 || diff > max) {
          salida[k] = null;
        } else {
          salida[k] = diff * paso;
        }
      }
      return salida;
    },

    /**
     * Dibuja el campo interpolado sobre el contexto 2D de canvas.
     * @param {CanvasRenderingContext2D} ctx Contexto 2D del lienzo.
     * @param {Object} opciones { campo, nx, ny, ancho, alto, umbral, opacidadMax }
     * @returns {Object} { celdas: <int>, huecos: <int>, ms: <numero> }
     */
    pintar: function (ctx, opciones) {
      var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

      if (!ctx || !opciones) {
        return { celdas: 0, huecos: 0, ms: 0 };
      }

      var campo = opciones.campo;
      var nx = opciones.nx;
      var ny = opciones.ny;
      var ancho = opciones.ancho || (ctx.canvas ? ctx.canvas.width : 0);
      var alto = opciones.alto || (ctx.canvas ? ctx.canvas.height : 0);

      if (!campo || !nx || !ny || !ancho || !alto) {
        return { celdas: (nx && ny) ? (nx * ny) : 0, huecos: 0, ms: 0 };
      }

      var umbral = (opciones.umbral !== undefined) ? opciones.umbral : 8;
      var opacidadMax = (opciones.opacidadMax !== undefined) ? opciones.opacidadMax : 0.85;

      var totalCeldas = nx * ny;
      var huecos = 0;
      for (var k = 0; k < totalCeldas; k++) {
        if (campo[k] === null || campo[k] === undefined) {
          huecos++;
        }
      }

      var imgData = ctx.createImageData(ancho, alto);
      var data = imgData.data;

      // Precalculo de mapeo horizontal (X: 0 -> Oeste, ancho-1 -> Este)
      var scaleX = (ancho > 1 && nx > 1) ? (nx - 1) / (ancho - 1) : 0;
      var xi0 = new Array(ancho);
      var xi1 = new Array(ancho);
      var xfx = new Array(ancho);
      var xrx = new Array(ancho);

      for (var px = 0; px < ancho; px++) {
        var gx = px * scaleX;
        var i0 = Math.floor(gx);
        if (i0 >= nx - 1) {
          i0 = nx - 1;
        }
        var i1 = (i0 < nx - 1) ? i0 + 1 : i0;
        var fx = gx - i0;
        xi0[px] = i0;
        xi1[px] = i1;
        xfx[px] = fx;
        xrx[px] = (fx < 0.5) ? i0 : i1;
      }

      var scaleY = (alto > 1 && ny > 1) ? (ny - 1) / (alto - 1) : 0;
      var denom = (100 - umbral > 0) ? (100 - umbral) : 1;

      var idx = 0;
      for (var py = 0; py < alto; py++) {
        // En canvas py = 0 es Norte (j = ny - 1) y py = alto - 1 es Sur (j = 0)
        var gy = (alto - 1 - py) * scaleY;
        var j0 = Math.floor(gy);
        if (j0 >= ny - 1) {
          j0 = ny - 1;
        }
        var j1 = (j0 < ny - 1) ? j0 + 1 : j0;
        var fy = gy - j0;
        var ry = (fy < 0.5) ? j0 : j1;

        var row0 = j0 * nx;
        var row1 = j1 * nx;
        var rowR = ry * nx;

        var wy0 = 1.0 - fy;
        var wy1 = fy;

        for (var px2 = 0; px2 < ancho; px2++) {
          var nearestVal = campo[rowR + xrx[px2]];

          if (nearestVal === null || nearestVal === undefined) {
            // Trama diagonal tenue en oro de la pagina rgba(207, 171, 74, 0.18)
            // Franjas diagonales a 45 grados (ancho 2px, periodo 8px)
            if ((px2 + py) % 8 < 2) {
              data[idx] = 207;
              data[idx + 1] = 171;
              data[idx + 2] = 74;
              data[idx + 3] = 46; // round(0.18 * 255)
            }
          } else {
            var v00 = campo[row0 + xi0[px2]];
            var v10 = campo[row0 + xi1[px2]];
            var v01 = campo[row1 + xi0[px2]];
            var v11 = campo[row1 + xi1[px2]];

            var fxVal = xfx[px2];
            var val;

            if (v00 !== null && v10 !== null && v01 !== null && v11 !== null &&
                v00 !== undefined && v10 !== undefined && v01 !== undefined && v11 !== undefined) {
              val = (v00 * (1.0 - fxVal) + v10 * fxVal) * wy0 +
                    (v01 * (1.0 - fxVal) + v11 * fxVal) * wy1;
            } else {
              var sum = 0;
              var wSum = 0;
              var w;
              if (v00 !== null && v00 !== undefined) { w = (1.0 - fxVal) * wy0; sum += v00 * w; wSum += w; }
              if (v10 !== null && v10 !== undefined) { w = fxVal * wy0; sum += v10 * w; wSum += w; }
              if (v01 !== null && v01 !== undefined) { w = (1.0 - fxVal) * wy1; sum += v01 * w; wSum += w; }
              if (v11 !== null && v11 !== undefined) { w = fxVal * wy1; sum += v11 * w; wSum += w; }
              val = (wSum > 0) ? (sum / wSum) : nearestVal;
            }

            if (val >= umbral) {
              var factor = (val - umbral) / denom;
              if (factor > 1.0) {
                factor = 1.0;
              }
              var a = factor * opacidadMax;
              var a255 = (a * 255 + 0.5) | 0;
              if (a255 > 255) {
                a255 = 255;
              }
              if (a255 > 0) {
                // Blanco calido: rgba(232, 228, 216, a)
                data[idx] = 232;
                data[idx + 1] = 228;
                data[idx + 2] = 216;
                data[idx + 3] = a255;
              }
            }
          }

          idx += 4;
        }
      }

      // Dibujamos sobre el lienzo mediante canvas auxiliar para respetar composicion
      if (typeof document !== 'undefined' && document.createElement) {
        var offscreen = document.createElement('canvas');
        offscreen.width = ancho;
        offscreen.height = alto;
        var offCtx = offscreen.getContext('2d');
        offCtx.putImageData(imgData, 0, 0);
        ctx.drawImage(offscreen, 0, 0);
      } else if (ctx.putImageData) {
        ctx.putImageData(imgData, 0, 0);
      }

      var t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      var elapsed = Math.round((t1 - t0) * 100) / 100;

      return {
        celdas: totalCeldas,
        huecos: huecos,
        ms: elapsed
      };
    }
  };

  if (typeof root !== 'undefined') {
    root.AWNubes = AWNubes;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AWNubes;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
