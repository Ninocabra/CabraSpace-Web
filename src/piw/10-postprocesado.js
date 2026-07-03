  // --- OPERACIONES DE POST-PROCESADO (TAB 2) ---

  // SCNR Green
  el("btnApplyScnr").addEventListener("click", () => {
    if (!state.activeImage || !state.activeImage.isColor) return;
    const k = parseFloat(el("sldScnrInt").value);
    showLoader("Eliminando cast verde (SCNR)...");

    setTimeout(() => {
      try {
        const srcImg = state.stepInputImage || state.activeImage;
        const img = cloneImage(srcImg);
        const n = img.w * img.h;
        const rCh = img.ch[0];
        const gCh = img.ch[1];
        const bCh = img.ch[2];

        // SCNR Average Neutral
        for (let i = 0; i < n; ++i) {
          const limit = (rCh[i] + bCh[i]) / 2;
          if (gCh[i] > limit) {
            gCh[i] = (1 - k) * gCh[i] + k * limit;
          }
        }

        commitActiveImage(img, "SCNR", srcImg);
        render();
        refreshPathBar();
        logConsole(`SCNR Green aplicado al ${(k*100).toFixed(0)}%`, "info");
      } catch (err) {
        logConsole(`Error en SCNR: ${err.message}`, "err");
      } finally {
        hideLoader();
      }
    }, 50);
  });

  // WEB-WORKER-BEGIN
  let denoiseWorker = null;
  let usmWorker     = null;

  // DENOISE-PATTERN-BEGIN (patrón Preview/Apply/Comparar para Noise Reduction)

  // Habilita los controles de todos los algoritmos de denoise implementados
  document.querySelectorAll('[id^="post-noise-"][id$="-controls"]').forEach((c) => {
    c.classList.remove("piw-disabled-control");
    c.querySelectorAll("input,select").forEach((i) => { i.disabled = false; });
  });

  // Routing de modelos de denoise: en localhost usa scratch/ (los .onnx de terceros no dan CORS;
  // en producción habría que re-hospedarlos con CORS — GATE humano).
  const COSMIC_DENOISE_COLOR_PROD = RELEASE_BASE + "cosmic_denoise_color.onnx";
  const COSMIC_DENOISE_MONO_PROD = RELEASE_BASE + "cosmic_denoise_mono.onnx";
  // DeepSNR simplificado a tile fijo 512 (control-flow plegado): numéricamente IDÉNTICO al
  // deepsnr_v2.onnx original (diff < 2e-7), pero 946 vs 2193 nodos → más rápido, y sin el bug de
  // forma 512/256 que hacía fallar a onnxruntime-web. Subir este .onnx a la Release (GATE humano).
  // ?v=1: esquiva un 404 que quedó cacheado como immutable en el CDN de Vercel para la URL sin
  // query (model.js cachea también las respuestas de error). Distinta clave de caché -> MISS -> 200.
  const DEEPSNR_PROD = RELEASE_BASE + "deepsnr_v2_512.onnx?v=1";
  function resolveDenoiseModel(prodUrl, scratchFile) {
    const host = window.location.hostname;
    return (host === "localhost" || host === "127.0.0.1") ? ("scratch/" + scratchFile) : prodUrl;
  }

  // Opción 2 — worker aislado para DeepSNR (ort-web 1.27 / WebGPU). La página principal sigue en
  // ort 1.19.2: el worker tiene su PROPIO scope global, así que el bump de versión no afecta al
  // resto de la pila IA. Devuelve el array de canales (mismo formato que runOnnxModelTiled). Si el
  // worker o WebGPU fallan, el caller cae a la ruta WASM clásica del hilo principal.
  let __deepsnrWorker = null;
  function runDeepSNRWorker(srcImg, modelUrl, opts, onProgress) {
    return new Promise((resolve, reject) => {
      let worker;
      try {
        if (!__deepsnrWorker) __deepsnrWorker = new Worker("deepsnr-worker.js?v=" + (window.PIW_BUILD || "0"));
        worker = __deepsnrWorker;
      } catch (e) { reject(e); return; }
      const cleanup = () => {
        worker.removeEventListener("message", onMsg);
        worker.removeEventListener("error", onErr);
      };
      const onMsg = (ev) => {
        const m = ev.data;
        if (m.type === "progress") { if (onProgress) onProgress(m.idx, m.total); }
        else if (m.type === "result") { cleanup(); resolve(m.ch); }
        else if (m.type === "error") { cleanup(); __deepsnrWorker = null; reject(new Error(m.message || "worker error")); }
      };
      const onErr = (e) => { cleanup(); __deepsnrWorker = null; reject(new Error(e.message || "worker crash")); };
      worker.addEventListener("message", onMsg);
      worker.addEventListener("error", onErr);
      // Sin lista de transferencia: srcImg.ch se clona (debe sobrevivir para blendDenoise).
      worker.postMessage({ ch: srcImg.ch, w: srcImg.w, h: srcImg.h, nc: srcImg.nc, isColor: srcImg.isColor, modelUrl, opts });
    });
  }
  // Estirado MTF a mediana objetivo 0.25 + su inverso (m -> 1-m). Hace robustos a la luminancia
  // de entrada los modelos SetiAstro (entrenados con datos estirados).
  function piwStretchMidtone(srcImg) {
    const lumCh = (srcImg.isColor && srcImg.nc >= 2) ? srcImg.ch[1] : srcImg.ch[0];
    return optMadMidtone(fastSampledMedian(lumCh), 0, 0.25);
  }
  function piwMtfStretchChans(chans, m) {
    return chans.map((src) => {
      const dst = new Float32Array(src.length);
      for (let i = 0; i < src.length; i++) {
        const x = src[i];
        const d = (2 * m - 1) * x - m;
        let v = Math.abs(d) < 1e-12 ? x : (m - 1) * x / d;
        dst[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
      }
      return dst;
    });
  }

  // Mezcla el resultado denoised con el original según strength (0..1). aiCh = canales del modelo.
  function blendDenoise(srcImg, aiCh, strength) {
    const s = Math.max(0, Math.min(1, strength));
    const out = srcImg.ch.map((src, c) => {
      const ai = aiCh[c] || aiCh[0];
      const dst = new Float32Array(src.length);
      for (let i = 0; i < src.length; i++) {
        let v = src[i] * (1 - s) + ai[i] * s;
        dst[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
      }
      return dst;
    });
    return { ch: out, w: srcImg.w, h: srcImg.h, nc: srcImg.nc, isColor: srcImg.isColor };
  }

  // TV denoise (Rudin-Osher-Fatemi vía Chambolle) por canal. Equivalente clásico a TGV.
  // lambda mayor = más suavizado. Resultado = src - lambda*div(p).
  function tvDenoiseChannel(src, w, h, lambda, iters) {
    const n = w * h;
    const px = new Float32Array(n), py = new Float32Array(n), div = new Float32Array(n);
    const tau = 0.25;
    for (let it = 0; it < iters; it++) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let d = px[i] + py[i];
        if (x > 0) d -= px[i - 1];
        if (y > 0) d -= py[i - w];
        div[i] = d - src[i] / lambda;
      }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const gx = (x < w - 1) ? div[i + 1] - div[i] : 0;
        const gy = (y < h - 1) ? div[i + w] - div[i] : 0;
        const npx = px[i] + tau * gx;
        const npy = py[i] + tau * gy;
        const norm = Math.max(1, Math.sqrt(npx * npx + npy * npy));
        px[i] = npx / norm;
        py[i] = npy / norm;
      }
    }
    const out = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let d = px[i] + py[i];
      if (x > 0) d -= px[i - 1];
      if (y > 0) d -= py[i - w];
      let v = src[i] - lambda * d;
      out[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
    }
    return out;
  }

  function computeTGVDenoise(srcImg) {
    const lumStr = parseFloat(el("sldPostTgvStrengthL").value); // 1..20
    const chrStr = parseFloat(el("sldPostTgvStrengthC").value); // 0..20
    const itSlider = parseInt(el("sldPostTgvIter").value, 10);  // 100..3000
    // Cap de iteraciones (hilo principal; más = bloqueo notable). λ mapeado para efecto visible.
    const iters = Math.max(12, Math.min(40, Math.round(itSlider / 15)));
    const lamL = Math.max(1e-3, lumStr / 50);
    const lamC = Math.max(1e-3, chrStr / 50);
    const w = srcImg.w, h = srcImg.h;
    const out = srcImg.ch.map((ch, c) => {
      const lambda = (srcImg.isColor && srcImg.nc >= 3 && c !== 1 && chrStr > 0) ? lamC : lamL;
      return tvDenoiseChannel(ch, w, h, lambda, iters);
    });
    return { ch: out, w, h, nc: srcImg.nc, isColor: srcImg.isColor };
  }

  // Dispatcher: devuelve la imagen denoised para un algoritmo EXPLÍCITO. Reusado por Preview y Comparar.
  async function computeDenoise(algo, srcImg) {
    const lang = document.documentElement.lang || "es";
    if (algo === "tgv") {
      showLoader(lang === "es" ? "Aplicando TGV Denoise..." : "Applying TGV Denoise...");
      return computeTGVDenoise(srcImg);
    }
    if (algo === "graxpert") {
      // Hilo principal (el worker fallaba al init de WASM; el ORT del hilo principal sí funciona).
      showLoader(lang === "es" ? "Cargando modelo GraXpert Denoise..." : "Loading GraXpert Denoise model...");
      const strength = parseFloat(el("sldPostGraXpertStrength").value);
      const d = await window.GraXpert.computeDenoiseGraXpert(srcImg, { strength }, (idx, total) => {
        const lt = el("piwLoaderText");
        if (lt) lt.textContent = (lang === "es" ? `Procesando mosaico ${idx}/${total}...` : `Processing tile ${idx}/${total}...`);
      });
      return { ch: d.ch, w: d.w, h: d.h, nc: d.nc, isColor: d.isColor };
    }
    if (algo === "cosmic") {
      const isColor = srcImg.isColor && srcImg.nc >= 3;
      showLoader(lang === "es" ? "Cargando Cosmic Clarity Denoise..." : "Loading Cosmic Clarity Denoise...");
      const url = resolveDenoiseModel(isColor ? COSMIC_DENOISE_COLOR_PROD : COSMIC_DENOISE_MONO_PROD,
        isColor ? "cosmic_denoise_color.onnx" : "cosmic_denoise_mono.onnx");
      const session = await window.OnnxEngine.loadSession(url, {}, (p) => {
        showLoader(lang === "es" ? `Descargando modelo: ${(p * 100).toFixed(0)}%` : `Downloading model: ${(p * 100).toFixed(0)}%`);
      });
      showLoader(lang === "es" ? "Procesando Cosmic Clarity Denoise..." : "Processing Cosmic Clarity Denoise...");
      // Estirar -> inferir -> des-estirar (modelo entrenado con datos estirados; robustez a luminancia).
      const m = piwStretchMidtone(srcImg);
      const stretchedSrc = { w: srcImg.w, h: srcImg.h, nc: srcImg.nc, isColor: srcImg.isColor, ch: piwMtfStretchChans(srcImg.ch, m) };
      const aiS = await window.OnnxEngine.runOnnxModelTiled(session, stretchedSrc, { tileSize: 256, fixedTile: 256, overlap: 32, layout: "NCHW",
        onProgress: (done, total) => showLoader((lang === "es" ? "Procesando Cosmic Clarity Denoise: " : "Processing Cosmic Clarity Denoise: ") + Math.round(done / Math.max(1, total) * 100) + "%") });
      const ai = piwMtfStretchChans(aiS, 1 - m);
      return blendDenoise(srcImg, ai, parseFloat(el("sldPostCcnrLuma").value));
    }
    if (algo === "deepsnr") {
      showLoader(lang === "es" ? "Cargando DeepSNR..." : "Loading DeepSNR...");
      const url = resolveDenoiseModel(DEEPSNR_PROD, "deepsnr_v2_512.onnx");
      const dsnrOpts = { tileSize: 512, fixedTile: 512, overlap: 32, layout: "NHWC" };
      const onTile = (idx, total) => {
        const lt = el("piwLoaderText");
        if (lt) lt.textContent = (lang === "es" ? `Procesando mosaico ${idx}/${total}...` : `Processing tile ${idx}/${total}...`);
      };
      let ai;
      try {
        // Worker aislado con ort-web 1.27 → WebGPU (~33ms/tile @256). La página sigue en 1.19.2.
        showLoader(lang === "es" ? "Procesando DeepSNR (WebGPU)..." : "Processing DeepSNR (WebGPU)...");
        ai = await runDeepSNRWorker(srcImg, url, dsnrOpts, onTile);
      } catch (e) {
        // Fallback robusto: ruta clásica en el hilo principal (ort 1.19.2, WASM) si el worker o WebGPU fallan.
        logConsole(lang === "es" ? `DeepSNR: worker no disponible (${e.message}); usando WASM.` : `DeepSNR: worker unavailable (${e.message}); falling back to WASM.`, "warn");
        showLoader(lang === "es" ? "Procesando DeepSNR (WASM)..." : "Processing DeepSNR (WASM)...");
        const session = await window.OnnxEngine.loadSession(url, { executionProviders: ["wasm"] }, (p) => {
          showLoader(lang === "es" ? `Descargando modelo: ${(p * 100).toFixed(0)}%` : `Downloading model: ${(p * 100).toFixed(0)}%`);
        });
        ai = await window.OnnxEngine.runOnnxModelTiled(session, srcImg, dsnrOpts);
      }
      return blendDenoise(srcImg, ai, parseFloat(el("sldPostDeepSNRAmount").value));
    }
    throw new Error(`Algoritmo de denoise desconocido: ${algo}`);
  }

  // "Preview Noise Reduction": preview no destructivo sobre la Imagen Inicial.
  el("btnApplyPostNR").addEventListener("click", () => {
    const srcImg = state.stepInputImage || state.activeImage;
    if (!srcImg) return;
    const algo = el("selPostNoiseAlgo").value;
    const lang = document.documentElement.lang || "es";
    setTimeout(async () => {
      try {
        const res = await computeDenoise(algo, srcImg);
        previewActiveImage(res, srcImg, "Noise Reduction");
        render();
        drawHistogram();
        logConsole(lang === "es" ? "Vista previa de reducción de ruido (Preview). Pulsa 'Apply Denoise' para confirmar." : "Noise reduction preview. Press 'Apply Denoise' to commit.", "info");
      } catch (e) {
        logConsole(`Reducción de ruido: ${e.message}`, "warn");
      } finally {
        hideLoader();
      }
    }, 50);
  });

  // "Comparar": corre los algoritmos disponibles sobre la Imagen Inicial y los guarda en Slots.
  if (el("btnComparePostNR")) {
    el("btnComparePostNR").addEventListener("click", () => {
      const srcImg = state.stepInputImage || state.activeImage;
      if (!srcImg) return;
      const lang = document.documentElement.lang || "es";
      showLoader(lang === "es" ? "Comparando reducciones de ruido..." : "Comparing noise reductions...");
      setTimeout(async () => {
        try {
          const variants = [
            { name: "TGV", algo: "tgv" },
            { name: "GraXpert", algo: "graxpert" },
            { name: "Cosmic Clarity", algo: "cosmic" },
            { name: "DeepSNR", algo: "deepsnr" }
          ];
          const results = [];
          for (const v of variants) {
            try {
              results.push({ name: v.name, img: await computeDenoise(v.algo, srcImg) });
            } catch (e) {
              logConsole((lang === "es" ? `${v.name} omitido: ` : `${v.name} skipped: `) + e.message, "warn");
            }
          }
          for (let i = 0; i < results.length; i++) {
            const r = results[i];
            state.imageSlots[i] = cloneImage({ ch: r.img.ch, w: r.img.w, h: r.img.h, nc: r.img.nc, isColor: r.img.isColor, wcs: srcImg && srcImg.wcs });
            const slotBtn = document.querySelector(`.piw-slot-btn[data-slot="${i + 1}"]`);
            if (slotBtn) { slotBtn.classList.add("filled"); slotBtn.title = "Denoise: " + r.name; }
            logConsole(`Slot ${i + 1} ← ${r.name}`, "info");
          }
          updateMixSourceOptions();
          hideLoader();
          logConsole(lang === "es"
            ? `Comparación lista: ${results.length} en Slots 1-${results.length}. Carga un slot y pulsa 'Apply Denoise'.`
            : `Comparison ready: ${results.length} in Slots 1-${results.length}.`, "ok");
        } catch (e) {
          hideLoader();
          logConsole(`Error: ${e.message}`, "err");
        }
      }, 50);
    });
  }
  // DENOISE-PATTERN-END

  // USM-SHARP-BEGIN
  // SHARPEN-PATTERN: Preview/Apply/Comparar para Enfoque/Detalles.
  // Habilita los controles de los algoritmos de enfoque implementados.
  document.querySelectorAll('[id^="post-sharp-"][id$="-controls"]').forEach((c) => {
    c.classList.remove("piw-disabled-control");
    c.querySelectorAll("input,select").forEach((i) => { i.disabled = false; });
  });

  // --- Helpers de enfoque (clásicos, operan en luminancia para preservar color) ---
  function sharpLum(srcImg) {
    if (srcImg.isColor && srcImg.nc >= 3) {
      const n = srcImg.w * srcImg.h, L = new Float32Array(n);
      const r = srcImg.ch[0], g = srcImg.ch[1], b = srcImg.ch[2];
      for (let i = 0; i < n; i++) L[i] = 0.2126 * r[i] + 0.7152 * g[i] + 0.0722 * b[i];
      return L;
    }
    return Float32Array.from(srcImg.ch[0]);
  }
  function sharpApplyLum(srcImg, Lnew, Lold) {
    const n = srcImg.w * srcImg.h;
    if (!(srcImg.isColor && srcImg.nc >= 3)) {
      return { ch: [Lnew], w: srcImg.w, h: srcImg.h, nc: srcImg.nc, isColor: srcImg.isColor };
    }
    const out = srcImg.ch.map((src) => {
      const dst = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const ratio = Lold[i] > 1e-6 ? Lnew[i] / Lold[i] : 1;
        let v = src[i] * ratio;
        dst[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
      }
      return dst;
    });
    return { ch: out, w: srcImg.w, h: srcImg.h, nc: srcImg.nc, isColor: srcImg.isColor };
  }
  // OPTIMIZACIÓN (HDR/DSE lentos): antes delegaba en window.Sharpening.gaussianBlur, una convolución
  // por fuerza bruta con kernel de radio ceil(3*sigma) — con HDR iterando sigma=2^0..2^(layers-1) el
  // coste por capa crece EXPONENCIALMENTE (radio ~48 con sigma=16, ~1500 con sigma=512...). ImgProc.
  // boxBlur usa una ventana deslizante con suma acumulada: coste CONSTANTE por píxel sea cual sea el
  // radio. Es la misma aproximación (box ≈ gaussiana) que ya usa Detail & Contrast para este mismo
  // propósito (realce multiescala), así que el resultado visual es coherente con el resto de la app.
  function sharpGaussCh(ch, w, h, sigma) {
    return window.ImgProc.boxBlur(ch, w, h, Math.max(1, Math.round(sigma)));
  }

  // HDR Multiscale: descompone L en capas de detalle (à-trous) + residual; realza el detalle.
  function computeSharpHDR(srcImg) {
    const w = srcImg.w, h = srcImg.h;
    const L = sharpLum(srcImg);
    const layers = Math.max(2, Math.min(8, parseInt(el("sldPostHdrLayers").value, 10)));
    const overdrive = parseFloat(el("sldPostHdrOverdrive").value);
    let cur = Float32Array.from(L);
    const details = [];
    for (let s = 0; s < layers; s++) {
      const blur = sharpGaussCh(cur, w, h, Math.pow(2, s));
      const det = new Float32Array(L.length);
      for (let i = 0; i < L.length; i++) det[i] = cur[i] - blur[i];
      details.push(det);
      cur = blur;
    }
    const boost = 1 + overdrive * 1.5;
    const Lnew = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) {
      let v = cur[i];
      for (const det of details) v += det[i] * boost;
      Lnew[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
    }
    return sharpApplyLum(srcImg, Lnew, L);
  }

  // Local Histogram Equalization (equivalente CLAHE): realce de contraste local adaptativo
  // limitado por 'slope' (clip) y mezclado por 'amount'.
  function computeSharpLHE(srcImg) {
    const w = srcImg.w, h = srcImg.h;
    const L = sharpLum(srcImg);
    const radius = Math.max(8, parseInt(el("sldPostLheRadius").value, 10));
    const amount = parseFloat(el("sldPostLheAmount").value);
    const slope = 3.0; // fijo (simplificación de UI)
    const sigma = radius / 3;
    const mean = sharpGaussCh(L, w, h, sigma);
    const L2 = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) L2[i] = L[i] * L[i];
    const mean2 = sharpGaussCh(L2, w, h, sigma);
    const Lnew = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) {
      const std = Math.sqrt(Math.max(1e-6, mean2[i] - mean[i] * mean[i]));
      const gain = Math.min(slope, 1 + amount * 2 / (std + 0.05));
      const enhanced = mean[i] + (L[i] - mean[i]) * gain;
      let v = L[i] * (1 - amount) + enhanced * amount;
      Lnew[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
    }
    return sharpApplyLum(srcImg, Lnew, L);
  }

  // Dark Structure Enhance: oscurece más las estructuras más oscuras que su entorno (polvo, nebulosa oscura).
  function computeSharpDSE(srcImg) {
    const w = srcImg.w, h = srcImg.h;
    const L = sharpLum(srcImg);
    const amount = parseFloat(el("sldPostDseAmount").value);
    const blur = sharpGaussCh(L, w, h, 2.0);
    const Lnew = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) {
      const dark = Math.max(0, blur[i] - L[i]);
      let v = L[i] - amount * dark;
      Lnew[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
    }
    return sharpApplyLum(srcImg, Lnew, L);
  }

  // Dispatcher: devuelve la imagen enfocada para un algoritmo EXPLÍCITO. Reusado por Preview y Comparar.
  async function computeSharpen(algo, srcImg) {
    const lang = document.documentElement.lang || "es";
    if (algo === "usm") {
      showLoader(lang === "es" ? "Aplicando USM Sharpening..." : "Applying USM Sharpening...");
      const opts = {
        sigma: parseFloat(el("sldPostUsmSigma").value),
        amount: parseFloat(el("sldPostUsmAmount").value),
        // Deringing automático fijo (limita halos oscuros/claros sin exponer sliders)
        deringDark: 0.02,
        deringBright: 0.02
      };
      return window.Sharpening.computeUSM(srcImg, opts);
    }
    if (algo === "hdr") {
      showLoader(lang === "es" ? "Aplicando HDR Multiscale..." : "Applying HDR Multiscale...");
      return computeSharpHDR(srcImg);
    }
    if (algo === "lhe") {
      showLoader(lang === "es" ? "Aplicando Local Histogram Eq...." : "Applying Local Histogram Eq....");
      return computeSharpLHE(srcImg);
    }
    if (algo === "dse") {
      showLoader(lang === "es" ? "Aplicando Dark Structure Enhance..." : "Applying Dark Structure Enhance...");
      return computeSharpDSE(srcImg);
    }
    throw new Error(`Algoritmo de enfoque desconocido: ${algo}`);
  }

  // "Preview Enfoque": preview no destructivo sobre la Imagen Inicial.
  el("btnApplyPostSharp").addEventListener("click", () => {
    const srcImg = state.stepInputImage || state.activeImage;
    if (!srcImg) return;
    const algo = el("selPostSharpAlgo").value;
    const lang = document.documentElement.lang || "es";
    setTimeout(async () => {
      try {
        const res = await computeSharpen(algo, srcImg);
        previewActiveImage(res, srcImg, "Sharpening");
        render();
        drawHistogram();
        logConsole(lang === "es" ? "Vista previa de enfoque (Preview). Pulsa 'Aplicar Enfoque' para confirmar." : "Sharpening preview. Press 'Apply Sharpen' to commit.", "info");
      } catch (e) {
        logConsole(`Enfoque: ${e.message}`, "warn");
      } finally {
        hideLoader();
      }
    }, 50);
  });

  // "Comparar": corre los algoritmos disponibles sobre la Imagen Inicial y los guarda en Slots.
  if (el("btnComparePostSharp")) {
    el("btnComparePostSharp").addEventListener("click", () => {
      const srcImg = state.stepInputImage || state.activeImage;
      if (!srcImg) return;
      const lang = document.documentElement.lang || "es";
      showLoader(lang === "es" ? "Comparando enfoques..." : "Comparing sharpening...");
      setTimeout(async () => {
        try {
          const variants = [
            { name: "USM", algo: "usm" },
            { name: "HDR Multiscale", algo: "hdr" },
            { name: "Local Hist. Eq.", algo: "lhe" },
            { name: "Dark Struct.", algo: "dse" }
          ];
          const results = [];
          for (const v of variants) {
            try { results.push({ name: v.name, img: await computeSharpen(v.algo, srcImg) }); }
            catch (e) { logConsole((lang === "es" ? `${v.name} omitido: ` : `${v.name} skipped: `) + e.message, "warn"); }
          }
          for (let i = 0; i < results.length; i++) {
            const r = results[i];
            state.imageSlots[i] = cloneImage({ ch: r.img.ch, w: r.img.w, h: r.img.h, nc: r.img.nc, isColor: r.img.isColor, wcs: srcImg && srcImg.wcs });
            const slotBtn = document.querySelector(`.piw-slot-btn[data-slot="${i + 1}"]`);
            if (slotBtn) { slotBtn.classList.add("filled"); slotBtn.title = "Sharpen: " + r.name; }
            logConsole(`Slot ${i + 1} ← ${r.name}`, "info");
          }
          updateMixSourceOptions();
          hideLoader();
          logConsole(lang === "es"
            ? `Comparación lista: ${results.length} en Slots 1-${results.length}. Carga un slot y pulsa 'Aplicar Enfoque'.`
            : `Comparison ready: ${results.length} in Slots 1-${results.length}.`, "ok");
        } catch (e) {
          hideLoader();
          logConsole(`Error: ${e.message}`, "err");
        }
      }, 50);
    });
  }
  // USM-SHARP-END
  // WEB-WORKER-END

  // CURVES-BEGIN
  // Aplica las curvas actuales (state.curves) a srcImg y devuelve la imagen resultante SIN mutar
  // la entrada. Reutilizado por "Aplicar Curvas" (commit) y por el preview Live.
  // V2 (Fase 4): la matemática vive en ImgOps.computeCurves (imgops.js), compartida con el worker.
  function computeCurvesImage(srcImg) {
    return window.ImgOps.computeCurves(srcImg, { curves: state.curves });
  }

  el("btnApplyPostCurves").addEventListener("click", () => {
    const srcImg = state.stepInputImage || state.activeImage;
    if (!srcImg) return;

    const lang = document.documentElement.lang || "es";
    showLoader(lang === "es" ? "Aplicando curvas..." : "Applying curves...");
    // V2 (Fase 4): resolución completa en el Web Worker (fallback CPU si el worker falla).
    applyImgOp("curves", srcImg, { curves: state.curves }, "Curves", () => computeCurvesImage(srcImg));
  });
  // CURVES-END

  // COLOR-WHEEL-BEGIN
  // Params PLANOS (serializables) del balance de color leídos de los controles: multiplicadores
  // RGB + saturación + SCNR (scnrAmt 0 = desactivado). Los usan ImgOps.computeColorBalance en el
  // hilo principal (Live) y el Web Worker (Aplicar a resolución completa).
  function getColorBalanceParams() {
    const doScnr = !!(el("chkPostBalanceSCNR") && el("chkPostBalanceSCNR").checked);
    return {
      rMult:   parseFloat(el("sldPostBalanceR").value),
      gMult:   parseFloat(el("sldPostBalanceG").value),
      bMult:   parseFloat(el("sldPostBalanceB").value),
      satMult: parseFloat(el("sldPostBalanceSat").value),
      scnrAmt: doScnr ? parseFloat(el("sldPostBalanceSCNR").value) : 0
    };
  }
  // Aplica el balance de color actual a srcImg SIN mutar la entrada. Reutilizado por "Aplicar
  // Balance" (commit) y por el preview Live.
  // V2 (Fase 4): la matemática vive en ImgOps.computeColorBalance (imgops.js), compartida con el worker.
  function computeColorBalanceImage(srcImg) {
    return window.ImgOps.computeColorBalance(srcImg, getColorBalanceParams());
  }

  el("btnApplyPostColor").addEventListener("click", () => {
    if (!state.activeImage) return;
    const lang = document.documentElement.lang || "es";

    const p = getColorBalanceParams();
    if (p.rMult === 1 && p.gMult === 1 && p.bMult === 1 && p.satMult === 1 && !p.scnrAmt) {
      logConsole(lang === "es" ? "Balance de color: ajuste neutro, sin cambios." : "Color balance: neutral adjustment, no changes.", "info");
      return;
    }

    showLoader(lang === "es" ? "Aplicando balance de color..." : "Applying color balance...");
    const srcImg = state.stepInputImage || state.activeImage;
    logConsole(`Balance de color: R×${p.rMult.toFixed(3)} G×${p.gMult.toFixed(3)} B×${p.bMult.toFixed(3)} Sat×${p.satMult.toFixed(2)}${p.scnrAmt ? ` + SCNR(${(p.scnrAmt*100).toFixed(0)}%)` : ""}`, "info");
    // V2 (Fase 4): resolución completa en el Web Worker (fallback CPU si el worker falla).
    applyImgOp("colorBalance", srcImg, p, "Color Balance", () => window.ImgOps.computeColorBalance(srcImg, p));
  });
  // COLOR-WHEEL-END

  // MASK-USE-HINT: al marcar "Usar máscara activa" sin una máscara generada/cargada, avisar (si no,
  // el usuario cree que no funciona). La mezcla real se hace en previewActiveImage/commitActiveImage.
  ["chkPostNRUseMask", "chkPostSharpUseMask", "chkPostColorUseMask", "chkPostCurvesUseMask"].forEach((id) => {
    const c = el(id);
    if (!c) return;
    c.addEventListener("change", () => {
      if (!c.checked) return;
      const img = state.activeImage;
      const ok = state.activeMask && img && state.activeMask.length === img.w * img.h;
      const lang = document.documentElement.lang || "es";
      if (!ok) showToast(lang === "es"
        ? "No hay máscara activa: genérala o cárgala (sección Máscara / slots M) para que surta efecto."
        : "No active mask: generate or load one (Mask section / M slots) for it to take effect.", "err");
    });
  });

  // LIVE-PREVIEW-BEGIN
  // Preview Live de Color Balance y Curvas: con el checkbox "Live" marcado, cada cambio en los
  // controles muestra el efecto sobre la imagen en tiempo real (preview NO destructivo desde la
  // Imagen Inicial del menú). El commit real lo sigue haciendo "Aplicar". Se limita a un cálculo
  // por frame (requestAnimationFrame) para coalescer arrastres rápidos de sliders/rueda.
  let _livePreviewFn = null, _livePreviewRAF = 0;
  function scheduleLivePreview(fn) {
    _livePreviewFn = fn;
    if (_livePreviewRAF) return;
    _livePreviewRAF = requestAnimationFrame(() => {
      _livePreviewRAF = 0;
      const f = _livePreviewFn; _livePreviewFn = null;
      if (f) { try { f(); } catch (e) { console.warn("Live preview:", e); } }
    });
  }
  // PROXY-PROBAR-BEGIN (Fase 4 V1)
  // Proxy de BAJA RESOLUCIÓN (lado largo ≤ 1000 px, promediado por área) por imagen fuente,
  // cacheado por referencia (WeakMap; se libera solo con la imagen). Lo usan el preview Live y
  // los "Probar" no-IA de operaciones GLOBALES (gradiente, calibración, estirados), donde el
  // resultado a ~1 MP es visualmente representativo. Las operaciones a escala de píxel
  // (deconv/denoise/sharpen) NO usan proxy: a baja resolución mienten (un radio de 2 px no
  // significa lo mismo tras reescalar).
  const PROXY_MAX_DIM = 1000;
  const _proxyCache = new WeakMap();
  function getProxyOf(img) {
    if (!img || Math.max(img.w, img.h) <= PROXY_MAX_DIM) return null; // ya es pequeña: sin proxy
    let p = _proxyCache.get(img);
    if (!p) {
      const capped = window.AutoGHS.capChannels(img.ch, img.w, img.h, img.nc, PROXY_MAX_DIM);
      p = { ch: capped.ch, w: capped.w, h: capped.h, nc: img.nc, isColor: img.isColor };
      _proxyCache.set(img, p);
    }
    return p;
  }
  // "Probar" en dos fases: 1) cálculo INSTANTÁNEO sobre el proxy, mostrado como preview marcado
  // con img._proxy; 2) recomputo a resolución COMPLETA (computeFn puede devolver una promesa,
  // p. ej. del Web Worker) que reemplaza el preview al terminar. commitPreview (botón grande
  // "Aplicar") espera al full-res pendiente y NUNCA commitea un proxy (véase updateBigApply).
  // computeFn(img) recibe el proxy o srcImg; extraFn (opcional) corre tras cada preview.
  // BUSY-BADGE: letrero sobre el visor mientras un cómputo sigue en marcha (p. ej. el refinado a
  // resolución completa tras el proxy, que antes corría en silencio y el usuario no sabía si el
  // procesado había terminado). Se limpia siempre en finish().
  let _busyBadge = null;
  function showBusyBadge(text) {
    if (!_busyBadge) {
      _busyBadge = document.createElement("div");
      _busyBadge.id = "piwBusyBadge";
      _busyBadge.className = "piw-busy-badge";
      (el("canvasContainer") || document.body).appendChild(_busyBadge);
    }
    _busyBadge.textContent = "⏳ " + text;
    _busyBadge.style.display = "block";
  }
  function hideBusyBadge() { if (_busyBadge) _busyBadge.style.display = "none"; }

  let _proxySeq = 0;
  let _proxyPendingFull = null;
  async function previewProxyThenFull(srcImg, stageLabel, computeFn, extraFn) {
    const job = ++_proxySeq;
    // La promesa "pendiente" se publica ANTES de cualquier fase para que un "Aplicar" que llegue
    // en cualquier momento del Probar (incluso con el proxy recién pintado) siempre la encuentre
    // y espere al full-res, en vez de creer que no hay nada en marcha.
    let _resolveDone;
    const done = new Promise((r) => { _resolveDone = r; });
    _proxyPendingFull = done;
    const finish = () => { if (_proxyPendingFull === done) _proxyPendingFull = null; _resolveDone(); };
    try {
      const small = getProxyOf(srcImg);
      if (small) {
        try {
          const resS = await computeFn(small);
          if (job !== _proxySeq) return;
          const pv = previewActiveImage(resS, srcImg, stageLabel);
          pv._proxy = true;
          if (extraFn) extraFn(true);
          hideLoader(); // el usuario ya ve el resultado; el full-res sigue en segundo plano
          const langB = document.documentElement.lang || "es";
          showBusyBadge(langB === "es" ? `Procesando ${stageLabel} a resolución completa…` : `Processing ${stageLabel} at full resolution…`);
          render();
          drawHistogram();
        } catch (e) {
          console.warn("Proxy Probar:", e); // el proxy es solo feedback; el full-res sigue
        }
        await new Promise((r) => setTimeout(r, 30)); // deja pintar el proxy antes del cómputo pesado
        if (job !== _proxySeq) return;
      }
      try {
        const resF = await computeFn(srcImg);
        if (job !== _proxySeq) return;
        previewActiveImage(resF, srcImg, stageLabel);
        if (extraFn) extraFn(false);
        render();
        drawHistogram();
        // Aviso claro de FIN: el usuario sabe que el resultado que ve ya es el definitivo.
        const langF = document.documentElement.lang || "es";
        logConsole(langF === "es" ? `${stageLabel}: listo (resolución completa)` : `${stageLabel}: done (full resolution)`, "ok");
      } catch (e) {
        if (job === _proxySeq) {
          const lang = document.documentElement.lang || "es";
          logConsole((lang === "es" ? "Error a resolución completa: " : "Full-resolution error: ") + (e && e.message ? e.message : e), "err");
        }
      }
    } finally {
      if (job === _proxySeq) hideBusyBadge();
      finish();
    }
  }
  // PROXY-PROBAR-END

  // Fuente REDUCIDA de la Imagen Inicial: mismo proxy cacheado que usan los "Probar" —
  // computar curvas/balance sobre ~1 MP en vez de 16-36 MP hace el Live realmente instantáneo.
  function _getLiveSmallSrc() {
    const base = state.stepInputImage;
    if (!base) return null;
    return getProxyOf(base) || base;
  }
  // Motor Live común: 1) preview instantáneo en baja resolución (coalescido a 1/frame);
  //                   2) al quedar quieto ~220 ms, recalcula a resolución COMPLETA para una vista
  //                      nítida — en el Web Worker si la op lo soporta (workerSpec), con fallback CPU.
  let _liveSettleTimer = 0, _liveJobSeq = 0;
  function _runLive(chkId, computeFn, label, workerSpec) {
    const chk = el(chkId);
    if (!chk || !chk.checked) return;
    const full = state.stepInputImage;
    if (!full) return;
    const job = ++_liveJobSeq;
    const small = _getLiveSmallSrc() || full;
    scheduleLivePreview(() => {
      const pv = previewActiveImage(computeFn(small), full, label);
      if (small !== full) pv._proxy = true; // nunca commitear el preview de baja resolución
      render();
    });
    if (_liveSettleTimer) clearTimeout(_liveSettleTimer);
    _liveSettleTimer = setTimeout(() => {
      _liveSettleTimer = 0;
      const stillValid = () => job === _liveJobSeq && chk.checked && state.stepInputImage === full;
      if (!stillValid()) return;
      const spec = workerSpec ? workerSpec() : null;
      if (spec) {
        runImgWorker(spec.op, full, spec.params)
          .then((res) => { if (!stillValid()) return; previewActiveImage(res, full, label); render(); })
          .catch(() => { if (!stillValid()) return; previewActiveImage(computeFn(full), full, label); render(); });
      } else {
        previewActiveImage(computeFn(full), full, label);
        render();
      }
    }, 220);
  }
  function livePreviewCurves() { _runLive("chkPostCurvesLive", computeCurvesImage, "Curves", () => ({ op: "curves", params: { curves: state.curves } })); }
  function livePreviewColorBalance() { _runLive("chkPostColorBalanceLive", computeColorBalanceImage, "Color Balance", () => ({ op: "colorBalance", params: getColorBalanceParams() })); }
  // Al (des)marcar Live: si se activa, muestra el preview ya; si se desactiva, descarta el preview
  // no aplicado y vuelve a la Imagen Inicial del menú (para no dejar un preview "pegado").
  {
    const chkCurvesLive = el("chkPostCurvesLive");
    if (chkCurvesLive) chkCurvesLive.addEventListener("change", () => {
      if (chkCurvesLive.checked) livePreviewCurves();
      else if (state.stepInputImage) { state.activeImage = state.stepInputImage; render(); }
    });
    const chkColorLive = el("chkPostColorBalanceLive");
    if (chkColorLive) chkColorLive.addEventListener("change", () => {
      if (chkColorLive.checked) livePreviewColorBalance();
      else if (state.stepInputImage) { state.activeImage = state.stepInputImage; render(); }
    });
  }
  // LIVE-PREVIEW-END

  // Rueda de color en Color Mask
  const wheel = el("maskColorWheel");
  const wheelIndicator = el("maskWheelIndicator");

  // HUE-WHEEL-FIX: la rueda CSS es un conic-gradient(red,yellow,lime,cyan,blue,magenta,red), que por
  // definición del propio conic-gradient arranca ARRIBA (12 en punto = 0°) y gira en sentido horario
  // (red=0°, yellow=60°, lime=120°, cyan=180°, blue=240°, magenta=300°, igual que el hue HSL estándar
  // usado para generar la máscara). Pero Math.atan2(y,x) mide el ángulo con 0°=DERECHA (3 en punto),
  // no arriba: al clicar sobre el rojo visual (arriba) se capturaba hue=270 en vez de 0, y el
  // indicador nunca coincidía con el hue real de la máscara ("el tono se capta pero no el ángulo").
  // Conversión: hue_visual = atan2(0°=arriba) = atan2(0°=derecha) + 90°, y su inversa -90°.
  wheel.addEventListener("click", (e) => {
    const rect = wheel.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;

    // Ángulo en coordenadas de pantalla (0°=derecha) → hue visual de la rueda (0°=arriba, horario)
    let screenAngle = Math.atan2(y, x) * (180 / Math.PI);
    let hue = screenAngle + 90;
    hue = ((hue % 360) + 360) % 360;

    state.selectedHue = Math.round(hue);
    el("sldMaskHue").value = state.selectedHue;
    el("valMaskHue").textContent = state.selectedHue + "°";

    // Mover indicador exactamente donde se hizo clic (mismo ángulo de pantalla, sin convertir)
    const rad = Math.min(rect.width / 2 - 10, Math.sqrt(x*x + y*y));
    const radAngle = screenAngle * (Math.PI / 180);
    const indX = rect.width / 2 + rad * Math.cos(radAngle);
    const indY = rect.height / 2 + rad * Math.sin(radAngle);

    wheelIndicator.style.left = indX + "px";
    wheelIndicator.style.top = indY + "px";
    livePreviewMask();
  });

  el("sldMaskHue").addEventListener("input", (e) => {
    state.selectedHue = parseInt(e.target.value, 10);
    el("valMaskHue").textContent = state.selectedHue + "°";

    // Mover indicador: inverso de la conversión de arriba (hue visual → ángulo de pantalla)
    const rect = wheel.getBoundingClientRect();
    const screenAngle = state.selectedHue - 90;
    const rad = rect.width / 2 - 12;
    const radAngle = screenAngle * (Math.PI / 180);
    const indX = rect.width / 2 + rad * Math.cos(radAngle);
    const indY = rect.height / 2 + rad * Math.sin(radAngle);
    
    wheelIndicator.style.left = indX + "px";
    wheelIndicator.style.top = indY + "px";
  });

