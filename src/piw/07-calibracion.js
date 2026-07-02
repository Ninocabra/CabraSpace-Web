  // --- OPERACIONES DE PRE-PROCESADO (TAB 0) ---

  // Auto Linear Fit helper function
  // CALIB-COMPUTE-BEGIN
  // Funciones puras por método de calibración (devuelven la imagen corregida) para reusar
  // tanto en el preview de cada card como en "Comparar Métodos", sin duplicar la matemática.
  function computeLinearFit(srcImg) {
    const img = cloneImage(srcImg);
    const n = img.w * img.h;
    const refCh = img.ch[1];
    const refStats = AutoGHS.medianMAD(refCh, n, 200000);
    for (let c of [0, 2]) {
      const tgtCh = img.ch[c];
      const tgtStats = AutoGHS.medianMAD(tgtCh, n, 200000);
      if (tgtStats.sigma > 1e-6) {
        const scale = refStats.sigma / tgtStats.sigma;
        for (let i = 0; i < n; ++i) {
          const val = (tgtCh[i] - tgtStats.median) * scale + refStats.median;
          tgtCh[i] = val < 0 ? 0 : (val > 1 ? 1 : val);
        }
      }
    }
    return img;
  }

  function computeOptimalTransport(srcImg) {
    const img = cloneImage(srcImg);
    const n = img.w * img.h;
    const refCh = img.ch[1];
    const numBins = 65536;
    const refHist = new Float64Array(numBins);
    for (let i = 0; i < n; i++) {
      const bin = Math.min(numBins - 1, Math.max(0, Math.floor(refCh[i] * (numBins - 1))));
      refHist[bin]++;
    }
    const refCDF = new Float64Array(numBins);
    refCDF[0] = refHist[0] / n;
    for (let b = 1; b < numBins; b++) refCDF[b] = refCDF[b - 1] + refHist[b] / n;
    for (const c of [0, 2]) {
      const tgtCh = img.ch[c];
      const tgtHist = new Float64Array(numBins);
      for (let i = 0; i < n; i++) {
        const bin = Math.min(numBins - 1, Math.max(0, Math.floor(tgtCh[i] * (numBins - 1))));
        tgtHist[bin]++;
      }
      const tgtCDF = new Float64Array(numBins);
      tgtCDF[0] = tgtHist[0] / n;
      for (let b = 1; b < numBins; b++) tgtCDF[b] = tgtCDF[b - 1] + tgtHist[b] / n;
      const lut = new Float32Array(numBins);
      let refIdx = 0;
      for (let b = 0; b < numBins; b++) {
        while (refIdx < numBins - 1 && refCDF[refIdx] < tgtCDF[b]) refIdx++;
        if (refIdx > 0 && refCDF[refIdx] > tgtCDF[b]) {
          const d0 = tgtCDF[b] - refCDF[refIdx - 1];
          const d1 = refCDF[refIdx] - tgtCDF[b];
          const frac = d0 / (d0 + d1 + 1e-12);
          lut[b] = ((refIdx - 1) + frac) / (numBins - 1);
        } else {
          lut[b] = refIdx / (numBins - 1);
        }
      }
      for (let i = 0; i < n; i++) {
        const bin = Math.min(numBins - 1, Math.max(0, Math.floor(tgtCh[i] * (numBins - 1))));
        tgtCh[i] = lut[bin];
      }
    }
    return img;
  }

  function computeBackgroundNeutralizationCalib(srcImg) {
    const { bgVals } = window.BackgroundExtraction.findBackgroundSetiAstro(srcImg);
    return { img: window.BackgroundExtraction.applyBackgroundNeutralization(srcImg, bgVals), bgVals };
  }

  // SPCC: consulta Gaia DR3 (VizieR) + calibración en Pyodide. Requiere WCS (plate-solved).
  async function computeSPCC(srcImg, wcsData) {
    // Radio de búsqueda en Gaia. Preferimos el radius del plate solve; si falta, lo derivamos del
    // pixscale (arcsec/px) y la diagonal de la imagen (evita que la consulta a Gaia falle).
    let radiusArcmin;
    if (wcsData.radius && wcsData.radius > 0) {
      radiusArcmin = wcsData.radius * 60;
    } else if (wcsData.pixscale && wcsData.pixscale > 0) {
      const diagPx = Math.sqrt(srcImg.w * srcImg.w + srcImg.h * srcImg.h);
      radiusArcmin = (diagPx * wcsData.pixscale) / 120; // medio-diagonal en arcmin
    } else {
      radiusArcmin = 30;
    }
    const url = `https://vizier.cds.unistra.fr/viz-bin/asu-tsv?-source=I/355/gaiadr3&-c=${wcsData.ra}+${wcsData.dec}&-c.r=${radiusArcmin}&-out=RA_ICRS&-out=DE_ICRS&-out=Gmag&-out=BPmag&-out=RPmag&-out.max=250`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Error HTTP: ${response.status}`);
    const tsvText = await response.text();
    const stars = [];
    const lines = tsvText.split('\n');
    let dataStarted = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (line.startsWith('----') || line.startsWith('====')) { dataStarted = true; continue; }
      if (!dataStarted || line.startsWith('#')) continue;
      const parts = line.split('\t');
      if (parts.length >= 5) {
        const s_ra = parseFloat(parts[0]), s_dec = parseFloat(parts[1]), g = parseFloat(parts[2]), bp = parseFloat(parts[3]), rp = parseFloat(parts[4]);
        if (!isNaN(s_ra) && !isNaN(s_dec) && !isNaN(g) && !isNaN(bp) && !isNaN(rp)) stars.push({ ra: s_ra, dec: s_dec, g, bp, rp });
      }
    }
    if (stars.length === 0) throw new Error("No se encontraron estrellas Gaia DR3 en la zona");
    // SPCC-PYODIDE->JS: calibración en JS puro (window.SPCC, spcc.js). Replica apply_spcc/astropy
    // (proyección TAN reconstruida desde ra/dec/pixscale/orientation/parity, sin SIP). Validado vs
    // astropy a precisión de máquina (factores y píxeles, |Δ|<6e-8). calibrate() es síncrono; cedemos
    // el hilo para que el loader repinte antes del cómputo (mediana exacta de canales a 4K ~ s).
    const lang2 = document.documentElement.lang || "es";
    showLoader(lang2 === "es" ? "Calibrando color (PCC, JS)..." : "Calibrating color (PCC, JS)...");
    await new Promise(r => setTimeout(r, 20));
    return window.SPCC.calibrate(srcImg, stars, {
      ra: wcsData.ra, dec: wcsData.dec, pixscale: wcsData.pixscale, orientation: wcsData.orientation, parity: wcsData.parity
    });
  }
  // CALIB-COMPUTE-END

  function runLinearFit() {
    const srcImg = state.stepInputImage || state.activeImage;
    if (!srcImg || !srcImg.isColor) return;
    showLoader("Alineando canales (Linear Fit)...");
    setTimeout(async () => {
      try {
        // CALIB-PREVIEW + PROXY-PROBAR (V1): preview no destructivo (commit en "Aplicar
        // Calibración"); primero instantáneo sobre el proxy y luego a resolución completa.
        await previewProxyThenFull(srcImg, "Linear Fit", (img) => computeLinearFit(img));
        logConsole("Vista previa Linear Fit (Probar). Pulsa 'Aplicar Calibración' para confirmar.", "info");
      } catch (err) {
        logConsole(`Error en Linear Fit: ${err.message}`, "err");
      } finally {
        hideLoader();
      }
    }, 50);
  }

  // Optimal Transport (1D Wasserstein) helper function
  function runOptimalTransport() {
    const srcImg = state.stepInputImage || state.activeImage;
    if (!srcImg || !srcImg.isColor || srcImg.nc < 3) return;
    const lang = document.documentElement.lang || "es";
    showLoader(lang === "es" ? "Aplicando Optimal Transport (Wasserstein 1D)..." : "Applying Optimal Transport (1D Wasserstein)...");
    setTimeout(async () => {
      try {
        // CALIB-PREVIEW + PROXY-PROBAR (V1): preview no destructivo (commit en "Aplicar
        // Calibración"); primero instantáneo sobre el proxy y luego a resolución completa.
        await previewProxyThenFull(srcImg, "Optimal Transport", (img) => computeOptimalTransport(img));
        logConsole(lang === "es" ? "Vista previa Optimal Transport (Probar). Pulsa 'Aplicar Calibración' para confirmar." : "Optimal Transport preview (Test). Press 'Apply Calibration' to commit.", "info");
      } catch (err) {
        logConsole(`Error en Optimal Transport: ${err.message}`, "err");
      } finally {
        hideLoader();
      }
    }, 50);
  }

  // Background Neutralization helper function
  // BN-JS-BEGIN
  async function runBackgroundNeutralization() {
    if (!state.activeImage) return;
    const lang = document.documentElement.lang || "es";
    showLoader(lang === "es" ? "Neutralizando fondo..." : "Neutralizing background...");

    setTimeout(async () => {
      try {
        const srcImg = state.stepInputImage || state.activeImage;
        // CALIB-PREVIEW + PROXY-PROBAR (V1): preview no destructivo (commit en "Aplicar
        // Calibración"); primero instantáneo sobre el proxy y luego a resolución completa.
        // Los valores de fondo del log se toman del pase a resolución completa.
        let fullBgVals = null;
        await previewProxyThenFull(srcImg, "Background Neutralization", (img) => {
          const { img: res, bgVals } = computeBackgroundNeutralizationCalib(img);
          if (img === srcImg) fullBgVals = bgVals;
          return res;
        });
        if (fullBgVals) {
          const bgStr = Array.from(fullBgVals).map(v => v.toFixed(4)).join(", ");
          logConsole(lang === "es" ? `Fondo detectado (R,G,B): [${bgStr}]` : `Detected background (R,G,B): [${bgStr}]`, "info");
        }
        logConsole(lang === "es" ? "Neutralización de fondo completada" : "Background Neutralization completed", "info");
      } catch (err) {
        logConsole(`Error en Neutralización: ${err.message}`, "err");
      } finally {
        hideLoader();
      }
    }, 50);
  }
  // BN-JS-END

  // SPCC-BN-CHAIN: SPCC (calibración por estrellas) + Neutralización de Fondo encadenada.
  // Validado en imágenes reales (ASI2600MM+RGB): tras calibrar las estrellas, el verde residual es
  // luz parásita de fondo sin neutralizar; al neutralizarla el fondo queda gris (como el SPCC real
  // de PixInsight, que integra la neutralización). Preserva wcs y los factores (extra) para el log.
  async function computeSPCCNeutralized(srcImg, wcsData) {
    const res = await computeSPCC(srcImg, wcsData);
    try {
      const bn = computeBackgroundNeutralizationCalib(res).img;
      // SCNR verde "average neutral": ninguna estrella es realmente verde; tras calibrar+neutralizar
      // queda un leve exceso verde (estrellas verdes / tinte) que es el artefacto clasico de astrofoto.
      // Validado sobre imagen real: esto lo elimina y deja colores correctos. (G = min(G, (R+B)/2)).
      // SCNR a fuerza MODERADA (0.5): a plena fuerza (1.0) desatura y vuelve marron la nebulosa
      // (validado en imagen real); 0.5 quita las estrellas verdes y el tinte sin embarrar el color.
      if (bn.isColor && bn.nc >= 3) {
        const SCNR_AMT = 0.5;
        const n = bn.w * bn.h, R = bn.ch[0], G = bn.ch[1], B = bn.ch[2];
        for (let i = 0; i < n; i++) {
          const lim = (R[i] + B[i]) * 0.5;
          if (G[i] > lim) G[i] = G[i] + SCNR_AMT * (lim - G[i]);
        }
      }
      bn.wcs = res.wcs || (srcImg && srcImg.wcs);
      bn.extra = res.extra;
      return bn;
    } catch (e) {
      return res; // si la neutralización falla, devolvemos al menos la calibración por estrellas
    }
  }

  // PCC helper function
  async function runSPCC() {
    if (!state.activeImage) return;
    const lang = document.documentElement.lang || "es";
    const wcsData = state.wcs || state.activeImage.wcs;
    if (!wcsData) {
      logConsole(lang === "es" 
        ? "Error: PCC requiere que la imagen esté resuelta (Plate Solving) previamente." 
        : "Error: PCC requires the image to be solved (Plate Solving) first.", "err");
      alert(lang === "es" 
        ? "Por favor, ejecute Plate Solving en la pestaña correspondiente antes de usar PCC."
        : "Please run Plate Solving in the corresponding tab before using PCC.");
      return;
    }
    
    showLoader(lang === "es" ? "Consultando catálogo Gaia DR3 en VizieR..." : "Querying Gaia DR3 catalog on VizieR...");
    
    try {
      const srcImg = state.stepInputImage || state.activeImage;
      const res = await computeSPCCNeutralized(srcImg, wcsData);

      // CALIB-PREVIEW: preview no destructivo (commit en "Aplicar Calibración")
      previewActiveImage(res, srcImg, "PCC");

      render();
      drawHistogram();

      if (res.extra && res.extra.factors) {
        const k = res.extra.factors;
        logConsole(lang === "es"
          ? `PCC + fondo neutralizado + SCNR verde. Ganancias (k_R,k_G,k_B): [${k[0].toFixed(4)}, ${k[1].toFixed(4)}, ${k[2].toFixed(4)}]`
          : `PCC + background neutralized + green SCNR. Gains (k_R,k_G,k_B): [${k[0].toFixed(4)}, ${k[1].toFixed(4)}, ${k[2].toFixed(4)}]`,
          "ok"
        );
      } else {
        logConsole(lang === "es" ? "PCC completado sin cambios de factores." : "PCC completed without factor changes.", "info");
      }
    } catch (err) {
      logConsole(`Error en PCC: ${err.message}`, "err");
    } finally {
      hideLoader();
    }
  }

  // Auto Linear Fit
  const cardLF = el("cardLinearFit");
  if (cardLF) {
    cardLF.addEventListener("click", () => {
      if (cardLF.classList.contains("disabled") || !state.activeImage || !state.activeImage.isColor) return;
      cardLF.classList.add("active-cc");
      const cBN = el("cardBN");
      if (cBN) cBN.classList.remove("active-cc");
      const cSPCC = el("cardSPCC");
      if (cSPCC) cSPCC.classList.remove("active-cc");
      const cOT = el("cardOT");
      if (cOT) cOT.classList.remove("active-cc");
      updateBigApply();
      
      runLinearFit();
    });
  }

  // Background Neutralization
  const cardBN = el("cardBN");
  if (cardBN) {
    cardBN.addEventListener("click", () => {
      if (cardBN.classList.contains("disabled") || !state.activeImage) return;
      cardBN.classList.add("active-cc");
      const cLF = el("cardLinearFit");
      if (cLF) cLF.classList.remove("active-cc");
      const cSPCC = el("cardSPCC");
      if (cSPCC) cSPCC.classList.remove("active-cc");
      const cOT = el("cardOT");
      if (cOT) cOT.classList.remove("active-cc");
      updateBigApply();
      
      runBackgroundNeutralization();
    });
  }

  // SPCC
  const cardSPCC = el("cardSPCC");
  if (cardSPCC) {
    cardSPCC.addEventListener("click", () => {
      if (cardSPCC.classList.contains("disabled") || !state.activeImage || !state.activeImage.isColor) return;
      cardSPCC.classList.add("active-cc");
      const cLF = el("cardLinearFit");
      if (cLF) cLF.classList.remove("active-cc");
      const cBN = el("cardBN");
      if (cBN) cBN.classList.remove("active-cc");
      const cOT = el("cardOT");
      if (cOT) cOT.classList.remove("active-cc");
      updateBigApply();
      
      runSPCC();
    });
  }

  // Optimal Transport
  const cardOTEl = el("cardOT");
  if (cardOTEl) {
    cardOTEl.addEventListener("click", () => {
      if (cardOTEl.classList.contains("disabled") || !state.activeImage || !state.activeImage.isColor) return;
      cardOTEl.classList.add("active-cc");
      const cLF = el("cardLinearFit");
      if (cLF) cLF.classList.remove("active-cc");
      const cBN = el("cardBN");
      if (cBN) cBN.classList.remove("active-cc");
      const cSPCC = el("cardSPCC");
      if (cSPCC) cSPCC.classList.remove("active-cc");
      updateBigApply();

      runOptimalTransport();
    });
  }

  // CALIB-COMPARE-BEGIN
  // "Comparar Métodos": corre los métodos de calibración sobre la Imagen Inicial y guarda
  // cada resultado en un Slot de Memoria (1..N) para compararlos. No commitea.
  // Los 3 locales (Linear Fit, Optimal Transport, Bkg. Neutralization) siempre; SPCC solo si
  // la imagen está resuelta (plate-solved); si no, se omite con aviso.
  if (el("btnCompareColor")) {
    el("btnCompareColor").addEventListener("click", () => {
      if (el("btnCompareColor").disabled || !state.activeImage || !state.activeImage.isColor) return;
      const lang = document.documentElement.lang || "es";
      showLoader(lang === "es" ? "Comparando métodos de calibración..." : "Comparing calibration methods...");

      setTimeout(async () => {
        try {
          const srcImg = state.stepInputImage || state.activeImage;
          const wcsData = state.wcs || srcImg.wcs;
          const results = [
            { name: "Linear Fit", img: computeLinearFit(srcImg) },
            { name: "Optimal Transport", img: computeOptimalTransport(srcImg) },
            { name: "Bkg. Neutralization", img: computeBackgroundNeutralizationCalib(srcImg).img }
          ];
          if (wcsData) {
            try {
              results.push({ name: "PCC", img: await computeSPCCNeutralized(srcImg, wcsData) });
            } catch (e) {
              logConsole((lang === "es" ? "PCC omitido: " : "PCC skipped: ") + e.message, "warn");
            }
          } else {
            logConsole(lang === "es" ? "PCC omitido: la imagen no está resuelta (Plate Solving)." : "PCC skipped: image is not plate-solved.", "warn");
          }

          for (let i = 0; i < results.length; i++) {
            const r = results[i];
            state.imageSlots[i] = cloneImage({
              ch: r.img.ch, w: r.img.w, h: r.img.h, nc: r.img.nc,
              isColor: r.img.isColor, wcs: r.img.wcs || (srcImg && srcImg.wcs)
            });
            const slotBtn = document.querySelector(`.piw-slot-btn[data-slot="${i + 1}"]`);
            if (slotBtn) {
              slotBtn.classList.add("filled");
              slotBtn.title = (lang === "es" ? "Calibración: " : "Calibration: ") + r.name;
            }
            logConsole(`Slot ${i + 1} ← ${r.name}`, "info");
          }
          updateMixSourceOptions();

          // Habilita "Aplicar Calibración" para poder confirmar el slot que se elija
          state.calibCompareReady = true;
          updateBigApply();

          state.screenStretchMode = true;
          const stfBtn = el("btnToolAutoSTF");
          if (stfBtn) stfBtn.classList.add("active");

          hideLoader();
          logConsole(lang === "es"
            ? `Comparación lista: ${results.length} métodos en Slots 1-${results.length}. Carga un slot y pulsa 'Aplicar Calibración'.`
            : `Comparison ready: ${results.length} methods in Slots 1-${results.length}. Load a slot and press 'Apply Calibration'.`, "ok");
        } catch (e) {
          hideLoader();
          logConsole(`Error: ${e.message}`, "err");
        }
      }, 50);
    });
  }
  // CALIB-COMPARE-END

  // SCNR-PRE-BEGIN
  el("btnApplyScnrPre").addEventListener("click", () => {
    if (!state.activeImage || !state.activeImage.isColor) return;
    const k = parseFloat(el("sldScnrIntPre").value);
    showLoader("Eliminando cast verde (SCNR)...");
    setTimeout(() => {
      try {
        const srcImg = state.stepInputImage || state.activeImage;
        const img = cloneImage(srcImg);
        const n = img.w * img.h;
        for (let i = 0; i < n; ++i) {
          const limit = (img.ch[0][i] + img.ch[2][i]) / 2;
          if (img.ch[1][i] > limit) img.ch[1][i] = (1 - k) * img.ch[1][i] + k * limit;
        }
        commitActiveImage(img, "SCNR", srcImg);
        render(); refreshPathBar();
        logConsole("SCNR Green (lineal) aplicado", "info");
      } catch (err) {
        logConsole(`Error SCNR: ${err.message}`, "err");
      } finally { hideLoader(); }
    }, 50);
  });
  // SCNR-PRE-END

