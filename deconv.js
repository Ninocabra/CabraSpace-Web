/* =========================================================================
 * deconv.js — CS IA Deconvolution (Beta): deconvolucion ciega por IA propia.
 *
 * Modelo entrenado por CabraSpace (estilo BlurXTerminator) con ground truth real
 * de Hubble + degradacion sintetica (PSF Moffat + ruido). Mono, NCHW [1,1,H,W],
 * fp16. Corre sobre la LUMINANCIA en dominio LINEAL (como se entreno) y reaplica
 * el detalle al color por ratio, preservando el tono. Usa el motor compartido
 * OnnxEngine (WebGPU->WASM, cache IndexedDB, tiling reflect sin costuras).
 * ========================================================================= */

window.DeconvAI = (function () {
  "use strict";

  // fp16 (~4 MB). Prod via proxy Vercel (CORS sobre la Release); local desde scratch/.
  let MODEL_URL = "https://astronomy-proxy.vercel.app/m/deconv_beta.fp16.onnx";
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    MODEL_URL = "scratch/deconv_beta.fp16.onnx";
  }

  const LUMA = [0.2126, 0.7152, 0.0722]; // Rec.709

  // Fondo (mediana) y referencia de brillo (percentil alto) por muestreo rapido.
  function robustStats(L) {
    const n = L.length;
    const m = Math.min(n, 200000);
    const step = Math.max(1, Math.floor(n / m));
    const s = [];
    for (let i = 0; i < n; i += step) s.push(L[i]);
    s.sort((a, b) => a - b);
    const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
    return { med: q(0.5), hi: q(0.999) };
  }

  /**
   * Deconvoluciona imgData ({ ch:[Float32Array], w, h, nc, isColor }, valores 0..1).
   * opts.strength (0..1) mezcla con el original. Devuelve el mismo formato.
   *
   * Pipeline:
   *   1) luminancia L (o canal unico si mono).
   *   2) normalizacion LINEAL: fondo->0, brillo->~1 (igual que el entrenamiento).
   *   3) inferencia mono NCHW por tiles (256, reflect, overlap 32).
   *   4) detalle reaplicado al color por ratio Lout/Lin (preserva tono) + strength.
   */
  async function run(imgData, opts, onDownloadProgress, onTileProgress) {
    if (!imgData || !imgData.ch || !imgData.ch.length) {
      throw new Error("No hay datos de imagen de entrada validos.");
    }
    const { w, h, nc, isColor } = imgData;
    const n = w * h;
    const strength = (opts && opts.strength !== undefined) ? parseFloat(opts.strength) : 1.0;
    const color = isColor && nc >= 3;

    // 1) luminancia
    const L = new Float32Array(n);
    if (color) {
      const R = imgData.ch[0], G = imgData.ch[1], B = imgData.ch[2];
      for (let i = 0; i < n; i++) L[i] = LUMA[0] * R[i] + LUMA[1] * G[i] + LUMA[2] * B[i];
    } else {
      L.set(imgData.ch[0]);
    }

    // 2) normalizacion lineal (fondo->0, brillo->1). El tiler aplica scaleIn/offsetIn
    //    a la entrada y scaleOut/offsetOut (e invierte) a la salida.
    const { med, hi } = robustStats(L);
    const scale = 1.0 / Math.max(hi - med, 1e-4);

    // 3) inferencia mono NCHW (mismo tiling que la decon IA existente: 256, fixed, overlap 32)
    const monoImg = { ch: [L], w, h, nc: 1, isColor: false };
    const session = await window.OnnxEngine.loadSession(MODEL_URL, {}, onDownloadProgress);
    const outCh = await window.OnnxEngine.runOnnxModelTiled(session, monoImg, {
      tileSize: 256, fixedTile: 256, overlap: 32,
      padMode: "reflect", layout: "NCHW", channels: 1,
      scaleIn: scale, offsetIn: -med * scale,
      scaleOut: 1.0 / scale, offsetOut: med,
      onProgress: onTileProgress
    });
    const Lout = outCh[0];

    // 4) reaplicar el detalle al color por ratio (preserva tono) + mezcla strength
    const out = [];
    const RATIO_MAX = 4.0; // limita artefactos de color en pixeles muy debiles
    if (color) {
      for (let c = 0; c < nc; c++) {
        const src = imgData.ch[c], dst = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          let r = Lout[i] / Math.max(L[i], 1e-5);
          if (r < 0) r = 0; else if (r > RATIO_MAX) r = RATIO_MAX;
          let v = src[i] * (1 - strength) + (src[i] * r) * strength;
          dst[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
        }
        out.push(dst);
      }
    } else {
      const src = imgData.ch[0], dst = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let v = src[i] * (1 - strength) + Lout[i] * strength;
        dst[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
      }
      out.push(dst);
    }
    return { ch: out, w, h, nc, isColor };
  }

  return { run };
})();
