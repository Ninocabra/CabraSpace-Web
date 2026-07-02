/* =========================================================================
 * lut.js — Módulo para precomputación y aplicación de tablas de búsqueda (LUT)
 *
 * Expone (window|self).LUT: funciona igual en el hilo principal y en un
 * Web Worker (importScripts desde imgworker.js).
 * ========================================================================= */

(function (root) {
  "use strict";

  /**
   * Construye una tabla de búsqueda (LUT) a partir de una función matemática.
   *
   * @param {Function} fn Función matemática f(x) a evaluar, donde x está en [0, 1].
   * @param {number} size Tamaño de la tabla (por defecto 65536).
   * @returns {Float32Array} Tabla con los valores precomputados.
   */
  function buildLUT(fn, size = 65536) {
    const lut = new Float32Array(size);
    const maxIdx = size - 1;
    for (let i = 0; i < size; i++) {
      lut[i] = fn(i / maxIdx);
    }
    return lut;
  }

  /**
   * Aplica una LUT precomputada a un canal de imagen.
   * Devuelve un nuevo canal Float32Array (no modifica el canal original).
   *
   * @param {Float32Array} channel Canal de entrada con valores en el rango [0, 1].
   * @param {Float32Array} lut Tabla de búsqueda precomputada.
   * @returns {Float32Array} Nuevo canal procesado.
   */
  function applyLUT(channel, lut) {
    const len = channel.length;
    const dst = new Float32Array(len);
    const size = lut.length;
    const maxIdx = size - 1;

    for (let i = 0; i < len; i++) {
      const x = channel[i];
      let idx = Math.round(x * maxIdx);
      if (idx < 0) idx = 0;
      else if (idx > maxIdx) idx = maxIdx;
      dst[i] = lut[idx];
    }
    return dst;
  }

  /**
   * Ejecuta el auto-test de identidad para medir la pérdida por discretización de la LUT.
   *
   * @returns {number} Máxima diferencia absoluta medida.
   */
  function runAutoTest() {
    const size = 65536;
    const identityLut = buildLUT(x => x, size);
    
    const testData = new Float32Array(100000);
    for (let i = 0; i < testData.length; i++) {
      testData[i] = Math.random();
    }
    
    const resultData = applyLUT(testData, identityLut);
    
    let maxDiff = 0;
    for (let i = 0; i < testData.length; i++) {
      const diff = Math.abs(resultData[i] - testData[i]);
      if (diff > maxDiff) {
        maxDiff = diff;
      }
    }
    
    console.log(`[LUT Auto-Test] Max absolute diff: ${maxDiff}`);
    return maxDiff;
  }

  let maxDiffMeasured = null;
  // LUT-SELFTEST-BEGIN
  if (typeof window !== "undefined" && window.location && window.location.search && window.location.search.includes("luttest=1")) {
    maxDiffMeasured = runAutoTest();
  }
  // LUT-SELFTEST-END

  root.LUT = {
    buildLUT,
    applyLUT,
    runAutoTest,
    maxDiffMeasured
  };
})(typeof window !== "undefined" ? window : self);
