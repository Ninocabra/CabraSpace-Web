/* =========================================================================
 * background.js — Módulo para extracción de fondo optimizada (RBF/DBE)
 * ========================================================================= */

window.BackgroundExtraction = (function () {
  "use strict";

  /**
   * Resuelve el sistema lineal A * x = B usando eliminación Gaussiana con pivoteo parcial.
   *
   * @param {Array<Float64Array>} A Matriz de coeficientes de tamaño N x N.
   * @param {Float64Array} B Vector del lado derecho de tamaño N.
   * @returns {Float64Array} Vector solución de tamaño N.
   */
  function solveLinearSystem(A, B) {
    const n = B.length;
    const mat = Array.from({ length: n }, (_, i) => Float64Array.from(A[i]));
    const rhs = Float64Array.from(B);

    for (let i = 0; i < n; i++) {
      // Búsqueda de pivote (pivoteo parcial)
      let maxRow = i;
      let maxVal = Math.abs(mat[i][i]);
      for (let r = i + 1; r < n; r++) {
        const val = Math.abs(mat[r][i]);
        if (val > maxVal) {
          maxVal = val;
          maxRow = r;
        }
      }

      // Intercambio de filas
      if (maxRow !== i) {
        const tempRow = mat[i];
        mat[i] = mat[maxRow];
        mat[maxRow] = tempRow;

        const tempRhs = rhs[i];
        rhs[i] = rhs[maxRow];
        rhs[maxRow] = tempRhs;
      }

      let pivot = mat[i][i];
      if (Math.abs(pivot) < 1e-15) {
        pivot = pivot >= 0 ? 1e-12 : -1e-12;
      }

      // Normalizar fila pivote
      for (let j = i; j < n; j++) {
        mat[i][j] /= pivot;
      }
      rhs[i] /= pivot;

      // Eliminar el resto de filas
      for (let k = 0; k < n; k++) {
        if (k !== i) {
          const factor = mat[k][i];
          for (let j = i; j < n; j++) {
            mat[k][j] -= factor * mat[i][j];
          }
          rhs[k] -= factor * rhs[i];
        }
      }
    }
    return rhs;
  }

  // RBF-COLOR-BEGIN
  /**
   * Calcula el mapa de fondo a resolución completa a partir de un modelo RBF evaluado
   * en baja resolución y reescalado bilinealmente, compartiendo las posiciones
   * de los puntos de fondo entre todos los canales para evitar manchas de color.
   *
   * @param {{ch: Float32Array[], w: number, h: number, nc: number}} img Imagen original.
   * @param {{targetW?: number, gridCols?: number, gridRows?: number, smoothness?: number}} [opts] Parámetros.
   * @returns {{ch: Float32Array[], w: number, h: number, nc: number}} Mapa de fondo a resolución completa.
   */
  function computeBackgroundLowRes(img, opts = {}) {
    const targetW = opts.targetW || 250;
    const gridCols = opts.gridCols || 8;
    const gridRows = opts.gridRows || 6;
    const smoothness = opts.smoothness !== undefined ? opts.smoothness : 0.25;

    // Usamos s2 directamente derivado de la suavidad
    const s2 = smoothness;

    const result = {
      w: img.w,
      h: img.h,
      nc: img.nc,
      ch: []
    };

    // 1. Downsample all channels to low resolution (targetW)
    let sw = 0, sh = 0;
    const resampledChannels = [];
    for (let c = 0; c < img.nc; c++) {
      const resampled = window.Resample.downsampleChannel(img.ch[c], img.w, img.h, targetW);
      resampledChannels.push(resampled);
      sw = resampled.w;
      sh = resampled.h;
    }

    const len = sw * sh;
    if (len === 0) {
      for (let c = 0; c < img.nc; c++) {
        result.ch.push(new Float32Array(img.w * img.h));
      }
      return result;
    }

    // Compute luminance L of the small image
    const L = new Float32Array(len);
    if (img.nc >= 3) {
      const R = resampledChannels[0].ch;
      const G = resampledChannels[1].ch;
      const B = resampledChannels[2].ch;
      for (let i = 0; i < len; i++) {
        L[i] = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i];
      }
    } else {
      const src = resampledChannels[0].ch;
      for (let i = 0; i < len; i++) {
        L[i] = src[i];
      }
    }

    // 2. Selección de puntos de fondo (percentil bajo de luminancia por celda de la cuadrícula,
    // compartido por todos los canales)
    const cellW = sw / gridCols;
    const cellH = sh / gridRows;
    const selectedPoints = [];

    for (let r = 0; r < gridRows; r++) {
      for (let col = 0; col < gridCols; col++) {
        const startX = Math.floor(col * cellW);
        const endX = Math.min(sw, Math.floor((col + 1) * cellW));
        const startY = Math.floor(r * cellH);
        const endY = Math.min(sh, Math.floor((r + 1) * cellH));

        const cellPixels = [];
        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const idx = y * sw + x;
            cellPixels.push({ x, y, idx, val: L[idx] });
          }
        }

        if (cellPixels.length === 0) continue;

        // DBE-PERCENTILE-BEGIN
        // Ordenar por luminancia (ascendente)
        cellPixels.sort((a, b) => a.val - b.val);

        // Tomar el ~10% de píxeles más oscuros
        const count = Math.max(1, Math.floor(cellPixels.length * 0.1));

        // Calcular el centroide de esos píxeles
        let sumX = 0;
        let sumY = 0;
        for (let i = 0; i < count; i++) {
          sumX += cellPixels[i].x;
          sumY += cellPixels[i].y;
        }
        const cx = sumX / count;
        const cy = sumY / count;

        // Calcular la media de cada canal para esos píxeles oscuros
        const channelVals = new Float32Array(img.nc);
        for (let c = 0; c < img.nc; c++) {
          let sumVal = 0;
          const chData = resampledChannels[c].ch;
          for (let i = 0; i < count; i++) {
            sumVal += chData[cellPixels[i].idx];
          }
          channelVals[c] = sumVal / count;
        }

        selectedPoints.push({ x: cx, y: cy, vals: channelVals });
        // DBE-PERCENTILE-END
      }
    }

    // 3. Ajuste y evaluación del modelo RBF (Radial Basis Function - Multicuádrica) por canal
    const nPoints = selectedPoints.length;
    if (nPoints === 0) {
      for (let c = 0; c < img.nc; c++) {
        result.ch.push(new Float32Array(img.w * img.h));
      }
      return result;
    }

    // Construimos la matriz A (es idéntica para todos los canales ya que las posiciones son compartidas)
    const mat = Array.from({ length: nPoints }, () => new Float64Array(nPoints));
    for (let i = 0; i < nPoints; i++) {
      const p1 = selectedPoints[i];
      const p1_nx = p1.x / sw;
      const p1_ny = p1.y / sh;

      for (let j = 0; j < nPoints; j++) {
        const p2 = selectedPoints[j];
        const p2_nx = p2.x / sw;
        const p2_ny = p2.y / sh;
        const dx = p1_nx - p2_nx;
        const dy = p1_ny - p2_ny;
        const r2 = dx * dx + dy * dy;
        mat[i][j] = Math.sqrt(r2 + s2);
      }
    }

    for (let c = 0; c < img.nc; c++) {
      const rhs = new Float64Array(nPoints);
      for (let i = 0; i < nPoints; i++) {
        rhs[i] = selectedPoints[i].vals[c];
      }

      const weights = solveLinearSystem(mat, rhs);

      // 4. Evaluar el modelo RBF en toda la rejilla pequeña (sw x sh)
      const smallBG = new Float32Array(sw * sh);
      for (let y = 0; y < sh; y++) {
        const ny = y / sh;
        for (let x = 0; x < sw; x++) {
          const nx = x / sw;
          let background = 0;
          for (let i = 0; i < nPoints; i++) {
            const p = selectedPoints[i];
            const dx = nx - (p.x / sw);
            const dy = ny - (p.y / sh);
            const r2 = dx * dx + dy * dy;
            background += weights[i] * Math.sqrt(r2 + s2);
          }
          smallBG[y * sw + x] = Math.max(0, background);
        }
      }

      // 5. Bilinear upscaling del mapa de fondo a la resolución completa (W x H)
      const fullBG = window.Resample.bilinearUpscale(smallBG, sw, sh, img.w, img.h);
      result.ch.push(fullBG);
    }

    return result;
  }
  // RBF-COLOR-END

  /**
   * Obtiene una estimación rápida de la mediana de un Float32Array mediante muestreo.
   *
   * @param {Float32Array} arr
   * @returns {number}
   */
  function getFastMedian(arr) {
    const sampleSize = Math.min(arr.length, 10000);
    const step = Math.floor(arr.length / sampleSize);
    const samples = new Float32Array(sampleSize);
    for (let i = 0; i < sampleSize; i++) {
      samples[i] = arr[i * step];
    }
    samples.sort();
    return samples[Math.floor(sampleSize / 2)];
  }

  /**
   * Aplica la extracción y corrección (resta o división) de fondo a resolución completa.
   *
   * @param {{ch: Float32Array[], w: number, h: number, nc: number, isColor: boolean}} img
   * @param {{targetW?: number, gridCols?: number, gridRows?: number, smoothness?: number, correction?: string}} opts
   * @returns {{ch: Float32Array[], bgCh: Float32Array[], w: number, h: number, nc: number, isColor: boolean}}
   */
  function applyOptimizedBackgroundExtraction(img, opts = {}) {
    const bg = computeBackgroundLowRes(img, opts);
    const correction = opts.correction || "subtraction";
    const result = {
      w: img.w,
      h: img.h,
      nc: img.nc,
      isColor: img.isColor,
      ch: [],
      bgCh: bg.ch
    };

    for (let c = 0; c < img.nc; c++) {
      const src = img.ch[c];
      const bgCh = bg.ch[c];
      const len = src.length;
      const dst = new Float32Array(len);

      if (correction === "subtraction") {
        const pedestal = getFastMedian(bgCh);
        for (let i = 0; i < len; i++) {
          const val = src[i] - bgCh[i] + pedestal;
          dst[i] = val < 0 ? 0 : (val > 1 ? 1 : val);
        }
      } else {
        // Division
        let sum = 0;
        for (let i = 0; i < len; i++) {
          sum += bgCh[i];
        }
        const mean = sum / len;
        for (let i = 0; i < len; i++) {
          const denom = bgCh[i] < 1e-4 ? 1e-4 : bgCh[i];
          const val = (src[i] / denom) * mean;
          dst[i] = val < 0 ? 0 : (val > 1 ? 1 : val);
        }
      }
      result.ch.push(dst);
    }

    return result;
  }

  /**
   * Ejecuta el auto-test de paridad sobre una imagen sintética de gradiente 2D.
   *
   * @returns {{maxDiff: number, elapsedMs: number}} Resultados del auto-test.
   */
  function runAutoTest() {
    const W = 1000;
    const H = 1000;
    const imgCh = new Float32Array(W * H);

    // Generar gradiente 2D suave: v(nx,ny) = 0.1 + 0.3*nx + 0.2*ny + 0.1*nx*ny
    for (let y = 0; y < H; y++) {
      const ny = y / (H - 1);
      for (let x = 0; x < W; x++) {
        const nx = x / (W - 1);
        imgCh[y * W + x] = 0.1 + 0.3 * nx + 0.2 * ny + 0.1 * nx * ny;
      }
    }

    const testImg = {
      w: W,
      h: H,
      nc: 1,
      ch: [imgCh]
    };

    const startTime = typeof performance !== "undefined" ? performance.now() : Date.now();
    const bgResult = computeBackgroundLowRes(testImg, { targetW: 250, gridCols: 8, gridRows: 6, smoothness: 0.25 });
    const endTime = typeof performance !== "undefined" ? performance.now() : Date.now();
    const elapsedMs = endTime - startTime;

    const fullBG = bgResult.ch[0];
    let maxDiff = 0;

    for (let y = 0; y < H; y++) {
      const ny = y / (H - 1);
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        const nx = x / (W - 1);
        const original = 0.1 + 0.3 * nx + 0.2 * ny + 0.1 * nx * ny;
        const diff = Math.abs(fullBG[idx] - original);
        if (diff > maxDiff) {
          maxDiff = diff;
        }
      }
    }

    console.log(`[BG Auto-Test] Max absolute diff: ${maxDiff} (Acceptance: <= 1e-2)`);
    console.log(`[BG Auto-Test] Time elapsed: ${elapsedMs.toFixed(2)} ms (Acceptance: < 100 ms)`);

    return { maxDiff, elapsedMs };
  }

  let testResults = null;
  // BG-SELFTEST-BEGIN
  if (typeof window !== "undefined" && window.location && window.location.search && window.location.search.includes("bgtest=1")) {
    testResults = runAutoTest();
  }
  // BG-SELFTEST-END

  // BN-JS-BEGIN
  /**
   * Obtiene la mediana de un TypedArray.
   * 
   * @param {Float32Array|Float64Array} arr
   * @returns {number}
   */
  function getMedian(arr) {
    const sorted = new Float32Array(arr).sort();
    const n = sorted.length;
    if (n === 0) return 0;
    if (n % 2 !== 0) {
      return sorted[Math.floor(n / 2)];
    } else {
      return (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0;
    }
  }

  /**
   * Encuentra el fondo de la imagen usando el algoritmo de SetiAstro.
   *
   * @param {{ch: Float32Array[], w: number, h: number, nc: number}} img
   * @param {number} [gridSize=16]
   * @returns {{bgVals: Float64Array, coords: number[]}}
   */
  function findBackgroundSetiAstro(img, gridSize = 16) {
    const nc = img.nc;
    const w = img.w;
    const h = img.h;

    const ch = Math.floor(h / gridSize);
    const cw = Math.floor(w / gridSize);

    let bestScore = Infinity;
    let bestCoords = [0, 0, 0, 0];
    let bestBackgrounds = new Float64Array(nc);

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const y0 = r * ch;
        const y1 = (r + 1) * ch;
        const x0 = c * cw;
        const x1 = (c + 1) * cw;

        if ((y1 - y0) < 5 || (x1 - x0) < 5) {
          continue;
        }

        const numPixels = (y1 - y0) * (x1 - x0);
        const medians = new Float64Array(nc);
        const mads = new Float64Array(nc);

        for (let chan = 0; chan < nc; chan++) {
          const chData = new Float32Array(numPixels);
          let idx = 0;
          for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
              chData[idx++] = img.ch[chan][y * w + x];
            }
          }

          const med = getMedian(chData);
          
          const absDiffs = new Float32Array(numPixels);
          for (let i = 0; i < numPixels; i++) {
            absDiffs[i] = Math.abs(chData[i] - med);
          }
          let mad = getMedian(absDiffs);

          if (mad < 1e-6) {
            let sum = 0;
            for (let i = 0; i < numPixels; i++) {
              sum += chData[i];
            }
            const mean = sum / numPixels;
            let sumSqDiff = 0;
            for (let i = 0; i < numPixels; i++) {
              sumSqDiff += (chData[i] - mean) * (chData[i] - mean);
            }
            mad = Math.sqrt(sumSqDiff / numPixels);
          }

          medians[chan] = med;
          mads[chan] = mad;
        }

        let sumMed = 0;
        let sumMad = 0;
        for (let chan = 0; chan < nc; chan++) {
          sumMed += medians[chan];
          sumMad += mads[chan];
        }
        const lumaMed = sumMed / nc;
        const lumaMad = sumMad / nc;
        const score = lumaMed + 2.5 * lumaMad;

        if (score < bestScore) {
          bestScore = score;
          bestCoords = [x0, y0, cw, ch];
          for (let chan = 0; chan < nc; chan++) {
            bestBackgrounds[chan] = medians[chan];
          }
        }
      }
    }

    return { bgVals: bestBackgrounds, coords: bestCoords };
  }

  /**
   * Aplica la neutralizacion de fondo.
   *
   * @param {{ch: Float32Array[], w: number, h: number, nc: number, isColor: boolean}} img
   * @param {Float64Array} bgVals
   * @param {number} [targetVal=null]
   * @returns {{ch: Float32Array[], w: number, h: number, nc: number, isColor: boolean}}
   */
  function applyBackgroundNeutralization(img, bgVals, targetVal = null) {
    const nc = img.nc;
    const w = img.w;
    const h = img.h;

    let target = targetVal;
    if (target === null || target === undefined) {
      let sum = 0;
      for (let c = 0; c < nc; c++) {
        sum += bgVals[c];
      }
      target = sum / nc;
    }

    const resultCh = [];
    const len = w * h;
    for (let c = 0; c < nc; c++) {
      const src = img.ch[c];
      const bg = bgVals[c];
      const dst = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        const val = src[i] - bg + target;
        dst[i] = val < 0.0 ? 0.0 : (val > 1.0 ? 1.0 : val);
      }
      resultCh.push(dst);
    }

    return {
      ch: resultCh,
      w: w,
      h: h,
      nc: nc,
      isColor: img.isColor
    };
  }
  // BN-JS-END

  return {
    computeBackgroundLowRes,
    applyOptimizedBackgroundExtraction,
    runAutoTest,
    testResults,
    // BN-JS-BEGIN
    findBackgroundSetiAstro,
    applyBackgroundNeutralization
    // BN-JS-END
  };
})();
