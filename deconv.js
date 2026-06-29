/* =========================================================================
 * deconv.js — CS IA Deconvolution (Beta): deconvolucion ciega por IA propia.
 *
 * Modelo entrenado por CabraSpace (estilo BlurXTerminator) con ground truth real
 * de Hubble + degradacion sintetica (PSF Moffat + ruido). Mono, NCHW [1,1,H,W],
 * fp16. Corre sobre la LUMINANCIA en dominio LINEAL (como se entreno) y reaplica
 * el detalle al color por ratio, preservando el tono. Usa el motor compartido
 * OnnxEngine (WebGPU->WASM, cache IndexedDB, tiling reflect sin costuras).
 *
 * Robusto a NaN/Inf y a cualquier rango de valores: sanea la entrada y hace la
 * normalizacion (fondo->0, brillo->1) AQUI, no via el clamp [0,1] del tiler.
 * ========================================================================= */

window.DeconvAI = (function () {
  "use strict";

  // fp16 (~4 MB). Prod via proxy Vercel (CORS sobre la Release); local desde scratch/.
  let MODEL_URL = "https://astronomy-proxy.vercel.app/m/deconv_beta.fp16.onnx";
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    // STAGING (revisión a ojo de Nino): en local servimos el modelo de Fase 2.
    // Producción sigue con el Beta hasta su visto bueno. Al desplegar, actualizar
    // tambien la MODEL_URL de produccion (Release + proxy) a deconv_phase2.fp16.onnx.
    MODEL_URL = "scratch/deconv_phase2.fp16.onnx";
  }

  const LUMA = [0.2126, 0.7152, 0.0722]; // Rec.709
  const fin = (x) => (Number.isFinite(x) ? x : 0); // NaN/Inf -> 0

  // Fondo (mediana) y referencia de brillo (percentil alto) por muestreo rapido.
  function robustStats(L) {
    const n = L.length;
    const m = Math.min(n, 200000);
    const step = Math.max(1, Math.floor(n / m));
    const s = [];
    for (let i = 0; i < n; i += step) { const v = L[i]; if (Number.isFinite(v)) s.push(v); }
    s.sort((a, b) => a - b);
    const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
    return { med: q(0.5), hi: q(0.999), lo: s[0], top: s[s.length - 1] };
  }

  /**
   * Deconvoluciona imgData ({ ch:[Float32Array], w, h, nc, isColor }). Robusto a
   * NaN/Inf y a cualquier rango. opts.strength (0..1) mezcla con el original.
   */
  async function run(imgData, opts, onDownloadProgress, onTileProgress) {
    if (!imgData || !imgData.ch || !imgData.ch.length) {
      throw new Error("No hay datos de imagen de entrada validos.");
    }
    const { w, h, nc, isColor } = imgData;
    const n = w * h;
    const strength = (opts && opts.strength !== undefined) ? parseFloat(opts.strength) : 1.0;
    const color = isColor && nc >= 3;
    // Diagnostico: a la consola de la app si se pasa opts.onLog; si no, a la del navegador.
    const log = (opts && typeof opts.onLog === "function") ? opts.onLog : (m) => console.info(m);

    // 1) luminancia saneada (NaN/Inf -> 0), con conteo y rango para diagnostico
    const L = new Float32Array(n);
    let nNan = 0, Lmin = Infinity, Lmax = -Infinity;
    for (let i = 0; i < n; i++) {
      let v;
      if (color) {
        const r = imgData.ch[0][i], g = imgData.ch[1][i], b = imgData.ch[2][i];
        if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) nNan++;
        v = LUMA[0] * fin(r) + LUMA[1] * fin(g) + LUMA[2] * fin(b);
      } else {
        const x = imgData.ch[0][i];
        if (!Number.isFinite(x)) nNan++;
        v = fin(x);
      }
      L[i] = v;
      if (v < Lmin) Lmin = v;
      if (v > Lmax) Lmax = v;
    }

    // 2) estadisticas robustas + normalizacion AQUI (no en el tiler): fondo->0, brillo->1
    const { med, hi } = robustStats(L);
    const denom = Math.max(hi - med, 1e-6);
    log(`[DeconvAI] entrada ${w}x${h} color=${color} | L min=${Lmin.toExponential(2)} ` +
      `max=${Lmax.toExponential(2)} fondo=${med.toExponential(2)} brillo=${hi.toExponential(2)} ` +
      `noFinitos(NaN)=${nNan} | intensidad=${strength}`);
    const Ln = new Float32Array(n);
    for (let i = 0; i < n; i++) Ln[i] = (L[i] - med) / denom;

    // 3) inferencia mono NCHW por tiles (256, reflect, overlap 32). Tiler en IDENTIDAD
    //    porque la entrada ya esta normalizada y la salida del modelo es ~[0,1].
    const monoImg = { ch: [Ln], w, h, nc: 1, isColor: false };
    const session = await window.OnnxEngine.loadSession(MODEL_URL, {}, onDownloadProgress);
    const outCh = await window.OnnxEngine.runOnnxModelTiled(session, monoImg, {
      tileSize: 256, fixedTile: 256, overlap: 32,
      padMode: "reflect", layout: "NCHW", channels: 1,
      onProgress: onTileProgress
    });
    const LoutN = outCh[0];

    // 4) des-normaliza la salida al rango original (sin el clamp del tiler)
    const Lout = new Float32Array(n);
    let Omin = Infinity, Omax = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = LoutN[i] * denom + med;
      Lout[i] = v;
      if (v < Omin) Omin = v;
      if (v > Omax) Omax = v;
    }
    log(`[DeconvAI] salida min=${Omin.toExponential(2)} max=${Omax.toExponential(2)}`);

    // 5) reaplica el detalle al color por ratio (preserva tono) + mezcla strength
    const out = [];
    const RATIO_MAX = 4.0;
    if (color) {
      for (let c = 0; c < nc; c++) {
        const src = imgData.ch[c], dst = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const s = fin(src[i]);
          let r = Lout[i] / Math.max(L[i], 1e-6);
          if (!Number.isFinite(r) || r < 0) r = 0; else if (r > RATIO_MAX) r = RATIO_MAX;
          dst[i] = s * (1 - strength) + (s * r) * strength;
        }
        out.push(dst);
      }
    } else {
      const src = imgData.ch[0], dst = new Float32Array(n);
      for (let i = 0; i < n; i++) dst[i] = fin(src[i]) * (1 - strength) + Lout[i] * strength;
      out.push(dst);
    }
    return { ch: out, w, h, nc, isColor };
  }

  return { run };
})();
