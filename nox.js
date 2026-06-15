/* =========================================================================
 * nox.js — Módulo de integración para eliminación de estrellas (nox)
 *
 * Carga el modelo nox_color o nox_gray en formato ONNX, ejecuta inferencia
 * por tiles con solapamiento, y separa la imagen en capas Starless y Stars.
 * ========================================================================= */

window.NoxStarRemoval = (function () {
  "use strict";

  let MODEL_URL_COLOR = "https://github.com/Ninocabra/CabraSpace-Web/releases/download/models-v1/nox_color.fp16.onnx";
  let MODEL_URL_GRAY = "https://github.com/Ninocabra/CabraSpace-Web/releases/download/models-v1/nox_gray.fp16.onnx";

  // Usar modelos locales al probar en entorno de desarrollo local
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    MODEL_URL_COLOR = "scratch/nox_color.fp16.onnx";
    MODEL_URL_GRAY = "scratch/nox_gray.fp16.onnx";
  }

  /**
   * Ejecuta el proceso de eliminación de estrellas.
   *
   * @param {Object} imgData Imagen de entrada { ch: [Float32Array, ...], w, h, nc, isColor }
   * @param {Function} onDownloadProgress Progreso de descarga del modelo (p) => {}
   * @param {Function} onTileProgress Progreso de inferencia por tiles (completed, total) => {}
   * @returns {Promise<Object>} Capas resultantes: { starless, stars }
   */
  async function runNox(imgData, onDownloadProgress, onTileProgress) {
    if (!imgData || !imgData.ch || imgData.ch.length === 0) {
      throw new Error("No hay datos de imagen de entrada válidos.");
    }

    const isColor = imgData.isColor || imgData.nc === 3;
    const modelUrl = isColor ? MODEL_URL_COLOR : MODEL_URL_GRAY;

    // 1. Descarga/Caché del modelo
    const modelData = await window.OnnxEngine.fetchModelWithCache(modelUrl, onDownloadProgress);

    // 2. Inicialización de sesión ONNX
    const session = await window.OnnxEngine.createSession(modelData);

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

    const starlessCh = await window.OnnxEngine.runOnnxModelTiled(session, imgData, options);

    // 4. Calcular capa de estrellas: stars = max(0, original - starless)
    const nc = imgData.nc;
    const len = imgData.w * imgData.h;
    const starsCh = [];

    for (let c = 0; c < nc; ++c) {
      const orig = imgData.ch[c];
      const starless = starlessCh[c];
      const stars = new Float32Array(len);

      for (let i = 0; i < len; ++i) {
        const diff = orig[i] - starless[i];
        stars[i] = diff > 0.0 ? diff : 0.0;
      }
      starsCh.push(stars);
    }

    return {
      starless: {
        ch: starlessCh,
        w: imgData.w,
        h: imgData.h,
        nc: nc,
        isColor: isColor
      },
      stars: {
        ch: starsCh,
        w: imgData.w,
        h: imgData.h,
        nc: nc,
        isColor: isColor
      }
    };
  }

  return {
    runNox
  };
})();
