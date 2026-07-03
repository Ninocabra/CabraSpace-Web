  // IMAGE-MODEL-BEGIN
  // Punto único de confirmación de una imagen procesada. Análogo conceptual a
  // commitCandidate → store.setView() del script PJSR. Unifica cuatro cosas que antes
  // estaban dispersas e inconsistentes entre operaciones:
  //   1. Forma del objeto imagen (siempre { ch, w, h, nc, isColor, wcs?, hasTransforms, stages }).
  //   2. Preservación de la solución astrométrica (wcs): del resultado si la trae, si no se
  //      hereda del origen — evita que denoise/USM/curvas/blend pierdan el plate-solve.
  //   3. Registro del stage aplicado (historial acumulado en img.stages, como rec.stages del script).
  //   4. Persistencia EXPLÍCITA en workflowImages bajo la clave activa (ya no por efecto
  //      secundario de render()).
  // `result` debe traer al menos { ch, w, h, nc, isColor }. `sourceImg` es el origen del que
  // heredar wcs e historial (por defecto, la entrada del paso actual).
  // MASK-BLEND: algunas operaciones de POST ofrecen "Usar máscara activa". Si su checkbox está
  // marcado y hay una máscara del MISMO tamaño que el resultado (no un proxy de baja resolución),
  // se mezcla el resultado con la imagen de ENTRADA a través de la máscara:
  //   out = entrada·(1−m) + resultado·m   (blanco = afecta, negro = protege; igual convención que el resto).
  // Así la operación solo se aplica en las zonas blancas de la máscara. Se llama desde preview y
  // commit; ningún camino de estas 4 ops pasa por ambos, así que no hay doble aplicación.
  const _MASK_CHK_BY_STAGE = {
    "Noise Reduction": "chkPostNRUseMask",
    "Sharpening": "chkPostSharpUseMask",
    "Color Balance": "chkPostColorUseMask",
    "Curves": "chkPostCurvesUseMask"
  };
  function maskBlendForStage(result, src, stageLabel) {
    const chkId = _MASK_CHK_BY_STAGE[stageLabel];
    if (!chkId) return result;
    const chk = el(chkId);
    if (!chk || !chk.checked) return result;
    const m = state.activeMask;
    if (!m || !src || !src.ch || !result || !result.ch) return result;
    const n = result.w * result.h;
    if (m.length !== n || src.w !== result.w || src.h !== result.h) return result; // proxy/geometría distinta → sin máscara
    const nc = result.nc, out = [];
    for (let c = 0; c < nc; c++) {
      const rc = result.ch[c];
      const sc = src.ch[Math.min(c, src.ch.length - 1)];
      const oc = new Float32Array(n);
      for (let i = 0; i < n; i++) { const mm = m[i]; oc[i] = sc[i] * (1 - mm) + rc[i] * mm; }
      out.push(oc);
    }
    return { ch: out, w: result.w, h: result.h, nc: nc, isColor: result.isColor, wcs: result.wcs };
  }

  function commitActiveImage(result, stageLabel, sourceImg) {
    recordUndo(); // guarda el estado committeado anterior para poder deshacer
    const src = sourceImg || state.stepInputImage || state.activeImage;
    result = maskBlendForStage(result, src, stageLabel); // POST: aplica la máscara activa si procede
    const img = {
      ch: result.ch,
      w: result.w,
      h: result.h,
      nc: result.nc,
      isColor: result.isColor,
      hasTransforms: true
    };
    if (result.wcs) {
      img.wcs = result.wcs;
    } else if (src && src.wcs) {
      img.wcs = { ...src.wcs };
    }
    const stages = (src && Array.isArray(src.stages)) ? src.stages.slice() : [];
    if (stageLabel) {
      stages.push(stageLabel);
    }
    img.stages = stages;

    state.activeImage = img;
    if (state.activeWorkflowKey) {
      state.workflowImages[state.activeWorkflowKey] = img;
    }
    state.pendingPreview = false; // ya confirmado
    scheduleSessionSave();        // U2: autoguardado (debounced) del flujo committeado
    return img;
  }

  // Previsualización NO destructiva: aplica un resultado a la imagen activa para MOSTRARLO,
  // pero NO lo persiste en workflowImages ni cambia stepInputImage (la Imagen Inicial). El
  // commit real lo hace el botón "Aplicar" de la ventana de imagen (btnBigApply → commitPreview).
  // Mantiene la misma forma de objeto que commitActiveImage (wcs heredado, stages acumulado)
  // para que, al confirmar, el resultado quede consistente.
  function previewActiveImage(result, sourceImg, stageLabel) {
    const src = sourceImg || state.stepInputImage || state.activeImage;
    result = maskBlendForStage(result, src, stageLabel); // POST: aplica la máscara activa si procede
    const img = {
      ch: result.ch, w: result.w, h: result.h, nc: result.nc, isColor: result.isColor,
      hasTransforms: true
    };
    if (result.wcs) {
      img.wcs = result.wcs;
    } else if (src && src.wcs) {
      img.wcs = { ...src.wcs };
    }
    const stages = (src && Array.isArray(src.stages)) ? src.stages.slice() : [];
    if (stageLabel) {
      stages.push(stageLabel);
    }
    img.stages = stages;
    state.activeImage = img;
    state.pendingPreview = true; // hay un preview sin aplicar → habilita "Aplicar"
    return img;
  }
  // IMAGE-MODEL-END

  // UNDO-REDO-BEGIN — Historial global de pasos aplicados al flujo.
  // Se registra la imagen committeada ANTERIOR (referencia) antes de sobrescribirla; deshacer/rehacer
  // restaura workflowImages[key] + activeImage + stepInputImage.
  // V3: presupuesto del historial en BYTES, no en nº de pasos (30 imágenes de 144 MB matarían la
  // pestaña de un iPad). Las entradas son referencias — a menudo compartidas con workflowImages —
  // así que esta cuenta es una cota superior conservadora. deviceMemory<=4GB → presupuesto menor.
  const UNDO_BUDGET_BYTES = ((navigator.deviceMemory && navigator.deviceMemory <= 4) ? 250 : 600) * 1e6;
  function imgBytes(img) { let b = 0; if (img && img.ch) for (const c of img.ch) b += (c && c.byteLength) || 0; return b; }
  function recordUndo() {
    const key = state.activeWorkflowKey;
    const cur = key ? state.workflowImages[key] : null;
    if (!cur) return;
    const top = state.undoStack[state.undoStack.length - 1];
    if (top && top.key === key && top.img === cur) return; // ya registrado (evita duplicados)
    state.undoStack.push({ key, img: cur });
    let total = 0;
    for (const s of state.undoStack) total += imgBytes(s.img);
    while (state.undoStack.length > 1 && total > UNDO_BUDGET_BYTES) total -= imgBytes(state.undoStack.shift().img);
    if (state.undoStack.length > 30) state.undoStack.shift();
    state.redoStack.length = 0; // una acción nueva invalida el redo
    updateUndoButtons();
  }
  function _restoreSnapshot(snap) {
    state.workflowImages[snap.key] = snap.img;
    state.activeWorkflowKey = snap.key;
    state.activeImage = snap.img;
    state.stepInputImage = cloneImage(snap.img);
    state.pendingPreview = false;
    state.viewingPrevious = false;
    state.splitViewMode = false;
    state.previewMaskMode = false;
    state.previewGradientMode = false;
    render(); drawHistogram(); refreshPathBar(); updateUndoButtons();
  }
  function doUndo() {
    if (!state.undoStack.length) return;
    const key = state.activeWorkflowKey || state.undoStack[state.undoStack.length - 1].key;
    const cur = state.workflowImages[key];
    const snap = state.undoStack.pop();
    if (cur) state.redoStack.push({ key, img: cur });
    _restoreSnapshot(snap);
    const lang = document.documentElement.lang || "es";
    logConsole(lang === "es" ? "Deshacer" : "Undo", "info");
  }
  function doRedo() {
    if (!state.redoStack.length) return;
    const key = state.activeWorkflowKey;
    const cur = key ? state.workflowImages[key] : null;
    const snap = state.redoStack.pop();
    if (cur) state.undoStack.push({ key, img: cur });
    _restoreSnapshot(snap);
    const lang = document.documentElement.lang || "es";
    logConsole(lang === "es" ? "Rehacer" : "Redo", "info");
  }
  function updateUndoButtons() {
    const u = el("btnToolUndo"), r = el("btnToolRedo");
    if (u) { u.disabled = state.undoStack.length === 0; u.classList.toggle("piw-tool-disabled", state.undoStack.length === 0); }
    if (r) { r.disabled = state.redoStack.length === 0; r.classList.toggle("piw-tool-disabled", state.redoStack.length === 0); }
    updateMemIndicator();
  }
  // UNDO-REDO-END

  // MEM-INDICATOR-BEGIN (V3): estimación de la RAM ocupada por imágenes, contando cada buffer
  // UNA sola vez aunque esté referenciado desde varios sitios (workflow/slots/undo comparten refs).
  function updateMemIndicator() {
    const lbl = el("lblMemUse");
    if (!lbl) return;
    const seen = new Set();
    let bytes = 0;
    const add = (img) => {
      if (!img || !img.ch) return;
      for (const c of img.ch) { if (c && c.buffer && !seen.has(c.buffer)) { seen.add(c.buffer); bytes += c.byteLength; } }
    };
    Object.values(state.workflowImages || {}).forEach(add);
    (state.imageSlots || []).forEach(add);
    (state.undoStack || []).forEach(s => add(s.img));
    (state.redoStack || []).forEach(s => add(s.img));
    add(state.activeImage); add(state.stepInputImage); add(state.originalImage);
    add(state.starlessImage); add(state.starsImage);
    lbl.textContent = bytes > 0 ? "RAM img: " + (bytes / 1e6).toFixed(0) + " MB" : "";
  }
  setInterval(updateMemIndicator, 4000);
  // MEM-INDICATOR-END

  // STAGES-BAR-BEGIN (U3): historial visible de pasos aplicados (stages) bajo la barra de canales.
  function updateStagesBar() {
    const bar = el("piwStagesBar");
    if (!bar) return;
    const st = (state.activeImage && state.activeImage.stages) || [];
    if (!st.length) { bar.style.display = "none"; return; }
    bar.style.display = "block";
    const shown = st.length > 7 ? st.slice(-7) : st;
    bar.textContent = (st.length > 7 ? "… → " : "") + shown.join(" → ");
    bar.title = st.join(" → ");
  }
  // STAGES-BAR-END

  // SESSION-BEGIN (U2): autoguardado de la sesión en IndexedDB. Se guarda el flujo COMMITTEADO
  // (workflowImages) tras cada Aplicar, con debounce; al cargar la página se ofrece recuperarla.
  const SESSION_DB = "piw-session";
  function sessionDB() {
    return new Promise((res, rej) => {
      const rq = indexedDB.open(SESSION_DB, 1);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains("images")) db.createObjectStore("images");
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }
  let _sessTimer = 0;
  function scheduleSessionSave() {
    if (_sessTimer) clearTimeout(_sessTimer);
    _sessTimer = setTimeout(saveSessionNow, 2500);
  }
  async function saveSessionNow() {
    _sessTimer = 0;
    try {
      const keys = Object.keys(state.workflowImages || {});
      if (!keys.length) return;
      const db = await sessionDB();
      const tx = db.transaction(["images", "meta"], "readwrite");
      const st = tx.objectStore("images");
      st.clear();
      keys.forEach((k) => {
        const im = state.workflowImages[k];
        st.put({ ch: im.ch, w: im.w, h: im.h, nc: im.nc, isColor: im.isColor, wcs: im.wcs || null, stages: im.stages || [] }, k);
      });
      tx.objectStore("meta").put({ keys, activeKey: state.activeWorkflowKey, savedAt: Date.now() }, "session");
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    } catch (e) { console.warn("Session save:", e); }
  }
  async function loadSessionMeta() {
    try {
      const db = await sessionDB();
      return await new Promise((res) => {
        const rq = db.transaction("meta").objectStore("meta").get("session");
        rq.onsuccess = () => res(rq.result || null);
        rq.onerror = () => res(null);
      });
    } catch (e) { return null; }
  }
  async function restoreSession() {
    const meta = await loadSessionMeta();
    if (!meta || !meta.keys || !meta.keys.length) return false;
    const db = await sessionDB();
    const imgs = {};
    await Promise.all(meta.keys.map((k) => new Promise((res) => {
      const rq = db.transaction("images").objectStore("images").get(k);
      rq.onsuccess = () => { if (rq.result && rq.result.ch) imgs[k] = rq.result; res(); };
      rq.onerror = () => res();
    })));
    const keys = Object.keys(imgs);
    if (!keys.length) return false;
    state.workflowImages = imgs;
    const ak = imgs[meta.activeKey] ? meta.activeKey : keys[0];
    state.activeWorkflowKey = ak;
    setActiveImage(imgs[ak]);   // habilita toda la UI (misma ruta que una carga normal)
    refreshPathBar();
    return true;
  }
  async function clearSession() {
    try {
      const db = await sessionDB();
      const tx = db.transaction(["images", "meta"], "readwrite");
      tx.objectStore("images").clear();
      tx.objectStore("meta").clear();
    } catch (e) { /* borrar la sesión nunca debe romper el flujo */ }
  }
  // Banner persistente (no auto-expira) con Recuperar / Descartar.
  function showRestoreBanner(meta) {
    const lang = document.documentElement.lang || "es";
    const wrap = document.createElement("div");
    wrap.className = "piw-toast-wrap";
    wrap.style.pointerEvents = "auto";
    const t = document.createElement("div");
    t.className = "piw-toast show";
    t.style.pointerEvents = "auto";
    const span = document.createElement("div");
    const mins = Math.max(1, Math.round((Date.now() - (meta.savedAt || Date.now())) / 60000));
    span.textContent = (lang === "es"
      ? `Sesión guardada hace ${mins} min (${meta.keys.join(", ")})`
      : `Session saved ${mins} min ago (${meta.keys.join(", ")})`);
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;margin-top:8px;";
    const bR = document.createElement("button");
    bR.className = "piw-btn primary"; bR.style.cssText = "padding:5px 10px;font-size:0.62rem;width:auto;";
    bR.textContent = lang === "es" ? "Recuperar" : "Restore";
    const bD = document.createElement("button");
    bD.className = "piw-btn"; bD.style.cssText = "padding:5px 10px;font-size:0.62rem;width:auto;";
    bD.textContent = lang === "es" ? "Descartar" : "Discard";
    bR.onclick = async () => {
      wrap.remove();
      showLoader(lang === "es" ? "Recuperando sesión..." : "Restoring session...");
      try {
        const ok = await restoreSession();
        logConsole(ok ? (lang === "es" ? "Sesión recuperada" : "Session restored")
                      : (lang === "es" ? "No se pudo recuperar la sesión" : "Could not restore session"), ok ? "ok" : "err");
      } finally { hideLoader(); }
    };
    bD.onclick = () => { wrap.remove(); clearSession(); };
    row.appendChild(bR); row.appendChild(bD);
    t.appendChild(span); t.appendChild(row); wrap.appendChild(t);
    document.body.appendChild(wrap);
  }
  // SESSION-END

  // -------------------------------------------------------------------------
  // Auto STF MAD — Port exacto de PI Workflow (optMadMidtone + optApplyMadAutoStretch)
  //
  // Ref: PI Workflow.js líneas 1449-1523
  //   shadow  = max(0,  median - 1.25 * MAD)          // ← MAD sin escalar 1.4826
  //   midtone = MTF(0.25, median - shadow)             // ← target background = 0.25
  //   MTF(m, x) = (m-1)·x / ((2m-1)·x - m)
  //
  // Modos:
  //   linked=false  → Unlinked: parámetros independientes por canal (unlinked MAD AutoSTF)
  //   linked=true   → Linked:   media de medianas y MADs de los 3 canales RGB
  //
  // Devuelve nuevos Float32Array estirados para previsualización.
  // El original NO se modifica (trabaja sobre copias).
  // -------------------------------------------------------------------------

  // Función MTF (Midtone Transfer Function) de PixInsight
  // MTF(m, x) = (m-1)·x / ((2m-1)·x - m)
  // Port directo de optMadMidtone() en PI Workflow.js:1449
  function optMadMidtone(median, shadow, targetBackground) {
    var value = median - shadow;
    var target = isFinite(targetBackground) ? targetBackground : 0.25;
    // Si la diferencia es casi nula o negativa (por ejemplo, fondos restados agresivamente),
    // usamos un valor de estirado por defecto (0.002) en lugar de 0.5 para que no se vea negra.
    if (!isFinite(value) || value <= 0.0001) return 0.002;
    var denom = (2 * target - 1) * value - target;
    if (Math.abs(denom) < 1.0e-12) return 0.002;
    var midtone = (target - 1) * value / denom;
    if (!isFinite(midtone)) return 0.002;
    return Math.max(0.0001, Math.min(0.9999, midtone));
  }

  // Mediana rápida por muestreo (≤ MAX_SAMPLES puntos para rendimiento)
  function fastSampledMedian(ch) {
    const n = ch.length;
    const MAX_SAMPLES = 500000;
    let arr;
    if (n > MAX_SAMPLES) {
      arr = new Float32Array(MAX_SAMPLES);
      const step = Math.floor(n / MAX_SAMPLES);
      for (let i = 0; i < MAX_SAMPLES; i++) arr[i] = ch[i * step];
    } else {
      arr = Float32Array.from(ch);
    }
    arr.sort();
    const mid = arr.length >> 1;
    return arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) * 0.5 : arr[mid];
  }

  // MAD rápido por muestreo dado la mediana ya calculada
  function fastSampledMAD(ch, median) {
    const n = ch.length;
    const MAX_SAMPLES = 500000;
    const sampleCount = Math.min(n, MAX_SAMPLES);
    const step = n > MAX_SAMPLES ? Math.floor(n / MAX_SAMPLES) : 1;
    const absDevs = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) absDevs[i] = Math.abs(ch[i * step] - median);
    absDevs.sort();
    const mid = absDevs.length >> 1;
    return absDevs.length % 2 === 0 ? (absDevs[mid - 1] + absDevs[mid]) * 0.5 : absDevs[mid];
  }

  // Port directo de optApplyMadAutoStretch() en PI Workflow.js:1463
  // linked=false → unlinked (parámetros por canal, como "mad-unlinked")
  // linked=true  → linked   (parámetros compartidos, como "mad-linked")
  function applyAutoSTF(channels, nc, isColor, linked) {
    const TB = 0.25; // targetBackground
    const n = channels[0].length;
    const shadows  = [0.0, 0.0, 0.0];
    const midtones = [0.5, 0.5, 0.5];

    if (linked === true && isColor && nc >= 3) {
      // Modo LINKED: media de medianas y MADs de los 3 canales
      var sumMedian = 0.0, sumMad = 0.0;
      for (var c0 = 0; c0 < 3; c0++) {
        const med = fastSampledMedian(channels[c0]);
        sumMedian += med;
        sumMad    += fastSampledMAD(channels[c0], med);
      }
      const linkedMedian = sumMedian / 3.0;
      // Clampeamos el MAD mínimo a 0.0005 para evitar colapsos visuales y estirados verticales infinitos
      const linkedMad    = Math.max(0.0005, sumMad / 3.0);
      const linkedShadow = Math.max(0.0, linkedMedian - 1.25 * linkedMad);
      const linkedMidtone = optMadMidtone(linkedMedian, linkedShadow, TB);
      shadows[0]  = shadows[1]  = shadows[2]  = linkedShadow;
      midtones[0] = midtones[1] = midtones[2] = linkedMidtone;
    } else {
      // Modo UNLINKED: parámetros independientes por canal
      const count = Math.min(nc, 3);
      for (var c1 = 0; c1 < count; c1++) {
        const median = fastSampledMedian(channels[c1]);
        // Clampeamos el MAD mínimo a 0.0005 para evitar colapsos visuales y estirados verticales infinitos
        const mad    = Math.max(0.0005, fastSampledMAD(channels[c1], median));
        const shadow = Math.max(0.0, median - 1.25 * mad);
        shadows[c1]  = isFinite(shadow) ? shadow : 0.0;
        midtones[c1] = optMadMidtone(median, shadows[c1], TB);
      }
    }

    // Equivalente a HistogramTransformation de PixInsight:
    // H(x) = MTF(midtone, clamp01((x - shadow) / (1 - shadow)))
    // MTF(m, x) = (m-1)·x / ((2m-1)·x - m)
    function mtfPure(m, x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var denom = (2 * m - 1) * x - m;
      if (Math.abs(denom) < 1e-12) return x;
      return (m - 1) * x / denom;
    }

    const result = [];
    for (let c = 0; c < nc; c++) {
      const src = channels[c];
      const dst = new Float32Array(n);
      const sh = shadows[c]  || 0.0;
      const mt = midtones[c] || 0.5;
      const scale = sh >= 1.0 ? 1.0 : (1.0 - sh);
      for (let i = 0; i < n; i++) {
        const x = Math.max(0.0, Math.min(1.0, (src[i] - sh) / scale));
        dst[i] = mtfPure(mt, x);
      }
      result.push(dst);
    }
    return result;
  }


  // Convierte coordenadas de píxel de imagen a coordenadas de Canvas
  function getCanvasCoords(imgX, imgY) {
    const rect = cv.getBoundingClientRect();
    const scaleX = cv.width / rect.width;
    const scaleY = cv.height / rect.height;
    
    // Centrar
    const cx = cv.width / 2 + state.panX;
    const cy = cv.height / 2 + state.panY;
    
    const x = cx + (imgX - state.activeImage.w / 2) * state.zoom;
    const y = cy + (imgY - state.activeImage.h / 2) * state.zoom;
    return { x, y };
  }

