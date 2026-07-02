  // IMG-ENH-BEGIN — Pestaña "Mejora": Color Mixer + Detail & Contrast (port de PI Workflow Dev_194).
  const CM_BANDS = [
    { id: "red", center: 0, label: "Rojo / H-alpha", labelEn: "Red / H-alpha" },
    { id: "orange", center: 30, label: "Naranja / Núcleos", labelEn: "Orange / Galaxy Cores" },
    { id: "yellow", center: 60, label: "Amarillo / Estrellas cálidas", labelEn: "Yellow / Warm Stars" },
    { id: "green", center: 120, label: "Verde / Control de tinte", labelEn: "Green / Cast Control" },
    { id: "cyan", center: 180, label: "Cian / OIII", labelEn: "Cyan / OIII" },
    { id: "blue", center: 240, label: "Azul / Nebulosa reflexión", labelEn: "Blue / Reflection Nebula" },
    { id: "purple", center: 275, label: "Púrpura / Violetas", labelEn: "Purple / Violet Cleanup" },
    { id: "magenta", center: 315, label: "Magenta / Halos", labelEn: "Magenta / Halo Cleanup" }
  ];
  const CM_AXIS = 1 / Math.sqrt(3);
  const CM_POS_LUM_GAIN = 0.5;
  const cmClamp01 = (x) => x < 0 ? 0 : (x > 1 ? 1 : x);
  const cmSmooth = (a, b, x) => { if (a >= b) return x < a ? 0 : 1; let t = (x - a) / (b - a); t = t < 0 ? 0 : (t > 1 ? 1 : t); return t * t * (3 - 2 * t); };
  function cmDefaultState() {
    return {
      bands: CM_BANDS.map(d => ({ id: d.id, center: d.center, hueShift: 0, saturation: 0, luminance: 0, width: 45, feather: 0.75 })),
      globalStrength: 1.0, protectStars: true, protectLowSat: true,
      satFloor: 0.015, satFull: 0.07, darkFloor: 0.0, darkFull: 0.06, highlightStart: 0.92, highlightFull: 1.0
    };
  }
  if (!state.colorMixer) state.colorMixer = cmDefaultState();

  // Aplica el ajuste de una banda al píxel p (sat + rotación de tono en el plano de croma + luminancia).
  function cmApplyPixel(R, G, B, p, mask, satBase, lumBase, hasHue, hueRad) {
    const rr = R[p], gg = G[p], bb = B[p];
    const y = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
    let cr = rr - y, cg = gg - y, cb = bb - y;
    let satScale = 1 + satBase * mask; if (satScale < 0) satScale = 0;
    cr *= satScale; cg *= satScale; cb *= satScale;
    if (hasHue) {
      const ang = hueRad * mask, cosA = Math.cos(ang), sinA = Math.sin(ang), invc = 1 - cosA, ax = CM_AXIS, ay = CM_AXIS, az = CM_AXIS;
      const dot = cr * ax + cg * ay + cb * az;
      const xr = ay * cb - az * cg, xg = az * cr - ax * cb, xb = ax * cg - ay * cr;
      cr = cr * cosA + xr * sinA + ax * dot * invc; cg = cg * cosA + xg * sinA + ay * dot * invc; cb = cb * cosA + xb * sinA + az * dot * invc;
    }
    const y2 = lumBase >= 0 ? y + (lumBase * CM_POS_LUM_GAIN) * mask * (1 - y) : y + lumBase * mask * y;
    R[p] = cmClamp01(y2 + cr); G[p] = cmClamp01(y2 + cg); B[p] = cmClamp01(y2 + cb);
  }
  function cmHasWork(st) { return st.bands.some(b => Math.abs(b.hueShift) > 1e-6 || Math.abs(b.saturation) > 1e-6 || Math.abs(b.luminance) > 1e-6); }
  // IMG-WORKER: ejecuta operaciones pesadas (Color Mixer / Detail) en un Web Worker para NO congelar
  // la UI al "Aplicar" a resolución completa. Clona los canales del origen y los TRANSFIERE (sin copia
  // extra) al worker; el worker devuelve el resultado también transferido. Si el worker falla, el
  // llamador hace fallback al hilo principal.
  let _imgWorker = null, _imgWorkerId = 0;
  const _imgWorkerCbs = {};
  function ensureImgWorker() {
    if (_imgWorker) return _imgWorker;
    _imgWorker = new Worker("imgworker.js?v=" + (window.PIW_BUILD || "0"));
    _imgWorker.onmessage = (e) => {
      const d = e.data || {}; const cb = _imgWorkerCbs[d.id]; if (!cb) return; delete _imgWorkerCbs[d.id];
      if (d.error) cb.reject(new Error(d.error));
      else cb.resolve({ ch: d.ch, w: d.w, h: d.h, nc: d.nc, isColor: d.isColor });
    };
    _imgWorker.onerror = (ev) => { Object.keys(_imgWorkerCbs).forEach(k => { _imgWorkerCbs[k].reject(new Error("Worker: " + (ev.message || "error"))); delete _imgWorkerCbs[k]; }); };
    return _imgWorker;
  }
  function runImgWorker(op, srcImg, params) {
    return new Promise((resolve, reject) => {
      const wrk = ensureImgWorker();
      const id = ++_imgWorkerId;
      _imgWorkerCbs[id] = { resolve, reject };
      const chCopy = srcImg.ch.map(c => Float32Array.from(c)); // copia (no toca el original) para transferir
      wrk.postMessage({ id, op, img: { ch: chCopy, w: srcImg.w, h: srcImg.h, nc: srcImg.nc, isColor: srcImg.isColor }, params }, chCopy.map(c => c.buffer));
    });
  }
  // Aplica una operación de ImgOps en el worker; si algo falla, cae al hilo principal (mainFn).
  function applyImgOp(op, srcImg, params, stageLabel, mainFn) {
    const lang = document.documentElement.lang || "es";
    let done = false;
    const finish = (res) => { if (done) return; done = true; res.wcs = srcImg.wcs; commitActiveImage(res, stageLabel, srcImg); render(); drawHistogram(); refreshPathBar(); hideLoader(); logConsole((lang === "es" ? "Aplicado: " : "Applied: ") + stageLabel, "ok"); };
    const fallback = (why) => {
      if (done) return; done = true;
      try { const res = mainFn(); res.wcs = srcImg.wcs; commitActiveImage(res, stageLabel, srcImg); render(); drawHistogram(); refreshPathBar(); logConsole((lang === "es" ? "Aplicado (CPU): " : "Applied (CPU): ") + stageLabel, "ok"); }
      catch (e) { logConsole(stageLabel + ": " + e.message, "err"); }
      finally { hideLoader(); }
    };
    try {
      runImgWorker(op, srcImg, params).then(finish).catch((e) => fallback(e && e.message));
    } catch (e) { fallback(e && e.message); }
  }

  // Delegado al módulo común ImgOps (misma matemática, unificada; también la usa el Web Worker).
  function computeColorMixer(srcImg, st) { return window.ImgOps.computeColorMixer(srcImg, st); }

  // --- Color Mixer: cableado de UI ---
  function cmCurrentBand() { return state.colorMixer.bands[el("selCmBand") ? el("selCmBand").selectedIndex : 0] || state.colorMixer.bands[0]; }
  function cmSyncSlidersFromBand() {
    const b = cmCurrentBand();
    if (el("sldCmHue")) { el("sldCmHue").value = b.hueShift; el("valCmHue").textContent = String(b.hueShift); }
    if (el("sldCmSat")) { el("sldCmSat").value = b.saturation; el("valCmSat").textContent = String(b.saturation); }
    if (el("sldCmLum")) { el("sldCmLum").value = b.luminance; el("valCmLum").textContent = String(b.luminance); }
  }
  function livePreviewColorMixer() { _runLive("chkCmLive", (img) => computeColorMixer(img, state.colorMixer), "Color Mixer", () => ({ op: "colorMixer", params: state.colorMixer })); }
  {
    const selBand = el("selCmBand");
    if (selBand) {
      const _isEnCm = document.documentElement.lang !== "es";
      CM_BANDS.forEach((d, i) => { const o = document.createElement("option"); o.value = d.id; o.textContent = _isEnCm ? d.labelEn : d.label; selBand.appendChild(o); });
      selBand.addEventListener("change", cmSyncSlidersFromBand);
      cmSyncSlidersFromBand();
    }
    const wire = (sldId, valId, prop) => { const s = el(sldId); if (!s) return; s.addEventListener("input", () => { const v = parseFloat(s.value); el(valId).textContent = String(v); cmCurrentBand()[prop] = v; livePreviewColorMixer(); }); };
    wire("sldCmHue", "valCmHue", "hueShift");
    wire("sldCmSat", "valCmSat", "saturation");
    wire("sldCmLum", "valCmLum", "luminance");
    const sldGS = el("sldCmStrength");
    if (sldGS) sldGS.addEventListener("input", () => { const v = parseFloat(sldGS.value); el("valCmStrength").textContent = v.toFixed(2); state.colorMixer.globalStrength = v; livePreviewColorMixer(); });
    const cps = el("chkCmProtectStars"); if (cps) cps.addEventListener("change", () => { state.colorMixer.protectStars = cps.checked; livePreviewColorMixer(); });
    const cpl = el("chkCmProtectLowSat"); if (cpl) cpl.addEventListener("change", () => { state.colorMixer.protectLowSat = cpl.checked; livePreviewColorMixer(); });
    const cmLive = el("chkCmLive");
    if (cmLive) cmLive.addEventListener("change", () => { if (cmLive.checked) livePreviewColorMixer(); else if (state.stepInputImage) { state.activeImage = state.stepInputImage; render(); } });
    const btnCM = el("btnApplyColorMixer");
    if (btnCM) btnCM.addEventListener("click", () => {
      const srcImg = state.stepInputImage || state.activeImage; if (!srcImg) return;
      const lang = document.documentElement.lang || "es";
      const st = state.colorMixer;
      showLoader(lang === "es" ? "Aplicando Color Mixer..." : "Applying Color Mixer...");
      applyImgOp("colorMixer", srcImg, st, "Color Mixer", () => computeColorMixer(srcImg, st));
    });
    const btnCMR = el("btnResetColorMixer");
    if (btnCMR) btnCMR.addEventListener("click", () => { state.colorMixer = cmDefaultState(); cmSyncSlidersFromBand(); if (el("sldCmStrength")) { el("sldCmStrength").value = "1.00"; el("valCmStrength").textContent = "1.00"; } if (el("chkCmProtectStars")) el("chkCmProtectStars").checked = true; if (el("chkCmProtectLowSat")) el("chkCmProtectLowSat").checked = true; livePreviewColorMixer(); logConsole(document.documentElement.lang === "es" ? "Color Mixer restablecido." : "Color Mixer reset.", "info"); });
  }

  // --- Detail & Contrast (luminancia; preserva color reaplicando el DELTA de luma) ---
  // Box blur separable → delegado al módulo común ImgProc (misma implementación, unificada).
  const detailBoxBlur = (src, w, h, radius) => window.ImgProc.boxBlur(src, w, h, radius);
  function detailAtrous(Y, w, h, gains) { const count = w * h, out = new Float32Array(count); let cur = Y; for (let i = 0; i < count; i++) out[i] = Y[i]; for (let k = 0; k < gains.length; k++) { const g = gains[k], blur = detailBoxBlur(cur, w, h, 1 << k); if (g !== 0) for (let p = 0; p < count; p++) out[p] += g * (cur[p] - blur[p]); cur = blur; } return out; }
  function detailApplyLuma(srcImg, lumaFn) {
    const w = srcImg.w, h = srcImg.h, count = w * h;
    if (srcImg.isColor && srcImg.nc >= 3) {
      const R = Float32Array.from(srcImg.ch[0]), G = Float32Array.from(srcImg.ch[1]), B = Float32Array.from(srcImg.ch[2]);
      const Y = new Float32Array(count); for (let i = 0; i < count; i++) Y[i] = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i];
      const nY = lumaFn(Y, w, h);
      for (let j = 0; j < count; j++) { const dlt = nY[j] - Y[j]; R[j] = cmClamp01(R[j] + dlt); G[j] = cmClamp01(G[j] + dlt); B[j] = cmClamp01(B[j] + dlt); }
      return { ch: [R, G, B], w, h, nc: 3, isColor: true, wcs: srcImg.wcs };
    }
    const C = Float32Array.from(srcImg.ch[0]); const nC = lumaFn(C, w, h); for (let p = 0; p < count; p++) C[p] = cmClamp01(nC[p]);
    return { ch: [C], w, h, nc: 1, isColor: false, wcs: srcImg.wcs };
  }
  function detailParams() {
    return {
      lcAmount: parseFloat((el("sldDetailLcAmount") || {}).value || 0.2), lcRadius: parseFloat((el("sldDetailLcRadius") || {}).value || 80),
      mdFine: parseFloat((el("sldDetailMdFine") || {}).value || 0.4), mdMedium: parseFloat((el("sldDetailMdMedium") || {}).value || 0.2),
      hpAmount: parseFloat((el("sldDetailHpAmount") || {}).value || 0.5), hpRadius: parseFloat((el("sldDetailHpRadius") || {}).value || 3)
    };
  }
  // Delegado al módulo común ImgOps (misma matemática, unificada; también la usa el Web Worker).
  function computeDetail(srcImg, algo, pr) { const p = Object.assign({ algo: algo }, pr); return window.ImgOps.computeDetail(srcImg, algo, p); }
  function livePreviewDetail() { const algo = el("selDetailAlgo") ? el("selDetailAlgo").value : "localContrast"; _runLive("chkDetailLive", (img) => computeDetail(img, algo, detailParams()), "Detail", () => ({ op: "detail", params: Object.assign({ algo }, detailParams()) })); }
  {
    const selD = el("selDetailAlgo");
    if (selD) selD.addEventListener("change", () => {
      const v = selD.value;
      if (el("detail-lc-controls")) el("detail-lc-controls").style.display = v === "localContrast" ? "block" : "none";
      if (el("detail-md-controls")) el("detail-md-controls").style.display = v === "multiscale" ? "block" : "none";
      if (el("detail-hp-controls")) el("detail-hp-controls").style.display = v === "highPass" ? "block" : "none";
      livePreviewDetail();
    });
    [["sldDetailLcAmount", "valDetailLcAmount", 2], ["sldDetailLcRadius", "valDetailLcRadius", 0], ["sldDetailMdFine", "valDetailMdFine", 2], ["sldDetailMdMedium", "valDetailMdMedium", 2], ["sldDetailHpAmount", "valDetailHpAmount", 2], ["sldDetailHpRadius", "valDetailHpRadius", 0]].forEach(([sId, vId, dp]) => {
      const s = el(sId); if (s) s.addEventListener("input", () => { el(vId).textContent = parseFloat(s.value).toFixed(dp); livePreviewDetail(); });
    });
    const dLive = el("chkDetailLive");
    if (dLive) dLive.addEventListener("change", () => { if (dLive.checked) livePreviewDetail(); else if (state.stepInputImage) { state.activeImage = state.stepInputImage; render(); } });
    const btnD = el("btnApplyDetail");
    if (btnD) btnD.addEventListener("click", () => {
      const srcImg = state.stepInputImage || state.activeImage; if (!srcImg) return;
      const lang = document.documentElement.lang || "es"; const algo = el("selDetailAlgo").value;
      const pr = Object.assign({ algo }, detailParams());
      showLoader(lang === "es" ? "Aplicando detalle..." : "Applying detail...");
      applyImgOp("detail", srcImg, pr, "Detail", () => computeDetail(srcImg, algo, detailParams()));
    });
  }
  // IMG-ENH-END


