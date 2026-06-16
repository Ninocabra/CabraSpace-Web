/* =========================================================================
 * nox.js — Módulo de integración para eliminación de estrellas (nox)
 *
 * Carga el modelo nox_color o nox_gray en formato ONNX, ejecuta inferencia
 * por tiles con solapamiento, y separa la imagen en capas Starless y Stars.
 * ========================================================================= */

window.NoxStarRemoval = (function () {
  "use strict";

  // Servidos vía proxy Vercel (añade CORS sobre la Release models-v1; GitHub Releases no da CORS).
  let MODEL_URL_COLOR = "https://astronomy-proxy.vercel.app/m/nox_color.fp16.onnx";
  let MODEL_URL_GRAY = "https://astronomy-proxy.vercel.app/m/nox_gray.fp16.onnx";
  let MODEL_URL_STARNET2 = "https://astronomy-proxy.vercel.app/m/starnet2.onnx";

  // Usar modelos locales al probar en entorno de desarrollo local
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    MODEL_URL_COLOR = "scratch/nox_color.fp16.onnx";
    MODEL_URL_GRAY = "scratch/nox_gray.fp16.onnx";
    MODEL_URL_STARNET2 = "scratch/starnet2.onnx";
  }

  /**
   * Ejecuta el proceso de eliminación de estrellas.
   *
   * @param {Object} imgData Imagen de entrada { ch: [Float32Array, ...], w, h, nc, isColor }
   * @param {Function} onDownloadProgress Progreso de descarga del modelo (p) => {}
   * @param {Function} onTileProgress Progreso de inferencia por tiles (completed, total) => {}
   * @returns {Promise<Object>} Capas resultantes: { starless, stars }
   */
  // Recuperación de detalle de nebulosa: el modelo quita estrellas pero suaviza un poco la textura
  // de la nebulosa. Usamos el starless del modelo SOLO donde se quitó algo significativo (estrellas:
  // diff alto/localizado) y mantenemos el original donde no (preserva la textura). `recover` (0..1)
  // controla el umbral: 0 = starless crudo del modelo; mayor = más nebulosa original conservada.
  function applyNebulaRecover(imgData, starlessCh, recover) {
    const w = imgData.w, h = imgData.h, n = w * h, nc = imgData.nc;
    const thr = Math.max(0.01, recover * 0.12);
    const lumW = imgData.isColor && nc >= 3;
    const diff = new Float32Array(n);
    for (let i = 0; i < n; ++i) {
      let lo, ls;
      if (lumW) {
        lo = 0.2126 * imgData.ch[0][i] + 0.7152 * imgData.ch[1][i] + 0.0722 * imgData.ch[2][i];
        ls = 0.2126 * starlessCh[0][i] + 0.7152 * starlessCh[1][i] + 0.0722 * starlessCh[2][i];
      } else {
        lo = imgData.ch[0][i]; ls = starlessCh[0][i];
      }
      const d = lo - ls;
      diff[i] = d > 0 ? d : 0;
    }
    // máscara suavizada (box 3x3 separable) para transiciones limpias alrededor de estrellas
    const mask = new Float32Array(n);
    for (let i = 0; i < n; ++i) { let m = diff[i] / thr; mask[i] = m > 1 ? 1 : (m < 0 ? 0 : m); }
    const tmp = new Float32Array(n);
    const blur1D = (src, dst, horiz) => {
      for (let y = 0; y < h; ++y) for (let x = 0; x < w; ++x) {
        const i = y * w + x; let s = src[i], c = 1;
        if (horiz) { if (x > 0) { s += src[i - 1]; c++; } if (x < w - 1) { s += src[i + 1]; c++; } }
        else { if (y > 0) { s += src[i - w]; c++; } if (y < h - 1) { s += src[i + w]; c++; } }
        dst[i] = s / c;
      }
    };
    blur1D(mask, tmp, true); blur1D(tmp, mask, false);
    const out = [];
    for (let c = 0; c < nc; ++c) {
      const o = imgData.ch[c], s = starlessCh[c], dst = new Float32Array(n);
      for (let i = 0; i < n; ++i) { const m = mask[i]; dst[i] = o[i] * (1 - m) + s[i] * m; }
      out.push(dst);
    }
    return out;
  }

  async function runNox(imgData, onDownloadProgress, onTileProgress, recover) {
    if (!imgData || !imgData.ch || imgData.ch.length === 0) {
      throw new Error("No hay datos de imagen de entrada válidos.");
    }

    const isColor = imgData.isColor || imgData.nc === 3;
    const modelUrl = isColor ? MODEL_URL_COLOR : MODEL_URL_GRAY;

    // 1+2. Modelo (descarga/caché) + sesión ONNX REUTILIZABLE (cacheada por URL; no recompila por clic)
    const session = await window.OnnxEngine.loadSession(modelUrl, {}, onDownloadProgress);

    // 3. Ejecución por tiles con normalización
    // Entrada: [0, 1] -> [-1, 1] (scaleIn: 2.0, offsetIn: -1.0)
    // Salida: [-1, 1] -> [0, 1] (scaleOut: 0.5, offsetOut: 0.5)
    // El modelo espera NHWC [1, None, None, 3]
    const options = {
      tileSize: 512,
      overlap: 64, // Solapamiento para evitar costuras
      padMode: "reflect",
      layout: "NHWC",
      scaleIn: 2.0,
      offsetIn: -1.0,
      scaleOut: 0.5,
      offsetOut: 0.5,
      onProgress: onTileProgress,
      channels: isColor ? 3 : 1,
      fixedTile: 512 // nox requiere tamaño de tile múltiplo de 256 por su profundidad U-Net (reducción de 256x)
    };

    let starlessCh = await window.OnnxEngine.runOnnxModelTiled(session, imgData, options);

    return finishStarRemoval(imgData, starlessCh, recover, isColor);
  }

  // StarNet2: starless directo. NHWC 512x512 fijo, normalización [0,1] (sin escalado).
  async function runStarNet2(imgData, onDownloadProgress, onTileProgress, recover) {
    if (!imgData || !imgData.ch || imgData.ch.length === 0) {
      throw new Error("No hay datos de imagen de entrada válidos.");
    }
    const isColor = imgData.isColor || imgData.nc === 3;
    const session = await window.OnnxEngine.loadSession(MODEL_URL_STARNET2, {}, onDownloadProgress);
    const options = {
      tileSize: 512, overlap: 64, padMode: "reflect", layout: "NHWC",
      scaleIn: 1.0, offsetIn: 0.0, scaleOut: 1.0, offsetOut: 0.0,
      onProgress: onTileProgress, channels: 3, fixedTile: 512
    };
    let starlessCh = await window.OnnxEngine.runOnnxModelTiled(session, imgData, options);
    return finishStarRemoval(imgData, starlessCh, recover, isColor);
  }

  // Post-proceso común: recuperación de nebulosa (opcional) + capa de estrellas = max(0, orig - starless).
  function finishStarRemoval(imgData, starlessCh, recover, isColor) {
    if (typeof recover === "number" && recover > 0) {
      starlessCh = applyNebulaRecover(imgData, starlessCh, recover);
    }
    const nc = imgData.nc, len = imgData.w * imgData.h, starsCh = [];
    for (let c = 0; c < nc; ++c) {
      const orig = imgData.ch[c], starless = starlessCh[c], stars = new Float32Array(len);
      for (let i = 0; i < len; ++i) { const d = orig[i] - starless[i]; stars[i] = d > 0 ? d : 0; }
      starsCh.push(stars);
    }
    return {
      starless: { ch: starlessCh, w: imgData.w, h: imgData.h, nc: nc, isColor: isColor },
      stars: { ch: starsCh, w: imgData.w, h: imgData.h, nc: nc, isColor: isColor }
    };
  }

  return {
    runNox,
    runStarNet2
  };
})();
