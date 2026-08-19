/* =========================================================================
 * deconv-split.js — CS IA Deconvolution SPLIT (Fase E): el pipeline que FUNCIONA
 * (replica src/recombine.py del repo de entrenamiento):
 *
 *   StarNet2 (separa) -> ESTRELLAS con deconv_stars_v7 (3ch, guard saturación)
 *                     -> NEBULOSA con deconv_neb_v7 (mono + PSF-conditioning:
 *                        FWHM medido de la capa de estrellas, sigma por MAD)
 *                     -> recombinar (starless_dec + stars_dec)
 *
 * Sliders separados: opts.sStar (defecto 0.9) y opts.sNeb (defecto 0.5).
 * Conditioning de neb_v7: canales [L, FWHM/12, sigma*5] (mapeo v6+; ¡NO el /8,*20 de v5!).
 * Motor compartido OnnxEngine (WebGPU->WASM, tiling reflect, NHWC para StarNet).
 * PENDIENTE: probar en localhost:8099 y cablear a la UI (sliders).
 * ========================================================================= */

window.DeconvSplitAI = (function () {
  "use strict";

  const LOCAL = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  const URLS = {
    starnet: LOCAL ? "scratch/starnet2.onnx" : "https://astronomy-proxy.vercel.app/m/starnet2.onnx",
    stars: LOCAL ? "scratch/deconv_stars_v11.fp16.onnx" : "https://astronomy-proxy.vercel.app/m/deconv_stars_v11.fp16.onnx",
    neb: LOCAL ? "scratch/deconv_neb_v7.fp16.onnx" : "https://astronomy-proxy.vercel.app/m/deconv_neb_v7.fp16.onnx"
  };
  const LUMA = [0.2126, 0.7152, 0.0722];
  const FWHM_NORM = 12.0, SIGMA_NORM = 5.0;      // conditioning v6+/v7 (train_nebula.py)
  const fin = (x) => (Number.isFinite(x) ? x : 0);

  function luminance(ch, n) {
    const L = new Float32Array(n);
    if (ch.length >= 3) {
      for (let i = 0; i < n; i++) L[i] = LUMA[0] * fin(ch[0][i]) + LUMA[1] * fin(ch[1][i]) + LUMA[2] * fin(ch[2][i]);
    } else {
      for (let i = 0; i < n; i++) L[i] = fin(ch[0][i]);
    }
    return L;
  }

  // Dilatación (box-max radio rMax) + suavizado (box-blur rBlur, 2 pasadas ≈ gaussiano), ambos
  // SEPARABLES (O(n) por eje) -> barato. Replica maximum_filter+gaussian_filter del guard Python.
  function boxDilateBlur(src, w, h, rMax, rBlur) {
    const maxH = new Float32Array(w * h), maxV = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let m = 0; const x0 = Math.max(0, x - rMax), x1 = Math.min(w - 1, x + rMax);
      for (let k = x0; k <= x1; k++) { const v = src[y * w + k]; if (v > m) m = v; }
      maxH[y * w + x] = m;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let m = 0; const y0 = Math.max(0, y - rMax), y1 = Math.min(h - 1, y + rMax);
      for (let k = y0; k <= y1; k++) { const v = maxH[k * w + x]; if (v > m) m = v; }
      maxV[y * w + x] = m;
    }
    let cur = maxV;
    for (let pass = 0; pass < 2; pass++) {
      const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0, c = 0; const x0 = Math.max(0, x - rBlur), x1 = Math.min(w - 1, x + rBlur);
        for (let k = x0; k <= x1; k++) { s += cur[y * w + k]; c++; }
        tmp[y * w + x] = s / c;
      }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0, c = 0; const y0 = Math.max(0, y - rBlur), y1 = Math.min(h - 1, y + rBlur);
        for (let k = y0; k <= y1; k++) { s += tmp[k * w + x]; c++; }
        out[y * w + x] = s / c;
      }
      cur = out;
    }
    return cur;
  }

  function robustStats(L) {
    const n = L.length, m = Math.min(n, 200000), step = Math.max(1, Math.floor(n / m));
    const s = [];
    for (let i = 0; i < n; i += step) { const v = L[i]; if (Number.isFinite(v)) s.push(v); }
    s.sort((a, b) => a - b);
    const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
    return { med: q(0.5), hi: q(0.999) };
  }

  // FWHM por ÁREA A MITAD DE MÁXIMO sobre la capa de estrellas (== neb_compare.measure_fwhm;
  // los momentos de 2º orden se inflan con las alas del Moffat). Busca máximos locales.
  function measureFWHM(Lst, w, h) {
    const st = robustStats(Lst);
    let mad = 0; { const dev = []; for (let i = 0; i < Lst.length; i += 7) dev.push(Math.abs(Lst[i] - st.med)); dev.sort((a, b) => a - b); mad = dev[Math.floor(dev.length / 2)] || 1e-6; }
    const thr = st.med + 6 * 1.48 * mad;
    const half = 10, fs = [];
    for (let y = half; y < h - half && fs.length < 40; y += 2) {
      for (let x = half; x < w - half && fs.length < 40; x += 2) {
        const v = Lst[y * w + x];
        if (v <= thr || v > 0.9) continue;                     // descarta débil y saturada
        let isMax = true;
        for (let dy = -2; dy <= 2 && isMax; dy++) for (let dx = -2; dx <= 2; dx++) {
          if (Lst[(y + dy) * w + (x + dx)] > v) { isMax = false; break; }
        }
        if (!isMax) continue;
        // ventana 21x21: fondo=mediana aprox (borde), área >= mitad de pico
        let bg = 0, nb = 0;
        for (let dx = -half; dx <= half; dx++) { bg += Lst[(y - half) * w + (x + dx)] + Lst[(y + half) * w + (x + dx)]; nb += 2; }
        bg /= nb;
        const pk = v - bg;
        if (pk <= 1e-6) continue;
        let area = 0;
        for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) {
          if (Lst[(y + dy) * w + (x + dx)] - bg >= 0.5 * pk) area++;
        }
        fs.push(2.0 * Math.sqrt(area / Math.PI));
        x += half;                                             // no re-detectar la misma estrella
      }
    }
    if (!fs.length) return 3.0;
    fs.sort((a, b) => a - b);
    return fs[Math.floor(fs.length / 2)];
  }

  // sigma de ruido: MAD del residuo high-pass (box 3x3) sobre la mitad oscura, en unidades norm.
  function measureSigma(Ln, w, h) {
    const st = robustStats(Ln);
    const dev = [];
    for (let y = 1; y < h - 1; y += 3) for (let x = 1; x < w - 1; x += 3) {
      const i = y * w + x;
      if (Ln[i] >= st.med) continue;
      const box = (Ln[i - w - 1] + Ln[i - w] + Ln[i - w + 1] + Ln[i - 1] + Ln[i] + Ln[i + 1] + Ln[i + w - 1] + Ln[i + w] + Ln[i + w + 1]) / 9;
      dev.push(Math.abs(Ln[i] - box));
    }
    if (!dev.length) return 0.02;
    dev.sort((a, b) => a - b);
    return 1.4826 * dev[Math.floor(dev.length / 2)];
  }

  async function run(imgData, opts, onDownloadProgress, onTileProgress) {
    const { w, h, nc, isColor } = imgData;
    const n = w * h;
    const sStar = (opts && opts.sStar !== undefined) ? parseFloat(opts.sStar) : 0.9;
    const sNeb = (opts && opts.sNeb !== undefined) ? parseFloat(opts.sNeb) : 0.5;
    const log = (opts && typeof opts.onLog === "function") ? opts.onLog : (m) => console.info(m);

    // 0) RGB saneado en [0,1] (mono -> replicado; StarNet es RGB)
    const rgb = [];
    for (let c = 0; c < 3; c++) {
      const src = imgData.ch[Math.min(c, imgData.ch.length - 1)];
      const d = new Float32Array(n);
      for (let i = 0; i < n; i++) { const v = fin(src[i]); d[i] = v < 0 ? 0 : (v > 1 ? 1 : v); }
      rgb.push(d);
    }

    // 1) StarNet2 -> starless (NHWC 512 fijo, overlap 32)
    log("[Split] StarNet2: separando estrellas/fondo...");
    const snSess = await window.OnnxEngine.loadSession(URLS.starnet, {}, onDownloadProgress);
    const slCh = await window.OnnxEngine.runOnnxModelTiled(snSess, { ch: rgb, w, h, nc: 3, isColor: true }, {
      tileSize: 512, fixedTile: 512, overlap: 32, padMode: "reflect", layout: "NHWC", channels: 3,
      onProgress: (p) => onTileProgress && onTileProgress(p * 0.4)
    });
    const stars = [];
    for (let c = 0; c < 3; c++) {
      const d = new Float32Array(n);
      for (let i = 0; i < n; i++) { const v = rgb[c][i] - slCh[c][i]; d[i] = v > 0 ? v : 0; }
      stars.push(d);
    }

    // 2) ESTRELLAS: deconv_stars v11 (3ch) + guard. NORMALIZACIÓN por las stats de la PROPIA
    // CAPA DE ESTRELLAS (fondo≈0, picos→1), EXACTAMENTE como judge.deconv en Python. (BUG del
    // 1er porte: usaba la mediana de la imagen COMPLETA -> metía un pedestal negativo en el fondo
    // negro de la capa -> el modelo residual veía algo FUERA de distribución -> anillos arcoíris
    // + checkerboard. Este era el "funcionamiento malísimo".)
    log("[Split] deconv_stars (v11) sobre la capa de estrellas...");
    const Lstn = luminance(stars, n);
    const sst = robustStats(Lstn);
    const scale = 1.0 / Math.max(sst.hi - sst.med, 1e-4);
    const med = sst.med;
    const starsN = stars.map((s) => { const d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = (s[i] - med) * scale; return d; });
    const stSess = await window.OnnxEngine.loadSession(URLS.stars, {}, onDownloadProgress);
    const stOut = await window.OnnxEngine.runOnnxModelTiled(stSess, { ch: starsN, w, h, nc: 3, isColor: true }, {
      tileSize: 512, fixedTile: 512, overlap: 48, padMode: "reflect", layout: "NCHW", channels: 3,
      onProgress: (p) => onTileProgress && onTileProgress(0.4 + p * 0.3)
    });
    // Salida del modelo des-normalizada y clip [0,1] (== Python judge.deconv).
    const vout = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < n; i++) {
        let v = stOut[c][i] / scale + med;
        if (!Number.isFinite(v) || v < 0) v = 0; else if (v > 1) v = 1;
        vout[c][i] = v;
      }
    }
    // APLICAR EL MODELO COMO RATIO DE LUMINANCIA (no RGB-directo). El modelo 3ch en RGB-directo
    // desalinea R/G/B y mete franjas de color (ringing croma) en estrellas MEDIAS -> eran las
    // "rayas verticales de color" que se veían en el navegador. Con el ratio SOLO aprieta la
    // estrella, nunca la recolorea. Medido en Python: chroma p99.9 0.064->0.112 (RGB-directo) vs
    // 0.057 (ratio, ≤ original). Es exactamente process_image.deconv_star_luma().
    const Lin = luminance(stars, n);
    const Lout = luminance(vout, n);
    const ratioL = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let r = Lout[i] / Math.max(Lin[i], 1e-5);
      if (!Number.isFinite(r) || r < 0) r = 0; else if (r > 4.0) r = 4.0;
      ratioL[i] = r;
    }
    // GUARD GRADUADO por brillo (validado en bench_scoreboard v9_guard2: protege el halo de las
    // brillantes 0.6-0.92 donde el modelo dejaba anillos; total en saturadas). Mismo mapa que
    // bench_compare.ours(). Dilatado con un box-max 15x15 + suavizado para que la transición
    // no deje costura en el borde del halo.
    const guardRaw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let m = Math.max(fin(rgb[0][i]), fin(rgb[1][i]), fin(rgb[2][i]));
      guardRaw[i] = Math.max(0, Math.min(1, (m - 0.6) / 0.32));
    }
    const guard = boxDilateBlur(guardRaw, w, h, 7, 4);
    const starsDec = [];
    for (let c = 0; c < 3; c++) {
      const d = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let dec_lr = stars[c][i] * ratioL[i];            // reescala por luminancia -> croma intacta
        if (dec_lr > 1) dec_lr = 1;                       // clip [0,1] como Python
        const g = guard[i];                              // 0=corregir pleno, 1=estrella original
        const dec = dec_lr * (1 - g) + stars[c][i] * g;
        d[i] = stars[c][i] * (1 - sStar) + dec * sStar;
      }
      starsDec.push(d);
    }

    // 3) NEBULOSA: conditioning medido + deconv_neb_v7 mono + recombine por ratio
    const Lsl = luminance(slCh, n);
    const sl = robustStats(Lsl);
    const dsl = Math.max(sl.hi - sl.med, 1e-6);
    const Ln = new Float32Array(n);
    for (let i = 0; i < n; i++) Ln[i] = (Lsl[i] - sl.med) / dsl;
    const fwhm = measureFWHM(Lin, w, h);   // Lin = luminancia de la capa de estrellas (antes 'Lst')
    const sigma = measureSigma(Ln, w, h);
    log(`[Split] conditioning: FWHM=${fwhm.toFixed(2)}px sigma=${sigma.toFixed(4)} | sStar=${sStar} sNeb=${sNeb}`);
    const fmap = new Float32Array(n).fill(Math.min(fwhm / FWHM_NORM, 1.0));
    const smap = new Float32Array(n).fill(Math.min(sigma * SIGMA_NORM, 1.0));
    const nbSess = await window.OnnxEngine.loadSession(URLS.neb, {}, onDownloadProgress);
    const nbOut = await window.OnnxEngine.runOnnxModelTiled(nbSess, { ch: [Ln, fmap, smap], w, h, nc: 3, isColor: true }, {
      tileSize: 256, fixedTile: 256, overlap: 32, padMode: "reflect", layout: "NCHW", channels: 3, outChannels: 1,
      onProgress: (p) => onTileProgress && onTileProgress(0.7 + p * 0.3)
    });
    const LnebN = nbOut[0];
    const RATIO_MAX = 4.0;
    const slDec = [];
    for (let c = 0; c < 3; c++) {
      const d = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const Lout = LnebN[i] * dsl + sl.med;
        let r = Lout / Math.max(Lsl[i], 1e-6);
        if (!Number.isFinite(r) || r < 0) r = 0; else if (r > RATIO_MAX) r = RATIO_MAX;
        const s = slCh[c][i];
        d[i] = s * (1 - sNeb) + s * r * sNeb;
      }
      slDec.push(d);
    }

    // 4) RECOMBINAR: starless_dec + stars_dec (la luz suma)
    const out = [];
    const outNc = (isColor && nc >= 3) ? 3 : 1;
    for (let c = 0; c < outNc; c++) {
      const d = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let v = slDec[c][i] + starsDec[c][i];
        d[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
      }
      out.push(d);
    }
    // DEBUG: guarda las ramas intermedias para diagnóstico (mirar dónde se inflan las estrellas)
    window.__dbg = {
      starless: { ch: slCh, w, h, nc: 3, isColor: true },
      stars:    { ch: stars, w, h, nc: 3, isColor: true },
      starsDec: { ch: starsDec, w, h, nc: 3, isColor: true },
      slDec:    { ch: slDec, w, h, nc: 3, isColor: true }
    };
    return { ch: out, w, h, nc: outNc, isColor: outNc === 3 };
  }

  // _internals: expuesto para tests headless (verificar la nebulosa asimétrica y el guard sin
  // tener que descargar los 131MB de StarNet). No usar en producción.
  return { run, _internals: { measureFWHM, measureSigma, boxDilateBlur, robustStats, luminance, URLS, FWHM_NORM, SIGMA_NORM } };
})();
