/* =========================================================================
 * graxpert.js — Módulo para procesamiento y normalización de GraXpert
 * ========================================================================= */

window.GraXpert = (function () {
  "use strict";

  let MODEL_URL = "https://github.com/Ninocabra/CabraSpace-Web/releases/download/models-v1/graxpert_bg.onnx";
  let DENOISE_MODEL_URL = "https://github.com/Ninocabra/CabraSpace-Web/releases/download/models-v1/graxpert_denoise.onnx";

  // Usar modelo local al probar en desarrollo local
  if (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
    MODEL_URL = "scratch/graxpert_bg.onnx";
    DENOISE_MODEL_URL = "scratch/graxpert_denoise.onnx";
  }

  let session = null;
  let denoiseSession = null;

  async function initSession(onDownloadProgress) {
    if (session) return session;
    const modelData = await window.OnnxEngine.fetchModelWithCache(MODEL_URL, onDownloadProgress);
    session = await window.OnnxEngine.createSession(modelData);
    return session;
  }

  async function initDenoiseSession(onDownloadProgress) {
    if (denoiseSession) return denoiseSession;
    const modelData = await window.OnnxEngine.fetchModelWithCache(DENOISE_MODEL_URL, onDownloadProgress);
    denoiseSession = await window.OnnxEngine.createSession(modelData);
    return denoiseSession;
  }

  /**
   * Calcula la mediana y la desviación absoluta mediana (MAD) de un canal.
   * Utiliza un muestreo rápido para optimizar el rendimiento.
   *
   * @param {Float32Array} channel Canal de la imagen original.
   * @returns {{median: number, mad: number}} Mediana y MAD.
   */
  function medianMAD(channel) {
    const n = channel.length;
    const maxSamples = 200000;
    const sampleSize = Math.min(n, maxSamples);
    const step = Math.max(1, Math.floor(n / sampleSize));
    const samples = new Float32Array(sampleSize);
    for (let i = 0; i < sampleSize; i++) {
      samples[i] = channel[i * step];
    }
    samples.sort();
    const median = samples[Math.floor(sampleSize / 2)];

    const diffs = new Float32Array(sampleSize);
    for (let i = 0; i < sampleSize; i++) {
      diffs[i] = Math.abs(samples[i] - median);
    }
    diffs.sort();
    const mad = Math.max(diffs[Math.floor(sampleSize / 2)], 1e-6);

    return { median, mad };
  }

  /**
   * Normaliza un canal utilizando la mediana y el MAD de GraXpert.
   *
   * @param {Float32Array} channel Canal a normalizar.
   * @param {number} median Mediana del canal.
   * @param {number} mad MAD del canal.
   * @returns {Float32Array} Canal normalizado en el rango [-1, 1].
   */
  function normalizeBG(channel, median, mad, L = 1.0) {
    const n = channel.length;
    const out = new Float32Array(n);
    const scale = 0.04 / mad;
    for (let i = 0; i < n; i++) {
      const v = (channel[i] - median) * scale;
      out[i] = v < -L ? -L : (v > L ? L : v);
    }
    return out;
  }

  /**
   * Desnormaliza un canal normalizado utilizando la mediana y el MAD de GraXpert.
   *
   * @param {Float32Array} norm Canal normalizado.
   * @param {number} median Mediana original del canal.
   * @param {number} mad MAD original del canal.
   * @returns {Float32Array} Canal desnormalizado.
   */
  function denormalizeBG(norm, median, mad) {
    const n = norm.length;
    const out = new Float32Array(n);
    const scale = mad / 0.04;
    for (let i = 0; i < n; i++) {
      out[i] = norm[i] * scale + median;
    }
    return out;
  }

  /**
   * Pandea un canal de 240x240 a 256x256 usando reflect padding de 8 píxeles.
   *
   * @param {Float32Array} ch240 Canal de 240x240 píxeles.
   * @returns {Float32Array} Canal de 256x256 píxeles con padding.
   */
  function reflectPad8(ch240) {
    const w = 240;
    const h = 240;
    const pad = 8;
    const outW = 256;
    const outH = 256;
    const out = new Float32Array(outW * outH);

    for (let y = 0; y < outH; y++) {
      let sy = y - pad;
      if (sy < 0) {
        sy = -sy;
      } else if (sy >= h) {
        sy = 2 * (h - 1) - sy;
      }

      for (let x = 0; x < outW; x++) {
        let sx = x - pad;
        if (sx < 0) {
          sx = -sx;
        } else if (sx >= w) {
          sx = 2 * (w - 1) - sx;
        }

        out[y * outW + x] = ch240[sy * w + sx];
      }
    }
    return out;
  }

  /**
   * Recorta la región central de 240x240 de un canal de 256x256 (removiendo el pad de 8 px).
   *
   * @param {Float32Array} bg256 Canal de 256x256 píxeles.
   * @returns {Float32Array} Canal recortado de 240x240 píxeles.
   */
  function crop8(bg256) {
    const w = 240;
    const h = 240;
    const pad = 8;
    const inW = 256;
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const inY = y + pad;
      const inRowOffset = inY * inW;
      const outRowOffset = y * w;
      for (let x = 0; x < w; x++) {
        out[outRowOffset + x] = bg256[inRowOffset + x + pad];
      }
    }
    return out;
  }

  /**
   * Prepara la entrada para el modelo GraXpert BG: resize a 240x240 y reflect-pad 8 px.
   *
   * @param {Float32Array} channel Canal original.
   * @param {number} w Ancho original.
   * @param {number} h Alto original.
   * @returns {Float32Array} Canal de entrada del modelo (256x256).
   */
  function prepareInput(channel, w, h) {
    const resized = window.Resample.resizeBilinear(channel, w, h, 240, 240);
    return reflectPad8(resized);
  }

  /**
   * Restaura el fondo a partir de la salida del modelo: recorta pad y resize al tamaño original.
   *
   * @param {Float32Array} bg256 Mapa de fondo del modelo (256x256).
   * @param {number} origW Ancho original de la imagen.
   * @param {number} origH Alto original de la imagen.
   * @returns {Float32Array} Mapa de fondo a resolución original.
   */
  function restoreBackground(bg256, origW, origH) {
    const cropped = crop8(bg256);
    return window.Resample.resizeBilinear(cropped, 240, 240, origW, origH);
  }

  /**
   * Aplica un filtro de desenfoque gaussiano 1D separable a un canal con bordes por reflexión.
   *
   * @param {Float32Array} ch Canal original.
   * @param {number} w Ancho del canal.
   * @param {number} h Alto del canal.
   * @param {number} sigma Desviación estándar del filtro Gaussiano.
   * @returns {Float32Array} Canal difuminado.
   */
  function gaussianBlur(ch, w, h, sigma) {
    if (sigma <= 0) {
      return new Float32Array(ch);
    }

    const radius = Math.ceil(sigma * 3);
    const kernelSize = radius * 2 + 1;
    const kernel = new Float32Array(kernelSize);
    
    let sum = 0;
    const twoSigmaSq = 2 * sigma * sigma;
    for (let i = -radius; i <= radius; i++) {
      const val = Math.exp(-(i * i) / twoSigmaSq);
      kernel[i + radius] = val;
      sum += val;
    }
    for (let i = 0; i < kernelSize; i++) {
      kernel[i] /= sum;
    }

    // Horizontal pass
    const temp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      for (let x = 0; x < w; x++) {
        let val = 0;
        for (let k = -radius; k <= radius; k++) {
          let sx = x + k;
          if (sx < 0) {
            sx = -sx;
          } else if (sx >= w) {
            sx = 2 * (w - 1) - sx;
          }
          val += ch[rowOffset + sx] * kernel[k + radius];
        }
        temp[rowOffset + x] = val;
      }
    }

    // Vertical pass
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      for (let x = 0; x < w; x++) {
        let val = 0;
        for (let k = -radius; k <= radius; k++) {
          let sy = y + k;
          if (sy < 0) {
            sy = -sy;
          } else if (sy >= h) {
            sy = 2 * (h - 1) - sy;
          }
          val += temp[sy * w + x] * kernel[k + radius];
        }
        out[rowOffset + x] = val;
      }
    }

    return out;
  }

  /**
   * Calcula el mapa de fondo de la imagen utilizando el modelo GraXpert BG ONNX.
   *
   * @param {{ch: Float32Array[], w: number, h: number, nc: number, isColor: boolean}} img Imagen original.
   * @param {{smoothing?: number}} opts Parámetros adicionales (p. ej. suavizado).
   * @param {Function} onDownloadProgress Progreso de descarga del modelo.
   * @returns {Promise<{ch: Float32Array[], w: number, h: number, nc: number, isColor: boolean}>} Fondo calculado.
   */
  async function computeBackgroundGraXpert(img, opts = {}, onDownloadProgress) {
    const origW = img.w;
    const origH = img.h;
    const nc = img.nc;
    const isColor = img.isColor || nc === 3;

    // 1. Obtener sesión de ONNX
    const sess = await initSession(onDownloadProgress);

    // 2. Preparar canales
    const chData = [];
    const stats = [];

    for (let c = 0; c < 3; c++) {
      const srcChIndex = isColor ? c : 0;
      const srcCh = img.ch[srcChIndex];

      const stat = medianMAD(srcCh);
      stats.push(stat);

      const norm = normalizeBG(srcCh, stat.median, stat.mad);
      const prep = prepareInput(norm, origW, origH);
      chData.push(prep);
    }

    // 3. Empaquetar en tensor NHWC [1, 256, 256, 3]
    const inputTensorData = new Float32Array(256 * 256 * 3);
    const r256 = chData[0];
    const g256 = chData[1];
    const b256 = chData[2];
    for (let i = 0; i < 256 * 256; i++) {
      inputTensorData[i * 3 + 0] = r256[i];
      inputTensorData[i * 3 + 1] = g256[i];
      inputTensorData[i * 3 + 2] = b256[i];
    }

    // 4. Inferencia
    const inputTensor = new ort.Tensor("float32", inputTensorData, [1, 256, 256, 3]);
    const feeds = { gen_input_image: inputTensor };
    const results = await sess.run(feeds);
    const outputTensor = results.sequential_15;
    const outputData = outputTensor.data;

    // 5. Desempaquetar
    const outCh256 = [
      new Float32Array(256 * 256),
      new Float32Array(256 * 256),
      new Float32Array(256 * 256)
    ];
    for (let i = 0; i < 256 * 256; i++) {
      outCh256[0][i] = outputData[i * 3 + 0];
      outCh256[1][i] = outputData[i * 3 + 1];
      outCh256[2][i] = outputData[i * 3 + 2];
    }

    // 6. Postprocesamiento por canal
    const resultCh = [];
    const smoothing = opts.smoothing !== undefined ? parseFloat(opts.smoothing) : 0.25;

    for (let c = 0; c < nc; c++) {
      const modelChIndex = c;
      const stat = stats[modelChIndex];
      let ch = outCh256[modelChIndex];

      // a) Desnormalizar
      ch = denormalizeBG(ch, stat.median, stat.mad);

      // b) Gaussian Blur opcional
      if (smoothing !== 0) {
        ch = gaussianBlur(ch, 256, 256, smoothing * 20);
      }

      // c) Recortar padding -> 240x240
      ch = crop8(ch);

      // d) Gaussian Blur fijo de 3.0
      ch = gaussianBlur(ch, 240, 240, 3.0);

      // e) Redimensionar a resolución original
      const finalBG = window.Resample.resizeBilinear(ch, 240, 240, origW, origH);
      resultCh.push(finalBG);
    }

    return {
      ch: resultCh,
      w: origW,
      h: origH,
      nc: nc,
      isColor: isColor
    };
  }

  /**
   * Ejecuta la inferencia completa de reducción de ruido GraXpert Denoise ONNX en mosaico (tiled).
   *
   * @param {{ch: Float32Array[], w: number, h: number, nc: number, isColor: boolean}} img Imagen original.
   * @param {Object} opts Opciones adicionales de procesamiento.
   * @param {Function} onTileProgress Callback de progreso de tiles (tileIdx, totalTiles).
   * @returns {Promise<{ch: Float32Array[], w: number, h: number, nc: number, isColor: boolean}>} Imagen procesada.
   */
  async function computeDenoiseGraXpert(img, opts = {}, onTileProgress) {
    const origW = img.w;
    const origH = img.h;
    const nc = img.nc;
    const isColor = img.isColor || nc === 3;

    // 1. Inicializar la sesión ONNX para Denoise
    const sess = await initDenoiseSession();

    // 2. Preparar los 3 canales padded normalizados globales
    const paddedChannels = [];
    const stats = [];

    for (let c = 0; c < 3; c++) {
      const srcChIndex = isColor ? c : 0;
      const srcCh = img.ch[srcChIndex];

      const stat = medianMAD(srcCh);
      stats.push(stat);

      const norm = normalizeBG(srcCh, stat.median, stat.mad, 10.0);
      const padded = padReflect(norm, origW, origH, 64);
      paddedChannels.push(padded);
    }

    const paddedW = origW + 128; // w + 2*pad
    const paddedR = paddedChannels[0];
    const paddedG = paddedChannels[1];
    const paddedB = paddedChannels[2];

    // 3. Crear acumuladores para los 3 canales de salida a resolución completa
    const accumR = new Float32Array(origW * origH);
    const accumG = new Float32Array(origW * origH);
    const accumB = new Float32Array(origW * origH);

    // 4. Obtener posiciones de los tiles
    const positions = getTilePositions(origW, origH, 256, 128, 64);
    const totalTiles = positions.length;

    // DN-BATCH-BEGIN
    // 5. Inferencia en batches de K tiles (default K = 4)
    const K = opts.batchSize ?? 4;
    const tileOutR = new Float32Array(256 * 256);
    const tileOutG = new Float32Array(256 * 256);
    const tileOutB = new Float32Array(256 * 256);

    for (let b = 0; b < totalTiles; b += K) {
      const actualK = Math.min(K, totalTiles - b);
      const inputTensorData = new Float32Array(actualK * 256 * 256 * 3);

      for (let i = 0; i < actualK; i++) {
        const pos = positions[b + i];

        // a) Extraer tiles
        const rTile = extractTile(paddedR, paddedW, pos.tx, pos.ty, 256);
        const gTile = extractTile(paddedG, paddedW, pos.tx, pos.ty, 256);
        const bTile = extractTile(paddedB, paddedW, pos.tx, pos.ty, 256);

        // b) Empaquetar en formato NHWC [actualK, 256, 256, 3]
        const offset = i * 256 * 256 * 3;
        for (let j = 0; j < 256 * 256; j++) {
          inputTensorData[offset + j * 3 + 0] = rTile[j];
          inputTensorData[offset + j * 3 + 1] = gTile[j];
          inputTensorData[offset + j * 3 + 2] = bTile[j];
        }
      }

      // c) Ejecutar inferencia ONNX
      const inputTensor = new ort.Tensor("float32", inputTensorData, [actualK, 256, 256, 3]);
      const feeds = { gen_input_image: inputTensor };
      const results = await sess.run(feeds);
      const outputTensor = results.output;
      const outputData = outputTensor.data;

      // d) Desempaquetar
      for (let i = 0; i < actualK; i++) {
        const pos = positions[b + i];
        const offset = i * 256 * 256 * 3;
        for (let j = 0; j < 256 * 256; j++) {
          tileOutR[j] = outputData[offset + j * 3 + 0];
          tileOutG[j] = outputData[offset + j * 3 + 1];
          tileOutB[j] = outputData[offset + j * 3 + 2];
        }

        // e) Colocar el bloque central
        placeCentral(accumR, origW, origH, tileOutR, pos.tx, pos.ty, 64, 128);
        placeCentral(accumG, origW, origH, tileOutG, pos.tx, pos.ty, 64, 128);
        placeCentral(accumB, origW, origH, tileOutB, pos.tx, pos.ty, 64, 128);

        if (onTileProgress) {
          onTileProgress(b + i + 1, totalTiles);
        }
      }
    }
    // DN-BATCH-END

    // 6. Post-procesamiento: desnormalización + star-protection + mezcla por strength
    const strength = opts.strength !== undefined ? parseFloat(opts.strength) : 1.0;

    const finalR = applyStarProtection(
      denormalizeBG(accumR, stats[0].median, stats[0].mad),
      img.ch[isColor ? 0 : 0],
      stats[0].median,
      stats[0].mad
    );
    const origR = img.ch[isColor ? 0 : 0];
    for (let i = 0; i < finalR.length; i++) {
      finalR[i] = origR[i] * (1.0 - strength) + finalR[i] * strength;
    }

    const finalG = applyStarProtection(
      denormalizeBG(accumG, stats[1].median, stats[1].mad),
      img.ch[isColor ? 1 : 0],
      stats[1].median,
      stats[1].mad
    );
    const origG = img.ch[isColor ? 1 : 0];
    for (let i = 0; i < finalG.length; i++) {
      finalG[i] = origG[i] * (1.0 - strength) + finalG[i] * strength;
    }

    const finalB = applyStarProtection(
      denormalizeBG(accumB, stats[2].median, stats[2].mad),
      img.ch[isColor ? 2 : 0],
      stats[2].median,
      stats[2].mad
    );
    const origB = img.ch[isColor ? 2 : 0];
    for (let i = 0; i < finalB.length; i++) {
      finalB[i] = origB[i] * (1.0 - strength) + finalB[i] * strength;
    }

    // 7. Retornar formato correspondiente
    if (!isColor) {
      // Imagen mono: media aritmética de los 3 canales de salida
      const meanCh = new Float32Array(origW * origH);
      for (let i = 0; i < meanCh.length; i++) {
        meanCh[i] = (finalR[i] + finalG[i] + finalB[i]) / 3.0;
      }
      return {
        ch: [meanCh],
        w: origW,
        h: origH,
        nc: 1,
        isColor: false
      };
    } else {
      // Imagen color
      return {
        ch: [finalR, finalG, finalB],
        w: origW,
        h: origH,
        nc: 3,
        isColor: true
      };
    }
  }

  /**
   * Aplica la extracción y corrección de fondo de GraXpert (resta o división).
   *
   * @param {{ch: Float32Array[], w: number, h: number, nc: number, isColor: boolean}} img Imagen de entrada.
   * @param {{correction?: string, smoothing?: number}} opts Opciones de corrección y suavizado.
   * @param {Function} onDownloadProgress Progreso de descarga del modelo.
   * @returns {Promise<{ch: Float32Array[], bgCh: Float32Array[], w: number, h: number, nc: number, isColor: boolean}>} Imagen corregida y canal de fondo.
   */
  async function applyGraXpertBG(img, opts = {}, onDownloadProgress) {
    const bg = await computeBackgroundGraXpert(img, opts, onDownloadProgress);
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
      const imgCh = img.ch[c];
      const bgCh = bg.ch[c];
      const len = imgCh.length;

      if (correction === "division") {
        let sum = 0;
        for (let i = 0; i < len; i++) {
          sum += bgCh[i];
        }
        const mean = sum / len;

        const out = new Float32Array(len);
        for (let i = 0; i < len; i++) {
          const bgVal = bgCh[i] < 1e-4 ? 1e-4 : bgCh[i];
          const val = (imgCh[i] / bgVal) * mean;
          out[i] = val < 0.0 ? 0.0 : (val > 1.0 ? 1.0 : val);
        }
        result.ch.push(out);
      } else {
        // subtraction: out = clamp(img - bg + pedestal, 0, 1)
        const pedestal = medianMAD(bgCh).median;

        const out = new Float32Array(len);
        for (let i = 0; i < len; i++) {
          const val = imgCh[i] - bgCh[i] + pedestal;
          out[i] = val < 0.0 ? 0.0 : (val > 1.0 ? 1.0 : val);
        }
        result.ch.push(out);
      }
    }

    return result;
  }

  /**
   * Ejecuta el auto-test de geometría para verificar el round-trip de resize y padding.
   *
   * @returns {{success: boolean, maxDiff: number}} Resultados del test.
   */
  function runGeomTest() {
    const W = 800;
    const H = 600;
    const v = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const ny = y / (H - 1);
      for (let x = 0; x < W; x++) {
        const nx = x / (W - 1);
        v[y * W + x] = 0.1 + 0.3 * nx + 0.2 * ny;
      }
    }

    const prep = prepareInput(v, W, H);
    const restored = restoreBackground(prep, W, H);

    let maxDiff = 0;
    for (let i = 0; i < W * H; i++) {
      const diff = Math.abs(restored[i] - v[i]);
      if (diff > maxDiff) {
        maxDiff = diff;
      }
    }

    const success = (maxDiff <= 1e-2);
    console.log(`[GraXpert Geom-Test] Max Diff: ${maxDiff.toExponential(4)} (Acceptance: <= 1e-2)`);
    console.log(`[GraXpert Geom-Test] Result: ${success ? "SUCCESS" : "FAILED"}`);

    return {
      success,
      maxDiff
    };
  }

  /**
   * Ejecuta el auto-test de normalización/desnormalización y comprueba el error de round-trip.
   *
   * @param {number} refMedian Mediana de referencia para el test.
   * @param {number} refMad MAD de referencia para el test.
   * @returns {{success: boolean, maxDiff: number, pctSaturated: number}} Resultados del test.
   */
  function runAutoTest(refMedian = 0.3, refMad = 0.05) {
    const size = 100000;
    const testChannel = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      testChannel[i] = Math.random();
    }

    const norm = normalizeBG(testChannel, refMedian, refMad);
    const denorm = denormalizeBG(norm, refMedian, refMad);

    let maxDiff = 0;
    let saturatedCount = 0;
    let nonSaturatedCount = 0;

    for (let i = 0; i < size; i++) {
      if (norm[i] > -1 && norm[i] < 1) {
        const diff = Math.abs(denorm[i] - testChannel[i]);
        if (diff > maxDiff) {
          maxDiff = diff;
        }
        nonSaturatedCount++;
      } else {
        saturatedCount++;
      }
    }

    const pctSaturated = (saturatedCount / size) * 100;
    const success = (maxDiff <= 1e-5);

    console.log(`[GraXpert Auto-Test] Max Diff (Non-saturated): ${maxDiff.toExponential(4)} (Acceptance: <= 1e-5)`);
    console.log(`[GraXpert Auto-Test] Saturated: ${pctSaturated.toFixed(2)}% (${saturatedCount} / ${size})`);
    console.log(`[GraXpert Auto-Test] Result: ${success ? "SUCCESS" : "FAILED"}`);

    return {
      success,
      maxDiff,
      pctSaturated
    };
  }

  /**
   * Ejecuta el auto-test de normalización/desnormalización para Denoise (L=10).
   *
   * @param {number} refMedian Mediana de referencia para el test.
   * @param {number} refMad MAD de referencia para el test.
   * @param {number} L Límite de normalización.
   * @returns {{success: boolean, maxDiff: number, pctSaturated: number}} Resultados del test.
   */
  function runDenoiseNormTest(refMedian = 0.3, refMad = 0.05, L = 10) {
    const size = 100000;
    const testChannel = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      testChannel[i] = Math.random();
    }

    const norm = normalizeBG(testChannel, refMedian, refMad, L);
    const denorm = denormalizeBG(norm, refMedian, refMad);

    let maxDiff = 0;
    let saturatedCount = 0;
    let nonSaturatedCount = 0;

    for (let i = 0; i < size; i++) {
      if (norm[i] > -L && norm[i] < L) {
        const diff = Math.abs(denorm[i] - testChannel[i]);
        if (diff > maxDiff) {
          maxDiff = diff;
        }
        nonSaturatedCount++;
      } else {
        saturatedCount++;
      }
    }

    const pctSaturated = (saturatedCount / size) * 100;
    const success = (maxDiff <= 1e-5);

    console.log(`[GraXpert DN-Test] Max Diff (Non-saturated): ${maxDiff.toExponential(4)} (Acceptance: <= 1e-5)`);
    console.log(`[GraXpert DN-Test] Saturated (L=${L}): ${pctSaturated.toFixed(2)}% (${saturatedCount} / ${size})`);
    console.log(`[GraXpert DN-Test] Result: ${success ? "SUCCESS" : "FAILED"}`);

    return {
      success,
      maxDiff,
      pctSaturated
    };
  }

  /**
   * Obtiene la coordenada original reflejada (reflect-101) para un índice arbitrario.
   *
   * @param {number} val Coordenada original con desbordamiento.
   * @param {number} max Límite de la dimensión.
   * @returns {number} Coordenada reflejada.
   */
  function getReflectCoord(val, max) {
    if (max <= 1) return 0;
    while (val < 0 || val >= max) {
      if (val < 0) {
        val = -val;
      } else {
        val = 2 * (max - 1) - val;
      }
    }
    return val;
  }

  /**
   * Genera una versión con padding reflect (reflect-101) de un canal de imagen.
   *
   * @param {Float32Array} ch Canal original.
   * @param {number} w Ancho original.
   * @param {number} h Alto original.
   * @param {number} pad Cantidad de padding por lado.
   * @returns {Float32Array} Canal padded de tamaño (w + 2*pad) x (h + 2*pad).
   */
  function padReflect(ch, w, h, pad) {
    const outW = w + 2 * pad;
    const outH = h + 2 * pad;
    const out = new Float32Array(outW * outH);
    for (let y = 0; y < outH; y++) {
      const sy = getReflectCoord(y - pad, h);
      const srcRowOffset = sy * w;
      const outRowOffset = y * outW;
      for (let x = 0; x < outW; x++) {
        const sx = getReflectCoord(x - pad, w);
        out[outRowOffset + x] = ch[srcRowOffset + sx];
      }
    }
    return out;
  }

  /**
   * Genera las coordenadas de inicio {tx, ty} de cada tile en la imagen padded.
   * Garantiza que el último tile cubra hasta el borde inferior derecho (paddedW - window).
   *
   * @param {number} w Ancho original de la imagen.
   * @param {number} h Alto original de la imagen.
   * @param {number} window Tamaño del tile (def. 256).
   * @param {number} stride Desplazamiento entre tiles (def. 128).
   * @param {number} pad Margen de padding reflect (def. 64).
   * @returns {{tx: number, ty: number}[]} Lista de posiciones de inicio de tiles.
   */
  function getTilePositions(w, h, window = 256, stride = 128, pad = 64) {
    const paddedW = w + 2 * pad;
    const paddedH = h + 2 * pad;

    const xs = [];
    let x = 0;
    while (x <= paddedW - window) {
      xs.push(x);
      x += stride;
    }
    if (xs[xs.length - 1] !== paddedW - window) {
      xs.push(paddedW - window);
    }

    const ys = [];
    let y = 0;
    while (y <= paddedH - window) {
      ys.push(y);
      y += stride;
    }
    if (ys[ys.length - 1] !== paddedH - window) {
      ys.push(paddedH - window);
    }

    const positions = [];
    for (let i = 0; i < ys.length; i++) {
      for (let j = 0; j < xs.length; j++) {
        positions.push({ tx: xs[j], ty: ys[i] });
      }
    }
    return positions;
  }

  /**
   * Extrae un tile del tamaño especificado a partir de la imagen padded.
   *
   * @param {Float32Array} padded Imagen con padding reflect.
   * @param {number} paddedW Ancho de la imagen padded.
   * @param {number} tx Coordenada X de inicio del tile en padded.
   * @param {number} ty Coordenada Y de inicio del tile en padded.
   * @param {number} window Tamaño de lado del tile (def. 256).
   * @returns {Float32Array} Sub-bloque extraído de window x window.
   */
  function extractTile(padded, paddedW, tx, ty, window = 256) {
    const out = new Float32Array(window * window);
    for (let y = 0; y < window; y++) {
      const inY = ty + y;
      const inRowOffset = inY * paddedW;
      const outRowOffset = y * window;
      for (let x = 0; x < window; x++) {
        out[outRowOffset + x] = padded[inRowOffset + tx + x];
      }
    }
    return out;
  }

  /**
   * Escribe el bloque central del tile procesado en la imagen de salida.
   * Aplica clamping a los límites originales de la imagen.
   *
   * @param {Float32Array} output Canal original de salida a rellenar.
   * @param {number} w Ancho original de la imagen.
   * @param {number} h Alto original de la imagen.
   * @param {Float32Array} tileOut256 Salida del modelo para un tile (256x256).
   * @param {number} tx Posición X de inicio en la padded.
   * @param {number} ty Posición Y de inicio en la padded.
   * @param {number} pad Margen de padding reflect (def. 64).
   * @param {number} central Ancho/alto del bloque central a extraer (def. 128).
   */
  function placeCentral(output, w, h, tileOut256, tx, ty, pad = 64, central = 128) {
    for (let y = 0; y < central; y++) {
      const origY = ty + y;
      if (origY < 0 || origY >= h) continue;

      const outRowOffset = origY * w;
      const tileY = pad + y;
      const tileRowOffset = tileY * 256;

      for (let x = 0; x < central; x++) {
        const origX = tx + x;
        if (origX < 0 || origX >= w) continue;

        const tileX = pad + x;
        output[outRowOffset + origX] = tileOut256[tileRowOffset + tileX];
      }
    }
  }

  /**
   * Ejecuta el auto-test de tiling para verificar el round-trip de división y reensamblado.
   *
   * @returns {{success: boolean, maxDiff: number, numTiles: number, coverageOk: boolean}} Resultados del test.
   */
  function runTileTest() {
    const W = 500;
    const H = 300;
    const size = W * H;
    const img = new Float32Array(size);
    for (let y = 0; y < H; y++) {
      const ny = y / (H - 1);
      for (let x = 0; x < W; x++) {
        const nx = x / (W - 1);
        img[y * W + x] = 0.1 + 0.3 * nx + 0.2 * ny;
      }
    }

    const pad = 64;
    const windowSize = 256;
    const stride = 128;
    const central = 128;

    // 1. Padding reflect
    const padded = padReflect(img, W, H, pad);
    const paddedW = W + 2 * pad;
    const paddedH = H + 2 * pad;

    // 2. Obtener posiciones de los tiles
    const positions = getTilePositions(W, H, windowSize, stride, pad);

    // 3. Round-trip identidad
    const output = new Float32Array(size);
    const writtenMask = new Uint8Array(size);

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      const tile = extractTile(padded, paddedW, pos.tx, pos.ty, windowSize);
      
      // Simular modelo identidad: tileOut = tile
      placeCentral(output, W, H, tile, pos.tx, pos.ty, pad, central);
      
      // Actualizar máscara de cobertura
      for (let y = 0; y < central; y++) {
        const origY = pos.ty + y;
        if (origY >= 0 && origY < H) {
          const outRowOffset = origY * W;
          for (let x = 0; x < central; x++) {
            const origX = pos.tx + x;
            if (origX >= 0 && origX < W) {
              writtenMask[outRowOffset + origX] = 1;
            }
          }
        }
      }
    }

    // 4. Verificar diferencia máxima y cobertura
    let maxDiff = 0;
    let missingPixels = 0;
    for (let i = 0; i < size; i++) {
      const diff = Math.abs(output[i] - img[i]);
      if (diff > maxDiff) {
        maxDiff = diff;
      }
      if (writtenMask[i] === 0) {
        missingPixels++;
      }
    }

    const coverageOk = (missingPixels === 0);
    const success = (maxDiff <= 1e-5) && coverageOk;

    console.log(`[GraXpert Tile-Test] Max Diff: ${maxDiff.toExponential(4)} (Acceptance: <= 1e-5)`);
    console.log(`[GraXpert Tile-Test] Num Tiles: ${positions.length}`);
    console.log(`[GraXpert Tile-Test] Coverage OK: ${coverageOk ? "YES" : "NO"} (Missing: ${missingPixels})`);
    console.log(`[GraXpert Tile-Test] Result: ${success ? "SUCCESS" : "FAILED"}`);

    return {
      success,
      maxDiff,
      numTiles: positions.length,
      coverageOk
    };
  }

  /**
   * Aplica star-protection comparando la imagen original con la denoised.
   * Si original >= threshold (donde threshold = median + 250 * mad), se preserva original.
   *
   * @param {Float32Array} denoised Canal de imagen denoised.
   * @param {Float32Array} original Canal de imagen original.
   * @param {number} median Mediana del canal original.
   * @param {number} mad MAD del canal original.
   * @returns {Float32Array} Canal procesado con estrellas brillantes preservadas.
   */
  function applyStarProtection(denoised, original, median, mad) {
    const len = original.length;
    const out = new Float32Array(len);
    const threshold = median + 250.0 * mad;
    for (let i = 0; i < len; i++) {
      out[i] = (original[i] >= threshold) ? original[i] : denoised[i];
    }
    return out;
  }

  /**
   * Ejecuta el auto-test de star-protection para verificar la detección y preservación.
   *
   * @returns {{success: boolean, maxDiff: number, protectedCount: number}} Resultados del test.
   */
  function runStarProtTest() {
    const median = 0.1;
    const mad = 0.002;
    const size = 100;
    const original = new Float32Array(size);
    const denoised = new Float32Array(size);
    const expected = new Float32Array(size);

    // threshold = 0.1 + 250 * 0.002 = 0.6
    for (let i = 0; i < size; i++) {
      if (i >= 90) {
        original[i] = 0.8;  // estrella >= threshold
        denoised[i] = 0.7;
        expected[i] = 0.8;  // preservada original
      } else {
        original[i] = 0.3;  // fondo < threshold
        denoised[i] = 0.25;
        expected[i] = 0.25; // usa denoised
      }
    }

    const out = applyStarProtection(denoised, original, median, mad);

    let maxDiff = 0;
    let protectedCount = 0;
    for (let i = 0; i < size; i++) {
      const diff = Math.abs(out[i] - expected[i]);
      if (diff > maxDiff) {
        maxDiff = diff;
      }
      if (out[i] === original[i] && original[i] !== denoised[i]) {
        protectedCount++;
      }
    }

    const success = (maxDiff === 0) && (protectedCount === 10);
    console.log(`[GraXpert Star-Test] Max Diff: ${maxDiff} (Acceptance: 0)`);
    console.log(`[GraXpert Star-Test] Protected Pixels: ${protectedCount} (Expected: 10)`);
    console.log(`[GraXpert Star-Test] Result: ${success ? "SUCCESS" : "FAILED"}`);

    return {
      success,
      maxDiff,
      protectedCount
    };
  }

  let testResults = null;
  // GX-SELFTEST-BEGIN
  if (typeof window !== "undefined" && window.location && window.location.search && window.location.search.includes("gxtest=1")) {
    testResults = runAutoTest(0.3, 0.05);
  }
  // GX-SELFTEST-END

  let geomTestResults = null;
  // GX-GEOM-SELFTEST-BEGIN
  if (typeof window !== "undefined" && window.location && window.location.search && window.location.search.includes("gxgeomtest=1")) {
    geomTestResults = runGeomTest();
  }
  // GX-GEOM-SELFTEST-END

  let dnTestResults = null;
  // GX-DN-SELFTEST-BEGIN
  if (typeof window !== "undefined" && window.location && window.location.search && window.location.search.includes("gxdntest=1")) {
    dnTestResults = runDenoiseNormTest(0.3, 0.05, 10);
  }
  // GX-DN-SELFTEST-END

  let tileTestResults = null;
  // GX-TILE-SELFTEST-BEGIN
  if (typeof window !== "undefined" && window.location && window.location.search && window.location.search.includes("gxtiletest=1")) {
    tileTestResults = runTileTest();
  }
  // GX-TILE-SELFTEST-END

  let starTestResults = null;
  // GX-STAR-SELFTEST-BEGIN
  if (typeof window !== "undefined" && window.location && window.location.search && window.location.search.includes("gxstartest=1")) {
    starTestResults = runStarProtTest();
  }
  // GX-STAR-SELFTEST-END

  return {
    medianMAD,
    normalizeBG,
    denormalizeBG,
    prepareInput,
    restoreBackground,
    gaussianBlur,
    computeBackgroundGraXpert,
    computeDenoiseGraXpert,
    applyGraXpertBG,
    runGeomTest,
    runAutoTest,
    runDenoiseNormTest,
    runTileTest,
    runStarProtTest,
    getReflectCoord,
    padReflect,
    getTilePositions,
    extractTile,
    placeCentral,
    applyStarProtection,
    testResults,
    geomTestResults,
    dnTestResults,
    tileTestResults,
    starTestResults
  };
})();
