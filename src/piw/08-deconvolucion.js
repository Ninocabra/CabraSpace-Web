  // --- COSMIC CLARITY IA / STANDARD DECONVOLUTION ENGINE ---
  // Modelos servidos vía proxy Vercel (añade CORS sobre la Release models-v1; GitHub Releases no da CORS).
  // En localhost, resolveCosmicModelUrl tira de scratch/.
  const RELEASE_BASE = "https://astronomy-proxy.vercel.app/m/";
  // fp16 (11.8->5.9MB cada uno, paridad imperceptible): ~2x mas rapido en WebGPU + mitad de descarga.
  // Requiere subir los .fp16.onnx a la Release. En localhost resolveCosmicModelUrl usa scratch/.
  const STELLAR_MODEL_URL = RELEASE_BASE + "deep_sharp_stellar_cnn_AI3_5s.fp16.onnx";
  // En la Release solo está el nonstellar radius_2; todas las opciones de radio usan ese modelo.
  const NONSTELLAR_MODEL_URLS = {
    radius_1: RELEASE_BASE + "deep_nonstellar_sharp_cnn_radius_2AI3_5s.fp16.onnx",
    radius_2: RELEASE_BASE + "deep_nonstellar_sharp_cnn_radius_2AI3_5s.fp16.onnx",
    radius_4: RELEASE_BASE + "deep_nonstellar_sharp_cnn_radius_2AI3_5s.fp16.onnx",
    radius_8: RELEASE_BASE + "deep_nonstellar_sharp_cnn_radius_2AI3_5s.fp16.onnx"
  };

  // COSMIC-MODEL-ROUTING-BEGIN
  // En localhost usa las copias locales de scratch/; en producción usa la Release propia models-v1
  // (RELEASE_BASE), que sí permite fetch cross-origin (CORS).
  function resolveCosmicModelUrl(url) {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return "scratch/" + url.split("/").pop();
    }
    return url;
  }
  // COSMIC-MODEL-ROUTING-END

  // ONNX-ENGINE-REF-BEGIN
  // Las funciones openModelDB, getCachedModel, cacheModel, fetchModelWithCache y runOnnxModelTiled
  // han sido movidas al módulo independiente 'onnx-engine.js' para modularidad y reutilización en star removal/GraXpert.
  // ONNX-ENGINE-REF-END

  // Event Listener para Deconvolución
  // DECON-COMPUTE-BEGIN
  // RL-DECONV-BEGIN
  // Deconvolución Richardson-Lucy CLÁSICA en JS puro (sin IA, sin Pyodide, sin tiling): rápida,
  // específica para cielo profundo, con PSF gaussiana AUTO-estimada de las estrellas y DERINGING
  // (evita halos negros). El blur se aproxima con 3 cajas (O(n) por sigma) -> rápido a 4000px.
  // Convolución gaussiana separable EXACTA (kernel acotado a ±3σ). Es CRÍTICO para la
  // deconvolución: aproximar la gaussiana por cajas la ensancha (~1.6×) y provoca anillos
  // (ringing/donuts) alrededor de las estrellas. El kernel exacto los elimina.
  function _gaussConv(src, dst, w, h, sigma) {
    const r = Math.max(1, Math.ceil(3 * sigma));
    const k = new Float32Array(2 * r + 1); let s = 0;
    for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k[i + r] = v; s += v; }
    for (let i = 0; i < k.length; i++) k[i] /= s;
    const w1 = w - 1, h1 = h - 1, tmp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) { const o = y * w; for (let x = 0; x < w; x++) { let acc = 0; for (let j = -r; j <= r; j++) acc += src[o + Math.min(w1, Math.max(0, x + j))] * k[j + r]; tmp[o + x] = acc; } }
    for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) { let acc = 0; for (let j = -r; j <= r; j++) acc += tmp[Math.min(h1, Math.max(0, y + j)) * w + x] * k[j + r]; dst[y * w + x] = acc; } }
  }
  // Estima la sigma de la PSF a partir del segundo momento de las estrellas brillantes no saturadas.
  function _estimatePSFSigma(L, w, h) {
    const med = fastSampledMedian(L);
    let mad = 0; const ns = Math.min(L.length, 100000), st = Math.max(1, (L.length / ns) | 0);
    const tmp = []; for (let i = 0; i < L.length; i += st) tmp.push(Math.abs(L[i] - med));
    tmp.sort((a, b) => a - b); mad = (tmp[tmp.length >> 1] || 0.001) * 1.4826;
    const thr = med + 6 * mad; const sigmas = [];
    for (let y = 4; y < h - 4 && sigmas.length < 400; y++) {
      for (let x = 4; x < w - 4; x++) {
        const v = L[y * w + x];
        if (v < thr || v > 0.95) continue;
        if (v < L[y * w + x - 1] || v < L[y * w + x + 1] || v < L[(y - 1) * w + x] || v < L[(y + 1) * w + x]) continue;
        let sxx = 0, sw = 0;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          const p = L[(y + dy) * w + x + dx] - med; if (p <= 0) continue;
          sxx += p * (dx * dx + dy * dy); sw += p;
        }
        if (sw > 0) { const s = Math.sqrt(sxx / sw / 2); if (s > 0.6 && s < 5) sigmas.push(s); }
      }
    }
    if (!sigmas.length) return 1.5;
    sigmas.sort((a, b) => a - b); return sigmas[sigmas.length >> 1];
  }
  function computeRLDeconv(srcImg) {
    const w = srcImg.w, h = srcImg.h, n = w * h, nc = srcImg.nc;
    const isColor = srcImg.isColor || nc >= 3;
    const lang = document.documentElement.lang || "es";
    const iters = el("sldRlIters") ? parseInt(el("sldRlIters").value, 10) : 5;
    const amount = el("sldRlAmount") ? parseFloat(el("sldRlAmount").value) : 0.8;
    const starProt = el("sldRlStarProt") ? parseFloat(el("sldRlStarProt").value) : 1.0;
    // Luminancia (deconvolvemos L y reaplicamos preservando el color)
    const L = new Float32Array(n);
    if (isColor) { const r = srcImg.ch[0], g = srcImg.ch[1], b = srcImg.ch[2]; for (let i = 0; i < n; i++) L[i] = 0.2126 * r[i] + 0.7152 * g[i] + 0.0722 * b[i]; }
    else L.set(srcImg.ch[0]);
    const sigma = _estimatePSFSigma(L, w, h);
    if (el("lblRlPsf")) el("lblRlPsf").textContent = (lang === "es" ? "PSF estimada: " : "Estimated PSF: ") + sigma.toFixed(2) + " px (σ)";
    // Richardson-Lucy
    const est = Float32Array.from(L), conv = new Float32Array(n), corr = new Float32Array(n);
    for (let it = 0; it < iters; it++) {
      _gaussConv(est, conv, w, h, sigma);
      for (let i = 0; i < n; i++) { const c = conv[i]; corr[i] = c > 1e-6 ? L[i] / c : 1; }
      _gaussConv(corr, corr, w, h, sigma);
      for (let i = 0; i < n; i++) est[i] *= corr[i];
    }
    // Protección de estrellas: RL aprieta las estrellas creando sobre-disparo, que ES el anillo
    // (ringing). Por eso se protegen las estrellas brillantes (como la deconvolución de PixInsight):
    // máscara smoothstep sobre la luminancia, DILATADA con una gaussiana para cubrir núcleo + anillo.
    // Donde la máscara es alta se conserva el original -> cero anillos; la decon actúa en la
    // nebulosa y las estrellas débiles.
    let med2 = fastSampledMedian(L), nmad = 0;
    { const st = Math.max(1, (n / 80000) | 0), tt = []; for (let i = 0; i < n; i += st) tt.push(Math.abs(L[i] - med2)); tt.sort((a, b) => a - b); nmad = (tt[tt.length >> 1] || 1e-4) * 1.4826; }
    const t0 = med2 + 120 * nmad, t1d = (300 * nmad) || 1e-6;
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) { let v = (L[i] - t0) / t1d; v = v < 0 ? 0 : v > 1 ? 1 : v; raw[i] = v * v * (3 - 2 * v); }
    const prot = new Float32Array(n);
    _gaussConv(raw, prot, w, h, sigma * 2.5);
    // Clamp anti-oscurecimiento + realce (amount) + protección de estrellas (starProt).
    for (let i = 0; i < n; i++) {
      let e = est[i];
      if (e < L[i]) e = L[i]; // ningún píxel baja del original (sin halos oscuros)
      e = L[i] + amount * (e - L[i]);
      let p = prot[i] * starProt; if (p > 1) p = 1;
      est[i] = e * (1 - p) + L[i] * p;
    }
    // Reaplicar conservando el color por ratio de luminancia.
    const out = [];
    if (isColor) {
      const ro = new Float32Array(n), go = new Float32Array(n), bo = new Float32Array(n);
      const r = srcImg.ch[0], g = srcImg.ch[1], b = srcImg.ch[2];
      for (let i = 0; i < n; i++) {
        const ratio = L[i] > 1e-6 ? Math.min(5, est[i] / L[i]) : 1;
        ro[i] = Math.min(1, Math.max(0, r[i] * ratio));
        go[i] = Math.min(1, Math.max(0, g[i] * ratio));
        bo[i] = Math.min(1, Math.max(0, b[i] * ratio));
      }
      out.push(ro, go, bo);
    } else {
      const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = Math.min(1, Math.max(0, est[i])); out.push(o);
    }
    logConsole(lang === "es" ? `Deconvolución RL (clásica): σ PSF=${sigma.toFixed(2)}px, ${iters} iter, protección estrellas ${starProt}` : `RL deconvolution: PSF σ=${sigma.toFixed(2)}px, ${iters} iters, star protection ${starProt}`, "info");
    return { ch: out, w, h, nc, isColor };
  }
  // RL-DECONV-END

  // CS IA Deconvolution (Beta): modelo de deconvolución propio de CabraSpace (deconv.js),
  // mono/NCHW sobre luminancia en dominio lineal. Devuelve imgData deconvolucionado.
  async function computeDeconvAI(srcImg) {
    const lang = document.documentElement.lang || "es";
    const strength = el("sldDeconAiStrength") ? parseFloat(el("sldDeconAiStrength").value) : 0.8;
    showLoader(lang === "es" ? "Cargando CS IA Deconvolution (Beta)..." : "Loading CS IA Deconvolution (Beta)...");
    return await window.DeconvAI.run(
      srcImg, { strength },
      (p) => showLoader(lang === "es" ? `Descargando modelo IA: ${(p * 100).toFixed(0)}%` : `Downloading AI model: ${(p * 100).toFixed(0)}%`),
      (idx, total) => showLoader(lang === "es" ? `Deconvolución IA: tile ${idx}/${total}` : `AI deconvolution: tile ${idx}/${total}`)
    );
  }

  // Calcula la deconvolución para un algoritmo EXPLÍCITO (rl_auto | cs_ia_beta | cosmic_ia)
  // COSMIC-DECON-BLEND-JS-BEGIN
  // Port a JS del blend de Cosmic Clarity deconv (antes en Pyodide/decon.py de Seti Astro).
  // A 4K, el blend en Pyodide (WASM) alocaba varias copias de 124 MiB -> OOM. Como img/stellar_ai/
  // nonstellar_ai ya están en JS tras la inferencia WebGPU, blendeamos aquí (sin límite WASM, más
  // rápido), igual que StarNet2/GraXpert/DeepSNR. No se porta la rama Lucy-Richardson (stellar_ai=None):
  // el path de IA siempre provee stellar/nonstellar.
  function _ccGaussBlur1(src, w, h, sigma) {
    if (sigma <= 0.01) return Float32Array.from(src);
    const r = Math.max(1, Math.ceil(3 * sigma));
    const k = new Float32Array(2 * r + 1); let s = 0;
    for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k[i + r] = v; s += v; }
    for (let i = 0; i < k.length; i++) k[i] /= s;
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) { const row = y * w; for (let x = 0; x < w; x++) { let a = 0; for (let j = -r; j <= r; j++) { let xx = x + j; if (xx < 0) xx = 0; else if (xx >= w) xx = w - 1; a += src[row + xx] * k[j + r]; } tmp[row + x] = a; } }
    for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) { let a = 0; for (let j = -r; j <= r; j++) { let yy = y + j; if (yy < 0) yy = 0; else if (yy >= h) yy = h - 1; a += tmp[yy * w + x] * k[j + r]; } out[y * w + x] = a; } }
    return out;
  }
  function _ccGaussReduced(src, w, h, sigma, factor) {
    const dw = Math.max(1, Math.round(w / factor)), dh = Math.max(1, Math.round(h / factor));
    const ds = window.Resample.resizeBilinear(src, w, h, dw, dh);
    const bds = _ccGaussBlur1(ds, dw, dh, sigma / factor);
    return window.Resample.resizeBilinear(bds, dw, dh, w, h);
  }
  function _ccMaxFilter(src, w, h, size) {
    const r = Math.floor(size / 2);
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) { const row = y * w; for (let x = 0; x < w; x++) { let m = -Infinity; for (let dx = -r; dx <= r; dx++) { let xx = x + dx; if (xx < 0) xx = 0; else if (xx >= w) xx = w - 1; const v = src[row + xx]; if (v > m) m = v; } tmp[row + x] = m; } }
    for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) { let m = -Infinity; for (let dy = -r; dy <= r; dy++) { let yy = y + dy; if (yy < 0) yy = 0; else if (yy >= h) yy = h - 1; const v = tmp[yy * w + x]; if (v > m) m = v; } out[y * w + x] = m; } }
    return out;
  }
  function _ccMedianFilter(src, w, h, size) {
    const r = Math.floor(size / 2), out = new Float32Array(w * h), buf = new Float32Array(size * size);
    for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) { let kk = 0; for (let dy = -r; dy <= r; dy++) { let yy = y + dy; if (yy < 0) yy = 0; else if (yy >= h) yy = h - 1; const row = yy * w; for (let dx = -r; dx <= r; dx++) { let xx = x + dx; if (xx < 0) xx = 0; else if (xx >= w) xx = w - 1; buf[kk++] = src[row + xx]; } } const a = buf.slice(0, kk).sort(); out[y * w + x] = a[kk >> 1]; } }
    return out;
  }
  function _ccMedian(arr) { const a = Float32Array.from(arr).sort(); const n = a.length; return n % 2 ? a[(n - 1) >> 1] : 0.5 * (a[n / 2 - 1] + a[n / 2]); }
  function _ccStarMasks(L, w, h) {
    const n = w * h;
    const dds = Math.min(h, w) >= 256 ? 4 : 1;
    let bg;
    if (dds > 1) {
      const dw = Math.max(1, Math.round(w / dds)), dh = Math.max(1, Math.round(h / dds));
      const Lds = window.Resample.resizeBilinear(L, w, h, dw, dh);
      const bgds = _ccMedianFilter(Lds, dw, dh, Math.max(3, Math.floor(11 / dds)));
      bg = window.Resample.resizeBilinear(bgds, dw, dh, w, h);
    } else {
      bg = _ccMedianFilter(L, w, h, 11);
    }
    const stars = new Float32Array(n);
    let mean = 0;
    for (let i = 0; i < n; i++) { const d = L[i] - bg[i]; stars[i] = d > 0 ? d : 0; mean += L[i]; }
    mean /= n;
    let sd = 0; for (let i = 0; i < n; i++) { const d = L[i] - mean; sd += d * d; } sd = Math.sqrt(sd / n);
    const thr = _ccMedian(L) + 1.2 * sd;
    const sm = new Float32Array(n);
    for (let i = 0; i < n; i++) sm[i] = stars[i] > thr ? stars[i] : 0;
    let dil;
    if (dds > 1) {
      const dw = Math.max(1, Math.round(w / dds)), dh = Math.max(1, Math.round(h / dds));
      const smds = window.Resample.resizeBilinear(sm, w, h, dw, dh);
      const smdd = _ccGaussBlur1(_ccMaxFilter(smds, dw, dh, Math.max(3, Math.floor(15 / dds))), dw, dh, 2.0 / dds);
      dil = window.Resample.resizeBilinear(smdd, dw, dh, w, h);
    } else {
      dil = _ccGaussBlur1(_ccMaxFilter(sm, w, h, 15), w, h, 2.0);
    }
    let mx = 0; for (let i = 0; i < n; i++) if (dil[i] > mx) mx = dil[i];
    if (mx > 0) for (let i = 0; i < n; i++) { let v = dil[i] / mx; dil[i] = v > 1 ? 1 : (v < 0 ? 0 : v); }
    const base = _ccGaussBlur1(sm, w, h, 1.5);
    let mb = 0; for (let i = 0; i < n; i++) if (base[i] > mb) mb = base[i];
    if (mb > 0) for (let i = 0; i < n; i++) { let v = base[i] / mb; base[i] = v > 1 ? 1 : (v < 0 ? 0 : v); }
    return { base, dil };
  }
  // Lucy-Richardson en JS (PSF gaussiana sigma 1.2, 5 iter; fftconvolve(x,gauss) == blur gaussiano).
  // Fallback defensivo SIN IA dentro de computeCosmicDeconBlend (se usaba en el retirado
  // "Standard Deconvolution"; cosmic_ia siempre aporta el canal estelar por IA).
  function _ccLucyRichardson(src, w, h) {
    const n = w * h, decon = Float32Array.from(src);
    for (let it = 0; it < 5; it++) {
      const conv = _ccGaussBlur1(decon, w, h, 1.2);
      const rel = new Float32Array(n);
      for (let i = 0; i < n; i++) { const c = conv[i] < 1e-10 ? 1e-10 : conv[i]; rel[i] = src[i] / c; }
      const corr = _ccGaussBlur1(rel, w, h, 1.2);
      for (let i = 0; i < n; i++) { let v = decon[i] * corr[i]; decon[i] = v < 0 ? 0 : (v > 1 ? 1 : v); }
    }
    return decon;
  }
  // Sustituye a apply_cosmic_clarity_decon (Pyodide). Maneja la mezcla IA de cosmic_ia
  // (stellar/nonstellar_ai). Las ramas sin IA quedan como fallback defensivo.
  function computeCosmicDeconBlend(srcImg, stellarAi, nonstellarAi, mode, stellarAmt, nsStrength, nsAmount) {
    const w = srcImg.w, h = srcImg.h, n = w * h, nc = srcImg.nc;
    const isColor = srcImg.isColor && nc >= 3;
    const cl = (v) => v < 0 ? 0 : (v > 1 ? 1 : v);
    const doStellar = (mode === "both" || mode === "stellar") && stellarAmt > 0.01;
    const doNS = (mode === "both" || mode === "nonstellar") && nsAmount > 0.01;
    const nsSigma = Math.max(0.5, Math.min(5.0, nsStrength / 2.0));
    if (isColor) {
      const ch = srcImg.ch;
      const L = new Float32Array(n);
      for (let i = 0; i < n; i++) L[i] = (ch[0][i] + ch[1][i] + ch[2][i]) / 3;
      const { base, dil } = _ccStarMasks(L, w, h);
      const ratio = new Float32Array(n);
      if (doStellar) {
        let deconL;
        if (stellarAi) { deconL = new Float32Array(n); for (let i = 0; i < n; i++) deconL[i] = (stellarAi[0][i] + stellarAi[1][i] + stellarAi[2][i]) / 3; }
        else { deconL = _ccLucyRichardson(L, w, h); }
        for (let i = 0; i < n; i++) {
          const a = base[i] * stellarAmt;
          const sL = L[i] * (1 - a) + deconL[i] * a;
          let r = L[i] > 1e-6 ? sL / (L[i] + 1e-10) : 1.0; ratio[i] = r > 5 ? 5 : (r < 0 ? 0 : r);
        }
      } else { ratio.fill(1.0); }
      const out = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
      for (let c = 0; c < 3; c++) for (let i = 0; i < n; i++) out[c][i] = cl(ch[c][i] * ratio[i]);
      if (doNS) {
        for (let c = 0; c < 3; c++) {
          const neb = _ccGaussReduced(ch[c], w, h, 6.0, 4);
          let mxn = 0; for (let i = 0; i < n; i++) if (neb[i] > mxn) mxn = neb[i];
          const inv = 2.0 / (mxn + 1e-6);
          const blurC = nonstellarAi ? null : _ccGaussBlur1(ch[c], w, h, nsSigma);
          for (let i = 0; i < n; i++) {
            let d;
            if (nonstellarAi) { d = cl(nonstellarAi[c][i]) - ch[c][i]; if (dil[i] > 0.01 && d < 0) d = 0; }
            else { d = ch[c][i] - blurC[i]; }
            let nm = neb[i] * inv; nm = nm > 1 ? 1 : (nm < 0 ? 0 : nm);
            out[c][i] = cl(out[c][i] + nsAmount * d * (1 - base[i]) * nm);
          }
        }
      }
      return { ch: out, w, h, nc, isColor: true };
    } else {
      const cv = srcImg.ch[0];
      const { base, dil } = _ccStarMasks(cv, w, h);
      const out = new Float32Array(n);
      if (doStellar) {
        const deconCh = stellarAi ? null : _ccLucyRichardson(cv, w, h);
        for (let i = 0; i < n; i++) { const a = base[i] * stellarAmt; const dec = stellarAi ? cl(stellarAi[0][i]) : deconCh[i]; out[i] = cv[i] * (1 - a) + dec * a; }
      } else { out.set(cv); }
      if (doNS) {
        const neb = _ccGaussReduced(cv, w, h, 6.0, 4);
        let mxn = 0; for (let i = 0; i < n; i++) if (neb[i] > mxn) mxn = neb[i];
        const inv = 2.0 / (mxn + 1e-6);
        const blurC = nonstellarAi ? null : _ccGaussBlur1(cv, w, h, nsSigma);
        for (let i = 0; i < n; i++) {
          let d;
          if (nonstellarAi) { d = cl(nonstellarAi[0][i]) - cv[i]; if (dil[i] > 0.01 && d < 0) d = 0; }
          else { d = cv[i] - blurC[i]; }
          let nm = neb[i] * inv; nm = nm > 1 ? 1 : (nm < 0 ? 0 : nm);
          out[i] = cl(out[i] + nsAmount * d * (1 - base[i]) * nm);
        }
      } else {
        for (let i = 0; i < n; i++) out[i] = cl(out[i]);
      }
      return { ch: [out], w, h, nc, isColor: false };
    }
  }
  // COSMIC-DECON-BLEND-JS-END

  // STAT-STRETCH-JS-BEGIN
  // Port a JS del Statistical Stretch de Seti Astro (antes en Pyodide/stretch.py). Mismo algoritmo:
  // por canal -> MAD robusto, punto de negro a sigma*MAD, normaliza [0,1], y MTF para llevar la
  // mediana al objetivo. Sin Pyodide (sin descargar el runtime ni OOM), como las demás operaciones JS.
  // V2 (Fase 4): la matemática vive en ImgOps.computeStatisticalStretch (imgops.js), compartida
  // con el Web Worker; aquí queda el delegado para los llamadores existentes.
  function computeStatisticalStretchJS(srcImg, target, sigma) {
    return window.ImgOps.computeStatisticalStretch(srcImg, target, sigma);
  }
  // Star Stretch = Statistical Stretch + correccion gamma por canal para preservar el color estelar.
  function computeStarStretchJS(srcImg, target, sigma, colorPreservation) {
    const res = computeStatisticalStretchJS(srcImg, target, sigma);
    if (res.isColor && res.nc >= 3) {
      const n = res.w * res.h;
      for (let c = 0; c < res.nc; c++) {
        const ch = res.ch[c];
        for (let i = 0; i < n; i++) { let v = Math.pow(ch[i], colorPreservation); ch[i] = v < 0 ? 0 : (v > 1 ? 1 : v); }
      }
    }
    return res;
  }
  // SCNR Green (Subtractive Chrominance Noise Reduction): el verde no supera al max(R,B) (con amount).
  function computeScnrGreenJS(srcImg, amount) {
    if (!srcImg.isColor || srcImg.nc < 3) return srcImg;
    const n = srcImg.w * srcImg.h, r = srcImg.ch[0], g = srcImg.ch[1], b = srcImg.ch[2];
    const ng = new Float32Array(n);
    for (let i = 0; i < n; i++) { const maxRB = r[i] > b[i] ? r[i] : b[i]; ng[i] = g[i] > maxRB ? g[i] - amount * (g[i] - maxRB) : g[i]; }
    return { ch: [Float32Array.from(r), ng, Float32Array.from(b)], w: srcImg.w, h: srcImg.h, nc: srcImg.nc, isColor: true };
  }
  // STAT-STRETCH-JS-END

  // sobre srcImg, leyendo los parámetros actuales de la UI. Reutilizado por "Probar" y "Comparar".
  async function computeDeconv(algo, srcImg) {
    if (algo === "rl_auto") return computeRLDeconv(srcImg);
    if (algo === "cs_ia_beta") return await computeDeconvAI(srcImg);
    const lang = document.documentElement.lang || "es";
    const mode = el("selCcSharpenMode").value;
    const stellarAmt = parseFloat(el("sldCcStellarAmt").value);
    const nsStrength = parseFloat(el("sldCcNsStrength").value);
    const nsAmount = parseFloat(el("sldCcNsAmount").value);
    let stellarAiCh = null;
    let nonstellarAiCh = null;

    if (algo === "cosmic_ia") {
      // DECON-STRETCH-BEGIN: el modelo Cosmic Clarity está entrenado con datos ESTIRADOS.
      // Estiramos srcImg (MTF a mediana objetivo ~0.25), inferimos, y deshacemos el estirado
      // (MTF inverso con midtone 1-m, propiedad auto-inversa de la MTF) para devolver la salida
      // al dominio lineal del blend.
      const _lumCh = (srcImg.isColor && srcImg.nc >= 2) ? srcImg.ch[1] : srcImg.ch[0];
      const _med = fastSampledMedian(_lumCh);
      const _mMid = optMadMidtone(_med, 0, 0.25);
      const _mtf = (m, x) => { const d = (2 * m - 1) * x - m; if (Math.abs(d) < 1e-12) return x; const v = (m - 1) * x / d; return v < 0 ? 0 : (v > 1 ? 1 : v); };
      const _stretchChans = (chans, m) => chans.map((src) => { const dst = new Float32Array(src.length); for (let i = 0; i < src.length; i++) dst[i] = _mtf(m, src[i]); return dst; });
      const stretchedSrc = { w: srcImg.w, h: srcImg.h, nc: srcImg.nc, isColor: srcImg.isColor, ch: _stretchChans(srcImg.ch, _mMid) };
      const _unstretch = (chans) => _stretchChans(chans, 1 - _mMid);
      // DECON-STRETCH-END
      // ONNX-ENGINE-REF-BEGIN
      if ((mode === "both" || mode === "stellar") && stellarAmt > 0.01) {
        showLoader(lang === "es" ? "Cargando modelo de estrellas IA..." : "Loading AI stellar model...");
        const session = await window.OnnxEngine.loadSession(resolveCosmicModelUrl(STELLAR_MODEL_URL), {}, (p) => {
          showLoader(lang === "es" ? `Descargando modelo de estrellas: ${(p * 100).toFixed(0)}%` : `Downloading stellar model: ${(p * 100).toFixed(0)}%`);
        });
        showLoader(lang === "es" ? "Procesando estrellas por IA..." : "Processing stars via AI...");
        stellarAiCh = _unstretch(await window.OnnxEngine.runOnnxModelTiled(session, stretchedSrc, { tileSize: 256, fixedTile: 256, overlap: 32,
          onProgress: (done, total) => showLoader((lang === "es" ? "Procesando estrellas por IA: " : "Processing stars via AI: ") + Math.round(done / Math.max(1, total) * 100) + "%") }));
      }
      if ((mode === "both" || mode === "nonstellar") && nsAmount > 0.01) {
        let modelKey = "radius_2";
        if (nsStrength <= 1.5) modelKey = "radius_1";
        else if (nsStrength <= 3.0) modelKey = "radius_2";
        else if (nsStrength <= 6.0) modelKey = "radius_4";
        else modelKey = "radius_8";
        const nonstellarUrl = NONSTELLAR_MODEL_URLS[modelKey];
        showLoader(lang === "es" ? `Cargando modelo de nebulosa IA (${modelKey})...` : `Loading AI nebula model (${modelKey})...`);
        const session = await window.OnnxEngine.loadSession(resolveCosmicModelUrl(nonstellarUrl), {}, (p) => {
          showLoader(lang === "es" ? `Descargando modelo de nebulosa: ${(p * 100).toFixed(0)}%` : `Downloading nebula model: ${(p * 100).toFixed(0)}%`);
        });
        showLoader(lang === "es" ? "Procesando nebulosa por IA..." : "Processing nebula via AI...");
        nonstellarAiCh = _unstretch(await window.OnnxEngine.runOnnxModelTiled(session, stretchedSrc, { tileSize: 256, fixedTile: 256, overlap: 32,
          onProgress: (done, total) => showLoader((lang === "es" ? "Procesando nebulosa por IA: " : "Processing nebula via AI: ") + Math.round(done / Math.max(1, total) * 100) + "%") }));
      }
      // ONNX-ENGINE-REF-END
    }

    // COSMIC-DECON en JS (sin Pyodide). cosmic_ia usa stellar/nonstellar_ai (IA).
    if (algo === "cosmic_ia") {
      showLoader(lang === "es" ? "Mezcla final (JS)..." : "Final blending (JS)...");
      return computeCosmicDeconBlend(srcImg, stellarAiCh, nonstellarAiCh, mode, stellarAmt, nsStrength, nsAmount);
    }
    throw new Error("Algoritmo de deconvolución desconocido: " + algo);
  }
  // DECON-COMPUTE-END

  // Event Listener para Deconvolución — "Probar" (preview no destructivo; commit en botón grande)
  el("btnApplyDecon").addEventListener("click", () => {
    if (!state.activeImage) return;
    const lang = document.documentElement.lang || "es";
    const algo = el("selDeconAlgo").value;
    showLoader(lang === "es" ? "Iniciando deconvolución..." : "Starting deconvolution...");
    setTimeout(async () => {
      try {
        const srcImg = state.stepInputImage || state.activeImage;
        let res;
        try {
          res = await computeDeconv(algo, srcImg);
        } catch (err) {
          if (algo !== "rl_auto") {
            logConsole(lang === "es" ? `Fallo en ${algo}. Reintentando con Richardson-Lucy (clásica, rápida) automáticamente...` : `${algo} failed. Retrying with Richardson-Lucy (classic, fast) automatically...`, "warn");
            res = await computeDeconv("rl_auto", srcImg);
          } else {
            throw err;
          }
        }
        // CALIB-PREVIEW: preview no destructivo (commit en "Aplicar Deconvolución")
        previewActiveImage(res, srcImg, "Deconvolution");
        // CS IA Deconvolution devuelve imagen LINEAL -> activar AutoSTF para que el
        // resultado no se vea negro (igual que Background/Gradiente).
        if (algo === "cs_ia_beta") {
          state.screenStretchMode = true;
          const stfBtn = el("btnToolAutoSTF");
          if (stfBtn) stfBtn.classList.add("active");
        }
        render();
        drawHistogram();
        logConsole(lang === "es" ? "Vista previa de deconvolución (Probar). Pulsa 'Aplicar Deconvolución' para confirmar." : "Deconvolution preview (Test). Press 'Apply Deconvolve' to commit.", "info");
      } catch (e) {
        logConsole(`Error en Deconvolución: ${e.message}`, "err");
      } finally {
        hideLoader();
      }
    }, 50);
  });

  // DECON-COMPARE-BEGIN
  // "Comparar": corre Standard y Cosmic Clarity IA con los parámetros actuales sobre la Imagen
  // Inicial y guarda cada resultado en un Slot de Memoria (1-2). No commitea.
  if (el("btnCompareDecon")) {
    el("btnCompareDecon").addEventListener("click", () => {
      if (!state.activeImage) return;
      const lang = document.documentElement.lang || "es";
      showLoader(lang === "es" ? "Comparando deconvoluciones..." : "Comparing deconvolutions...");
      setTimeout(async () => {
        try {
          const srcImg = state.stepInputImage || state.activeImage;
          const variants = [
            { name: "Richardson-Lucy", algo: "rl_auto" },
            { name: "Cosmic Clarity IA", algo: "cosmic_ia" }
          ];
          const results = [];
          for (const v of variants) {
            try {
              results.push({ name: v.name, img: await computeDeconv(v.algo, srcImg) });
            } catch (e) {
              logConsole((lang === "es" ? `${v.name} omitido: ` : `${v.name} skipped: `) + e.message, "warn");
            }
          }
          for (let i = 0; i < results.length; i++) {
            const r = results[i];
            state.imageSlots[i] = cloneImage({ ch: r.img.ch, w: r.img.w, h: r.img.h, nc: r.img.nc, isColor: r.img.isColor, wcs: r.img.wcs || (srcImg && srcImg.wcs) });
            const slotBtn = document.querySelector(`.piw-slot-btn[data-slot="${i + 1}"]`);
            if (slotBtn) {
              slotBtn.classList.add("filled");
              slotBtn.title = "Deconv: " + r.name;
            }
            logConsole(`Slot ${i + 1} ← ${r.name}`, "info");
          }
          updateMixSourceOptions();
          hideLoader();
          logConsole(lang === "es" ? `Comparación lista: ${results.length} en Slots 1-${results.length}. Carga un slot y pulsa 'Aplicar Deconvolución'.` : `Comparison ready: ${results.length} in Slots 1-${results.length}. Load a slot and press 'Apply Deconvolve'.`, "ok");
        } catch (e) {
          hideLoader();
          logConsole(`Error: ${e.message}`, "err");
        }
      }, 50);
    });
  }
  // DECON-COMPARE-END

  // WORK-RES-SELECTOR-BEGIN
  // Selector de resolución de trabajo: ajusta el cap del lado largo (máx 4000). Se aplica a
  // las imágenes que se carguen DESPUÉS de cambiarlo (no re-escala la imagen ya cargada).
  if (el("selWorkRes")) {
    el("selWorkRes").addEventListener("change", (e) => {
      const v = parseInt(e.target.value, 10);
      MAX_PREVIEW_DIM = Math.min(4000, Math.max(500, isNaN(v) ? 2000 : v));
      const lbl = el("valWorkRes");
      if (lbl) lbl.textContent = MAX_PREVIEW_DIM + " px";
      const lang = document.documentElement.lang || "es";
      logConsole(lang === "es"
        ? `Resolución de trabajo: ${MAX_PREVIEW_DIM} px (se aplica al cargar la imagen)`
        : `Working resolution: ${MAX_PREVIEW_DIM} px (applies when loading the image)`, "info");
    });
  }
  // WORK-RES-SELECTOR-END

