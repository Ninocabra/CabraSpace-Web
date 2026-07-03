/* =========================================================================
 * pi-workflow.js — Motor de Procesado y UI de PI Workflow
 *
 * ARCHIVO GENERADO por tools/build_piw.py desde los fragmentos de src/piw/
 * (NO editar a mano: edita el fragmento y regenera).
 *
 * Coordina las operaciones cliente de pre-procesado, estirado, máscaras
 * y mezcla de canales directamente en el navegador.
 * ========================================================================= */

(function () {
  "use strict";

  // --- CONFIGURACIÓN Y ESTADO GLOBAL ---
  let MAX_PREVIEW_DIM = 4000; // Resolución máx. de trabajo (default 4000 = máxima calidad; ajustable por el selector "Resolución de trabajo"). Se aplica al cargar.
  const wl = [0.2126, 0.7152, 0.0722]; // Pesos de luminancia Rec.709

  const state = {
    // Canales de carga inicial (Tab 0): 0=R, 1=G, 2=B, 3=L, 4=SII, 5=Ha, 6=OIII, 7=Color RGB Directa
    loadedChannels: [null, null, null, null, null, null, null, null],
    channelNames: ["", "", "", "", "", "", "", ""],
    
    // Capas cargadas externamente (Tab 1): Starless y Stars
    starlessImage: null,
    starsImage: null,

    // Imagen activa actual en el espacio de trabajo
    activeImage: null, // { ch: [Float32Array], w, h, nc, isColor }
    originalImage: null, // Para deshacer o comparar
    stepInputImage: null, // Entrada inicial para la sección actual (previene cambios acumulados)
    subtractedGradient: null, // Modelo del gradiente extraído para visualización
    previewGradientMode: false, // Si true, renderiza el gradiente en lugar de la imagen
    wcs: null, // Metadatos WCS del Plate Solving (se preserva globalmente)
    
    // Máscaras
    activeMask: null, // Float32Array (tamaño w * h, valores [0, 1])
    previewMaskMode: false, // Si true, renderiza la máscara en lugar de la imagen
    screenStretchMode: false, // Estirado temporal AutoSTF (MAD) de pantalla para imágenes lineales
    workflowImages: {}, // Guarda las imágenes del flujo, ej. {"R": img, "MonoRGB": img}
    activeWorkflowKey: "", // Clave del flujo activa actual, ej. "R" o "MonoRGB"

    // Slots de memoria (1 a 8)
    imageSlots: new Array(8).fill(null),
    maskSlots: new Array(8).fill(null),
    activeSlotIdx: -1,
    // Historial global Undo/Redo: pilas de { key, img } (referencias a imágenes committeadas;
    // las operaciones crean objetos nuevos, así que guardar referencias es correcto y sin copias).
    undoStack: [],
    redoStack: [],
    // Tras "Comparar Métodos" de Color Calibration: permite que "Aplicar Calibración"
    // esté activo aunque no haya card seleccionada, para confirmar el slot elegido.
    calibCompareReady: false,

    // Visualización
    zoom: 1,
    panX: 0,
    panY: 0,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,

    // Comparación Split (Cortinilla)
    splitViewMode: false,
    splitPercent: 0.5, // 0.0 a 1.0 (posición del control deslizante)
    isDraggingSplit: false,
    splitCompareImage: null, // Imagen contra la que se compara (ej. Slot o Original)
    previousImage: null,
    viewingPrevious: false,
    _lastImgRef: null,
    pendingPreview: false, // Hay un preview sin aplicar en el menú actual → habilita "Aplicar"

    // Hue Rueda de color
    selectedHue: 180,
  };

  let narrowbandFormulas = [];

  // --- ELEMENTOS DEL DOM ---
  const el = (id) => document.getElementById(id);
  const cv = el("piwCanvas");
  const ctx = cv.getContext("2d");
  const container = el("canvasContainer");
  const loader = el("piwLoader");
  const loaderText = el("piwLoaderText");
  const consoleOutput = el("piwConsoleOutput");

  // --- UTILIDADES ---
  function logConsole(msg, type = "info") {
    const time = new Date().toTimeString().split(" ")[0];
    const line = document.createElement("div");
    line.className = "piw-console-line";
    line.innerHTML = `<span class="time">[${time}]</span><span class="${type}">${msg}</span>`;
    consoleOutput.appendChild(line);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
    // TOAST: los ok/err también se muestran como aviso efímero sobre el visor
    // (la consola queda abajo y no se ve en iPad). Los "info" se quedan solo en consola.
    if (type === "ok" || type === "err") showToast(msg, type);
  }

  // Aviso efímero (toast) arriba a la derecha. Dedupe de ráfagas y máximo 3 apilados.
  let _toastWrap = null, _lastToast = { msg: "", t: 0 };
  function showToast(msg, type) {
    try {
      const now = Date.now();
      if (msg === _lastToast.msg && now - _lastToast.t < 1500) return;
      _lastToast = { msg, t: now };
      if (!_toastWrap) {
        _toastWrap = document.createElement("div");
        _toastWrap.className = "piw-toast-wrap";
        document.body.appendChild(_toastWrap);
      }
      while (_toastWrap.children.length >= 3) _toastWrap.removeChild(_toastWrap.firstChild);
      const t = document.createElement("div");
      t.className = "piw-toast" + (type === "err" ? " err" : "");
      t.textContent = (type === "err" ? "✕ " : "✓ ") + msg;
      _toastWrap.appendChild(t);
      // setTimeout (no rAF): rAF no dispara con la pestaña en segundo plano y el toast se quedaría invisible.
      setTimeout(() => t.classList.add("show"), 15);
      setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 220); }, 2600);
    } catch (e) { /* el toast nunca debe romper el flujo */ }
  }

  function showLoader(text) {
    loaderText.textContent = text;
    loader.style.display = "flex";
  }

  // Cierra el loader de UI
  function hideLoader() {
    loader.style.display = "none";
  }

  function cloneImage(img) {
    if (!img) return null;
    const copy = {
      w: img.w,
      h: img.h,
      nc: img.nc,
      isColor: img.isColor,
      ch: []
    };
    for (let c = 0; c < img.nc; ++c) {
      copy.ch[c] = Float32Array.from(img.ch[c]);
    }
    if (img.wcs) {
      copy.wcs = { ...img.wcs };
    }
    if (img.hasTransforms) {
      copy.hasTransforms = img.hasTransforms;
    }
    if (Array.isArray(img.stages)) {
      copy.stages = img.stages.slice();
    }
    return copy;
  }

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
  function commitActiveImage(result, stageLabel, sourceImg) {
    recordUndo(); // guarda el estado committeado anterior para poder deshacer
    const src = sourceImg || state.stepInputImage || state.activeImage;
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

  // --- CROP STATE & LOGIC ---
  const CROP_MIN_SIZE = 64;
  const CROP_HIT_TOLERANCE_PX = 10;
  const CROP_HANDLE_NONE = -1;
  const CROP_HANDLE_TL = 0, CROP_HANDLE_TM = 1, CROP_HANDLE_TR = 2;
  const CROP_HANDLE_ML = 3,                       CROP_HANDLE_MR = 4;
  const CROP_HANDLE_BL = 5, CROP_HANDLE_BM = 6, CROP_HANDLE_BR = 7;
  const CROP_HANDLE_INSIDE = 8;

  let cropState = {
    rect: null, // { x, y, width, height } in image coordinates
    drawing: false,
    dragMode: "", // "move", "resize", "draw"
    dragHandle: CROP_HANDLE_NONE,
    dragStartImgX: 0,
    dragStartImgY: 0,
    dragStartRect: null
  };

  // Convert canvas event coordinates to image coordinates
  function getImageCoordsFromEvent(e) {
    if (!state.activeImage) return { x: 0, y: 0 };
    const rect = cv.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // El canvas llena el recuadro con object-fit:contain: el bitmap (cv.width × cv.height) se escala a
    // 'fit' y se CENTRA (letterbox). Mapeamos ratón→imagen con esa escala y desplazamiento.
    const s = Math.min(rect.width / cv.width, rect.height / cv.height) || 1;
    const ox = (rect.width - cv.width * s) / 2;
    const oy = (rect.height - cv.height * s) / 2;
    const imgX = (mouseX - ox) / s;
    const imgY = (mouseY - oy) / s;

    return {
      x: Math.max(0, Math.min(state.activeImage.w - 1, Math.floor(imgX))),
      y: Math.max(0, Math.min(state.activeImage.h - 1, Math.floor(imgY)))
    };
  }

  function cropClampRect(rect, imgW, imgH) {
    let x1 = Math.max(0, Math.min(imgW - 1, rect.x));
    let y1 = Math.max(0, Math.min(imgH - 1, rect.y));
    let w = Math.max(CROP_MIN_SIZE, Math.min(imgW - x1, rect.width));
    let h = Math.max(CROP_MIN_SIZE, Math.min(imgH - y1, rect.height));
    return { x: x1, y: y1, width: w, height: h };
  }

  function cropHandlePositions(r) {
    if (!r) return [];
    const { x, y, width: w, height: h } = r;
    const halfW = w / 2;
    const halfH = h / 2;
    return [
      { x: x, y: y },         // TL
      { x: x + halfW, y: y }, // TM
      { x: x + w, y: y },     // TR
      { x: x, y: y + halfH }, // ML
      { x: x + w, y: y + halfH }, // MR
      { x: x, y: y + h },     // BL
      { x: x + halfW, y: y + h }, // BM
      { x: x + w, y: y + h }  // BR
    ];
  }

  function cropHitTest(rect, ix, iy) {
    if (!rect) return CROP_HANDLE_NONE;
    const handles = cropHandlePositions(rect);
    const toleranceImg = CROP_HIT_TOLERANCE_PX / state.zoom;
    
    for (let i = 0; i < handles.length; i++) {
      const dx = ix - handles[i].x;
      const dy = iy - handles[i].y;
      if (Math.sqrt(dx*dx + dy*dy) <= toleranceImg) {
        return i;
      }
    }
    
    if (ix >= rect.x && ix <= rect.x + rect.width && iy >= rect.y && iy <= rect.y + rect.height) {
      return CROP_HANDLE_INSIDE;
    }
    
    return CROP_HANDLE_NONE;
  }

  function cropResizeFromHandle(startRect, handle, ix, iy, imgW, imgH) {
    let x1 = startRect.x;
    let y1 = startRect.y;
    let x2 = startRect.x + startRect.width;
    let y2 = startRect.y + startRect.height;
    
    switch (handle) {
      case CROP_HANDLE_TL:
        x1 = Math.min(x2 - CROP_MIN_SIZE, Math.max(0, ix));
        y1 = Math.min(y2 - CROP_MIN_SIZE, Math.max(0, iy));
        break;
      case CROP_HANDLE_TM:
        y1 = Math.min(y2 - CROP_MIN_SIZE, Math.max(0, iy));
        break;
      case CROP_HANDLE_TR:
        x2 = Math.max(x1 + CROP_MIN_SIZE, Math.min(imgW - 1, ix));
        y1 = Math.min(y2 - CROP_MIN_SIZE, Math.max(0, iy));
        break;
      case CROP_HANDLE_ML:
        x1 = Math.min(x2 - CROP_MIN_SIZE, Math.max(0, ix));
        break;
      case CROP_HANDLE_MR:
        x2 = Math.max(x1 + CROP_MIN_SIZE, Math.min(imgW - 1, ix));
        break;
      case CROP_HANDLE_BL:
        x1 = Math.min(x2 - CROP_MIN_SIZE, Math.max(0, ix));
        y2 = Math.max(y1 + CROP_MIN_SIZE, Math.min(imgH - 1, iy));
        break;
      case CROP_HANDLE_BM:
        y2 = Math.max(y1 + CROP_MIN_SIZE, Math.min(imgH - 1, iy));
        break;
      case CROP_HANDLE_BR:
        x2 = Math.max(x1 + CROP_MIN_SIZE, Math.min(imgW - 1, ix));
        y2 = Math.max(y1 + CROP_MIN_SIZE, Math.min(imgH - 1, iy));
        break;
    }
    
    return {
      x: x1,
      y: y1,
      width: x2 - x1,
      height: y2 - y1
    };
  }

  function cropUpdateStatus() {
    const lbl = el("lblCropStatus");
    const btnCur = el("btnCropApplyCurrent");
    const btnAll = el("btnCropApplyAll");
    if (!lbl) return;
    
    const lang = document.documentElement.lang || "es";
    if (cropState.rect) {
      const r = cropState.rect;
      lbl.textContent = `● ${r.width} × ${r.height} px @ (${r.x}, ${r.y})`;
      if (btnCur) btnCur.removeAttribute("disabled");
      if (btnAll) btnAll.removeAttribute("disabled");
    } else {
      lbl.textContent = lang === "es" ? "● Sin selección" : "● No selection";
      if (btnCur) btnCur.setAttribute("disabled", "true");
      if (btnAll) btnAll.setAttribute("disabled", "true");
    }
    updateBigApply();
  }

  function cropApplyToImage(imgObj, rect) {
    const { x, y, width: w, height: h } = rect;
    const srcW = imgObj.w;
    const result = { w, h, nc: imgObj.nc, isColor: imgObj.isColor, ch: [], hasTransforms: true };
    for (let c = 0; c < imgObj.nc; c++) {
      const dst = new Float32Array(w * h);
      for (let row = 0; row < h; row++) {
        const srcOffset = (y + row) * srcW + x;
        dst.set(imgObj.ch[c].subarray(srcOffset, srcOffset + w), row * w);
      }
      result.ch.push(dst);
    }
    // El recorte cambia la geometría: la solución astrométrica (wcs) deja de ser válida y NO se
    // propaga — hay que volver a resolver. Es coherente con la salvaguarda del script, que descarta
    // la astrometría dependiente de dimensiones tras un crop. El historial de stages sí se preserva.
    const stages = Array.isArray(imgObj.stages) ? imgObj.stages.slice() : [];
    stages.push("Crop");
    result.stages = stages;
    return result;
  }

  function drawCropOverlay(ctx, rect) {
    if (!rect || !state.activeImage) return;
    const w = state.activeImage.w;
    const h = state.activeImage.h;
    
    // Draw shaded exterior areas
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    // Top box
    ctx.fillRect(0, 0, w, rect.y);
    // Bottom box
    ctx.fillRect(0, rect.y + rect.height, w, h - (rect.y + rect.height));
    // Left box
    ctx.fillRect(0, rect.y, rect.x, rect.height);
    // Right box
    ctx.fillRect(rect.x + rect.width, rect.y, w - (rect.x + rect.width), rect.height);
    
    // Draw amber border
    ctx.strokeStyle = "#FFD000";
    ctx.lineWidth = Math.max(1, 2 / state.zoom);
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    
    // Draw handles
    const handles = cropHandlePositions(rect);
    const size = Math.max(4, 8 / state.zoom);
    ctx.fillStyle = "#FFD000";
    for (const hd of handles) {
      ctx.fillRect(hd.x - size/2, hd.y - size/2, size, size);
    }
  }

  // Bind Apply Crop Buttons
  if (el("btnCropApplyCurrent")) {
    el("btnCropApplyCurrent").addEventListener("click", () => {
      if (!cropState.rect || !state.activeImage) return;
      const cropped = cropApplyToImage(state.activeImage, cropState.rect);
      state.activeImage = cropped;
      if (state.activeWorkflowKey) {
        state.workflowImages[state.activeWorkflowKey] = cropped;
      }
      const hadWcs = !!state.wcs;
      state.wcs = null; // geometría cambiada → plate-solve invalidado
      if (typeof annotOnWcsChanged === "function") annotOnWcsChanged(); // apaga la anotación si estaba activa
      cropState.rect = null;
      cropUpdateStatus();
      refreshPathBar();
      render();
      const lang = document.documentElement.lang || "es";
      logConsole(lang === "es" ? `Crop aplicado a imagen actual (${cropped.w}×${cropped.h} px)` : `Crop applied to current image (${cropped.w}×${cropped.h} px)`, "info");
      if (hadWcs) logConsole(lang === "es" ? "El recorte invalidó la solución astrométrica: vuelve a ejecutar Plate Solving antes de PCC." : "Crop invalidated the astrometric solution: re-run Plate Solving before PCC.", "warn");
    });
  }

  if (el("btnCropApplyAll")) {
    el("btnCropApplyAll").addEventListener("click", () => {
      if (!cropState.rect || !state.activeImage) return;
      const rect = cropState.rect;
      for (const key of Object.keys(state.workflowImages)) {
        state.workflowImages[key] = cropApplyToImage(state.workflowImages[key], rect);
      }
      if (state.activeWorkflowKey && state.workflowImages[state.activeWorkflowKey]) {
        state.activeImage = state.workflowImages[state.activeWorkflowKey];
      } else {
        state.activeImage = cropApplyToImage(state.activeImage, rect);
      }
      const hadWcs = !!state.wcs;
      state.wcs = null; // geometría cambiada → plate-solve invalidado
      if (typeof annotOnWcsChanged === "function") annotOnWcsChanged(); // apaga la anotación si estaba activa
      cropState.rect = null;
      cropUpdateStatus();
      refreshPathBar();
      render();
      const lang = document.documentElement.lang || "es";
      logConsole(lang === "es" ? `Crop aplicado a todo el flujo (${state.activeImage.w}×${state.activeImage.h} px)` : `Crop applied to all workflow images (${state.activeImage.w}×${state.activeImage.h} px)`, "info");
      if (hadWcs) logConsole(lang === "es" ? "El recorte invalidó la solución astrométrica: vuelve a ejecutar Plate Solving antes de PCC." : "Crop invalidated the astrometric solution: re-run Plate Solving before PCC.", "warn");
    });
  }

  // --- PLATE SOLVING CON ASTROMETRY.NET ---
  const ASTROMETRY_API_KEY = "coqpscljnloiluyi";
  // CF-WORKER-BEGIN
  // Proxy CORS para Astrometry.net en producción (Vercel Edge Function).
  // Código y despliegue: vercel-proxy/. Vacío = en producción muestra el mensaje guía.
  let ASTROMETRY_PROXY_URL = "https://astronomy-proxy.vercel.app";
  // CF-WORKER-END

  // Redirige las peticiones a Astrometry.net a través del proxy CORS de Vercel. El proxy admite
  // orígenes localhost, así que se usa el MISMO tanto en local como en producción. (Antes, en
  // localhost se apuntaba a http://localhost:8010 —un proxy de dev que normalmente no está
  // levantado—, por lo que el plate solve fallaba al probar en local.)
  function corsFetch(url, options = {}) {
    // CF-WORKER-BEGIN
    if (ASTROMETRY_PROXY_URL) {
      const proxyUrl = url.replace("https://nova.astrometry.net", ASTROMETRY_PROXY_URL);
      return fetch(proxyUrl, options);
    }
    const errMsg = document.documentElement.lang === "es"
      ? "El plate solve requiere configurar ASTROMETRY_PROXY_URL (proxy Vercel). Consulta vercel-proxy/README.md."
      : "Plate solving requires configuring ASTROMETRY_PROXY_URL (Vercel proxy). Refer to vercel-proxy/README.md.";
    logConsole(errMsg, "error");
    return Promise.reject(new Error(errMsg));
    // CF-WORKER-END
  }

  // PLATE-SOLVE-HARDEN-BEGIN
  // Lee una respuesta del plate solve como JSON con error CLARO si llega HTML/no-OK (en vez del
  // críptico "Unexpected token '<'"). Reintenta en fallos transitorios (solo peticiones idempotentes).
  async function solveFetchJson(url, options, label, retries = 0) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await corsFetch(url, options);
        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          const snip = (text || "").trim().slice(0, 140).replace(/\s+/g, " ");
          const server = res.headers.get("server") || "?";
          const sw = (typeof navigator !== "undefined" && navigator.serviceWorker && navigator.serviceWorker.controller) ? "SW-activo" : "sin-SW";
          throw new Error(`${label} → no-JSON (HTTP ${res.status}, server=${server}, ${sw}). Servidor devolvió: "${snip}…"`);
        }
        if (!res.ok) throw new Error(`${label} → HTTP ${res.status}: ${data.errmessage || data.error || "error del servidor"}`);
        return data;
      } catch (e) {
        lastErr = e;
        if (attempt < retries) { await new Promise(r => setTimeout(r, 1500)); continue; }
      }
    }
    throw lastErr;
  }

  async function getSessionKey() {
    const data = await solveFetchJson("https://nova.astrometry.net/api/login", {
      method: "POST",
      body: new URLSearchParams({
        "request-json": JSON.stringify({ apikey: ASTROMETRY_API_KEY })
      })
    }, "Login");
    if (data.status !== "success") {
      throw new Error(data.errmessage || "Login fallido");
    }
    return data.session;
  }

  // Comprimir imagen activa a Blob JPEG usando un canvas temporal de tamaño optimizado
  function getActiveImageAsJpegBlob() {
    return new Promise((resolve, reject) => {
      if (!state.activeImage) return reject(new Error("No active image"));
      
      const img = state.activeImage;
      const tempCv = document.createElement("canvas");
      // Escalar la imagen a un tamaño máximo de 800px para subirla super rápido
      const maxDim = 800;
      let w = img.w;
      let h = img.h;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      
      tempCv.width = w;
      tempCv.height = h;
      const tempCtx = tempCv.getContext("2d");
      
      // Dibujar imagen a color u monocromo en el canvas temporal
      let channelsToDraw = img.ch;
      if (state.screenStretchMode) {
        try {
          channelsToDraw = applyAutoSTF(img.ch, img.nc, img.isColor);
        } catch (e) {}
      }
      const id = AutoGHS.channelsToImageData(channelsToDraw, img.w, img.h, img.nc);
      
      // Para redimensionar con suavizado, dibujamos primero a tamaño completo y luego escalamos
      const fullCv = document.createElement("canvas");
      fullCv.width = img.w;
      fullCv.height = img.h;
      fullCv.getContext("2d").putImageData(id, 0, 0);
      
      tempCtx.drawImage(fullCv, 0, 0, w, h);
      
      tempCv.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Blob conversion failed"));
      }, "image/jpeg", 0.85);
    });
  }

  async function uploadImageToAstrometry(session, jpegBlob) {
    const form = new FormData();
    form.append("request-json", JSON.stringify({
      session: session,
      allow_commercial_use: "n",
      allow_modifications: "n",
      publicly_visible: "y"
    }));
    form.append("file", jpegBlob, "solve_img.jpg");

    const data = await solveFetchJson("https://nova.astrometry.net/api/upload", {
      method: "POST",
      body: form
    }, "Upload");
    if (data.status !== "success") {
      throw new Error(data.errmessage || "Upload fallido");
    }
    return data.subid;
  }

  async function pollSubmissionStatus(subid) {
    const url = `https://nova.astrometry.net/api/submissions/${subid}`;
    // Intentos de polling con reintento cada 5 segundos
    for (let i = 0; i < 40; i++) {
      const data = await solveFetchJson(url, undefined, "Estado de envío", 2);

      if (data.processing_finished === "true" || data.jobs && data.jobs.length > 0) {
        const job = data.jobs[0];
        if (job) return job;
      }
      
      await new Promise(r => setTimeout(r, 5000));
    }
    throw new Error("Timeout esperando resolución en Astrometry.net");
  }

  async function checkJobSolved(jobId) {
    const url = `https://nova.astrometry.net/api/jobs/${jobId}/info`;
    const data = await solveFetchJson(url, undefined, "Info del job", 2);
    if (data.status === "success") {
      return data;
    }
    return null;
  }

  // Espera a que el JOB termine de resolver (no basta con que exista). El job pasa por estados
  // "solving" -> "success"/"failure". Sondea /info cada 3s hasta terminar o agotar el tiempo.
  async function pollJobUntilSolved(jobId) {
    for (let i = 0; i < 60; i++) {
      const data = await solveFetchJson(`https://nova.astrometry.net/api/jobs/${jobId}/info`, undefined, "Estado del job", 2);
      if (data.status === "success") return true;
      if (data.status === "failure") return false;
      await new Promise(r => setTimeout(r, 3000));
    }
    throw new Error("Timeout esperando que Astrometry.net resuelva el campo.");
  }

  async function getCalibrationData(jobId) {
    const url = `https://nova.astrometry.net/api/jobs/${jobId}/calibration`;
    const data = await solveFetchJson(url, undefined, "Calibración", 2);
    return data;
  }
  // PLATE-SOLVE-HARDEN-END

  // Ejecución principal del solved
  async function performPlateSolving() {
    const lang = document.documentElement.lang || "es";
    if (!state.activeImage) {
      logConsole(lang === "es" ? "No hay ninguna imagen activa para resolver" : "No active image to solve", "err");
      return;
    }

    showLoader(lang === "es" ? "Iniciando Plate Solving..." : "Starting Plate Solving...");
    logConsole(lang === "es" ? "Conectando con Astrometry.net..." : "Connecting to Astrometry.net...", "info");
    
    try {
      const session = await getSessionKey();
      
      showLoader(lang === "es" ? "Comprimiendo y preparando imagen..." : "Compressing image...");
      const jpegBlob = await getActiveImageAsJpegBlob();
      
      showLoader(lang === "es" ? "Subiendo imagen a Astrometry.net..." : "Uploading image to Astrometry.net...");
      const subid = await uploadImageToAstrometry(session, jpegBlob);
      logConsole(lang === "es" ? `Envío de imagen exitoso (Submission ID: ${subid})` : `Upload successful (Submission ID: ${subid})`, "info");
      
      // Polling para esperar a que termine el procesamiento y nos devuelva el id del Job
      showLoader(lang === "es" ? "Resolviendo campo (espera de 10-30s)..." : "Solving field (waiting 10-30s)...");
      const jobId = await pollSubmissionStatus(subid);
      logConsole(lang === "es" ? `Job ID asignado: ${jobId}. Esperando a que resuelva...` : `Job ID assigned: ${jobId}. Waiting for solve...`, "info");

      // Esperar a que el job termine de RESOLVER (no basta con que exista; tarda 15-60s).
      showLoader(lang === "es" ? "Resolviendo campo (puede tardar 15-60s)..." : "Solving field (may take 15-60s)...");
      const solved = await pollJobUntilSolved(jobId);
      if (!solved) {
        throw new Error(lang === "es"
          ? "Astrometry.net no pudo resolver la imagen (campo no reconocido: prueba con más estrellas/menos procesada)."
          : "Astrometry.net could not solve the image (field not recognized: try a less-processed image with more stars).");
      }
      const calibration = await getCalibrationData(jobId);
      
      hideLoader();

      if (calibration && calibration.ra) {
        // Guardar metadatos WCS globalmente en state
        state.wcs = {
          ra: calibration.ra,
          dec: calibration.dec,
          radius: calibration.radius,
          pixscale: calibration.pixscale,
          orientation: calibration.orientation,
          parity: calibration.parity,
          // Dimensiones de la imagen al resolver: la pestaña Anotar rechaza el WCS
          // si la geometría cambió después (además del crop, que ya lo anula).
          imgW: state.activeImage.w,
          imgH: state.activeImage.h
        };
        // También en la imagen activa por compatibilidad
        state.activeImage.wcs = state.wcs;
        if (typeof annotOnWcsChanged === "function") annotOnWcsChanged();
        
        // Actualizar UI
        const statusLbl = el("lblSolveStatus");
        if (statusLbl) {
          const ar = calibration.ra.toFixed(4);
          const dec = calibration.dec.toFixed(4);
          statusLbl.textContent = `● AR:${ar}°, DEC:${dec}° (${calibration.pixscale.toFixed(2)}"/px)`;
          statusLbl.style.color = "#7ed89b";
        }
        
        logConsole(lang === "es" 
          ? `Plate Solving Exitoso! Centro AR: ${calibration.ra.toFixed(4)}°, DEC: ${calibration.dec.toFixed(4)}°, Escala: ${calibration.pixscale.toFixed(2)}"/px, Rotación: ${calibration.orientation.toFixed(1)}°`
          : `Plate Solving Successful! Center RA: ${calibration.ra.toFixed(4)}°, DEC: ${calibration.dec.toFixed(4)}°, Scale: ${calibration.pixscale.toFixed(2)}"/px, Rotation: ${calibration.orientation.toFixed(1)}°`, 
          "info"
        );
      } else {
        throw new Error("Astrometry.net no pudo resolver la imagen.");
      }
    } catch (err) {
      hideLoader();
      logConsole(lang === "es" ? `Error en Plate Solving: ${err.message}` : `Plate Solving Error: ${err.message}`, "err");
      const statusLbl = el("lblSolveStatus");
      if (statusLbl) {
        statusLbl.textContent = lang === "es" ? "● Error al resolver" : "● Solve failed";
        statusLbl.style.color = "#ff4a4a";
      }
    }
  }

  // Bind del botón
  if (el("btnSolveImage")) {
    el("btnSolveImage").addEventListener("click", (e) => {
      e.preventDefault();
      performPlateSolving();
    });
  }

  // --- CORRECCIÓN DE GRADIENTES (MGC, ABE, AutoDBE, GraXpert) ---

  // Ajusta un polinomio 2D de bajo grado sobre una imagen reducida (para rendimiento)
  // Grado 1 (plano inclinado): ax + by + c
  // Grado 2 (superficie cuadrática / viñeteo): ax^2 + by^2 + cxy + dx + ey + f
  function fitPolynomial2D(img, degree = 2, outlierRejection = true) {
    const w = img.w;
    const h = img.h;
    
    // Submuestrear la imagen a un tamaño manejable (~100 píxeles de ancho) para ajustar rápido
    const step = Math.max(1, Math.floor(w / 100));
    const samples = [];
    
    for (let c = 0; c < img.nc; c++) {
      const ch = img.ch[c];
      const chSamples = [];
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const val = ch[y * w + x];
          chSamples.push({ x: x / w, y: y / h, val: val }); // Coordenadas normalizadas [0, 1]
        }
      }
      
      // Ajuste iterativo por mínimos cuadrados con rechazo de valores atípicos (outliers de estrellas/nebulosas)
      let coeffs = solveLeastSquaresPolynomial(chSamples, degree);
      if (outlierRejection) {
        for (let iter = 0; iter < 3; iter++) {
          // Calcular desviación estándar de los residuos
          let sumSq = 0;
          const count = chSamples.length;
          const residuals = new Float32Array(count);
          for (let i = 0; i < count; i++) {
            const s = chSamples[i];
            const pVal = evaluatePolynomial(s.x, s.y, coeffs, degree);
            residuals[i] = s.val - pVal;
            sumSq += residuals[i] * residuals[i];
          }
          const stdDev = Math.sqrt(sumSq / count);
          
          // Filtrar muestras que se alejen demasiado (estrellas o nebulosas brillantes)
          // Evitamos que el umbral colapse a cero en tomas ya corregidas usando un mínimo de 0.002
          const filtered = chSamples.filter((s, idx) => Math.abs(residuals[idx]) < Math.max(2.0 * stdDev, 0.002));
          if (filtered.length > 10) {
            coeffs = solveLeastSquaresPolynomial(filtered, degree);
          }
        }
      }
      samples.push(coeffs);
    }
    return samples;
  }

  function evaluatePolynomial(x, y, c, d) {
    if (d === 1) {
      // ax + by + c
      return c[0] * x + c[1] * y + c[2];
    } else {
      // ax^2 + by^2 + cxy + dx + ey + f
      return c[0] * x * x + c[1] * y * y + c[2] * x * y + c[3] * x + c[4] * y + c[5];
    }
  }

  // Resuelve A * coeffs = B mediante eliminación de Gauss-Jordan con pivoteo parcial
  function solveLinearSystem(A, B) {
    const n = B.length;
    const mat = Array.from({ length: n }, (_, i) => Float64Array.from(A[i]));
    const rhs = Float64Array.from(B);
    
    for (let i = 0; i < n; i++) {
      // Búsqueda de pivote (pivoteo parcial)
      let maxRow = i;
      let maxVal = Math.abs(mat[i][i]);
      for (let r = i + 1; r < n; r++) {
        const val = Math.abs(mat[r][i]);
        if (val > maxVal) {
          maxVal = val;
          maxRow = r;
        }
      }
      
      // Intercambio de filas
      if (maxRow !== i) {
        const tempRow = mat[i];
        mat[i] = mat[maxRow];
        mat[maxRow] = tempRow;
        
        const tempRhs = rhs[i];
        rhs[i] = rhs[maxRow];
        rhs[maxRow] = tempRhs;
      }
      
      let pivot = mat[i][i];
      if (Math.abs(pivot) < 1e-15) {
        pivot = pivot >= 0 ? 1e-12 : -1e-12;
      }
      
      // Normalizar fila pivote
      for (let j = i; j < n; j++) {
        mat[i][j] /= pivot;
      }
      rhs[i] /= pivot;
      
      // Eliminar el resto de filas
      for (let k = 0; k < n; k++) {
        if (k !== i) {
          const factor = mat[k][i];
          for (let j = i; j < n; j++) {
            mat[k][j] -= factor * mat[i][j];
          }
          rhs[k] -= factor * rhs[i];
        }
      }
    }
    return rhs;
  }

  // Resuelve A * coeffs = B
  function solveLeastSquaresPolynomial(samples, degree) {
    const numCoeffs = degree === 1 ? 3 : 6;
    const A = Array.from({ length: numCoeffs }, () => new Float64Array(numCoeffs));
    const B = new Float64Array(numCoeffs);
    
    for (const s of samples) {
      let terms;
      if (degree === 1) {
        terms = [s.x, s.y, 1];
      } else {
        terms = [s.x * s.x, s.y * s.y, s.x * s.y, s.x, s.y, 1];
      }
      for (let i = 0; i < numCoeffs; i++) {
        for (let j = 0; j < numCoeffs; j++) {
          A[i][j] += terms[i] * terms[j];
        }
        B[i] += terms[i] * s.val;
      }
    }
    
    return solveLinearSystem(A, B);
  }

  // --- Lógica del modelo MGC ---
  function applyMGC(img, smooth, multipliers) {
    // Generar gradiente sintético bilineal/bicúbico suave
    const w = img.w;
    const h = img.h;
    const result = { w, h, nc: img.nc, isColor: img.isColor, ch: [] };
    
    // Ajustar un polinomio de grado 2 (con rechazo moderado)
    const coeffs = fitPolynomial2D(img, 2, true);
    
    for (let c = 0; c < img.nc; c++) {
      const src = img.ch[c];
      const dst = new Float32Array(w * h);
      const coeff = coeffs[c];
      const mult = multipliers[c] || 1.0;
      
      for (let y = 0; y < h; y++) {
        const ny = y / h;
        for (let x = 0; x < w; x++) {
          const nx = x / w;
          const idx = y * w + x;
          
          // Evaluar polinomio de fondo modelado
          const gradVal = evaluatePolynomial(nx, ny, coeff, 2) * smooth * mult;
          
          // Resta del gradiente
          dst[idx] = Math.max(0, src[idx] - gradVal);
        }
      }
      result.ch.push(dst);
    }
    return result;
  }

  // --- Lógica del modelo ABE ---
  // --- Lógica del modelo ABE ---
  function applyABE(img, degree, method, normalize) {
    const w = img.w;
    const h = img.h;
    const result = { w, h, nc: img.nc, isColor: img.isColor, ch: [] };
    const grad = { w, h, nc: img.nc, isColor: img.isColor, ch: [] };
    
    // Ajustar polinomio del grado configurado con fuerte rechazo de outliers
    const coeffs = fitPolynomial2D(img, degree, true);
    
    for (let c = 0; c < img.nc; c++) {
      const src = img.ch[c];
      const dst = new Float32Array(w * h);
      const bgCh = new Float32Array(w * h);
      const coeff = coeffs[c];
      
      // Calcular la media del canal original para normalización si es requerida
      let mean = 0;
      if (normalize) {
        let sum = 0;
        for (let i = 0; i < src.length; i++) sum += src[i];
        mean = sum / src.length;
      }
      
      for (let y = 0; y < h; y++) {
        const ny = y / h;
        for (let x = 0; x < w; x++) {
          const nx = x / w;
          const idx = y * w + x;
          
          const background = evaluatePolynomial(nx, ny, coeff, degree === 1 ? 1 : 2);
          bgCh[idx] = background;
          
          if (method === "subtraction") {
            dst[idx] = Math.max(0, src[idx] - background);
            if (normalize) dst[idx] = Math.min(1.0, dst[idx] + mean);
          } else {
            // División (Division)
            const denom = Math.max(0.001, background);
            dst[idx] = Math.max(0, Math.min(1.0, src[idx] / denom));
            if (normalize) dst[idx] = Math.min(1.0, dst[idx] * mean);
          }
        }
      }
      result.ch.push(dst);
      grad.ch.push(bgCh);
    }
    state.subtractedGradient = grad;
    return result;
  }

  // --- Lógica del modelo AutoDBE por RBF (Radial Basis Functions) ---
  function applyAutoDBE(img, pathCount, tolerance, smoothness) {
    const w = img.w;
    const h = img.h;
    const result = { w, h, nc: img.nc, isColor: img.isColor, ch: [] };
    const grad = { w, h, nc: img.nc, isColor: img.isColor, ch: [] };
    
    // Generar muestras dinámicas automáticas en áreas oscuras de la toma
    // Para simplificar y optimizar, seleccionamos puntos aleatorios y nos quedamos con los de menor luminancia
    const points = [];
    const step = Math.max(1, Math.floor(w / 100));
    
    // Evaluar luminancia para evitar nebulosas/estrellas
    const lum = new Float32Array(w * h);
    if (img.isColor) {
      for (let i = 0; i < w*h; i++) {
        lum[i] = wl[0] * img.ch[0][i] + wl[1] * img.ch[1][i] + wl[2] * img.ch[2][i];
      }
    } else {
      lum.set(img.ch[0]);
    }
    
    // Dividir la imagen en una cuadrícula de bloques (ej. 8x6) para asegurar distribución uniforme
    const cols = 8;
    const rows = 6;
    const cellW = Math.floor(w / cols);
    const cellH = Math.floor(h / rows);
    
    const selectedPoints = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const startX = c * cellW + 10;
        const endX = Math.min(w - 10, (c + 1) * cellW);
        const startY = r * cellH + 10;
        const endY = Math.min(h - 10, (r + 1) * cellH);
        
        let minVal = Infinity;
        let minX = startX;
        let minY = startY;
        
        for (let y = startY; y < endY; y += 4) {
          for (let x = startX; x < endX; x += 4) {
            const val = lum[y * w + x];
            if (val < minVal) {
              minVal = val;
              minX = x;
              minY = y;
            }
          }
        }
        selectedPoints.push({ x: minX, y: minY, val: minVal });
      }
    }
    
    for (let c = 0; c < img.nc; c++) {
      const src = img.ch[c];
      const dst = new Float32Array(w * h);
      const bgCh = new Float32Array(w * h);
      
      // RBF interpolator (Multiquadric radial basis)
      // f(x,y) = sum( w_i * phi(r_i) ) donde phi(r) = sqrt(r^2 + s^2)
      const nPoints = selectedPoints.length;
      const rbfWeights = new Float64Array(nPoints);
      const s2 = smoothness * smoothness * 0.1; // Parámetro de suavizado
      
      // Ajustar pesos RBF resolviendo sistema lineal
      const mat = Array.from({ length: nPoints }, () => new Float64Array(nPoints));
      const rhs = new Float64Array(nPoints);
      
      for (let i = 0; i < nPoints; i++) {
        const p1 = selectedPoints[i];
        rhs[i] = src[p1.y * w + p1.x];
        for (let j = 0; j < nPoints; j++) {
          const p2 = selectedPoints[j];
          const dx = (p1.x - p2.x) / w;
          const dy = (p1.y - p2.y) / h;
          const r2 = dx*dx + dy*dy;
          mat[i][j] = Math.sqrt(r2 + s2);
        }
      }
      
      // Solve system using robust solver with partial pivoting
      const weights = solveLinearSystem(mat, rhs);
      rbfWeights.set(weights);
      
      // Evaluar RBF en toda la cuadrícula
      for (let y = 0; y < h; y++) {
        const ny = y / h;
        for (let x = 0; x < w; x++) {
          const nx = x / w;
          const idx = y * w + x;
          
          let background = 0;
          for (let i = 0; i < nPoints; i++) {
            const p = selectedPoints[i];
            const dx = nx - (p.x / w);
            const dy = ny - (p.y / h);
            const r2 = dx*dx + dy*dy;
            background += rbfWeights[i] * Math.sqrt(r2 + s2);
          }
          bgCh[idx] = Math.max(0, background);
          
          // Resta del gradiente elástico
          dst[idx] = Math.max(0, src[idx] - Math.max(0, background));
        }
      }
      
      result.ch.push(dst);
      grad.ch.push(bgCh);
    }
    
    state.subtractedGradient = grad;
    return result;
  }

  // --- PROCESAMIENTO GENERAL DE GRADIENTE ---
  function applyGradientCorrection(img) {
    if (!img) return null;
    const algo = el("selGradientAlgo").value;
    
    if (algo === "dbe") {
      const paths = parseInt(el("sldAdbePaths").value, 10);
      const tol = parseFloat(el("sldAdbeTol").value);
      const smooth = parseFloat(el("sldAdbeSmooth").value);
      return applyAutoDBE(img, paths, tol, smooth);
    } else if (algo === "abe") {
      const degree = parseInt(el("sldAbeDegree").value, 10);
      const corr = el("selAbeCorrection").value;
      const norm = el("chkAbeNormalize").checked;
      // Mapear grados impares a 1 y pares a 2 en la aproximación analítica
      const fitDegree = degree <= 2 ? 1 : 2;
      return applyABE(img, fitDegree, corr, norm);
    }
    return img;
  }

  // GRADIENT-COMPUTE-BEGIN
  // Calcula la corrección de gradiente para un algoritmo EXPLÍCITO sobre srcImg, sin depender
  // del valor actual del desplegable (lo necesita "Comparar" para iterar los 4 algoritmos).
  // Devuelve { corrected, bgCh } (bgCh = mapa de fondo si el algoritmo lo produce, si no null).
  async function computeGradient(algo, srcImg) {
    if (algo === "graxpert_ia") {
      const params = { correction: el("selGraXpertCorrection").value, smoothing: parseFloat(el("sldGraXpertSmooth").value) };
      const res = await window.GraXpert.applyGraXpertBG(srcImg, params);
      return { corrected: { ch: res.ch, w: res.w, h: res.h, nc: res.nc, isColor: res.isColor, wcs: srcImg.wcs }, bgCh: res.bgCh || null };
    }
    if (algo === "dbe") {
      const density = parseInt(el("sldAdbePaths").value, 10);
      const params = { targetW: 250, gridCols: density, gridRows: density, smoothness: parseFloat(el("sldAdbeSmooth").value), correction: el("selAdbeCorrection").value };
      const res = window.BackgroundExtraction.applyOptimizedBackgroundExtraction(srcImg, params);
      return { corrected: { ch: res.ch, w: res.w, h: res.h, nc: res.nc, isColor: res.isColor, wcs: srcImg.wcs }, bgCh: res.bgCh || null };
    }
    if (algo === "abe") {
      const degree = parseInt(el("sldAbeDegree").value, 10);
      const fitDegree = degree <= 2 ? 1 : 2;
      return { corrected: applyABE(srcImg, fitDegree, el("selAbeCorrection").value, el("chkAbeNormalize").checked), bgCh: null };
    }
    return { corrected: srcImg, bgCh: null };
  }
  // GRADIENT-COMPUTE-END

  // Bind de sliders dinámicos del gradiente
  const gradSliders = [
    { s: "sldAdbePaths", v: "valAdbePaths", p: 0 },
    { s: "sldAdbeTol", v: "valAdbeTol", p: 2 },
    { s: "sldAdbeSmooth", v: "valAdbeSmooth", p: 2 },
    { s: "sldAbeDegree", v: "valAbeDegree", p: 0 },
    { s: "sldGraXpertSmooth", v: "valGraXpertSmooth", p: 3 }
  ];

  gradSliders.forEach(({ s, v, p }) => {
    const sld = el(s);
    const val = el(v);
    if (sld && val) {
      sld.addEventListener("input", () => {
        val.textContent = parseFloat(sld.value).toFixed(p);
      });
    }
  });

  // Event Listeners de Botones de Gradiente
  if (el("btnApplyGradient")) {
    el("btnApplyGradient").addEventListener("click", () => {
      if (!state.activeImage) return;
      const lang = document.documentElement.lang || "es";
      showLoader(lang === "es" ? "Aplicando Corrección de Gradiente..." : "Applying Gradient Correction...");
      
      setTimeout(async () => {
        try {
          // PROBAR-GRADIENTE-BEGIN
          // "Probar Gradiente": aplica el algoritmo seleccionado a la Imagen Inicial
          // (state.stepInputImage) y muestra el resultado como PREVIEW no destructivo.
          // No persiste en el flujo; el commit lo hace el botón "Aplicar Gradiente"
          // (btnBigApply). Cambiar de algoritmo siempre parte de la Imagen Inicial.
          const algo = el("selGradientAlgo").value;
          const srcImg = state.stepInputImage || state.activeImage;
          // PROXY-PROBAR (V1): ABE/AutoDBE (no-IA) previsualizan primero sobre el proxy ≤1000px
          // (el ajuste de fondo es global: el proxy es representativo) y refinan a resolución
          // completa en segundo plano. GraXpert IA va directo a resolución completa.
          const computeFn = async (img) => {
            const { corrected, bgCh } = await computeGradient(algo, img);
            // el gradiente restado solo se guarda del pase a resolución completa
            if (bgCh && img === srcImg) {
              state.subtractedGradient = { ch: bgCh, w: corrected.w, h: corrected.h, nc: corrected.nc, isColor: corrected.isColor };
            }
            return corrected;
          };
          const extraFn = () => {
            // Activar estirado automático de pantalla (AutoSTF) para que el resultado lineal no se vea negro
            state.screenStretchMode = true;
            const stfBtn = el("btnToolAutoSTF");
            if (stfBtn) stfBtn.classList.add("active");
          };
          if (algo !== "graxpert_ia") {
            await previewProxyThenFull(srcImg, "Background Extraction", computeFn, extraFn);
          } else {
            previewActiveImage(await computeFn(srcImg), srcImg, "Background Extraction");
            extraFn();
            render();
            drawHistogram();
          }
          hideLoader();
          logConsole(lang === "es" ? "Vista previa de gradiente (Probar). Pulsa 'Aplicar Gradiente' para confirmar." : "Gradient preview (Test). Press 'Apply Gradient' to commit.", "info");
          // PROBAR-GRADIENTE-END
        } catch (e) {
          hideLoader();
          logConsole(`Error: ${e.message}`, "err");
        }
      }, 50);
    });
  }

  // COMPARE-SLOTS-BEGIN
  // "Comparar": corre los 4 algoritmos con sus argumentos actuales sobre la Imagen Inicial
  // y guarda cada resultado en un Slot de Memoria (1-4) para poder compararlos. No commitea.
  if (el("btnCompareGradient")) {
    el("btnCompareGradient").addEventListener("click", () => {
      if (!state.activeImage) return;
      const lang = document.documentElement.lang || "es";
      showLoader(lang === "es" ? "Comparando algoritmos de gradiente..." : "Comparing gradient algorithms...");

      setTimeout(async () => {
        try {
          const srcImg = state.stepInputImage || state.activeImage;
          const algos = [
            { id: "graxpert_ia", name: "GraXpert IA" },
            { id: "abe",         name: "ABE" },
            { id: "dbe",         name: "AutoDBE" }
          ];
          for (let i = 0; i < algos.length; i++) {
            const { corrected } = await computeGradient(algos[i].id, srcImg);
            state.imageSlots[i] = cloneImage({
              ch: corrected.ch, w: corrected.w, h: corrected.h, nc: corrected.nc,
              isColor: corrected.isColor, wcs: corrected.wcs || (srcImg && srcImg.wcs)
            });
            const slotBtn = document.querySelector(`.piw-slot-btn[data-slot="${i + 1}"]`);
            if (slotBtn) {
              slotBtn.classList.add("filled");
              slotBtn.title = (lang === "es" ? "Gradiente: " : "Gradient: ") + algos[i].name;
            }
            logConsole(`Slot ${i + 1} ← ${algos[i].name}`, "info");
          }
          updateMixSourceOptions();

          // Estirado de pantalla para que los resultados lineales no se vean negros al cargarlos
          state.screenStretchMode = true;
          const stfBtn = el("btnToolAutoSTF");
          if (stfBtn) stfBtn.classList.add("active");

          hideLoader();
          logConsole(lang === "es"
            ? "Comparación lista: 3 algoritmos guardados en Slots 1-3. Pulsa un slot para verlo."
            : "Comparison ready: 3 algorithms saved to Slots 1-3. Click a slot to view it.", "ok");
        } catch (e) {
          hideLoader();
          logConsole(`Error: ${e.message}`, "err");
        }
      }, 50);
    });
  }
  // COMPARE-SLOTS-END

  if (el("btnGradientApplyAll")) {
    el("btnGradientApplyAll").addEventListener("click", () => {
      if (!state.activeImage) return;
      const lang = document.documentElement.lang || "es";
      showLoader(lang === "es" ? "Aplicando Gradiente a todo el flujo..." : "Applying Gradient to all workflow images...");
      
      setTimeout(async () => {
        try {
          const algo = el("selGradientAlgo").value;
          for (const key of Object.keys(state.workflowImages)) {
            if (algo === "graxpert_ia" || algo === "dbe") {
              let params = {};
              // GRAXPERT-AI-BEGIN
              if (algo === "graxpert_ia") {
                params = {
                  correction: el("selGraXpertCorrection").value,
                  smoothing: parseFloat(el("sldGraXpertSmooth").value)
                };
                const res = await window.GraXpert.applyGraXpertBG(state.workflowImages[key], params);
                state.workflowImages[key] = { ch: res.ch, w: res.w, h: res.h, nc: res.nc, isColor: res.isColor, wcs: state.workflowImages[key].wcs };
                if (key === state.activeWorkflowKey && res.bgCh) {
                  state.subtractedGradient = { ch: res.bgCh, w: res.w, h: res.h, nc: res.nc, isColor: res.isColor };
                }
              }
              // GRAXPERT-AI-END
              else {
                const density = parseInt(el("sldAdbePaths").value, 10);
                params = {
                  targetW: 250,
                  gridCols: density,
                  gridRows: density,
                  smoothness: parseFloat(el("sldAdbeSmooth").value),
                  correction: el("selAdbeCorrection").value
                };
                // RBF-OPT-BEGIN
                const res = window.BackgroundExtraction.applyOptimizedBackgroundExtraction(state.workflowImages[key], params);
                state.workflowImages[key] = { ch: res.ch, w: res.w, h: res.h, nc: res.nc, isColor: res.isColor, wcs: state.workflowImages[key].wcs };
                if (key === state.activeWorkflowKey && res.bgCh) {
                  state.subtractedGradient = { ch: res.bgCh, w: res.w, h: res.h, nc: res.nc, isColor: res.isColor };
                }
                // RBF-OPT-END
              }
            } else {
              state.workflowImages[key] = applyGradientCorrection(state.workflowImages[key]);
            }
          }
          if (state.activeWorkflowKey && state.workflowImages[state.activeWorkflowKey]) {
            state.activeImage = state.workflowImages[state.activeWorkflowKey];
          }
          
          // Activar estirado automático de pantalla (AutoSTF)
          state.screenStretchMode = true;
          const stfBtn = el("btnToolAutoSTF");
          if (stfBtn) stfBtn.classList.add("active");

          hideLoader();
          render();
          drawHistogram();
          logConsole(lang === "es" ? "Corrección de gradiente aplicada a todo el flujo (AutoSTF habilitado)" : "Gradient correction applied to all workflow images (AutoSTF enabled)", "info");
        } catch (e) {
          hideLoader();
          logConsole(`Error: ${e.message}`, "err");
        }
      }, 50);
    });
  }

  // --- CARGA DE ARCHIVOS ---
  let targetLoadingChannel = -1;

  // Cargar canales individuales
  document.querySelectorAll(".piw-channel-row").forEach(row => {
    row.addEventListener("click", () => {
      targetLoadingChannel = parseInt(row.getAttribute("data-channel"), 10);
      el("fileInputChannel").value = "";
      el("fileInputChannel").click();
    });
  });

  el("fileInputChannel").addEventListener("change", async (e) => {
    if (e.target.files && e.target.files[0] && targetLoadingChannel !== -1) {
      const file = e.target.files[0];
      const chanIdx = targetLoadingChannel;
      showLoader(`Cargando canal ${file.name}...`);
      
      setTimeout(async () => {
        try {
          const loaded = await AutoGHS.loadFromFile(file);
          // Reducir la resolución de trabajo para rendimiento óptimo
          const capped = AutoGHS.capChannels(loaded.ch, loaded.w, loaded.h, loaded.nc, MAX_PREVIEW_DIM);
          
          let loadedItem;
          if (chanIdx === 7) {
            // Guardar imagen color/mono original
            loadedItem = {
              ch: capped.ch,
              w: capped.w,
              h: capped.h,
              nc: loaded.nc,
              isColor: loaded.isColor
            };
          } else {
            // Guardar canal (monocromo, cogemos la luminancia si el canal cargado es color)
            let monoCh;
            if (loaded.isColor) {
              monoCh = new Float32Array(capped.w * capped.h);
              for (let i = 0; i < monoCh.length; ++i) {
                monoCh[i] = wl[0] * capped.ch[0][i] + wl[1] * capped.ch[1][i] + wl[2] * capped.ch[2][i];
              }
            } else {
              monoCh = capped.ch[0];
            }
            loadedItem = {
              ch: [monoCh],
              w: capped.w,
              h: capped.h,
              nc: 1,
              isColor: false
            };
          }

          state.loadedChannels[chanIdx] = loadedItem;
          state.channelNames[chanIdx] = file.name;

          // Actualizar UI
          const rowEl = document.querySelector(`.piw-channel-row[data-channel="${chanIdx}"]`);
          if (rowEl) rowEl.classList.add("loaded");
          
          const filenameEl = el(`file-name-${chanIdx}`);
          if (filenameEl) {
            filenameEl.textContent = file.name;
            filenameEl.title = file.name;
          }

          logConsole(`Canal ${chanIdx} cargado: ${file.name} (${capped.w}x${capped.h})`, "info");
          
          // Habilitar combinación
          checkCombineState();
        } catch (err) {
          logConsole(`Error al cargar canal: ${err.message}`, "err");
        } finally {
          hideLoader();
        }
      }, 50);
    }
  });

  // Habilita el botón de combinación si hay suficientes canales cargados
  function checkCombineState() {
    // 1. R+G+B
    const hasR = state.loadedChannels[0] !== null;
    const hasG = state.loadedChannels[1] !== null;
    const hasB = state.loadedChannels[2] !== null;
    const hasL = state.loadedChannels[3] !== null;
    const rgbValid = (hasR && hasG) || (hasR && hasG && hasB) || hasL;
    el("btnCombineRGB").disabled = !rgbValid;
    // "Por Separado" carga cada canal cargado como imagen independiente → basta con tener ≥1 canal
    // (no exige la receta completa como "Combinar").
    if (el("btnSeparateRGB")) el("btnSeparateRGB").disabled = !(hasR || hasG || hasB || hasL);
    
    // 2. NB (Narrowband)
    const hasSII = state.loadedChannels[4] !== null;
    const hasHa = state.loadedChannels[5] !== null;
    const hasOIII = state.loadedChannels[6] !== null;
    
    let nbValid = false;
    const selectEl = el("selNbRecipe");
    if (selectEl) {
      const recipeId = selectEl.value;
      const formula = narrowbandFormulas && narrowbandFormulas.find(f => f.id === recipeId);
      if (formula) {
        nbValid = true;
        const reqSources = formula.sources || ['sii', 'ha', 'oiii'];
        if (reqSources.includes("sii") && !hasSII) nbValid = false;
        if (reqSources.includes("ha") && !hasHa) nbValid = false;
        if (reqSources.includes("oiii") && !hasOIII) nbValid = false;
      } else {
        // Fallback si no han cargado aún las fórmulas de la PixelMath-teca
        if (recipeId === "sho" && hasSII && hasHa && hasOIII) nbValid = true;
        else if (recipeId === "hoo" && hasHa && hasOIII) nbValid = true;
        else if (recipeId === "hso" && hasSII && hasHa && hasOIII) nbValid = true;
      }
    }
    el("btnCombineNB").disabled = !nbValid;
    // "Por Separado" carga cada canal NB cargado como imagen independiente → basta con tener ≥1 canal.
    if (el("btnSeparateNB")) el("btnSeparateNB").disabled = !(hasSII || hasHa || hasOIII);

    // 3. RGB Color (Direct)
    const hasColorImg = state.loadedChannels[7] !== null;
    el("btnLoadRGBColor").disabled = !hasColorImg;
  }

  // Combinación de canales RGB (Tab 0)
  el("btnCombineRGB").addEventListener("click", () => {
    showLoader("Combinando canales RGB...");
    setTimeout(() => {
      try {
        const hasR = state.loadedChannels[0] !== null;
        const hasG = state.loadedChannels[1] !== null;
        const hasB = state.loadedChannels[2] !== null;
        const hasL = state.loadedChannels[3] !== null;

        let w = 0, h = 0;
        // Obtener dimensiones de referencia
        for (let i = 0; i < 4; ++i) {
          if (state.loadedChannels[i]) {
            w = state.loadedChannels[i].w;
            h = state.loadedChannels[i].h;
            break;
          }
        }

        if (w === 0 || h === 0) throw new Error("No hay canales válidos cargados.");

        const n = w * h;
        let finalImage;

        if (hasR && hasG) {
          // Es una imagen color (clonamos para no mutar los cargados originales)
          const rChan = Float32Array.from(state.loadedChannels[0].ch[0]);
          const gChan = Float32Array.from(state.loadedChannels[1].ch[0]);
          let bChan;

          if (hasB) {
            bChan = Float32Array.from(state.loadedChannels[2].ch[0]);
          } else {
            // Sintetizar bicolor (HOO): B = OIII (G)
            bChan = Float32Array.from(gChan);
            logConsole("Mezcla bicolor HOO autodetectada (duplicando canal Verde en Azul)", "info");
          }

          // Inyectar luminancia si está cargada
          if (hasL) {
            const lChan = state.loadedChannels[3].ch[0];
            const rgbL = new Float32Array(n);
            for (let i = 0; i < n; ++i) {
              rgbL[i] = wl[0] * rChan[i] + wl[1] * gChan[i] + wl[2] * bChan[i];
            }
            // Escalar canales cromáticos por el ratio L / Luminancia_RGB
            for (let i = 0; i < n; ++i) {
              const ratio = rgbL[i] > 1e-5 ? lChan[i] / rgbL[i] : 1;
              rChan[i] = Math.min(1, rChan[i] * ratio);
              gChan[i] = Math.min(1, gChan[i] * ratio);
              bChan[i] = Math.min(1, bChan[i] * ratio);
            }
            logConsole("Luminancia inyectada en canales de crominancia", "info");
          }

          finalImage = {
            ch: [rChan, gChan, bChan],
            w: w,
            h: h,
            nc: 3,
            isColor: true
          };
        } else if (hasL) {
          // Solo luminancia (monocromo, clonamos para no mutar)
          finalImage = {
            ch: [Float32Array.from(state.loadedChannels[3].ch[0])],
            w: w,
            h: h,
            nc: 1,
            isColor: false
          };
          logConsole("Imagen monocroma (Luminancia) generada", "info");
        }

        // Limpiar claves de Banda Estrecha
        const nbKeys = ["S", "H", "O", "HSO"];
        nbKeys.forEach(k => delete state.workflowImages[k]);

        state.workflowImages["MonoRGB"] = finalImage;
        state.activeWorkflowKey = "MonoRGB";
        setActiveImage(finalImage);
        refreshPathBar();
        logConsole(`Combinación completada con éxito (${w}x${h} px)`, "info");
      } catch (err) {
        logConsole(`Error al combinar canales: ${err.message}`, "err");
      } finally {
        hideLoader();
      }
    }, 50);
  });

  // Combinación de canales NB (Tab 0)
  el("btnCombineNB").addEventListener("click", () => {
    showLoader("Combinando canales Banda Estrecha...");
    setTimeout(() => {
      try {
        const hasSII = state.loadedChannels[4] !== null;
        const hasHa = state.loadedChannels[5] !== null;
        const hasOIII = state.loadedChannels[6] !== null;
        const recipeId = el("selNbRecipe").value;
        const formula = narrowbandFormulas.find(f => f.id === recipeId);
        if (!formula) throw new Error("Fórmula no encontrada.");

        let w = 0, h = 0;
        // Obtener dimensiones de referencia
        for (let i = 4; i <= 6; ++i) {
          if (state.loadedChannels[i]) {
            w = state.loadedChannels[i].w;
            h = state.loadedChannels[i].h;
            break;
          }
        }

        if (w === 0 || h === 0) throw new Error("No hay canales válidos cargados para Banda Estrecha.");

        const n = w * h;
        let finalImage;

        // Reservar canales R, G, B
        const rChan = new Float32Array(n);
        const gChan = new Float32Array(n);
        const bChan = new Float32Array(n);

        const sii = hasSII ? state.loadedChannels[4].ch[0] : new Float32Array(n);
        const ha = hasHa ? state.loadedChannels[5].ch[0] : new Float32Array(n);
        const oiii = hasOIII ? state.loadedChannels[6].ch[0] : new Float32Array(n);

        // Compile expressions for R, G, B
        // Collect slider keys and values
        const sliderKeys = formula.sliders ? formula.sliders.map(s => s.id) : [];
        const sliderVals = sliderKeys.map(key => {
          const inputEl = el(`sldNb_${key}`);
          return inputEl ? parseFloat(inputEl.value) : (formula.sliders.find(s => s.id === key).value);
        });

        const fnR = compilePixelMathExpression(formula.r || 'Ha', sliderKeys);
        const fnG = compilePixelMathExpression(formula.g || 'OIII', sliderKeys);
        const fnB = compilePixelMathExpression(formula.b || 'OIII', sliderKeys);

        if (!fnR || !fnG || !fnB) {
          throw new Error("No se pudo compilar la expresión matemática de la fórmula.");
        }

        // Ejecutar píxel a píxel
        for (let i = 0; i < n; ++i) {
          rChan[i] = Math.min(1.0, Math.max(0.0, fnR(sii[i], ha[i], oiii[i], sii[i], ha[i], oiii[i], ...sliderVals)));
          gChan[i] = Math.min(1.0, Math.max(0.0, fnG(sii[i], ha[i], oiii[i], sii[i], ha[i], oiii[i], ...sliderVals)));
          bChan[i] = Math.min(1.0, Math.max(0.0, fnB(sii[i], ha[i], oiii[i], sii[i], ha[i], oiii[i], ...sliderVals)));
        }

        logConsole(`Mezcla PixelMath aplicada: ${formula.name}`, "info");

        finalImage = {
          ch: [rChan, gChan, bChan],
          w: w,
          h: h,
          nc: 3,
          isColor: true
        };

        // Limpiar claves de Banda Ancha RGB
        const rgbKeys = ["MonoRGB", "RGB", "R", "G", "B", "L"];
        rgbKeys.forEach(k => delete state.workflowImages[k]);

        state.workflowImages["HSO"] = finalImage;
        state.activeWorkflowKey = "HSO";
        setActiveImage(finalImage);
        refreshPathBar();
        logConsole(`Combinación NB completada con éxito (${w}x${h} px)`, "info");
      } catch (err) {
        logConsole(`Error al combinar canales NB: ${err.message}`, "err");
      } finally {
        hideLoader();
      }
    }, 50);
  });

  // Carga de imagen a color directa (Tab 0)
  el("btnLoadRGBColor").addEventListener("click", () => {
    showLoader("Cargando imagen a color...");
    setTimeout(() => {
      try {
        const loadedColor = state.loadedChannels[7];
        if (!loadedColor) throw new Error("No hay imagen color cargada.");

        // Clonamos la imagen para no machacar la guardada
        const finalImage = cloneImage(loadedColor);

        // Limpiar claves de Banda Estrecha
        const nbKeys = ["S", "H", "O", "HSO"];
        nbKeys.forEach(k => delete state.workflowImages[k]);

        state.workflowImages["RGB"] = finalImage;
        state.activeWorkflowKey = "RGB";
        setActiveImage(finalImage);
        refreshPathBar();
        logConsole(`Carga de imagen color completada con éxito (${finalImage.w}x${finalImage.h} px)`, "info");
      } catch (err) {
        logConsole(`Error al cargar imagen color: ${err.message}`, "err");
      } finally {
        hideLoader();
      }
    }, 50);
  });

  // Procesar por separado RGB (Tab 0)
  el("btnSeparateRGB").addEventListener("click", () => {
    showLoader("Separando canales RGB...");
    setTimeout(() => {
      try {
        const hasR = state.loadedChannels[0] !== null;
        const hasG = state.loadedChannels[1] !== null;
        const hasB = state.loadedChannels[2] !== null;
        const hasL = state.loadedChannels[3] !== null;

        let w = 0, h = 0;
        for (let i = 0; i < 4; ++i) {
          if (state.loadedChannels[i]) {
            w = state.loadedChannels[i].w;
            h = state.loadedChannels[i].h;
            break;
          }
        }

        if (w === 0 || h === 0) throw new Error("No hay canales válidos cargados.");

        // Limpiar claves de Banda Estrecha
        const nbKeys = ["S", "H", "O", "HSO"];
        nbKeys.forEach(k => delete state.workflowImages[k]);
        
        if (hasR) state.workflowImages["R"] = cloneImage(state.loadedChannels[0]);
        if (hasG) state.workflowImages["G"] = cloneImage(state.loadedChannels[1]);
        if (hasB) state.workflowImages["B"] = cloneImage(state.loadedChannels[2]);
        if (hasL) state.workflowImages["L"] = cloneImage(state.loadedChannels[3]);

        const keys = Object.keys(state.workflowImages);
        if (keys.length === 0) throw new Error("No hay ningún canal cargado.");

        state.activeWorkflowKey = keys[0];
        setActiveImage(state.workflowImages[state.activeWorkflowKey]);
        refreshPathBar();
        logConsole(`Canales separados cargados con éxito (${w}x${h} px)`, "info");
      } catch (err) {
        logConsole(`Error al cargar canales por separado: ${err.message}`, "err");
      } finally {
        hideLoader();
      }
    }, 50);
  });

  // Procesar por separado NB (Tab 0)
  el("btnSeparateNB").addEventListener("click", () => {
    showLoader("Separando canales Banda Estrecha...");
    setTimeout(() => {
      try {
        const hasSII = state.loadedChannels[4] !== null;
        const hasHa = state.loadedChannels[5] !== null;
        const hasOIII = state.loadedChannels[6] !== null;

        let w = 0, h = 0;
        for (let i = 4; i <= 6; ++i) {
          if (state.loadedChannels[i]) {
            w = state.loadedChannels[i].w;
            h = state.loadedChannels[i].h;
            break;
          }
        }

        if (w === 0 || h === 0) throw new Error("No hay canales válidos cargados.");

        // Limpiar claves de Banda Ancha RGB
        const rgbKeys = ["MonoRGB", "RGB", "R", "G", "B", "L"];
        rgbKeys.forEach(k => delete state.workflowImages[k]);
        
        if (hasSII) state.workflowImages["S"] = cloneImage(state.loadedChannels[4]);
        if (hasHa) state.workflowImages["H"] = cloneImage(state.loadedChannels[5]);
        if (hasOIII) state.workflowImages["O"] = cloneImage(state.loadedChannels[6]);

        const keys = Object.keys(state.workflowImages);
        if (keys.length === 0) throw new Error("No hay ningún canal cargado.");

        state.activeWorkflowKey = keys[0];
        setActiveImage(state.workflowImages[state.activeWorkflowKey]);
        refreshPathBar();
        logConsole(`Canales de banda estrecha cargados por separado (${w}x${h} px)`, "info");
      } catch (err) {
        logConsole(`Error al cargar canales NB por separado: ${err.message}`, "err");
      } finally {
        hideLoader();
      }
    }, 50);
  });

  // Refresca la barra de botones del flujo de canales (path buttons)
  function refreshPathBar() {
    const bar = el("piwPathBar");
    if (!bar) return;
    bar.innerHTML = "";
    
    const keys = Object.keys(state.workflowImages);
    if (keys.length === 0) {
      bar.style.display = "none";
      return;
    }
    
    bar.style.display = "flex";
    keys.forEach(key => {
      const btn = document.createElement("button");
      btn.className = "piw-path-btn";
      btn.setAttribute("data-key", key);
      
      const imgObj = state.workflowImages[key];
      const hasTransforms = imgObj && imgObj.hasTransforms;
      
      if (key === state.activeWorkflowKey) {
        btn.classList.add("active");
        btn.textContent = `[${key}]`;
      } else {
        btn.textContent = key;
        if (hasTransforms) {
          btn.classList.add("done");
        }
      }
      
      btn.addEventListener("click", () => {
        selectWorkflowKey(key);
      });
      
      bar.appendChild(btn);
    });
  }

  // Cambia el canal/imagen del flujo activo actual
  function selectWorkflowKey(key) {
    if (!state.workflowImages[key]) return;
    state.activeWorkflowKey = key;
    state.activeImage = state.workflowImages[key];
    state.originalImage = cloneImage(state.activeImage);
    // La imagen seleccionada pasa a ser la Imagen Inicial de las operaciones (estirado, etc.),
    // para que se apliquen sobre lo que el usuario tiene seleccionado (RGB/Starless/Stars/…).
    state.stepInputImage = cloneImage(state.activeImage);
    state.pendingPreview = false;

    // MONO-RGB-VIS-BEGIN
    el("piwHint").style.display = "none";
    el("piwToolbar").style.display = "flex";
    // Autostretch al revisitar SOLO si la imagen sigue siendo lineal (no se le aplicó un
    // estirado permanente). Se deriva del historial de stages (modelo del script), no de
    // hasTransforms — que ahora marca "se aplicó cualquier proceso", incluidos los lineales (PRE).
    const isStretched = state.activeImage && Array.isArray(state.activeImage.stages)
      && state.activeImage.stages.indexOf("Stretch") >= 0;
    if (state.activeImage && !isStretched) {
      state.screenStretchMode = true;
    }
    const btnAutoStf = el("btnToolAutoSTF");
    if (btnAutoStf) {
      if (state.screenStretchMode) {
        btnAutoStf.classList.add("active");
      } else {
        btnAutoStf.classList.remove("active");
      }
    }
    // MONO-RGB-VIS-END
    
    // Reset A/B comparison for the new workflow key context
    state.previousImage = null;
    state._lastImgRef = state.activeImage;
    state.viewingPrevious = false;
    const btnToggle = el("btnToolToggleAB");
    if (btnToggle) {
      btnToggle.classList.remove("active");
      btnToggle.textContent = "Toggle A/B";
    }
    state.splitViewMode = false;
    const btnSplit = el("btnToolSplitView");
    if (btnSplit) {
      btnSplit.classList.remove("active");
    }
    el("piwSplitSlider").style.display = "none";
    
    // Si la imagen es a color, habilitar SCNR/Saturación, etc.
    el("btnApplyScnr").disabled = !state.activeImage.isColor;
    el("btnApplySat").disabled = !state.activeImage.isColor;
    // SCNR-PRE-BEGIN
    el("btnApplyScnrPre").disabled = !state.activeImage.isColor;
    el("sldScnrIntPre").disabled = !state.activeImage.isColor;
    // SCNR-PRE-END
    el("btnApplyPostSharp").disabled = false;
    { const b = el("btnComparePostSharp"); if (b) b.disabled = false; }
    el("btnApplyPostCurves").disabled = false;
    el("btnApplyPostColor").disabled = false;

    // Forzar redibujado de la pantalla
    render();
    drawHistogram();
    refreshPathBar();
    logConsole(`Visualizando canal/imagen del flujo: ${key}`, "info");
  }

  // Establece la imagen activa y refresca el canvas
  function setActiveImage(img) {
    state.activeImage = img;
    state.originalImage = cloneImage(img);
    state.stepInputImage = cloneImage(img);
    state.pendingPreview = false;
    state.calibCompareReady = false;
    state.undoStack.length = 0; state.redoStack.length = 0; updateUndoButtons();

    // Reset A/B comparison
    state.previousImage = null;
    state._lastImgRef = img;
    state.viewingPrevious = false;
    const btnToggle = el("btnToolToggleAB");
    if (btnToggle) {
      btnToggle.classList.remove("active");
      btnToggle.textContent = "Toggle A/B";
    }
    state.splitViewMode = false;
    const btnSplit = el("btnToolSplitView");
    if (btnSplit) {
      btnSplit.classList.remove("active");
    }
    el("piwSplitSlider").style.display = "none";
    
    // AutoSTF habilitado por defecto para ver imágenes lineales combinadas/cargadas
    state.screenStretchMode = true;
    const btnAutoStf = el("btnToolAutoSTF");
    if (btnAutoStf) btnAutoStf.classList.add("active");
    logConsole("Estirado de pantalla AutoSTF activado automáticamente", "info");
    
    // Reset de visualización
    zoomFit();
    setTimeout(zoomFit, 100);
    setTimeout(zoomFit, 300); // Doble cobertura por si la interfaz tarda en renderizar el acordeón o scrollbar
    
    // Habilitar botones de acción en las pestañas
    const cardLF = el("cardLinearFit");
    if (cardLF) {
      if (img.isColor) {
        cardLF.classList.remove("disabled");
      } else {
        cardLF.classList.add("disabled");
      }
    }
    const cardBN = el("cardBN");
    if (cardBN) {
      cardBN.classList.remove("disabled");
    }
    const cardSPCC = el("cardSPCC");
    if (cardSPCC) {
      if (img.isColor) {
        cardSPCC.classList.remove("disabled");
      } else {
        cardSPCC.classList.add("disabled");
      }
    }
    const cardOT = el("cardOT");
    if (cardOT) {
      if (img.isColor) {
        cardOT.classList.remove("disabled");
      } else {
        cardOT.classList.add("disabled");
      }
    }
    const btnCmpColor = el("btnCompareColor");
    if (btnCmpColor) btnCmpColor.disabled = !img.isColor;
    el("btnApplyDecon").disabled = false;
    { const b = el("btnCompareDecon"); if (b) b.disabled = false; }
    el("btnApplyStretch").disabled = false;
    el("btnApplyScnr").disabled = !img.isColor;
    // SCNR-PRE-BEGIN
    el("btnApplyScnrPre").disabled = !img.isColor;
    el("sldScnrIntPre").disabled = !img.isColor;
    // SCNR-PRE-END
    el("btnPreviewMask").disabled = false;
    el("btnApplyMask").disabled = false;
    el("btnApplySat").disabled = !img.isColor;
    el("btnDownloadPNG").disabled = false;
    { const b = el("btnApplyColorMixer"); if (b) b.disabled = false; }
    { const b = el("btnApplyDetail"); if (b) b.disabled = false; }
    el("btnApplyPostNR").disabled = false;
    { const b = el("btnComparePostNR"); if (b) b.disabled = false; }
    el("btnApplyPostSharp").disabled = false;
    { const b = el("btnComparePostSharp"); if (b) b.disabled = false; }
    el("btnApplyPostCurves").disabled = false;
    el("btnApplyPostColor").disabled = false;
    enablePostProcessControls();

    el("piwHint").style.display = "none";
    el("piwToolbar").style.display = "flex";

    // Rellenar selectores de la pestaña Mezcla
    updateMixSourceOptions();

    // Dibujar
    render();
    drawHistogram();
    drawCurvesWidget();
    drawColorBalanceWidget();
  }

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

  // --- OPERACIONES DE ESTIRADO / STRETCHING (TAB 1) ---

  // Auto STF
  // runAutoSTF (estirado STF del menú Estirar) vive ahora en imgops.js (autoSTFInPlace, misma
  // matemática) y se invoca vía ImgOps.computeStretch({algo:"stf"}) — también desde el worker.

  // Cargar Starless
  el("btnLoadStarless").addEventListener("click", () => {
    el("fileInputStarless").value = "";
    el("fileInputStarless").click();
  });
  el("fileInputStarless").addEventListener("change", async (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      showLoader("Cargando Starless...");
      setTimeout(async () => {
        try {
          const loaded = await AutoGHS.loadFromFile(file);
          const capped = AutoGHS.capChannels(loaded.ch, loaded.w, loaded.h, loaded.nc, MAX_PREVIEW_DIM);
          state.starlessImage = {
            ch: capped.ch,
            w: capped.w,
            h: capped.h,
            nc: loaded.nc,
            isColor: loaded.isColor
          };
          state.workflowImages["Starless"] = state.starlessImage;
          el("btnLoadStarless").classList.add("primary");
          logConsole(`Imagen sin estrellas (Starless) cargada: ${file.name}`, "info");
          updateMixSourceOptions();
          refreshPathBar();
        } catch (err) {
          logConsole(`Error al cargar Starless: ${err.message}`, "err");
        } finally {
          hideLoader();
        }
      }, 50);
    }
  });

  // Cargar Estrellas
  el("btnLoadStars").addEventListener("click", () => {
    el("fileInputStars").value = "";
    el("fileInputStars").click();
  });
  el("fileInputStars").addEventListener("change", async (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      showLoader("Cargando capa de estrellas...");
      setTimeout(async () => {
        try {
          const loaded = await AutoGHS.loadFromFile(file);
          const capped = AutoGHS.capChannels(loaded.ch, loaded.w, loaded.h, loaded.nc, MAX_PREVIEW_DIM);
          state.starsImage = {
            ch: capped.ch,
            w: capped.w,
            h: capped.h,
            nc: loaded.nc,
            isColor: loaded.isColor
          };
          state.workflowImages["Stars"] = state.starsImage;
          el("btnLoadStars").classList.add("primary");
          logConsole(`Imagen de estrellas cargada: ${file.name}`, "info");
          updateMixSourceOptions();
          refreshPathBar();
        } catch (err) {
          logConsole(`Error al cargar Estrellas: ${err.message}`, "err");
        } finally {
          hideLoader();
        }
      }, 50);
    }
  });

  // Escuchar cambios en el checkbox de Starless para refrescar la visualización
  el("chkStarlessView").addEventListener("change", () => {
    render();
    drawHistogram();
  });

  // STAR-REMOVAL-INTEGRATION-BEGIN
  el("btnRemoveStars").addEventListener("click", () => {
    if (!state.activeImage) {
      logConsole(window.location.pathname.includes("-en.html")
        ? "Please load an image before separating stars."
        : "Carga una imagen antes de separar estrellas.", "err");
      return;
    }

    const runExecution = () => {
      const lang = window.location.pathname.includes("-en.html") ? "en" : "es";
      showLoader(lang === "es" ? "Cargando modelo StarNet2..." : "Loading StarNet2 model...");

      setTimeout(async () => {
        try {
          const isLinear = state.screenStretchMode === true;
          let inputImg = state.activeImage;
          let shadows = null;
          let midtones = null;

          if (isLinear) {
            logConsole(lang === "es" ? "Imagen lineal detectada. Aplicando STF temporal..." : "Linear image detected. Applying temporary STF...", "info");
            const nc = state.activeImage.nc;
            const n = state.activeImage.ch[0].length;
            shadows = [];
            midtones = [];
            const stretchedCh = [];
            const TB = 0.25;

            function mtfPure(m, x) {
              if (x <= 0) return 0;
              if (x >= 1) return 1;
              const denom = (2 * m - 1) * x - m;
              if (Math.abs(denom) < 1e-12) return x;
              return (m - 1) * x / denom;
            }

            for (let c = 0; c < nc; c++) {
              const src = state.activeImage.ch[c];
              const median = fastSampledMedian(src);
              const mad    = Math.max(0.0005, fastSampledMAD(src, median));
              const shadow = Math.max(0.0, median - 1.25 * mad);
              const sh     = isFinite(shadow) ? shadow : 0.0;
              const mt     = optMadMidtone(median, sh, TB);
              shadows.push(sh);
              midtones.push(mt);

              const dst = new Float32Array(n);
              const scale = sh >= 1.0 ? 1.0 : (1.0 - sh);
              for (let i = 0; i < n; i++) {
                const x = Math.max(0.0, Math.min(1.0, (src[i] - sh) / scale));
                dst[i] = mtfPure(mt, x);
              }
              stretchedCh.push(dst);
            }

            inputImg = {
              ch: stretchedCh,
              w: state.activeImage.w,
              h: state.activeImage.h,
              nc: state.activeImage.nc,
              isColor: state.activeImage.isColor
            };
          }

          const runFn = window.StarRemoval.runStarNet2;
          const result = await runFn(
            inputImg,
            // Callback para progreso de descarga
            (p) => {
              showLoader(lang === "es"
                ? `Descargando modelo StarNet2: ${(p * 100).toFixed(0)}%`
                : `Downloading StarNet2 model: ${(p * 100).toFixed(0)}%`
              );
            },
            // Callback para progreso de tiles
            (completed, total) => {
              showLoader(lang === "es"
                ? `Procesando tiles: ${completed}/${total}`
                : `Processing tiles: ${completed}/${total}`
              );
            },
            // Recuperación de detalle de nebulosa (slider; 0 = starless crudo del modelo)
            (el("sldStarRecover") ? parseFloat(el("sldStarRecover").value) : 0)
          );

          let starlessOut = result.starless;
          let starsOut = result.stars;

          if (isLinear) {
            logConsole(lang === "es" ? "Invirtiendo STF temporal para obtener datos lineales..." : "Inverting temporary STF to obtain linear data...", "info");
            const nc = state.activeImage.nc;
            const n = state.activeImage.ch[0].length;
            const starlessLinearCh = [];
            const starsLinearCh = [];

            function mtfPure(m, x) {
              if (x <= 0) return 0;
              if (x >= 1) return 1;
              const denom = (2 * m - 1) * x - m;
              if (Math.abs(denom) < 1e-12) return x;
              return (m - 1) * x / denom;
            }

            for (let c = 0; c < nc; c++) {
              const sh = shadows[c];
              const mt = midtones[c];
              const starlessStretched = result.starless.ch[c];
              const starlessLinear = new Float32Array(n);
              const invMt = 1.0 - mt;

              for (let i = 0; i < n; i++) {
                const val = sh + (1.0 - sh) * mtfPure(invMt, starlessStretched[i]);
                starlessLinear[i] = val < 0.0 ? 0.0 : (val > 1.0 ? 1.0 : val);
              }
              starlessLinearCh.push(starlessLinear);

              // stars_linear = max(0, original_linear - starless_linear)
              const origLinear = state.activeImage.ch[c];
              const starsLinear = new Float32Array(n);
              for (let i = 0; i < n; i++) {
                const diff = origLinear[i] - starlessLinear[i];
                starsLinear[i] = diff > 0.0 ? diff : 0.0;
              }
              starsLinearCh.push(starsLinear);
            }

            starlessOut = {
              ch: starlessLinearCh,
              w: state.activeImage.w,
              h: state.activeImage.h,
              nc: nc,
              isColor: state.activeImage.isColor
            };
            starsOut = {
              ch: starsLinearCh,
              w: state.activeImage.w,
              h: state.activeImage.h,
              nc: nc,
              isColor: state.activeImage.isColor
            };
          }

          state.starlessImage = starlessOut;
          state.starsImage = starsOut;

          // Nombrar por ORIGEN: "Starless <key>" / "Stars <key>" para soportar splits de varias
          // fuentes (RGB, MonoRGB, ...). Cada una mantiene su propio par seleccionable en el flujo.
          const srcKey = state.activeWorkflowKey || "RGB";
          const starlessKey = "Starless " + srcKey;
          const starsKey = "Stars " + srcKey;
          state.workflowImages[starlessKey] = starlessOut;
          state.workflowImages[starsKey] = starsOut;

          logConsole(lang === "es"
            ? `Eliminación de estrellas completada: creados "${starlessKey}" y "${starsKey}".`
            : `Star removal completed: created "${starlessKey}" and "${starsKey}".`,
            "info"
          );

          updateMixSourceOptions();
          selectWorkflowKey(starlessKey); // ver el starless de esa fuente
        } catch (err) {
          logConsole(`Error en eliminación de estrellas: ${err.message}`, "err");
          console.error(err);
        } finally {
          hideLoader();
        }
      }, 50);
    };

    runExecution();
  });
  // STAR-REMOVAL-INTEGRATION-END

  // Mostrar u ocultar controles dinámicos de estirado según algoritmo seleccionado
  el("selStretchAlgo").addEventListener("change", (e) => {
    const val = e.target.value;
    el("stretch-stf-controls").style.display = val === "stf" ? "block" : "none";
    el("stretch-ghs-controls").style.display = val === "ghs" ? "block" : "none";
    el("stretch-stars-controls").style.display = val === "stars" ? "block" : "none";
    const statCtl = el("stretch-stat-controls");
    if (statCtl) statCtl.style.display = val === "statistical_stretch" ? "block" : "none";
    const curvesCtl = el("stretch-curves-controls");
    if (curvesCtl) {
      curvesCtl.style.display = val === "curves" ? "block" : "none";
      if (val === "curves") drawHistogram();
    }
  });

  // Sliders de la Curva Manual: actualizan el valor y redibujan la curva en vivo.
  ["Black", "Mid", "Contrast"].forEach((suffix) => {
    const sld = el("sldStretch" + suffix);
    if (!sld) return;
    sld.addEventListener("input", () => {
      const v = el("valStretch" + suffix);
      if (v) v.textContent = parseFloat(sld.value).toFixed(2);
      setStretchPointsFromSliders(); // los sliders re-siembran la curva por puntos
      drawStretchCurve();
    });
  });

  // Slider "Recuperar nebulosa" del star split
  {
    const sldRec = el("sldStarRecover");
    if (sldRec) sldRec.addEventListener("input", () => {
      const v = el("valStarRecover");
      if (v) v.textContent = parseFloat(sldRec.value).toFixed(2);
    });
  }

  // STRETCH-COMPARE-BEGIN
  // STRETCH-PARAMS: params PLANOS (serializables) del estirado según el algoritmo seleccionado,
  // leídos de los sliders de la UI. Sirven igual para ImgOps.computeStretch en el hilo principal
  // (proxy del Probar, Comparar) y para el Web Worker (resolución completa sin congelar la UI).
  function getStretchParams(algo, srcImg) {
    // Canales enlazados (por defecto SÍ): misma transformada para R/G/B → conserva el color
    // calibrado (PCC). Desmarcado = por canal (re-balancea el fondo pero VIRA el color en HSO/SHO).
    const _lk = el("chkStretchLinked");
    const linked = !_lk || _lk.checked;
    if (algo === "stf") {
      return { algo, linked, targetBg: parseFloat(el("sldStfBg").value), clipSigmas: parseFloat(el("sldStfClip").value) };
    }
    if (algo === "ghs") {
      const cfg = AutoGHS.defaultConfig();
      cfg.sigmasFromCenter = parseFloat(el("sldGhsSig").value);
      cfg.stretchIntensity = parseFloat(el("sldGhsInt").value);
      const _ghsIters = el("sldGhsIters");
      if (_ghsIters) cfg.maxIterations = parseInt(_ghsIters.value, 10);
      cfg.colorMode = srcImg.isColor ? "luminance" : "rgb";
      return { algo, cfg };
    }
    if (algo === "stars") {
      const boostEl = el("sldStarsBoost");
      return { algo, amount: parseFloat(el("sldStarsStretch").value), boost: boostEl ? parseFloat(boostEl.value) : 1.0 };
    }
    if (algo === "statistical_stretch") {
      // STAT-STRETCH-PYODIDE->JS: estirado en JS (sin Pyodide), MAD + MTF (enlazado o por canal).
      return { algo, linked, target: parseFloat(el("sldStretchStatTgt").value), sigma: parseFloat(el("sldStretchStatSigma").value) };
    }
    if (algo === "curves") {
      return { algo, points: stretchPoints.map((p) => [p[0], p[1]]) };
    }
    return { algo };
  }

  // Motor de estirado reutilizable (Preview y Comparar). No destructivo: devuelve una imagen nueva.
  // V2 (Fase 4): la matemática vive en ImgOps.computeStretch (imgops.js), compartida con el worker.
  async function computeStretch(algo, srcImg) {
    return window.ImgOps.computeStretch(srcImg, getStretchParams(algo, srcImg));
  }

  // Aplicar estirado (Preview no destructivo)
  el("btnApplyStretch").addEventListener("click", () => {
    if (!state.activeImage) return;
    const algo = el("selStretchAlgo").value;
    const lang = document.documentElement.lang || "es";
    showLoader(lang === "es" ? "Estirando imagen (Preview)..." : "Stretching image (Preview)...");

    setTimeout(async () => {
      try {
        const srcImg = state.stepInputImage || state.activeImage;
        // Los params se leen UNA vez: proxy y resolución completa usan exactamente los mismos.
        const params = getStretchParams(algo, srcImg);
        // PROXY-PROBAR (V1) + worker (V2): preview instantáneo sobre el proxy y recomputo a
        // resolución completa en el Web Worker (fallback CPU), que reemplaza el preview al llegar.
        await previewProxyThenFull(srcImg, "Stretch", (img) => {
          if (img === srcImg) {
            return runImgWorker("stretch", img, params).catch(() => window.ImgOps.computeStretch(img, params));
          }
          return window.ImgOps.computeStretch(img, params);
        }, () => {
          // Tras estirar, desactivar el estirado de pantalla AutoSTF (vemos los datos ya estirados, no doble)
          state.screenStretchMode = false;
          const btnAutoStf = el("btnToolAutoSTF");
          if (btnAutoStf) btnAutoStf.classList.remove("active");
        });
        logConsole(lang === "es" ? `Estirado aplicado: ${algo}` : `Stretch applied: ${algo}`, "info");
        logConsole(lang === "es" ? "Vista previa de estirado (Preview). Pulsa 'Aplicar Estirado' para confirmar." : "Stretch preview. Press 'Apply Stretch' to commit.", "info");
      } catch (err) {
        logConsole(`Error en estirado: ${err.message}`, "err");
      } finally {
        hideLoader();
      }
    }, 50);
  });

  // "Comparar estirados": ejecuta todos los algoritmos y guarda cada resultado en un Slot de memoria.
  if (el("btnCompareStretch")) {
    el("btnCompareStretch").addEventListener("click", () => {
      const srcImg = state.stepInputImage || state.activeImage;
      if (!srcImg) return;
      const lang = document.documentElement.lang || "es";
      showLoader(lang === "es" ? "Comparando estirados (puede tardar por Statistical Stretch)..." : "Comparing stretches (may take a while for Statistical Stretch)...");
      setTimeout(async () => {
        try {
          const variants = [
            { name: "STF", algo: "stf" },
            { name: "AutoGHS", algo: "ghs" },
            { name: "Statistical Stretch", algo: "statistical_stretch" },
            { name: lang === "es" ? "Estrellas (asinh)" : "Stars (asinh)", algo: "stars" },
            { name: lang === "es" ? "Curva Manual" : "Manual Curve", algo: "curves" }
          ];
          const results = [];
          for (const v of variants) {
            try {
              results.push({ name: v.name, img: await computeStretch(v.algo, srcImg) });
            } catch (e) {
              logConsole((lang === "es" ? `${v.name} omitido: ` : `${v.name} skipped: `) + e.message, "warn");
            }
          }
          for (let i = 0; i < results.length; i++) {
            const r = results[i];
            state.imageSlots[i] = cloneImage({ ch: r.img.ch, w: r.img.w, h: r.img.h, nc: r.img.nc, isColor: r.img.isColor, wcs: srcImg && srcImg.wcs });
            const slotBtn = document.querySelector(`.piw-slot-btn[data-slot="${i + 1}"]`);
            if (slotBtn) { slotBtn.classList.add("filled"); slotBtn.title = "Stretch: " + r.name; }
            logConsole(`Slot ${i + 1} ← ${r.name}`, "info");
          }
          updateMixSourceOptions();
          hideLoader();
          logConsole(lang === "es"
            ? `Comparación lista: ${results.length} estirados en Slots 1-${results.length}. Carga un slot para verlo.`
            : `Comparison ready: ${results.length} stretches in Slots 1-${results.length}.`, "ok");
        } catch (e) {
          hideLoader();
          logConsole(`Error: ${e.message}`, "err");
        }
      }, 50);
    });
  }
  // STRETCH-COMPARE-END

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

  // FAME-BEGIN — pincel manual de máscara sobre el visor (dibujo a mano).
  let fameActive = false;
  let famePainting = false;
  let fameHistory = [];   // snapshots de state.activeMask para "Deshacer" (1 por trazo)
  let fameShapes = 0;     // contador informativo de trazos

  function fameSetControlsEnabled(on) {
    const c = el("mask-fame-controls");
    if (!c) return;
    c.classList.toggle("piw-disabled-control", !on);
    c.querySelectorAll("input,select,button").forEach((i) => { i.disabled = !on; });
  }
  function fameUpdateLabel() {
    const lbl = el("lblPostFameState");
    if (lbl) lbl.innerHTML = `<b>Shapes:</b> ${fameShapes}  <b>Active:</b> ${fameActive ? "brush" : "none"}`;
  }
  function fameEnsureMask() {
    const img = state.activeImage;
    if (!img) return false;
    const n = img.w * img.h;
    if (!state.activeMask || state.activeMask.length !== n) state.activeMask = new Float32Array(n);
    return true;
  }
  function famePaintAt(cx, cy) {
    const img = state.activeImage; if (!img) return;
    const w = img.w, h = img.h, m = state.activeMask;
    const R = parseFloat(el("sldFameBrushRad").value) || 20;
    const D = parseFloat(el("sldFameDensity").value); const dens = isNaN(D) ? 0.4 : D;
    const sign = (el("selFameMaskMode") && el("selFameMaskMode").value === "subtract") ? -1 : 1;
    const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(w - 1, Math.ceil(cx + R));
    const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(h - 1, Math.ceil(cy + R));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy); if (d > R) continue;
        const fall = 1 - (d / R);                 // pincel suave (más fuerte en el centro)
        const i = y * w + x;
        let v = m[i] + sign * dens * fall;
        m[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
      }
    }
  }
  function fameBlurIfNeeded() {
    const b = el("sldFameBlur") ? parseInt(el("sldFameBlur").value, 10) : 0;
    if (!b || b < 1 || !state.activeMask || !window.BackgroundExtraction || !window.BackgroundExtraction.gaussianBlurMask) return;
    // blur opcional via helper si existe; si no, se omite (el pincel ya es suave)
  }
  // Pintura con el ratón sobre el canvas (solo cuando FAME está activo).
  cv.addEventListener("pointerdown", (e) => {
    if (!fameActive || !fameEnsureMask()) return;
    e.preventDefault();
    fameHistory.push(Float32Array.from(state.activeMask));
    if (fameHistory.length > 30) fameHistory.shift();
    fameShapes++;
    famePainting = true;
    const p = getImageCoordsFromEvent(e);
    famePaintAt(p.x, p.y);
    state.previewMaskMode = true;
    render(); fameUpdateLabel();
  });
  cv.addEventListener("pointermove", (e) => {
    if (!fameActive || !famePainting) return;
    const p = getImageCoordsFromEvent(e);
    famePaintAt(p.x, p.y);
    render();
  });
  window.addEventListener("pointerup", () => { famePainting = false; });

  if (el("btnPostFameUndo")) el("btnPostFameUndo").addEventListener("click", () => {
    if (fameHistory.length) { state.activeMask = fameHistory.pop(); if (fameShapes > 0) fameShapes--; render(); fameUpdateLabel(); }
  });
  if (el("btnPostFameReset")) el("btnPostFameReset").addEventListener("click", () => {
    if (!fameEnsureMask()) return;
    state.activeMask.fill(0); fameHistory = []; fameShapes = 0; render(); fameUpdateLabel();
  });
  if (el("btnPostFameNext")) el("btnPostFameNext").addEventListener("click", () => {
    // "Siguiente forma": fija el estado actual como punto de no-retorno (limpia el historial de deshacer).
    fameHistory = []; fameUpdateLabel();
    const lang = document.documentElement.lang || "es";
    logConsole(lang === "es" ? "FAME: nueva forma iniciada." : "FAME: new shape started.", "info");
  });
  // FAME-END

  // Mostrar u ocultar controles de máscara según tipo seleccionado
  el("selMaskType").addEventListener("change", (e) => {
    const val = e.target.value;
    el("mask-range-controls").style.display = val === "range" ? "block" : "none";
    el("mask-color-controls").style.display = val === "color" ? "block" : "none";
    const fameC = el("mask-fame-controls");
    if (fameC) fameC.style.display = val === "fame" ? "block" : "none";
    fameActive = (val === "fame");
    fameSetControlsEnabled(fameActive);
    if (fameActive) {
      fameEnsureMask();
      const lang = document.documentElement.lang || "es";
      logConsole(lang === "es"
        ? "FAME activo: dibuja la máscara sobre la imagen con el ratón (añadir/restar, pincel ajustable). 'Aplicar máscara' la guarda."
        : "FAME active: draw the mask on the image with the mouse (add/subtract, adjustable brush). 'Apply mask' saves it.", "info");
    }
    fameUpdateLabel();
    if (!fameActive) livePreviewMask();
  });

  // Previsualizar Máscara
  el("btnPreviewMask").addEventListener("click", () => {
    if (!state.activeImage) return;
    showLoader("Generando vista previa de máscara...");

    setTimeout(() => {
      try {
        generateMaskData();
        state.previewMaskMode = true;
        el("btnToolViewMask").classList.add("active");
        el("btnToolViewCurrent").classList.remove("active");
        render();
        logConsole("Previsualización de máscara activada en la ventana principal", "info");
      } catch (err) {
        logConsole(`Error al generar máscara: ${err.message}`, "err");
      } finally {
        hideLoader();
      }
    }, 50);
  });

  // LIVE-MASK-BEGIN: con "Live" marcado, cualquier cambio de tipo/umbral/tono recalcula y muestra
  // la máscara al instante (mismo patrón que Live en Curvas/Balance). generateMaskData() es un
  // recorrido O(n) sin blur pesado, así que no hace falta proxy ni worker: es barato en cualquier
  // resolución. No afecta a FAME (pincel manual, generateMaskData no toca esa máscara).
  function livePreviewMask() {
    const chk = el("chkMaskLive");
    if (!chk || !chk.checked) return;
    if (!state.activeImage) return;
    if (el("selMaskType").value === "fame") return; // FAME es manual, nada que recalcular
    try {
      generateMaskData();
      state.previewMaskMode = true;
      el("btnToolViewMask").classList.add("active");
      el("btnToolViewCurrent").classList.remove("active");
      render();
    } catch (err) {
      logConsole(`Error al generar máscara: ${err.message}`, "err");
    }
  }
  {
    const chkLive = el("chkMaskLive");
    if (chkLive) chkLive.addEventListener("change", () => {
      if (chkLive.checked) livePreviewMask();
      else { state.previewMaskMode = false; el("btnToolViewMask").classList.remove("active"); el("btnToolViewCurrent").classList.add("active"); render(); }
    });
    ["sldMaskLow", "sldMaskHigh", "sldMaskFuzz", "sldMaskHueRange"].forEach((id) => {
      const s = el(id); if (s) s.addEventListener("input", livePreviewMask);
    });
    const sldHue = el("sldMaskHue"); if (sldHue) sldHue.addEventListener("input", livePreviewMask);
  }
  // LIVE-MASK-END

  // Función matemática de generación de máscaras
  function generateMaskData() {
    const img = state.activeImage;
    const n = img.w * img.h;
    const type = el("selMaskType").value;
    if (type === "fame") return; // FAME: la máscara se pinta a mano; no regenerar (conserva state.activeMask).
    const mask = new Float32Array(n);

    if (type === "range") {
      const low = parseFloat(el("sldMaskLow").value);
      const high = parseFloat(el("sldMaskHigh").value);
      const fuzz = parseFloat(el("sldMaskFuzz").value);

      // Calcular luminancia
      const lum = new Float32Array(n);
      if (img.isColor) {
        for (let i = 0; i < n; ++i) lum[i] = wl[0]*img.ch[0][i] + wl[1]*img.ch[1][i] + wl[2]*img.ch[2][i];
      } else {
        lum.set(img.ch[0]);
      }

      // Aplicar umbralización con fuzziness (rampa lineal)
      for (let i = 0; i < n; ++i) {
        const val = lum[i];
        if (val < low - fuzz) {
          mask[i] = 0;
        } else if (val > high + fuzz) {
          mask[i] = 0;
        } else if (val >= low && val <= high) {
          mask[i] = 1;
        } else if (val < low) {
          // Rampa ascendente
          mask[i] = (val - (low - fuzz)) / fuzz;
        } else {
          // Rampa descendente
          mask[i] = ((high + fuzz) - val) / fuzz;
        }
      }
    } else if (type === "color" && img.isColor) {
      const targetHue = state.selectedHue;
      const hueRange = parseFloat(el("sldMaskHueRange").value);
      
      const r = img.ch[0];
      const g = img.ch[1];
      const b = img.ch[2];

      for (let i = 0; i < n; ++i) {
        // Conversión RGB a HSL rápida
        const rv = r[i], gv = g[i], bv = b[i];
        const max = Math.max(rv, gv, bv);
        const min = Math.min(rv, gv, bv);
        const d = max - min;
        
        let hVal = 0;
        if (d > 1e-4) {
          if (max === rv) hVal = ((gv - bv) / d) % 6;
          else if (max === gv) hVal = (bv - rv) / d + 2;
          else hVal = (rv - gv) / d + 4;
          hVal = Math.round(hVal * 60);
          if (hVal < 0) hVal += 360;
        }
        
        const sat = max > 1e-4 ? d / max : 0; // Saturación HSV para rechazar fondos negros

        // Calcular distancia cíclica de Hue
        let dist = Math.abs(hVal - targetHue);
        if (dist > 180) dist = 360 - dist;

        if (dist <= hueRange && sat > 0.08) {
          // Intensidad basada en la cercanía al ángulo objetivo y en la saturación
          const factor = 1 - (dist / hueRange);
          mask[i] = factor * sat;
        } else {
          mask[i] = 0;
        }
      }
    } else {
      // Monocroma para color mask
      mask.fill(1);
    }

    state.activeMask = mask;
  }

  // Guardar máscara en el almacén de máscaras activa
  el("btnApplyMask").addEventListener("click", () => {
    if (!state.activeImage) return;
    try {
      generateMaskData();
      logConsole("Máscara generada y establecida como Máscara Activa de Post-Procesado", "info");
      
      // Auto-guardar en la primera ranura libre o Slot M1
      state.maskSlots[0] = Float32Array.from(state.activeMask);
      const btn = document.querySelector(`.piw-slot-btn[data-mask-slot="1"]`);
      btn.classList.add("filled");

      state.previewMaskMode = false;
      el("btnToolViewMask").classList.remove("active");
      el("btnToolViewCurrent").classList.add("active");
      render();
    } catch (err) {
      logConsole(`Error al guardar máscara: ${err.message}`, "err");
    }
  });

  // Aplicar saturación cromática
  el("btnApplySat").addEventListener("click", () => {
    if (!state.activeImage || !state.activeImage.isColor) return;
    const boost = parseFloat(el("sldSatBoost").value);
    showLoader("Ajustando saturación cromática...");

    setTimeout(() => {
      try {
        const srcImg = state.stepInputImage || state.activeImage;
        const img = cloneImage(srcImg);
        const n = img.w * img.h;
        const r = img.ch[0];
        const g = img.ch[1];
        const b = img.ch[2];

        for (let i = 0; i < n; ++i) {
          // Usar el multiplicador con opacidad/máscara si está activa
          const maskVal = state.activeMask ? state.activeMask[i] : 1;
          const localBoost = 1 + (boost - 1) * maskVal;

          const rv = r[i], gv = g[i], bv = b[i];
          const luma = wl[0]*rv + wl[1]*gv + wl[2]*bv;

          r[i] = Math.max(0, Math.min(1, luma + (rv - luma) * localBoost));
          g[i] = Math.max(0, Math.min(1, luma + (gv - luma) * localBoost));
          b[i] = Math.max(0, Math.min(1, luma + (bv - luma) * localBoost));
        }

        commitActiveImage(img, "Saturation", srcImg);
        render();
        refreshPathBar();
        logConsole(`Saturación ajustada (factor ${boost.toFixed(2)})`, "info");
      } catch (err) {
        logConsole(`Error en saturación: ${err.message}`, "err");
      } finally {
        hideLoader();
      }
    }, 50);
  });

  // --- MEZCLA DE CAPAS ESTILO PHOTOSHOP (TAB 3, drag & drop) ---
  // MIX-DND-BEGIN
  // Pila de capas: índice 0 = ARRIBA (se funde encima). Cada capa: { key, blend, opacity, visible }.
  if (!state.mixLayers) state.mixLayers = [];

  function mixSourceImage(key) {
    if (!key) return null;
    if (key.indexOf("wf-") === 0) return state.workflowImages[key.slice(3)];
    if (key === "starless") return state.starlessImage;
    if (key === "stars") return state.starsImage;
    if (key === "active") return state.activeImage;
    if (key.indexOf("slot-") === 0) return state.imageSlots[parseInt(key.slice(5), 10)];
    return null;
  }
  function mixLabelForKey(key) {
    if (key.indexOf("wf-") === 0) return key.slice(3);
    if (key === "starless") return "Starless";
    if (key === "stars") return "Stars";
    if (key === "active") return (document.documentElement.lang === "es" ? "Activa" : "Active");
    if (key.indexOf("slot-") === 0) return "Slot " + (parseInt(key.slice(5), 10) + 1);
    return key;
  }
  function mixAvailableSources() {
    // SOLO las imágenes del flujo (RGB, Starless RGB, Stars RGB, H/O/S, Final…). La paleta con
    // starless/stars/activa/slots duplicaba fuentes y hacía el sistema confuso e ininteligible.
    return Object.keys(state.workflowImages || {}).map(k => "wf-" + k);
  }

  // Añade una capa nueva desde una fuente (arriba de la pila). Usado por drag (ratón) y tap (táctil).
  function addMixLayer(key) {
    if (!key) return;
    const isBase = state.mixLayers.length === 0;
    state.mixLayers.unshift({ key: key, blend: isBase ? "normal" : "screen", opacity: 1.0, visible: true });
    renderMixStack(); mixRefreshPreview();
  }
  // Mueve una capa arriba/abajo en la pila (reordenar sin arrastrar → táctil).
  function moveMixLayer(idx, dir) {
    const to = idx + dir;
    if (to < 0 || to >= state.mixLayers.length) return;
    const m = state.mixLayers.splice(idx, 1)[0];
    state.mixLayers.splice(to, 0, m);
    renderMixStack(); mixRefreshPreview();
  }

  // Reconstruye la paleta de etiquetas (arrastrables con ratón, y con TAP para añadir en táctil).
  function updateMixSourceOptions() {
    const pal = el("mixPalette");
    if (!pal) return;
    const isEn = document.documentElement.lang !== "es";
    pal.innerHTML = "";
    const sources = mixAvailableSources();
    if (sources.length === 0) {
      pal.innerHTML = '<span class="piw-mix-empty">' + (isEn ? "Load images or separate stars first…" : "Carga imágenes o separa estrellas…") + '</span>';
    }
    sources.forEach((key) => {
      const chip = document.createElement("div");
      chip.className = "piw-mix-chip";
      chip.textContent = mixLabelForKey(key);
      chip.title = isEn ? "Tap or drag to add as a layer" : "Toca o arrastra para añadir como capa";
      chip.setAttribute("draggable", "true");
      chip.dataset.key = key;
      chip.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/mixkey", key); e.dataTransfer.effectAllowed = "copy"; chip.classList.add("dragging"); });
      chip.addEventListener("dragend", () => chip.classList.remove("dragging"));
      chip.addEventListener("click", () => addMixLayer(key)); // tap para añadir (táctil + ratón)
      pal.appendChild(chip);
    });
    renderMixStack();
  }

  const MIX_BLENDS = [
    { v: "normal", es: "Normal", en: "Normal" },
    { v: "screen", es: "Pantalla (Screen)", en: "Screen" },
    { v: "add", es: "Aditiva (Add)", en: "Add" },
    { v: "lighten", es: "Aclarar (Lighten)", en: "Lighten" }
  ];

  function renderMixStack() {
    const stack = el("mixStack");
    if (!stack) return;
    const isEn = document.documentElement.lang !== "es";
    const layers = state.mixLayers;
    stack.innerHTML = "";
    if (!layers.length) {
      stack.innerHTML = '<div class="piw-mix-empty">' + (isEn ? "Drag an image here to start" : "Arrastra aquí una imagen para empezar") + '</div>';
    }
    layers.forEach((L, idx) => {
      const isBase = (idx === layers.length - 1);
      const row = document.createElement("div");
      row.className = "piw-mix-layer-row";
      row.setAttribute("draggable", "true"); // arrastre para reordenar (ratón)
      row.dataset.idx = String(idx);

      // --- Línea 1: grip · ojo · nombre · ▲ ▼ · ✕ ---
      const top = document.createElement("div"); top.className = "mix-row-top";
      const grip = document.createElement("span"); grip.className = "mix-grip"; grip.textContent = "⠿";
      const eye = document.createElement("button");
      eye.className = "mix-eye" + (L.visible ? "" : " off"); eye.textContent = L.visible ? "👁" : "▫"; eye.title = isEn ? "Show/Hide" : "Ver/Ocultar";
      eye.addEventListener("click", (e) => { e.stopPropagation(); L.visible = !L.visible; renderMixStack(); mixRefreshPreview(); });
      const name = document.createElement("span"); name.className = "mix-name"; name.textContent = mixLabelForKey(L.key) + (isBase ? " · base" : "");
      const up = document.createElement("button"); up.className = "mix-move"; up.textContent = "▲"; up.title = isEn ? "Move up" : "Subir"; up.disabled = idx === 0;
      up.addEventListener("click", (e) => { e.stopPropagation(); moveMixLayer(idx, -1); });
      const down = document.createElement("button"); down.className = "mix-move"; down.textContent = "▼"; down.title = isEn ? "Move down" : "Bajar"; down.disabled = idx === layers.length - 1;
      down.addEventListener("click", (e) => { e.stopPropagation(); moveMixLayer(idx, 1); });
      const del = document.createElement("button"); del.className = "mix-del"; del.textContent = "✕"; del.title = isEn ? "Remove" : "Quitar";
      del.addEventListener("click", (e) => { e.stopPropagation(); state.mixLayers.splice(idx, 1); renderMixStack(); mixRefreshPreview(); });
      top.appendChild(grip); top.appendChild(eye); top.appendChild(name); top.appendChild(up); top.appendChild(down); top.appendChild(del);

      // --- Línea 2: modo de fusión + slider de opacidad ---
      const bottom = document.createElement("div"); bottom.className = "mix-row-bottom";
      const blend = document.createElement("select"); blend.className = "mix-blend";
      MIX_BLENDS.forEach(b => { const o = document.createElement("option"); o.value = b.v; o.textContent = isEn ? b.en : b.es; if (b.v === L.blend) o.selected = true; blend.appendChild(o); });
      blend.disabled = isBase; // la capa base es el fondo (sin modo de fusión)
      blend.addEventListener("click", (e) => e.stopPropagation());
      blend.addEventListener("change", (e) => { L.blend = e.target.value; mixRefreshPreview(); });
      const opWrap = document.createElement("label"); opWrap.className = "mix-op-wrap"; opWrap.title = isEn ? "Opacity" : "Opacidad";
      const opVal = document.createElement("span"); opVal.className = "mix-op"; opVal.textContent = Math.round(L.opacity * 100) + "%";
      const opSld = document.createElement("input"); opSld.type = "range"; opSld.className = "mix-op-slider"; opSld.min = "0"; opSld.max = "1"; opSld.step = "0.05"; opSld.value = String(L.opacity);
      opSld.addEventListener("click", (e) => e.stopPropagation());
      opSld.addEventListener("input", (e) => { L.opacity = parseFloat(e.target.value); opVal.textContent = Math.round(L.opacity * 100) + "%"; mixRefreshPreview(); });
      opWrap.appendChild(opSld); opWrap.appendChild(opVal);
      bottom.appendChild(blend); bottom.appendChild(opWrap);

      // Reordenar por arrastre dentro de la pila (ratón; en táctil se usan ▲▼)
      row.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/mixlayeridx", String(idx)); e.dataTransfer.effectAllowed = "move"; row.classList.add("dragging"); });
      row.addEventListener("dragend", () => { row.classList.remove("dragging"); Array.from(stack.children).forEach(c => c.classList.remove("drop-before", "drop-after")); });
      row.addEventListener("dragover", (e) => {
        if (Array.from(e.dataTransfer.types).indexOf("text/mixlayeridx") === -1) return;
        e.preventDefault();
        const rect = row.getBoundingClientRect(); const after = (e.clientY - rect.top) > rect.height / 2;
        row.classList.toggle("drop-after", after); row.classList.toggle("drop-before", !after);
      });
      row.addEventListener("dragleave", () => row.classList.remove("drop-before", "drop-after"));
      row.addEventListener("drop", (e) => {
        const from = parseInt(e.dataTransfer.getData("text/mixlayeridx"), 10);
        if (isNaN(from)) return;
        e.preventDefault(); e.stopPropagation();
        const rect = row.getBoundingClientRect(); const after = (e.clientY - rect.top) > rect.height / 2;
        let to = idx + (after ? 1 : 0);
        const moved = state.mixLayers.splice(from, 1)[0];
        if (from < to) to--;
        state.mixLayers.splice(to, 0, moved);
        renderMixStack(); mixRefreshPreview();
      });
      row.appendChild(top); row.appendChild(bottom);
      stack.appendChild(row);
    });
    const btn = el("btnGenerateBlend");
    if (btn) btn.disabled = state.mixLayers.filter(L => L.visible).length === 0;
  }

  // Zona de soltado de la pila: añadir una capa nueva desde la paleta (arriba del todo).
  {
    const stack = el("mixStack");
    if (stack) {
      stack.addEventListener("dragover", (e) => {
        if (Array.from(e.dataTransfer.types).indexOf("text/mixkey") === -1) return;
        e.preventDefault(); stack.classList.add("drop-hover");
      });
      stack.addEventListener("dragleave", () => stack.classList.remove("drop-hover"));
      stack.addEventListener("drop", (e) => {
        stack.classList.remove("drop-hover");
        const key = e.dataTransfer.getData("text/mixkey");
        if (!key) return;
        e.preventDefault();
        addMixLayer(key);
      });
    }
  }

  function mixBlendPix(base, top, mode) {
    if (mode === "screen") return 1 - (1 - base) * (1 - top);
    if (mode === "add") { const v = base + top; return v > 1 ? 1 : v; }
    if (mode === "lighten") return base > top ? base : top;
    return top; // normal
  }
  // Compone la pila (fondo→arriba). La opacidad interpola entre lo de debajo y el resultado fundido.
  function composeMixImage() {
    const visible = state.mixLayers.filter(L => L.visible);
    if (!visible.length) return null;
    const ordered = visible.slice().reverse(); // [fondo … arriba]
    const baseImg = mixSourceImage(ordered[0].key);
    if (!baseImg) return null;
    const w = baseImg.w, h = baseImg.h, n = w * h;
    const chans = (img) => [img.ch[0], img.nc > 1 ? img.ch[1] : img.ch[0], img.nc > 2 ? img.ch[2] : (img.nc > 1 ? img.ch[1] : img.ch[0])];
    const outR = new Float32Array(n), outG = new Float32Array(n), outB = new Float32Array(n);
    { const [r, g, b] = chans(baseImg); const op = ordered[0].opacity; for (let i = 0; i < n; i++) { outR[i] = r[i] * op; outG[i] = g[i] * op; outB[i] = b[i] * op; } }
    for (let li = 1; li < ordered.length; li++) {
      const L = ordered[li]; const img = mixSourceImage(L.key);
      if (!img || img.w !== w || img.h !== h) { logConsole((document.documentElement.lang === "es" ? "Capa omitida (tamaño distinto): " : "Layer skipped (size mismatch): ") + mixLabelForKey(L.key), "warn"); continue; }
      const [r, g, b] = chans(img); const op = L.opacity, mode = L.blend;
      for (let i = 0; i < n; i++) {
        const br = outR[i], bg = outG[i], bb = outB[i];
        outR[i] = br * (1 - op) + mixBlendPix(br, r[i], mode) * op;
        outG[i] = bg * (1 - op) + mixBlendPix(bg, g[i], mode) * op;
        outB[i] = bb * (1 - op) + mixBlendPix(bb, b[i], mode) * op;
      }
    }
    for (let i = 0; i < n; i++) { outR[i] = outR[i] < 0 ? 0 : (outR[i] > 1 ? 1 : outR[i]); outG[i] = outG[i] < 0 ? 0 : (outG[i] > 1 ? 1 : outG[i]); outB[i] = outB[i] < 0 ? 0 : (outB[i] > 1 ? 1 : outB[i]); }
    return { ch: [outR, outG, outB], w, h, nc: 3, isColor: true, wcs: baseImg.wcs };
  }

  // Preview en vivo de la mezcla (si el checkbox está marcado). No destructivo.
  function mixRefreshPreview() {
    const chk = el("chkMixPreview");
    if (!chk || !chk.checked) return;
    const img = composeMixImage();
    if (img) { previewActiveImage(img, state.stepInputImage || state.activeImage, "Blend"); state.screenStretchMode = false; render(); drawHistogram(); }
  }

  if (el("chkMixPreview")) {
    el("chkMixPreview").addEventListener("change", () => {
      if (el("chkMixPreview").checked) mixRefreshPreview();
      else if (state.stepInputImage) { state.activeImage = state.stepInputImage; render(); }
    });
  }

  if (el("btnGenerateBlend")) {
    el("btnGenerateBlend").addEventListener("click", () => {
      const lang = document.documentElement.lang || "es";
      showLoader(lang === "es" ? "Componiendo mezcla de capas..." : "Composing layer blend...");
      setTimeout(() => {
        try {
          const img = composeMixImage();
          if (!img) throw new Error(lang === "es" ? "No hay capas visibles en la pila." : "No visible layers in the stack.");
          // La mezcla se guarda como imagen NUEVA del flujo: "Final", "Final 1", "Final 2"…
          // Antes sobrescribía el canal activo (p. ej. Starless RGB) y parecía que "no fusionaba":
          // el resultado pisaba una fuente y no aparecía como imagen propia en la barra de canales.
          let name = "Final", nn = 0;
          while (state.workflowImages[name]) { nn++; name = "Final " + nn; }
          img.stages = ["Blend"];
          img.hasTransforms = true;
          state.workflowImages[name] = img;
          selectWorkflowKey(name);   // selecciona la nueva imagen (render + path bar + baseline)
          // Las capas mezcladas ya suelen estar estiradas: sin AutoSTF de pantalla (evita doble estirado).
          state.screenStretchMode = false;
          { const bStf = el("btnToolAutoSTF"); if (bStf) bStf.classList.remove("active"); }
          render();
          scheduleSessionSave();
          logConsole((lang === "es" ? "Mezcla compuesta → " : "Blend composed → ") + name, "ok");
        } catch (err) {
          logConsole((lang === "es" ? "Error al componer mezcla: " : "Blend error: ") + err.message, "err");
        } finally { hideLoader(); }
      }, 50);
    });
  }
  // MIX-DND-END

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
    // "Preview": vista previa NO destructiva (proxy instantáneo + full-res en worker). El commit
    // lo hace el botón grande "Aplicar Color Mixer" sobre la imagen, como en el resto de menús.
    const btnCM = el("btnApplyColorMixer");
    if (btnCM) btnCM.addEventListener("click", () => {
      const srcImg = state.stepInputImage || state.activeImage; if (!srcImg) return;
      const lang = document.documentElement.lang || "es";
      const st = state.colorMixer;
      showLoader(lang === "es" ? "Preview de Color Mixer..." : "Color Mixer preview...");
      setTimeout(async () => {
        try {
          await previewProxyThenFull(srcImg, "Color Mixer", (img) => {
            if (img === srcImg) return runImgWorker("colorMixer", img, st).catch(() => computeColorMixer(img, st));
            return computeColorMixer(img, st);
          });
          logConsole(lang === "es" ? "Preview de Color Mixer. Pulsa 'Aplicar Color Mixer' para confirmar." : "Color Mixer preview. Press 'Apply Color Mixer' to commit.", "info");
        } catch (e) {
          logConsole("Color Mixer: " + (e && e.message ? e.message : e), "err");
        } finally { hideLoader(); }
      }, 50);
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
    // "Preview": vista previa NO destructiva SIEMPRE a resolución completa (el enfoque a baja
    // resolución engaña — misma exclusión de proxy que deconv/denoise/sharpen). Corre en el worker.
    // El commit lo hace el botón grande "Aplicar Detalle" sobre la imagen.
    const btnD = el("btnApplyDetail");
    if (btnD) btnD.addEventListener("click", () => {
      const srcImg = state.stepInputImage || state.activeImage; if (!srcImg) return;
      const lang = document.documentElement.lang || "es"; const algo = el("selDetailAlgo").value;
      const pr = Object.assign({ algo }, detailParams());
      showLoader(lang === "es" ? "Preview de detalle..." : "Detail preview...");
      setTimeout(async () => {
        try {
          const res = await runImgWorker("detail", srcImg, pr).catch(() => computeDetail(srcImg, algo, detailParams()));
          previewActiveImage(res, srcImg, "Detail");
          render(); drawHistogram();
          logConsole(lang === "es" ? "Preview de detalle. Pulsa 'Aplicar Detalle' para confirmar." : "Detail preview. Press 'Apply Detail' to commit.", "info");
        } catch (e) {
          logConsole("Detail: " + (e && e.message ? e.message : e), "err");
        } finally { hideLoader(); }
      }, 50);
    });
  }
  // IMG-ENH-END


  // --- SLOTS DE MEMORIA DE IMAGEN Y MÁSCARA ---

  // Inicializar grid de slots
  document.querySelectorAll(".piw-slot-btn").forEach(btn => {
    // Ranuras de imagen
    const slotIdx = parseInt(btn.getAttribute("data-slot"), 10) - 1;
    if (slotIdx >= 0 && slotIdx < 8) {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        
        if (state.imageSlots[slotIdx] === null) {
          // Guardar si está vacío
          saveSlot(slotIdx);
        } else {
          // Cargar si tiene contenido
          loadSlot(slotIdx);
        }
      });

      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        // Clic derecho: guardar/sobrescribir. Si el slot YA tiene contenido, pedir confirmación:
        // antes sobrescribía en silencio y destrozaba las comparaciones (el usuario recorría los
        // slots con clic derecho y los convertía todos en copias de la imagen activa).
        if (state.imageSlots[slotIdx] !== null) {
          const lang = document.documentElement.lang || "es";
          const what = btn.title || (lang === "es" ? `Slot ${slotIdx + 1}` : `Slot ${slotIdx + 1}`);
          const ok = confirm(lang === "es"
            ? `El Slot ${slotIdx + 1} ya contiene "${what}". ¿Sobrescribirlo con la imagen activa?\n(Para VER el slot usa clic izquierdo)`
            : `Slot ${slotIdx + 1} already holds "${what}". Overwrite it with the active image?\n(To VIEW the slot use left click)`);
          if (!ok) return;
        }
        saveSlot(slotIdx);
      });
    }

    // Ranuras de máscara
    const maskIdx = parseInt(btn.getAttribute("data-mask-slot"), 10) - 1;
    if (maskIdx >= 0 && maskIdx < 8) {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        if (state.maskSlots[maskIdx] === null) {
          saveMaskSlot(maskIdx);
        } else {
          loadMaskSlot(maskIdx);
        }
      });
      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        saveMaskSlot(maskIdx);
      });
    }
  });

  function saveSlot(idx) {
    if (!state.activeImage) return;
    state.imageSlots[idx] = cloneImage(state.activeImage);
    
    const btn = document.querySelector(`.piw-slot-btn[data-slot="${idx + 1}"]`);
    btn.classList.add("filled");
    logConsole(`Imagen activa guardada en Slot de Imagen ${idx + 1}`, "info");
    updateMixSourceOptions();
  }

  function loadSlot(idx) {
    const slot = state.imageSlots[idx];
    if (!slot) return;

    // Desmarcar anterior activo
    document.querySelectorAll(".piw-slot-btn").forEach(btn => btn.classList.remove("active-slot"));

    // Copia de trabajo ESTABLE por slot: reutilizarla al reciclar entre slots permite que el render
    // cacheado (displayImageDataFor) acierte y el cambio entre slots sea instantáneo (antes clonaba
    // un objeto NUEVO en cada clic → siempre fallaba el cache → AutoSTF completo por clic).
    if (!slot.__working) slot.__working = cloneImage(slot);
    state.activeImage = slot.__working;
    state.subtractedGradient = null;
    state.previewGradientMode = false;
    state.pendingPreview = true; // el slot cargado es un cambio pendiente de aplicar
    if (state.activeWorkflowKey) {
      state.workflowImages[state.activeWorkflowKey] = state.activeImage;
    }
    const btn = document.querySelector(`.piw-slot-btn[data-slot="${idx + 1}"]`);
    btn.classList.add("active-slot");

    // Mostrar QUÉ contiene el slot (título puesto por "Comparar": algoritmo/método). Sin esto,
    // al ciclar slots comparando no se sabía cuál se estaba viendo. "ok" → también sale como toast.
    const lang = document.documentElement.lang || "es";
    const what = btn.title ? ` — ${btn.title}` : "";
    logConsole((lang === "es" ? `Viendo Slot ${idx + 1}` : `Viewing Slot ${idx + 1}`) + what, "ok");
    render();
    drawHistogram();
    refreshPathBar();
  }

  function saveMaskSlot(idx) {
    if (!state.activeMask) {
      logConsole("No hay ninguna máscara activa para guardar", "err");
      return;
    }
    state.maskSlots[idx] = Float32Array.from(state.activeMask);
    const btn = document.querySelector(`.piw-slot-btn[data-mask-slot="${idx + 1}"]`);
    btn.classList.add("filled");
    logConsole(`Máscara activa guardada en Slot de Máscara M${idx + 1}`, "info");
  }

  function loadMaskSlot(idx) {
    if (!state.maskSlots[idx]) return;
    
    state.activeMask = Float32Array.from(state.maskSlots[idx]);
    logConsole(`Máscara M${idx + 1} cargada y establecida como Máscara Activa`, "info");

    state.previewMaskMode = true;
    el("btnToolViewMask").classList.add("active");
    el("btnToolViewCurrent").classList.remove("active");
    render();
  }

  el("btnClearSlots").addEventListener("click", () => {
    state.imageSlots.fill(null);
    state.maskSlots.fill(null);
    document.querySelectorAll(".piw-slot-btn").forEach(btn => {
      btn.classList.remove("filled", "active-slot");
    });
    logConsole("Slots de memoria de imagen y máscaras vaciados", "info");
    updateMixSourceOptions();
  });


  // --- VISUALIZADOR Y DIBUJO ---

  // DISPLAY-AA-BEGIN: el canvas se renderiza a resolución completa y el navegador lo reduce por CSS
  // al tamaño del visor (~1075px). A resoluciones altas (p.ej. 4000px) ese downscale bilineal del
  // navegador produce ALIASING del campo estelar (se ve peor que a 2000px). Pre-filtramos la COPIA de
  // display (box blur separable, NO toca los datos de trabajo/exportación) proporcional al ratio de
  // reducción → el reescalado del navegador queda limpio. Solo afecta a lo que se ve en pantalla.
  function displayAntiAlias(id, r) {
    if (r < 1) return;
    const w = id.width, h = id.height, d = id.data;
    const tmp = new Uint8ClampedArray(d.length);
    for (let y = 0; y < h; y++) {
      const off = y * w * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let k = 0; k <= r && k < w; k++) sum += d[off + k * 4 + c];
        for (let xx = 0; xx < w; xx++) {
          const cnt = Math.min(xx + r, w - 1) - Math.max(xx - r, 0) + 1;
          tmp[off + xx * 4 + c] = sum / cnt;
          const add = xx + r + 1, sub = xx - r;
          if (add < w) sum += d[off + add * 4 + c];
          if (sub >= 0) sum -= d[off + sub * 4 + c];
        }
      }
    }
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let k = 0; k <= r && k < h; k++) sum += tmp[(k * w + x) * 4 + c];
        for (let yy = 0; yy < h; yy++) {
          const cnt = Math.min(yy + r, h - 1) - Math.max(yy - r, 0) + 1;
          d[(yy * w + x) * 4 + c] = sum / cnt;
          const add = yy + r + 1, sub = yy - r;
          if (add < h) sum += tmp[(add * w + x) * 4 + c];
          if (sub >= 0) sum -= tmp[(sub * w + x) * 4 + c];
        }
      }
    }
  }
  // DISPLAY-AA-END

  // RENDER-CACHE-BEGIN
  // Cache del ImageData final (estirado de pantalla AutoSTF + channelsToImageData + antialias) por
  // objeto-imagen. Recalcular esto en cada render (varias pasadas O(n) sobre millones de píxeles) era
  // el cuello de botella que hacía lentos el Split y el cambio de slots. Como cada preview/commit crea
  // un objeto-imagen NUEVO, cachear en el propio objeto es seguro; un LRU acotado limita la memoria.
  const _dispCacheLRU = [];
  function _dispCacheTouch(imgObj) {
    const i = _dispCacheLRU.indexOf(imgObj);
    if (i !== -1) _dispCacheLRU.splice(i, 1);
    _dispCacheLRU.push(imgObj);
    while (_dispCacheLRU.length > 4) {
      const old = _dispCacheLRU.shift();
      if (old) { old.__disp = null; old.__dispKey = null; }
    }
  }
  function displayImageDataFor(imgObj, aaR) {
    const key = (state.screenStretchMode ? "s" : "n") + "|" + aaR;
    if (imgObj.__disp && imgObj.__dispKey === key) return imgObj.__disp;
    let channelsToDraw = imgObj.ch;
    if (state.screenStretchMode) {
      try { channelsToDraw = applyAutoSTF(imgObj.ch, imgObj.nc, imgObj.isColor, false); }
      catch (e) { console.warn("AutoSTF:", e); }
    }
    const id = AutoGHS.channelsToImageData(channelsToDraw, imgObj.w, imgObj.h, imgObj.nc);
    if (aaR) displayAntiAlias(id, aaR);
    imgObj.__disp = id;
    imgObj.__dispKey = key;
    _dispCacheTouch(imgObj);
    return id;
  }
  // Radio de antialias de la vista según cuánto reduce el CSS el canvas (mismo criterio de siempre).
  function _displayAAR() {
    const dispW = cv.getBoundingClientRect().width || cv.width;
    const ratio = dispW > 0 ? cv.width / dispW : 1;
    return (ratio >= 1.8 && !famePainting) ? Math.min(2, Math.max(1, Math.round((ratio - 1) / 2.5))) : 0;
  }

  // Composición rápida del Split: reutiliza dos canvas offscreen ya renderizados (_splitCanvasA/B) y
  // solo redibuja las dos porciones en la posición actual. Se llama en cada mousemove del arrastre en
  // vez de render() completo, por eso la cortinilla ahora es fluida.
  let _splitCanvasA = null, _splitCanvasB = null;
  function compositeSplitFast() {
    if (!_splitCanvasA || !_splitCanvasB || _splitCanvasA.width !== cv.width) { render(); return; }
    const splitX = Math.round(cv.width * state.splitPercent);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(_splitCanvasA, 0, 0, splitX, cv.height, 0, 0, splitX, cv.height);
    ctx.drawImage(_splitCanvasB, splitX, 0, cv.width - splitX, cv.height, splitX, 0, cv.width - splitX, cv.height);
    const containerRect = container.getBoundingClientRect();
    const splitSlider = el("piwSplitSlider");
    splitSlider.style.display = "block";
    splitSlider.style.left = (state.splitPercent * containerRect.width) + "px";
  }
  // RENDER-CACHE-END

  function render() {
    // Detect change of activeImage reference
    if (state.activeImage && state.activeImage !== state._lastImgRef) {
      if (state._lastImgRef) {
        state.previousImage = state._lastImgRef;
      }
      state._lastImgRef = state.activeImage;

      // COMPARE-BASELINE: al ejecutar una nueva operación (preview/commit) se descarta el
      // Toggle A/B momentáneo para mostrar el nuevo resultado (B). La cortinilla Split, en
      // cambio, PERSISTE: sigue comparando contra la Imagen Inicial del menú actual
      // (state.stepInputImage = "antes de aplicar"), no contra la última imagen mostrada.
      state.viewingPrevious = false;
      const btnToggle = el("btnToolToggleAB");
      if (btnToggle) {
        btnToggle.classList.remove("active");
        btnToggle.textContent = "Toggle A/B";
      }
      // La comparación (Toggle y Split) usa siempre la Imagen Inicial del menú como referencia.
      state.splitCompareImage = state.stepInputImage;
    }

    // Determine which image is active source. La "A" del Toggle es la Imagen Inicial del menú
    // (state.stepInputImage), es decir, la imagen antes de aplicar cambios en este menú.
    const imgSource = (state.viewingPrevious && state.stepInputImage) ? state.stepInputImage : state.activeImage;
    const img = (el("chkStarlessView").checked && state.starlessImage) ? state.starlessImage : imgSource;

    if (!img) {
      const btn = el("btnBigApply");
      if (btn) btn.style.display = "none";
      return;
    }
    updateBigApply();
    updateStagesBar(); // U3: refleja el historial de pasos de la imagen mostrada
    // La persistencia en workflowImages ya NO ocurre aquí (era un efecto secundario frágil):
    // ahora se hace explícitamente en commitActiveImage() al confirmar cada operación.

    // Mostrar/ocultar el botón de ver gradiente
    if (el("btnToolViewGradient")) {
      if (state.subtractedGradient) {
        el("btnToolViewGradient").style.display = "inline-block";
      } else {
        el("btnToolViewGradient").style.display = "none";
        el("btnToolViewGradient").classList.remove("active");
        if (state.previewGradientMode) {
          state.previewGradientMode = false;
          el("btnToolViewCurrent").classList.add("active");
        }
      }
    }

    cv.width = img.w;
    cv.height = img.h;

    // Limpiar canvas
    ctx.fillStyle = "#020202";
    ctx.fillRect(0, 0, cv.width, cv.height);

    const n = img.w * img.h;

    // DISPLAY-AA: antialias de la vista si el canvas se reduce mucho por CSS (p.ej. 4000px → ~1075px).
    const _aaR = _displayAAR();

    // Generar imagen final a dibujar (la ruta normal usa el cache por objeto-imagen).
    let id;
    if (state.previewMaskMode && state.activeMask) {
      // Dibujar máscara en escala de grises
      id = new ImageData(img.w, img.h);
      const d = id.data;
      for (let i = 0, p = 0; i < n; ++i, p += 4) {
        const val = Math.round(state.activeMask[i] * 255);
        d[p] = val; d[p+1] = val; d[p+2] = val; d[p+3] = 255;
      }
      if (_aaR) displayAntiAlias(id, _aaR);
    } else if (state.previewGradientMode && state.subtractedGradient) {
      // Dibujar modelo de gradiente sustraído
      let channelsToDraw = state.subtractedGradient.ch;
      if (state.screenStretchMode) {
        try {
          channelsToDraw = applyAutoSTF(state.subtractedGradient.ch, state.subtractedGradient.nc, state.subtractedGradient.isColor, false);
        } catch (e) {
          console.warn("Failed to apply AutoSTF screen stretch to gradient:", e);
        }
      }
      id = AutoGHS.channelsToImageData(channelsToDraw, state.subtractedGradient.w, state.subtractedGradient.h, state.subtractedGradient.nc);
      if (_aaR) displayAntiAlias(id, _aaR);
    } else {
      // Dibujar imagen (color o monocromo) — cacheado por objeto (AutoSTF + AA incluidos).
      id = displayImageDataFor(img, _aaR);
    }

    // Referencia "antes de aplicar" del menú actual. Solo dividimos si coincide en geometría con
    // la imagen activa (evita basura cuando un menú cambia el tamaño, p.ej. Crop/Resample).
    const splitComp = state.splitCompareImage || state.stepInputImage;
    if (state.splitViewMode && splitComp && splitComp.w === img.w && splitComp.h === img.h && splitComp.nc === img.nc) {
      // Renderizar vista dividida A/B (ambos lados cacheados). Guardamos los canvas compuestos en
      // _splitCanvasA/B para que el arrastre de la cortinilla solo recomponga (compositeSplitFast).
      const compId = displayImageDataFor(splitComp, _aaR);
      const splitX = Math.round(img.w * state.splitPercent);

      if (!_splitCanvasA) _splitCanvasA = document.createElement("canvas");
      _splitCanvasA.width = img.w; _splitCanvasA.height = img.h;
      _splitCanvasA.getContext("2d").putImageData(id, 0, 0);

      if (!_splitCanvasB) _splitCanvasB = document.createElement("canvas");
      _splitCanvasB.width = img.w; _splitCanvasB.height = img.h;
      _splitCanvasB.getContext("2d").putImageData(compId, 0, 0);

      // Dibujar porciones
      ctx.drawImage(_splitCanvasA, 0, 0, splitX, img.h, 0, 0, splitX, img.h);
      ctx.drawImage(_splitCanvasB, splitX, 0, img.w - splitX, img.h, splitX, 0, img.w - splitX, img.h);

      // Mostrar y posicionar el slider de cortinilla
      const containerRect = container.getBoundingClientRect();
      const splitSlider = el("piwSplitSlider");
      splitSlider.style.display = "block";
      splitSlider.style.left = (state.splitPercent * containerRect.width) + "px";
    } else {
      _splitCanvasA = null; _splitCanvasB = null;
      ctx.putImageData(id, 0, 0);
      el("piwSplitSlider").style.display = "none";
    }

    // Draw crop overlay if a selection exists
    if (cropState.rect) {
      drawCropOverlay(ctx, cropState.rect);
    }

    // ANOTAR: overlay de objetos del catálogo (definido en 22-anotacion.js).
    if (typeof drawAnnotationsOverlay === "function") drawAnnotationsOverlay();
  }

  // Dibujar Histograma SVG
  function drawHistogram() {
    const img = (el("chkStarlessView").checked && state.starlessImage) ? state.starlessImage : state.activeImage;
    if (!img) return;

    const n = img.w * img.h;
    const bins = new Uint32Array(256).fill(0);

    // Distribución de luminancia por SUBMUESTREO regular (V1 Fase 4): 256 bins no ganan nada
    // recorriendo 16-36M de píxeles; con ≤500k muestras el redibujado tras cada Probar/Live es
    // instantáneo y la forma del histograma es indistinguible.
    const step = Math.max(1, Math.floor(n / 500000));
    if (img.isColor) {
      const r = img.ch[0], g = img.ch[1], b = img.ch[2];
      for (let i = 0; i < n; i += step) {
        const lum = wl[0] * r[i] + wl[1] * g[i] + wl[2] * b[i];
        const idx = Math.min(255, Math.max(0, Math.floor(lum * 255)));
        bins[idx]++;
      }
    } else {
      const c = img.ch[0];
      for (let i = 0; i < n; i += step) {
        const idx = Math.min(255, Math.max(0, Math.floor(c[i] * 255)));
        bins[idx]++;
      }
    }

    // Encontrar máximo para escalar (ignorando picos extremos del fondo)
    let max = 0;
    for (let i = 3; i < 256; ++i) { // Ignorar los primeros bins de negros puros
      if (bins[i] > max) max = bins[i];
    }
    if (max === 0) max = 1;

    const width = 330;
    const height = 60;
    const points = [];
    points.push(`0,${height}`);

    for (let i = 0; i < 256; ++i) {
      const x = (i / 255) * width;
      const val = bins[i] > max ? max : bins[i];
      const y = height - (val / max) * height;
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    points.push(`${width},${height}`);

    el("histogramPath").setAttribute("d", `M ${points.join(" L ")} Z`);
    drawStretchCurve();
  }

  // STRETCH-CURVE-BEGIN
  // Curva de estirado "Curva Manual / Sigmoide". Dos formas de definirla:
  //  - Sliders (rápidos): Punto Negro, Medios (MTF midtone) y Contraste (sigmoide) -> siembran puntos.
  //  - Editor de puntos: añadir (clic), arrastrar y quitar (doble clic) puntos sobre el histograma.
  // La curva final es una spline cúbica monótona (PCHIP) por los puntos. mover un slider re-siembra.
  let stretchPoints = [[0, 0], [1, 1]];

  function stretchCurveValue(x, black, mid, contrast) {
    let v = (x - black) / Math.max(1e-6, 1.0 - black);
    if (v < 0) v = 0; else if (v > 1) v = 1;
    if (Math.abs(mid - 0.5) > 1e-4) {
      const m = mid;
      const den = (2 * m - 1) * v - m;
      if (Math.abs(den) > 1e-12) v = ((m - 1) * v) / den;
    }
    if (Math.abs(contrast) > 1e-4) {
      const k = contrast * 6;
      const sig = (t) => 1 / (1 + Math.exp(-k * (t - 0.5)));
      const s0 = sig(0), s1 = sig(1);
      v = (sig(v) - s0) / (s1 - s0);
    }
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }

  function setStretchPointsFromSliders() {
    const black = parseFloat(el("sldStretchBlack").value);
    const mid = parseFloat(el("sldStretchMid").value);
    const contrast = parseFloat(el("sldStretchContrast").value);
    stretchPoints = [];
    for (let i = 0; i <= 8; i++) {
      const x = i / 8;
      stretchPoints.push([x, stretchCurveValue(x, black, mid, contrast)]);
    }
  }

  // Spline cúbica monótona (Hermite con tangentes acotadas) por stretchPoints (ordenados por x).
  // V2 (Fase 4): la matemática vive en ImgOps.monotoneCurveFn (imgops.js), compartida con el worker.
  function curveEval(x) {
    return window.ImgOps.monotoneCurveFn(stretchPoints)(x);
  }

  function drawStretchCurve() {
    const path = el("stretchCurvePath");
    if (!path) return;
    const W = 330, H = 60, pts = [];
    for (let i = 0; i <= 80; i++) {
      const x = i / 80;
      pts.push(`${(x * W).toFixed(1)},${((1 - curveEval(x)) * H).toFixed(1)}`);
    }
    path.setAttribute("d", `M ${pts.join(" L ")}`);
    const svg = path.ownerSVGElement;
    if (!svg) return;
    svg.querySelectorAll("circle.stretch-pt").forEach((c) => c.remove());
    const NS = "http://www.w3.org/2000/svg";
    stretchPoints.forEach((p) => {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("class", "stretch-pt");
      c.setAttribute("cx", (p[0] * W).toFixed(1));
      c.setAttribute("cy", ((1 - p[1]) * H).toFixed(1));
      c.setAttribute("r", "2.5");
      c.setAttribute("fill", "var(--gold-primary)");
      svg.appendChild(c);
    });
  }

  // Editor interactivo de puntos sobre el SVG del histograma de estirado.
  function setupStretchCurveEditor() {
    const svg = el("stretchCurvePath") && el("stretchCurvePath").ownerSVGElement;
    if (!svg) return;
    let dragIdx = -1;
    const toNorm = (ev) => {
      const r = svg.getBoundingClientRect();
      const x = (ev.clientX - r.left) / r.width;
      const y = 1 - (ev.clientY - r.top) / r.height;
      return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
    };
    const findNear = (x, y) => {
      for (let i = 0; i < stretchPoints.length; i++) {
        const dx = stretchPoints[i][0] - x, dy = stretchPoints[i][1] - y;
        if (dx * dx + dy * dy < 0.0016) return i;
      }
      return -1;
    };
    svg.style.cursor = "crosshair";
    svg.addEventListener("pointerdown", (ev) => {
      const [x, y] = toNorm(ev);
      let idx = findNear(x, y);
      if (idx < 0) {
        stretchPoints.push([x, y]);
        stretchPoints.sort((a, b) => a[0] - b[0]);
        idx = stretchPoints.findIndex((p) => p[0] === x && p[1] === y);
      }
      dragIdx = idx;
      drawStretchCurve();
      ev.preventDefault();
    });
    window.addEventListener("pointermove", (ev) => {
      if (dragIdx < 0) return;
      const [x, y] = toNorm(ev);
      const isEnd = dragIdx === 0 || dragIdx === stretchPoints.length - 1;
      const px = isEnd ? stretchPoints[dragIdx][0]
        : Math.max(stretchPoints[dragIdx - 1][0] + 0.005, Math.min(stretchPoints[dragIdx + 1][0] - 0.005, x));
      stretchPoints[dragIdx] = [px, y];
      drawStretchCurve();
    });
    window.addEventListener("pointerup", () => { dragIdx = -1; });
    svg.addEventListener("dblclick", (ev) => {
      const [x, y] = toNorm(ev);
      const idx = findNear(x, y);
      if (idx > 0 && idx < stretchPoints.length - 1) {
        stretchPoints.splice(idx, 1);
        drawStretchCurve();
      }
    });
  }
  setStretchPointsFromSliders();
  setupStretchCurveEditor();
  // STRETCH-CURVE-END

  // --- CONTROLES DE ZOOM, PAN Y SPLIT SLIDER ---

  function zoomFit() {
    if (!state.activeImage) return;
    // El canvas se muestra con object-fit:contain llenando el panel, asi que a escala 1
    // la imagen ya queda ajustada (toda visible). "Fit/Ajustar" = volver a escala 1.
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    updateTransform();
  }

  function updateTransform() {
    cv.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  }

  // U5: zoom ANCLADO a un punto de pantalla (cursor o centro del pellizco): el punto de la
  // imagen que está bajo (clientX, clientY) se queda quieto al cambiar la escala. Con
  // transform-origin en el centro, el centro TRANSFORMADO del canvas es C0+pan (la escala no
  // lo mueve), así que basta corregir el pan con (1 - nuevo/viejo) · (punto - centroRect).
  function zoomAt(clientX, clientY, newZoom) {
    newZoom = Math.max(0.2, Math.min(15, newZoom));
    const r = cv.getBoundingClientRect();
    const k = newZoom / state.zoom;
    state.panX += (1 - k) * (clientX - (r.left + r.width / 2));
    state.panY += (1 - k) * (clientY - (r.top + r.height / 2));
    state.zoom = newZoom;
    updateTransform();
  }

  // Zoom de la rueda del ratón, centrado en el cursor (U5)
  container.addEventListener("wheel", (e) => {
    if (!state.activeImage) return;
    e.preventDefault();
    const zoomFactor = 1.15;
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? state.zoom * zoomFactor : state.zoom / zoomFactor);
  }, { passive: false });

  // U5: pinch-zoom con dos dedos (Pointer Events; el canvas ya tiene touch-action:none).
  // El segundo dedo CANCELA el paneo/crop en curso; la escala sigue la distancia entre dedos
  // (anclada al punto medio) y el punto medio arrastra la imagen (paneo a dos dedos). Al
  // soltar un dedo termina el gesto: seguir paneando requiere levantar y volver a tocar
  // (evita el salto clásico al retirar el primer dedo).
  const _pinch = { pointers: new Map(), active: false, dist0: 1, zoom0: 1, mid: null };
  function _pinchDist() { const p = [..._pinch.pointers.values()]; return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1; }
  function _pinchMid() { const p = [..._pinch.pointers.values()]; return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }; }
  function _pinchEnd(e) {
    if (!_pinch.pointers.delete(e.pointerId)) return;
    if (_pinch.active && _pinch.pointers.size < 2) {
      _pinch.active = false;
      state.isDragging = false;
    }
  }
  window.addEventListener("pointercancel", _pinchEnd);

  // Paneo y Crop con arrastre del ratón
  cv.addEventListener("pointerdown", (e) => {
    if (!state.activeImage) return;

    // U5: registro de dedos; con el segundo dedo se entra en modo pellizco
    if (e.pointerType === "touch") {
      _pinch.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (_pinch.pointers.size >= 2) {
        state.isDragging = false;
        cropState.drawing = false;
        cropState.dragMode = "";
        cropState.dragStartRect = null;
        _pinch.active = true;
        _pinch.dist0 = _pinchDist();
        _pinch.zoom0 = state.zoom;
        _pinch.mid = _pinchMid();
        cv.style.cursor = "default";
        return;
      }
    }

    // Check if Crop section is expanded/visible to allow crop mode
    const sectionCrop = el("sectionCrop");
    const cropActive = sectionCrop && !sectionCrop.classList.contains("collapsed");
    
    if (cropActive) {
      const { x: ix, y: iy } = getImageCoordsFromEvent(e);
      const hit = cropHitTest(cropState.rect, ix, iy);
      
      if (e.shiftKey) {
        // Start drawing a new crop box
        cropState.drawing = true;
        cropState.dragMode = "draw";
        cropState.dragStartImgX = ix;
        cropState.dragStartImgY = iy;
        cropState.rect = { x: ix, y: iy, width: CROP_MIN_SIZE, height: CROP_MIN_SIZE };
        cropClampRect(cropState.rect, state.activeImage.w, state.activeImage.h);
        cropUpdateStatus();
        render();
        return;
      } else if (hit !== CROP_HANDLE_NONE) {
        // Move or resize existing crop box
        cropState.drawing = true;
        cropState.dragStartImgX = ix;
        cropState.dragStartImgY = iy;
        cropState.dragStartRect = { ...cropState.rect };
        if (hit === CROP_HANDLE_INSIDE) {
          cropState.dragMode = "move";
          cv.style.cursor = "move";
        } else {
          cropState.dragMode = "resize";
          cropState.dragHandle = hit;
          cv.style.cursor = "crosshair";
        }
        return;
      }
    }
    
    // Default: Pan dragging
    state.isDragging = true;
    state.dragStartX = e.clientX - state.panX;
    state.dragStartY = e.clientY - state.panY;
    cv.style.cursor = "grabbing";
  });

  window.addEventListener("pointermove", (e) => {
    // U5: seguimiento del pellizco — escala anclada al punto medio + paneo a dos dedos
    if (_pinch.pointers.has(e.pointerId)) _pinch.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (_pinch.active && _pinch.pointers.size >= 2) {
      const mid = _pinchMid();
      zoomAt(mid.x, mid.y, _pinch.zoom0 * (_pinchDist() / _pinch.dist0));
      state.panX += mid.x - _pinch.mid.x;
      state.panY += mid.y - _pinch.mid.y;
      updateTransform();
      _pinch.mid = mid;
      return;
    }

    if (cropState.drawing && state.activeImage) {
      const { x: ix, y: iy } = getImageCoordsFromEvent(e);
      const imgW = state.activeImage.w;
      const imgH = state.activeImage.h;
      
      if (cropState.dragMode === "draw") {
        const x1 = Math.min(cropState.dragStartImgX, ix);
        const y1 = Math.min(cropState.dragStartImgY, iy);
        const x2 = Math.max(cropState.dragStartImgX, ix);
        const y2 = Math.max(cropState.dragStartImgY, iy);
        cropState.rect = cropClampRect({
          x: x1,
          y: y1,
          width: x2 - x1,
          height: y2 - y1
        }, imgW, imgH);
      } else if (cropState.dragMode === "move" && cropState.dragStartRect) {
        const dx = ix - cropState.dragStartImgX;
        const dy = iy - cropState.dragStartImgY;
        let newX = cropState.dragStartRect.x + dx;
        let newY = cropState.dragStartRect.y + dy;
        
        // Clamp bounds to prevent moving box outside image
        newX = Math.max(0, Math.min(imgW - cropState.dragStartRect.width, newX));
        newY = Math.max(0, Math.min(imgH - cropState.dragStartRect.height, newY));
        
        cropState.rect = {
          ...cropState.rect,
          x: newX,
          y: newY
        };
      } else if (cropState.dragMode === "resize" && cropState.dragStartRect) {
        cropState.rect = cropResizeFromHandle(cropState.dragStartRect, cropState.dragHandle, ix, iy, imgW, imgH);
      }
      cropUpdateStatus();
      render();
      return;
    }
    
    if (state.isDragging) {
      state.panX = e.clientX - state.dragStartX;
      state.panY = e.clientY - state.dragStartY;
      updateTransform();
    }
  });

  window.addEventListener("pointerup", (e) => {
    _pinchEnd(e); // U5: al soltar un dedo termina el pellizco (sin reanudar paneo)

    if (cropState.drawing) {
      cropState.drawing = false;
      cropState.dragMode = "";
      cropState.dragHandle = CROP_HANDLE_NONE;
      cropState.dragStartRect = null;
      cv.style.cursor = "default";
      return;
    }

    if (state.isDragging) {
      state.isDragging = false;
      cv.style.cursor = "grab";
    }
  });

  // Toolbar events
  el("btnToolZoomFit").addEventListener("click", zoomFit);
  el("btnToolZoomReset").addEventListener("click", () => {
    if (!state.activeImage) return;
    // "1:1" = 100% de pixeles reales (1 px de imagen = 1 px de pantalla). A escala 1 la imagen se
    // muestra ajustada (object-fit:contain con factor 'fit'); el zoom para 100% es el inverso de 'fit'.
    const fit = Math.min(container.clientWidth / cv.width, container.clientHeight / cv.height) || 1;
    state.zoom = fit > 0 ? 1 / fit : 1;
    state.panX = 0;
    state.panY = 0;
    updateTransform();
  });

  // Toggles de previsualización y estirado
  el("btnToolAutoSTF").addEventListener("click", () => {
    state.screenStretchMode = !state.screenStretchMode;
    if (state.screenStretchMode) {
      el("btnToolAutoSTF").classList.add("active");
      logConsole("Estirado de pantalla AutoSTF (MAD) activado", "info");
    } else {
      el("btnToolAutoSTF").classList.remove("active");
      logConsole("Estirado de pantalla AutoSTF desactivado", "info");
    }
    render();
  });

  el("btnToolViewCurrent").addEventListener("click", () => {
    state.previewMaskMode = false;
    state.previewGradientMode = false;
    el("btnToolViewCurrent").classList.add("active");
    el("btnToolViewMask").classList.remove("active");
    if (el("btnToolViewGradient")) el("btnToolViewGradient").classList.remove("active");
    render();
  });

  el("btnToolViewMask").addEventListener("click", () => {
    if (!state.activeMask) {
      logConsole("No hay ninguna máscara activa para ver", "err");
      return;
    }
    state.previewMaskMode = true;
    state.previewGradientMode = false;
    el("btnToolViewMask").classList.add("active");
    el("btnToolViewCurrent").classList.remove("active");
    if (el("btnToolViewGradient")) el("btnToolViewGradient").classList.remove("active");
    render();
  });

  if (el("btnToolViewGradient")) {
    el("btnToolViewGradient").addEventListener("click", () => {
      if (!state.subtractedGradient) {
        logConsole("No hay ningún gradiente sustraído para ver", "err");
        return;
      }
      state.previewMaskMode = false;
      state.previewGradientMode = true;
      el("btnToolViewGradient").classList.add("active");
      el("btnToolViewCurrent").classList.remove("active");
      el("btnToolViewMask").classList.remove("active");
      render();
    });
  }

  // Toggle A/B (Vista Alternada). A = Imagen Inicial del menú (antes de aplicar); B = imagen activa.
  el("btnToolToggleAB").addEventListener("click", () => {
    const lang = document.documentElement.lang || "es";
    if (!state.stepInputImage) {
      logConsole(lang === "es" ? "No hay imagen inicial para comparar" : "No baseline image to compare", "err");
      return;
    }
    state.viewingPrevious = !state.viewingPrevious;
    if (state.viewingPrevious) {
      el("btnToolToggleAB").classList.add("active");
      el("btnToolToggleAB").textContent = "Toggle A/B (A)";

      // Desactivar splitViewMode si estaba activo
      if (state.splitViewMode) {
        state.splitViewMode = false;
        el("btnToolSplitView").classList.remove("active");
        el("piwSplitSlider").style.display = "none";
      }
      logConsole(lang === "es" ? "Mostrando imagen inicial del menú (A)" : "Showing menu baseline image (A)", "info");
    } else {
      el("btnToolToggleAB").classList.remove("active");
      el("btnToolToggleAB").textContent = "Toggle A/B (B)";
      logConsole(lang === "es" ? "Mostrando imagen activa (B)" : "Showing active image (B)", "info");
    }
    render();
  });

  // Toggle Cortinilla A/B (Split A/B). Compara la imagen activa contra la Imagen Inicial del menú.
  el("btnToolSplitView").addEventListener("click", () => {
    const lang = document.documentElement.lang || "es";
    if (!state.stepInputImage) {
      logConsole(lang === "es" ? "No hay imagen inicial para comparar" : "No baseline image to compare", "err");
      return;
    }
    state.splitViewMode = !state.splitViewMode;

    if (state.splitViewMode) {
      el("btnToolSplitView").classList.add("active");
      state.splitCompareImage = state.stepInputImage;
      
      // Desactivar toggle A/B si estaba activo para no crear confusión
      if (state.viewingPrevious) {
        state.viewingPrevious = false;
        const btnToggle = el("btnToolToggleAB");
        if (btnToggle) {
          btnToggle.classList.remove("active");
          btnToggle.textContent = "Toggle A/B";
        }
      }
      logConsole(lang === "es" ? "Cortinilla de comparación A/B activada (Antes vs Después)" : "Split compare A/B activated (Before vs After)", "info");
    } else {
      el("btnToolSplitView").classList.remove("active");
      el("piwSplitSlider").style.display = "none";
    }
    render();
  });

  // RESET-BTN-BEGIN
  // UNDO/REDO: botones de la toolbar + atajos de teclado (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z).
  if (el("btnToolUndo")) el("btnToolUndo").addEventListener("click", doUndo);
  if (el("btnToolRedo")) el("btnToolRedo").addEventListener("click", doRedo);
  window.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || (e.target && e.target.isContentEditable)) return; // no interferir al escribir
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); doUndo(); }
    else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); doRedo(); }
  });

  el("btnToolReset").addEventListener("click", () => {
    const lang = document.documentElement.lang || "es";
    const confirmed = confirm(lang === "es" ? "¿Seguro que deseas reiniciar el espacio de trabajo actual?" : "Are you sure you want to reset the current workspace?");
    if (!confirmed) return;

    state.activeImage = null;
    state.previousImage = null;
    state.stepInputImage = null;
    state.subtractedGradient = null;
    state.activeMask = null;
    state.splitViewMode = false;
    state.viewingPrevious = false;
    state.previewMaskMode = false;
    state.previewGradientMode = false;
    state._lastImgRef = null;
    state.workflowImages = {};
    state.activeWorkflowKey = "";
    state.undoStack.length = 0; state.redoStack.length = 0; updateUndoButtons();
    clearSession(); // U2: un Reset explícito también descarta la sesión autoguardada

    // Limpiar canvas
    ctx.clearRect(0, 0, cv.width, cv.height);
    cv.width = 800;
    cv.height = 500;
    ctx.fillStyle = "#020202";
    ctx.fillRect(0, 0, cv.width, cv.height);

    // Ocultar slider y toolbar, mostrar el hint de arrastrar/soltar
    el("piwSplitSlider").style.display = "none";
    el("piwToolbar").style.display = "none";
    el("piwHint").style.display = "block";

    // Limpiar histograma
    const histPath = el("histogramPath");
    if (histPath) histPath.setAttribute("d", "");

    // Refrescar la path bar
    refreshPathBar();

    logConsole(lang === "es" ? "Imagen reiniciada" : "Image reset", "info");
    console.log("Imagen reiniciada");
    
    render();
  });
  // RESET-BTN-END

  // Arrastrar Cortinilla Split View. stopPropagation + preventDefault evitan que el mousedown
  // llegue al canvas (que iniciaría el paneo de la imagen) y que el navegador arranque una
  // selección/arrastre nativo mientras se mueve la línea.
  const splitSlider = el("piwSplitSlider");
  splitSlider.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    state.isDraggingSplit = true;
  });

  window.addEventListener("pointermove", (e) => {
    if (state.isDraggingSplit) {
      const rect = container.getBoundingClientRect();
      const posX = e.clientX - rect.left;
      state.splitPercent = Math.max(0.01, Math.min(0.99, posX / rect.width));
      // Recomposición ligera (sin recalcular AutoSTF/antialias): cortinilla fluida.
      compositeSplitFast();
    }
  });

  window.addEventListener("pointerup", () => {
    state.isDraggingSplit = false;
  });


  // --- CAMBIO DE PESTAÑAS (TABS) ---
  document.querySelectorAll(".piw-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".piw-tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".piw-tab-content").forEach(c => c.classList.remove("active"));

      btn.classList.add("active");
      const _tabId = btn.getAttribute("data-tab");
      el(_tabId).classList.add("active");
      // La pestaña Mezcla muestra SIEMPRE todas sus capas desplegadas (no participa del acordeón).
      if (_tabId === "tab-combine") {
        document.querySelectorAll("#tab-combine .piw-section").forEach(s => s.classList.remove("collapsed"));
        updateMixSourceOptions();
      }
      // La pestaña Anotar refresca su estado WCS y precarga el catálogo al entrar.
      if (_tabId === "tab-annotate" && typeof annotOnTabOpen === "function") annotOnTabOpen();
      updateBigApply();
    });
  });

  // --- EXPORTAR (PNG 8-bit de la vista | TIFF 16-bit | FITS 32-bit de los DATOS) ---
  // PNG conserva el comportamiento clásico: exporta lo que ves en el canvas (incluido el estirado
  // de pantalla). TIFF/FITS exportan los DATOS reales de state.activeImage vía ImgIO (mejora U1):
  // sin pérdida a 8 bits, para continuar en PixInsight/Photoshop.
  function _downloadBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  el("btnDownloadPNG").addEventListener("click", () => {
    if (!state.activeImage) return;
    const lang = document.documentElement.lang || "es";
    const fmt = el("selExportFormat") ? el("selExportFormat").value : "png";
    try {
      if (fmt === "tiff16") {
        const buf = window.ImgIO.writeTIFF16(state.activeImage);
        _downloadBlob(new Blob([buf], { type: "image/tiff" }), "CabraSpace_Workflow.tif");
        logConsole(lang === "es" ? "Exportado TIFF 16-bit (datos reales)" : "Exported 16-bit TIFF (real data)", "ok");
      } else if (fmt === "fits") {
        const buf = window.ImgIO.writeFITS(state.activeImage);
        _downloadBlob(new Blob([buf], { type: "application/fits" }), "CabraSpace_Workflow.fits");
        logConsole(lang === "es" ? "Exportado FITS 32-bit (datos reales)" : "Exported 32-bit FITS (real data)", "ok");
      } else {
        cv.toBlob((blob) => {
          _downloadBlob(blob, "CabraSpace_Workflow.png");
          logConsole(lang === "es" ? "Exportado PNG 8-bit (vista actual)" : "Exported 8-bit PNG (current view)", "ok");
        }, "image/png");
      }
    } catch (e) {
      logConsole((lang === "es" ? "Error al exportar: " : "Export error: ") + e.message, "err");
    }
  });

  // --- LIMPIAR CONSOLA ---
  el("btnConsoleClear").addEventListener("click", () => {
    consoleOutput.innerHTML = "";
  });

  // --- SLIDERS EVENT LISTENERS ---
  const dynamicSliders = [
    { s: "sldCcStellarAmt", v: "valCcStellarAmt", p: 2 },
    { s: "sldCcNsStrength", v: "valCcNsStrength", p: 2 },
    { s: "sldCcNsAmount", v: "valCcNsAmount", p: 2 },
    { s: "sldRlIters", v: "valRlIters", p: 0 },
    { s: "sldRlAmount", v: "valRlAmount", p: 2 },
    { s: "sldRlStarProt", v: "valRlStarProt", p: 2 },
    { s: "sldPostBalanceR", v: "valPostBalanceR", p: 3 },
    { s: "sldPostBalanceG", v: "valPostBalanceG", p: 3 },
    { s: "sldPostBalanceB", v: "valPostBalanceB", p: 3 },
    { s: "sldPostBalanceSat", v: "valPostBalanceSat", p: 2 },
    { s: "sldPostBalanceSCNR", v: "valPostBalanceSCNR", p: 2 },
    { s: "sldStfBg", v: "valStfBg", p: 2 },
    { s: "sldStfClip", v: "valStfClip", p: 2 },
    { s: "sldGhsSig", v: "valGhsSig", p: 2 },
    { s: "sldGhsInt", v: "valGhsInt", p: 2 },
    { s: "sldGhsIters", v: "valGhsIters", p: 0 },
    { s: "sldStarsStretch", v: "valStarsStretch", p: 2 },
    { s: "sldStarsBoost", v: "valStarsBoost", p: 2 },
    { s: "sldScnrInt", v: "valScnrInt", p: 2 },
    // SCNR-PRE-BEGIN
    { s: "sldScnrIntPre", v: "valScnrIntPre", p: 2 },
    // SCNR-PRE-END
    { s: "sldMaskLow", v: "valMaskLow", p: 2 },
    { s: "sldMaskHigh", v: "valMaskHigh", p: 2 },
    { s: "sldMaskFuzz", v: "valMaskFuzz", p: 2 },
    { s: "sldMaskHueRange", v: "valMaskHueRange", p: 0 },
    { s: "sldSatBoost", v: "valSatBoost", p: 2 },
    { s: "sldMixOpacity1", v: "valMixOpacity1", p: 2 },
    { s: "sldMixOpacity2", v: "valMixOpacity2", p: 2 },
    { s: "sldMixOpacity3", v: "valMixOpacity3", p: 2 },
    { s: "sldPostGraXpertStrength", v: "valPostGraXpertStrength", p: 2 },
    { s: "sldDeconAiStrength", v: "valDeconAiStrength", p: 2 }
  ];

  const _colorBalanceSliders = ["sldPostBalanceR", "sldPostBalanceG", "sldPostBalanceB", "sldPostBalanceSat", "sldPostBalanceSCNR"];
  dynamicSliders.forEach(({ s, v, p }) => {
    const sld = el(s);
    const val = el(v);
    if (sld && val) {
      sld.addEventListener("input", () => {
        val.textContent = parseFloat(sld.value).toFixed(p);
        // Preview Live: si el usuario mueve directamente un slider de balance de color.
        if (_colorBalanceSliders.indexOf(s) !== -1) livePreviewColorBalance();
      });
    }
  });
  // SCNR (casilla) también dispara el preview Live de balance de color.
  { const scnrChk = el("chkPostBalanceSCNR"); if (scnrChk) scnrChk.addEventListener("change", livePreviewColorBalance); }

  // SLIDER-LABEL-AUTOSYNC: red de seguridad para TODOS los sliders. La auditoría encontró 39 de 91
  // sliders sin binding de etiqueta (mueves el slider y el número no cambia: USM, HDR, LHE, DSE,
  // TGV, NXT, Prism, BXT, DeepSNR, Statistical, FAME…). En vez de mantener a mano una lista de 91
  // pares, este pase genérico empareja cada .piw-slider `sldX` con su span `valX` y, DESPUÉS de que
  // corran los handlers específicos (este listener se añade el último), reescribe la etiqueta SOLO
  // si quedó desincronizada — así no pisa los formatos custom de los sliders que ya funcionaban.
  // Los decimales se infieren del atributo step (step=1→0, 0.05→2, 0.005→3...).
  document.querySelectorAll("input.piw-slider[id^='sld']").forEach((sld) => {
    const span = el("val" + sld.id.slice(3));
    if (!span) return;
    const stepStr = sld.getAttribute("step") || "1";
    const decimals = (stepStr.split(".")[1] || "").length;
    const sync = () => {
      const v = parseFloat(sld.value);
      const shown = parseFloat(span.textContent);
      // tolerancia = medio step: si el handler específico ya puso el número correcto, no tocar
      if (!isFinite(shown) || Math.abs(shown - v) > parseFloat(stepStr) / 2 + 1e-9) {
        span.textContent = v.toFixed(decimals);
      }
    };
    sync(); // al cargar: etiqueta = posición real del slider
    sld.addEventListener("input", sync);
  });

  // --- REGISTRO DRAG & DROP GLOBAL DE ARCHIVOS ---
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  container.addEventListener("dragover", (e) => {
    e.preventDefault();
    container.style.borderColor = "var(--gold-primary)";
    container.style.background = "rgba(207, 171, 74, 0.02)";
  });

  container.addEventListener("dragleave", () => {
    container.style.borderColor = "";
    container.style.background = "";
  });

  container.addEventListener("drop", (e) => {
    e.preventDefault();
    container.style.borderColor = "";
    container.style.background = "";

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      
      // Determinar modo de carga activo (R+G+B, NB, RGB)
      const activeSegBtn = document.querySelector(".piw-segmented-control .piw-segment-btn.active");
      const activeMode = activeSegBtn ? activeSegBtn.getAttribute("data-mode") : "rgb-split";
      
      let channelRange = [0, 1, 2, 3];
      if (activeMode === "nb-split") {
        channelRange = [4, 5, 6];
      } else if (activeMode === "rgb-color") {
        channelRange = [7];
      }

      let freeChanIdx = channelRange[0];
      for (const idx of channelRange) {
        if (!state.loadedChannels[idx]) {
          freeChanIdx = idx;
          break;
        }
      }
      
      targetLoadingChannel = freeChanIdx;
      // Disparar la misma lógica que el file input
      const fileInput = el("fileInputChannel");
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event("change"));
    }
  });

  // --- DRAG & DROP DIRECTO EN CANALES DE CARGA ---
  // Permite arrastrar archivos desde el explorador de ficheros directamente
  // a una fila de canal específica (R, G, B, L, SII, Ha, OIII, RGB Directa)
  document.querySelectorAll(".piw-channel-row.piw-drop-target").forEach(row => {
    const chanIdx = parseInt(row.getAttribute("data-channel"), 10);

    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation(); // Evitar que el canvas también reaccione
      row.classList.add("drag-over");
    });

    row.addEventListener("dragenter", (e) => {
      e.preventDefault();
      row.classList.add("drag-over");
    });

    row.addEventListener("dragleave", (e) => {
      // Solo quitar la clase si el ratón sale del elemento (no de un hijo)
      if (!row.contains(e.relatedTarget)) {
        row.classList.remove("drag-over");
      }
    });

    row.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove("drag-over");

      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        const file = e.dataTransfer.files[0];
        targetLoadingChannel = chanIdx;
        const fileInput = el("fileInputChannel");
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event("change"));
      }
    });
  });

  // --- MOCK Y WIDGETS INTERACTIVOS DE ALTA FIDELIDAD ---

  const messages = {
    es: {
      btnSolveImage: "El Plate Solving requiere procesado astronómico local. Ejecútelo en PixInsight.",
      btnSolveAll: "El Plate Solving por lotes requiere procesado astronómico local. Ejecútelo en PixInsight.",
      btnApplyGradient: "La Corrección de Gradiente avanzada requiere el motor local de PixInsight.",
      btnCompareGradient: "Comparación de modelos de gradiente solo disponible en PixInsight local.",
      btnGradientApplyAll: "La corrección de gradiente por lotes solo está disponible en PixInsight.",
      btnCompareColor: "La comparación de calibración de color requiere los catálogos estelares locales.",
      btnApplyPostNR: "La Reducción de Ruido mediante IA requiere aceleración por hardware local en PixInsight.",
      btnComparePostNR: "La comparación de algoritmos de reducción de ruido está desactivada en la versión web.",
      btnApplyPostSharp: "El enfoque por deconvolución requiere el motor local BlurXTerminator en PixInsight.",
      btnComparePostSharp: "La comparación de algoritmos de enfoque está desactivada en la versión web.",
      btnApplyPostColor: "El balance de color por rueda cromática es un mockup interactivo. Aplique procesos activos en la pestaña Stretch.",
      cardSPCC: "PCC (Photometric Color Calibration): balance por fotometría de estrellas Gaia DR3 (banda ancha, respuesta dependiente del color) + neutralización de fondo + SCNR. Requiere Plate Solving.",
      cardOT: "Optimal Transport requiere integración local. Use Auto Linear Fit en la versión web."
    },
    en: {
      btnSolveImage: "Plate Solving requires local astronomical processing. Please run it in PixInsight.",
      btnSolveAll: "Batch Plate Solving requires local astronomical processing. Please run it in PixInsight.",
      btnApplyGradient: "Advanced Gradient Correction requires the local PixInsight engine.",
      btnCompareGradient: "Gradient model comparison is only available in local PixInsight.",
      btnGradientApplyAll: "Batch gradient correction is only available in local PixInsight.",
      btnCompareColor: "Color calibration comparison requires local stellar catalogs.",
      btnApplyPostNR: "AI-based Noise Reduction requires local hardware acceleration in PixInsight.",
      btnComparePostNR: "Noise reduction algorithm comparison is disabled in the web version.",
      btnApplyPostSharp: "Deconvolution sharpening requires the local BlurXTerminator engine in PixInsight.",
      btnComparePostSharp: "Sharpening algorithm comparison is disabled in the web version.",
      btnApplyPostColor: "Color balance wheel is an interactive mockup. Use active processes in the Stretch tab.",
      cardSPCC: "PCC (Photometric Color Calibration): white balance from Gaia DR3 broadband star photometry (color-dependent response) + background neutralization + SCNR. Requires Plate Solving.",
      cardOT: "Optimal Transport requires local integration. Please use Auto Linear Fit in the web version."
    }
  };

  // 1. Lógica de visibilidad de dropdowns
  function setupDropdownToggle(selectId, mappings) {
    const selector = el(selectId);
    if (!selector) return;
    
    function update() {
      const val = selector.value;
      // Primero ocultar todos los paneles mapeados
      for (const panelId of Object.values(mappings)) {
        const panel = el(panelId);
        if (panel) panel.style.display = "none";
      }
      // Mostrar el panel mapeado para el valor seleccionado activo
      const activePanelId = mappings[val];
      const activePanel = el(activePanelId);
      if (activePanel) activePanel.style.display = "block";
    }

    update();
    selector.addEventListener("change", update);
  }

  // Inicializar toggles de dropdown
  setupDropdownToggle("selGradientAlgo", {
    dbe: "gradient-dbe-controls",
    abe: "gradient-abe-controls",
    graxpert_ia: "gradient-graxpert-controls"
  });

  setupDropdownToggle("selDeconAlgo", {
    rl_auto: "decon-rl-controls",
    cosmic_ia: "decon-cosmic-controls",
    cs_ia_beta: "decon-csia-controls"
  });

  setupDropdownToggle("selPostNoiseAlgo", {
    nxt: "post-noise-nxt-controls",
    tgv: "post-noise-tgv-controls",
    cosmic: "post-noise-cosmic-controls",
    graxpert: "post-noise-graxpert-controls",
    prism: "post-noise-prism-controls",
    deepsnr: "post-noise-deepsnr-controls"
  });

  setupDropdownToggle("selPostSharpAlgo", {
    bxt: "post-sharp-bxt-controls",
    usm: "post-sharp-usm-controls",
    hdr: "post-sharp-hdr-controls",
    lhe: "post-sharp-lhe-controls",
    dse: "post-sharp-dse-controls"
  });

  setupDropdownToggle("selMaskType", {
    range: "mask-range-controls",
    color: "mask-color-controls",
    fame: "mask-fame-controls"
  });

  // Control segmentado para Selección y Carga
  document.querySelectorAll(".piw-segment-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      // Quitar clase active a los botones del mismo grupo
      btn.parentElement.querySelectorAll(".piw-segment-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      // Ocultar todas las subzonas
      document.querySelectorAll(".piw-loading-subzone").forEach(sz => {
        sz.style.display = "none";
      });

      // Mostrar la subzona seleccionada
      const mode = btn.getAttribute("data-mode");
      if (mode === "rgb-split") {
        el("loading-rgb-split").style.display = "block";
      } else if (mode === "nb-split") {
        el("loading-nb-split").style.display = "block";
      } else if (mode === "rgb-color") {
        el("loading-rgb-color").style.display = "block";
      }

      checkCombineState();
    });
  });

  // Escuchar cambio de receta NB
  const selNbRecipe = el("selNbRecipe");
  if (selNbRecipe) {
    selNbRecipe.addEventListener("change", checkCombineState);
  }

  // Título de sección colapsable (Toggle .collapsed en .piw-section con auto-acordeón)
  document.querySelectorAll(".piw-section-title").forEach(title => {
    title.addEventListener("click", () => {
      const section = title.closest(".piw-section");
      if (section) {
        // La pestaña Mezcla no participa del acordeón: sus capas quedan siempre desplegadas.
        if (section.closest("#tab-combine")) return;
        const isCollapsed = section.classList.contains("collapsed");
        if (isCollapsed) {
          // Descolapsar esta sección y colapsar todas las demás (excepto las de la pestaña Mezcla).
          document.querySelectorAll(".piw-section").forEach(s => { if (!s.closest("#tab-combine")) s.classList.add("collapsed"); });
          section.classList.remove("collapsed");
          // PREVIEW-DISCARD: al cambiar de sección, descartar cualquier preview NO aplicado.
          // La Imagen Inicial de la nueva sección es la imagen COMMITTED del flujo (no un preview
          // sin confirmar). Tras "Aplicar", committed === activeImage, así que el cambio persiste.
          if (state.activeWorkflowKey && state.workflowImages[state.activeWorkflowKey] &&
              state.activeImage !== state.workflowImages[state.activeWorkflowKey]) {
            state.activeImage = state.workflowImages[state.activeWorkflowKey];
            render();
            drawHistogram();
          }
          if (state.activeImage) {
            state.stepInputImage = cloneImage(state.activeImage);
          }
          state.pendingPreview = false; // menú nuevo: aún no hay nada que aplicar
          // Cada menú arranca con la comparación limpia: Toggle/Split se referirán a la Imagen
          // Inicial recién capturada (antes de aplicar cambios en este menú).
          state.viewingPrevious = false;
          state.splitViewMode = false;
          state.splitCompareImage = state.stepInputImage;
          { const bT = el("btnToolToggleAB"); if (bT) { bT.classList.remove("active"); bT.textContent = "Toggle A/B"; } }
          { const bS = el("btnToolSplitView"); if (bS) bS.classList.remove("active"); }
          { const sl = el("piwSplitSlider"); if (sl) sl.style.display = "none"; }
        } else {
          // Si ya está abierta y se pulsa, simplemente colapsarla
          section.classList.add("collapsed");
        }
        updateBigApply();
      }
    });
  });

  // --- INTEGRACIÓN PYODIDE / SAS PRO (WASM) ---
  const btnInitSaspro = el("btnInitSaspro");
  const lblSasproStatus = el("lblSasproStatus");
  const sasproControls = el("saspro-controls");
  const selSasproAlgo = el("selSasproAlgo");
  const sldSasproTgt = el("sldSasproTgt");
  const valSasproTgt = el("valSasproTgt");
  const sldSasproSigma = el("sldSasproSigma");
  const valSasproSigma = el("valSasproSigma");
  const sldSasproCp = el("sldSasproCp");
  const valSasproCp = el("valSasproCp");
  const sldSasproAmt = el("sldSasproAmt");
  const valSasproAmt = el("valSasproAmt");
  const btnSasproUploadTrigger = el("btnSasproUploadTrigger");
  const fileInputSaspro = el("fileInputSaspro");

  if (btnInitSaspro) {
    btnInitSaspro.addEventListener("click", async () => {
      const lang = document.documentElement.lang || "es";
      btnInitSaspro.disabled = true;
      lblSasproStatus.textContent = lang === "es" ? "● Cargando..." : "● Loading...";
      try {
        // SAS Pro y SPCC ahora son 100% JS: ya NO se carga Pyodide (antes esta era la última descarga
        // del runtime WASM ~10MB). El botón solo revela los controles, instantáneo.
        lblSasproStatus.textContent = lang === "es" ? "● Listo" : "● Ready";
        lblSasproStatus.style.color = "var(--gold-primary)";
        btnInitSaspro.style.display = "none";
        if (sasproControls) sasproControls.style.display = "block";
      } catch (err) {
        btnInitSaspro.disabled = false;
        lblSasproStatus.textContent = lang === "es" ? "● Error al inicializar" : "● Init Error";
        lblSasproStatus.style.color = "#ff4444";
      }
    });
  }

  // Sliders dinámicos
  if (sldSasproTgt && valSasproTgt) {
    sldSasproTgt.addEventListener("input", () => valSasproTgt.textContent = parseFloat(sldSasproTgt.value).toFixed(2));
  }
  if (sldSasproSigma && valSasproSigma) {
    sldSasproSigma.addEventListener("input", () => valSasproSigma.textContent = parseFloat(sldSasproSigma.value).toFixed(1));
  }
  if (sldSasproCp && valSasproCp) {
    sldSasproCp.addEventListener("input", () => valSasproCp.textContent = parseFloat(sldSasproCp.value).toFixed(2));
  }
  if (sldSasproAmt && valSasproAmt) {
    sldSasproAmt.addEventListener("input", () => valSasproAmt.textContent = parseFloat(sldSasproAmt.value).toFixed(2));
  }

  // Cambio de algoritmo
  if (selSasproAlgo) {
    selSasproAlgo.addEventListener("change", () => {
      const algo = selSasproAlgo.value;
      const stretchParams = el("saspro-stretch-params");
      const starSpec = el("saspro-star-spec");
      const scnrParams = el("saspro-scnr-params");

      if (algo === "statistical_stretch") {
        if (stretchParams) stretchParams.style.display = "block";
        if (starSpec) starSpec.style.display = "none";
        if (scnrParams) scnrParams.style.display = "none";
      } else if (algo === "star_stretch") {
        if (stretchParams) stretchParams.style.display = "block";
        if (starSpec) starSpec.style.display = "block";
        if (scnrParams) scnrParams.style.display = "none";
      } else if (algo === "scnr") {
        if (stretchParams) stretchParams.style.display = "none";
        if (starSpec) starSpec.style.display = "none";
        if (scnrParams) scnrParams.style.display = "block";
      }
    });
  }

  // Disparar selector de archivos
  if (btnSasproUploadTrigger && fileInputSaspro) {
    btnSasproUploadTrigger.addEventListener("click", () => {
      fileInputSaspro.value = "";
      fileInputSaspro.click();
    });
  }

  // Procesar archivo seleccionado
  if (fileInputSaspro) {
    fileInputSaspro.addEventListener("change", async (e) => {
      if (e.target.files && e.target.files[0]) {
        const file = e.target.files[0];
        const algo = selSasproAlgo.value;
        const params = {};
        const lang = document.documentElement.lang || "es";

        if (algo === "statistical_stretch") {
          params.target_median = parseFloat(sldSasproTgt.value);
          params.sigma_clip = parseFloat(sldSasproSigma.value);
        } else if (algo === "star_stretch") {
          params.target_median = parseFloat(sldSasproTgt.value);
          params.sigma_clip = parseFloat(sldSasproSigma.value);
          params.color_preservation = parseFloat(sldSasproCp.value);
        } else if (algo === "scnr") {
          params.amount = parseFloat(sldSasproAmt.value);
        }

        try {
          // SAS-PRO-PYODIDE->JS: carga con autoghs.js (JS) + algo en JS (sin Pyodide).
          showLoader(lang === "es" ? "Procesando archivo (JS)..." : "Processing file (JS)...");
          const loaded = await AutoGHS.loadFromFile(file);
          let result;
          if (algo === "statistical_stretch") result = computeStatisticalStretchJS(loaded, params.target_median, params.sigma_clip);
          else if (algo === "star_stretch") result = computeStarStretchJS(loaded, params.target_median, params.sigma_clip, params.color_preservation);
          else if (algo === "scnr") result = computeScnrGreenJS(loaded, params.amount);
          else result = loaded;
          hideLoader();
          
          // Establecer como imagen activa y actualizar la previsualización
          state.activeImage = result;
          state.originalImage = cloneImage(result);
          
          // Guardar en slots de flujo
          state.workflowImages["RGB"] = result;
          state.activeWorkflowKey = "RGB";
          
          // Desactivar estirado de pantalla temporal si SASPro ya aplicó estirado
          if (algo === "statistical_stretch" || algo === "star_stretch") {
            state.screenStretchMode = false;
            const btnAutoStf = el("btnToolAutoSTF");
            if (btnAutoStf) btnAutoStf.classList.remove("active");
          } else {
            // Si es SCNR, mantenemos el estirado de pantalla
            state.screenStretchMode = true;
            const btnAutoStf = el("btnToolAutoSTF");
            if (btnAutoStf) btnAutoStf.classList.add("active");
          }

          setActiveImage(result);
          logConsole(lang === "es" ? `Proceso SASPro ${algo} aplicado con éxito` : `SASPro ${algo} process applied successfully`, "ok");
        } catch (err) {
          hideLoader();
          logConsole(`Error: ${err.message}`, "err");
        }
      }
    });
  }

  // Desactivar tarjetas e inicializar comportamiento interactivo para botones y tarjetas mock
  // FAME ya está implementado (pincel manual de máscara); no quedan botones mock.
  const mockButtons = [];
  mockButtons.forEach(id => {
    const btn = el(id);
    if (btn) {
      btn.removeAttribute("disabled");
      btn.classList.add("mock-disabled");
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const lang = document.documentElement.lang || "es";
        const msg = messages[lang][id] || "Función no disponible en la versión web.";
        logConsole(msg, "warn");
      });
    }
  });

  // (mockCards vacío — todos los métodos de calibración están activos)

  // --- COMPILADOR Y CARGADOR DINÁMICO DE PIXELMATH ---

  function compilePixelMathExpression(expr, sliderKeys) {
    let js = expr;

    // 1. Reemplazar iif(cond, a, b) por ((cond)?(a):(b))
    let prev;
    do {
      prev = js;
      js = js.replace(/iif\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\)/g, '(($1)?($2):($3))');
    } while (js !== prev);

    // 2. Reemplazar funciones max, min y sqrt
    js = js.replace(/max\s*\(/g, 'Math.max(');
    js = js.replace(/min\s*\(/g, 'Math.min(');
    js = js.replace(/sqrt\s*\(/g, 'Math.sqrt(');

    // 3. Reemplazar operador ~: ~x -> (1.0 - x)
    js = js.replace(/~\s*([A-Za-z0-9_]+)/g, '(1.0 - $1)');
    js = js.replace(/~\s*(\([^)]+\))/g, '(1.0 - $1)');

    // 4. Reemplazar operador ^: a ^ b -> Math.pow(a, b)
    let pos;
    while ((pos = js.indexOf('^')) !== -1) {
      let leftStart = pos - 1;
      while (leftStart >= 0 && /\s/.test(js[leftStart])) leftStart--;
      if (js[leftStart] === ')') {
        let depth = 1;
        leftStart--;
        while (leftStart >= 0 && depth > 0) {
          if (js[leftStart] === ')') depth++;
          else if (js[leftStart] === '(') depth--;
          leftStart--;
        }
        leftStart++;
      } else {
        while (leftStart >= 0 && /[A-Za-z0-9_.]/.test(js[leftStart])) leftStart--;
        leftStart++;
      }
      const left = js.substring(leftStart, pos).trim();

      let rightEnd = pos + 1;
      while (rightEnd < js.length && /\s/.test(js[rightEnd])) rightEnd++;
      if (js[rightEnd] === '(') {
        let depth = 1;
        rightEnd++;
        while (rightEnd < js.length && depth > 0) {
          if (js[rightEnd] === '(') depth++;
          else if (js[rightEnd] === ')') depth--;
          rightEnd++;
        }
      } else {
        while (rightEnd < js.length && /[A-Za-z0-9_.]/.test(js[rightEnd])) rightEnd++;
      }
      const right = js.substring(pos + 1, rightEnd).trim();

      js = js.substring(0, leftStart) + `Math.pow(${left}, ${right})` + js.substring(rightEnd);
    }

    // 5. Reemplazar operadores lógicos & -> &&, | -> ||
    js = js.replace(/([^&])&([^&])/g, '$1&&$2');
    js = js.replace(/([^|])\|([^|])/g, '$1||$2');

    const argNames = ['SII', 'Ha', 'OIII', 'sii', 'ha', 'oiii', ...sliderKeys];
    try {
      return new Function(...argNames, `return ${js};`);
    } catch (e) {
      console.error("Failed to compile expression:", expr, js, e);
      return null;
    }
  }

  function handleFormulaChange() {
    const selectEl = el("selNbRecipe");
    if (!selectEl) return;
    const formulaId = selectEl.value;
    const formula = narrowbandFormulas.find(f => f.id === formulaId);
    
    // Limpiar y recrear controles de sliders
    const container = el("nb-formula-sliders-container");
    if (container) {
      container.innerHTML = "";
      if (formula && formula.sliders && formula.sliders.length > 0) {
        formula.sliders.forEach(slider => {
          const row = document.createElement("div");
          row.className = "piw-control-group";
          row.style.marginTop = "6px";
          
          const labelRow = document.createElement("div");
          labelRow.className = "piw-label-row";
          
          const labelSpan = document.createElement("span");
          labelSpan.className = "piw-label";
          labelSpan.textContent = slider.label;
          
          const valueSpan = document.createElement("span");
          valueSpan.className = "piw-value";
          valueSpan.id = `valNb_${slider.id}`;
          valueSpan.textContent = parseFloat(slider.value).toFixed(2);
          
          labelRow.appendChild(labelSpan);
          labelRow.appendChild(valueSpan);
          
          const input = document.createElement("input");
          input.type = "range";
          input.className = "piw-slider";
          input.id = `sldNb_${slider.id}`;
          input.min = slider.min;
          input.max = slider.max;
          input.step = slider.step || 0.05;
          input.value = slider.value;
          
          input.addEventListener("input", () => {
            valueSpan.textContent = parseFloat(input.value).toFixed(2);
          });
          
          row.appendChild(labelRow);
          row.appendChild(input);
          container.appendChild(row);
        });
      }
    }

    checkCombineState();
  }

  async function initNarrowbandFormulas() {
    const lang = document.documentElement.lang || "es";
    const isEn = lang.startsWith("en");
    const sourceFile = isEn ? "pixelmath-en.html" : "pixelmath.html";
    const categoryName = isEn ? "Narrowband Palette" : "Paleta Banda Estrecha";

    // Fallbacks
    const fallbackFormulas = isEn ? [
      { id: 'sho_hub', name: 'Hubble Palette (SHO) - Classic', category: 'Narrowband Palette', r: 'SII', g: 'Ha', b: 'OIII', sliders: [{ id: 'k_r', label: 'SII / Ha Mix in Red', min: 0, max: 1, step: 0.05, value: 1.0 }, { id: 'k_g', label: 'Ha / OIII Mix in Green', min: 0, max: 1, step: 0.05, value: 1.0 }] },
      { id: 'hoo_std', name: 'Bicolor Palette (HOO) - Standard', category: 'Narrowband Palette', r: 'Ha', g: 'OIII', b: 'OIII' },
      { id: 'hso_std', name: 'HSO Palette', category: 'Narrowband Palette', r: 'Ha', g: 'SII', b: 'OIII' }
    ] : [
      { id: 'sho_hub', name: 'Paleta Hubble (SHO) - Clásica', category: 'Paleta Banda Estrecha', r: 'SII', g: 'Ha', b: 'OIII', sliders: [{ id: 'k_r', label: 'Mezcla SII / Ha en canal Rojo', min: 0, max: 1, step: 0.05, value: 1.0 }, { id: 'k_g', label: 'Mezcla Ha / OIII en canal Verde', min: 0, max: 1, step: 0.05, value: 1.0 }] },
      { id: 'hoo_std', name: 'Paleta Bicolor (HOO) - Estándar', category: 'Paleta Banda Estrecha', r: 'Ha', g: 'OIII', b: 'OIII' },
      { id: 'hso_std', name: 'Paleta HSO', category: 'Paleta Banda Estrecha', r: 'Ha', g: 'SII', b: 'OIII' }
    ];

    try {
      const response = await fetch(sourceFile);
      if (!response.ok) throw new Error("Network response not OK");
      const text = await response.text();
      const loaded = [];
      
      // 1. Intentar buscar el bloque de código 'const baseFormulas =' completo (soporta múltiples líneas)
      const startIdx = text.indexOf('const baseFormulas =');
      if (startIdx !== -1) {
        let bracketCount = 0;
        let endIdx = -1;
        let started = false;
        for (let i = startIdx; i < text.length; i++) {
          if (text[i] === '[') {
            bracketCount++;
            started = true;
          } else if (text[i] === ']') {
            bracketCount--;
            if (started && bracketCount === 0) {
              endIdx = i + 1;
              break;
            }
          }
        }
        if (endIdx !== -1) {
          try {
            const block = text.substring(startIdx, endIdx);
            const fn = new Function(block + "; return baseFormulas;");
            const allFormulas = fn();
            if (Array.isArray(allFormulas)) {
              allFormulas.forEach(obj => {
                if (obj && obj.category === categoryName && obj.id && obj.name) {
                  loaded.push(obj);
                }
              });
            }
          } catch (e) {
            console.warn("Failed to parse baseFormulas block, falling back to line-by-line:", e);
          }
        }
      }

      // 2. Fallback: Análisis línea a línea si el analizador de bloque no cargó nada
      if (loaded.length === 0) {
        const lines = text.split("\n");
        for (let line of lines) {
          line = line.trim();
          if (line.includes(`category: '${categoryName}'`) && line.startsWith("{") && (line.endsWith("},") || line.endsWith("}"))) {
            if (line.endsWith(",")) {
              line = line.slice(0, -1);
            }
            try {
              const fn = new Function("return " + line);
              const obj = fn();
              if (obj && obj.id && obj.name) {
                loaded.push(obj);
              }
            } catch (e) {
              console.warn("Error parsing formula line:", line, e);
            }
          }
        }
      }
      
      if (loaded.length > 0) {
        narrowbandFormulas = loaded;
        logConsole(`Fórmulas de banda estrecha cargadas de la PixelMath-teca: ${loaded.length}`, "info");
      } else {
        narrowbandFormulas = fallbackFormulas;
      }
    } catch (err) {
      console.warn("Failed to fetch narrowband formulas, using fallbacks:", err);
      narrowbandFormulas = fallbackFormulas;
    }

    // Poblar el selector selNbRecipe
    const selectEl = el("selNbRecipe");
    if (selectEl) {
      selectEl.innerHTML = "";
      narrowbandFormulas.forEach(formula => {
        const opt = document.createElement("option");
        opt.value = formula.id;
        opt.textContent = formula.name;
        selectEl.appendChild(opt);
      });
      
      selectEl.addEventListener("change", handleFormulaChange);
      handleFormulaChange();
    }
  }

  // Inicializar fórmulas al cargar
  initNarrowbandFormulas();

  // Forzar tarjetas de calibración activas en gris al inicio
  const cardLFOnStart = el("cardLinearFit");
  if (cardLFOnStart) cardLFOnStart.classList.add("disabled");
  const cardBNOnStart = el("cardBN");
  if (cardBNOnStart) cardBNOnStart.classList.add("disabled");
  const cardSPCCOnStart = el("cardSPCC");
  if (cardSPCCOnStart) cardSPCCOnStart.classList.add("disabled");
  const cardOTOnStart = el("cardOT");
  if (cardOTOnStart) cardOTOnStart.classList.add("disabled");


  // 2. Editor de Curvas Interactivas (Mockup)
  state.curves = {
    K: [{x: 0, y: 0}, {x: 1, y: 1}],
    R: [{x: 0, y: 0}, {x: 1, y: 1}],
    G: [{x: 0, y: 0}, {x: 1, y: 1}],
    B: [{x: 0, y: 0}, {x: 1, y: 1}],
    S: [{x: 0, y: 0}, {x: 1, y: 1}]
  };
  let activeCurveChan = "K";

  // Monotone Cubic Hermite Interpolation (Fritsch-Carlson)
  // V2 (Fase 4): la spline cúbica monótona vive en ImgOps.cubicSplineFn (imgops.js), compartida
  // con el worker; aquí queda el delegado para el widget de curvas y llamadores existentes.
  function getCubicSpline(points) {
    return window.ImgOps.cubicSplineFn(points);
  }

  function drawCurvesWidget() {
    const canvas = el("curvesCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    
    ctx.fillStyle = "#020202";
    ctx.fillRect(0, 0, w, h);
    
    // Cuadrícula / Grid
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      // Líneas verticales
      const lx = (i / 4) * w;
      ctx.moveTo(lx, 0);
      ctx.lineTo(lx, h);
      // Líneas horizontales
      const ly = (i / 4) * h;
      ctx.moveTo(0, ly);
      ctx.lineTo(w, ly);
    }
    ctx.stroke();
    
    // Diagonal de referencia lineal
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(w, 0);
    ctx.stroke();
    ctx.setLineDash([]); // Reset
    
    // Spline curve
    const pts = state.curves[activeCurveChan];
    const spline = getCubicSpline(pts);
    
    let color = "#e8e8ea"; // Default K
    if (activeCurveChan === "R") color = "#e36a6a";
    else if (activeCurveChan === "G") color = "#72c98a";
    else if (activeCurveChan === "B") color = "#6aa3e3";
    else if (activeCurveChan === "S") color = "#e3a56a";
    
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, (1 - spline(0)) * h);
    for (let x = 1; x < w; x++) {
      const xNorm = x / w;
      ctx.lineTo(x, (1 - spline(xNorm)) * h);
    }
    ctx.stroke();
    
    // Dibujar puntos de control
    pts.forEach((p, idx) => {
      const cx = p.x * w;
      const cy = (1 - p.y) * h;
      const radius = (idx === hoveredCurvePtIdx || idx === draggedCurvePtIdx) ? 6 : 4;
      
      ctx.fillStyle = color;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, 2*Math.PI);
      ctx.fill();
      ctx.stroke();
    });
  }

  const curvesCv = el("curvesCanvas");
  let draggedCurvePtIdx = -1;
  let hoveredCurvePtIdx = -1;

  if (curvesCv) {
    function getMouseNormCoords(e) {
      const rect = curvesCv.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = 1 - (e.clientY - rect.top) / rect.height;
      return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
    }
    
    function findPointIndex(normCoords) {
      const pts = state.curves[activeCurveChan];
      const threshX = 10 / curvesCv.width;
      const threshY = 10 / curvesCv.height;
      
      for (let i = 0; i < pts.length; i++) {
        if (Math.abs(pts[i].x - normCoords.x) < threshX && Math.abs(pts[i].y - normCoords.y) < threshY) {
          return i;
        }
      }
      return -1;
    }

    curvesCv.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const coords = getMouseNormCoords(e);
      const pts = state.curves[activeCurveChan];
      const ptIdx = findPointIndex(coords);
      
      if (e.button === 2) {
        // Clic derecho: borrar punto
        if (ptIdx > 0 && ptIdx < pts.length - 1) {
          pts.splice(ptIdx, 1);
          hoveredCurvePtIdx = -1;
          draggedCurvePtIdx = -1;
          drawCurvesWidget();
          livePreviewCurves(); // punto eliminado
        }
      } else {
        // Clic izquierdo
        if (ptIdx !== -1) {
          draggedCurvePtIdx = ptIdx;
        } else {
          // Crear punto nuevo
          if (coords.x > 0.02 && coords.x < 0.98) {
            pts.push(coords);
            pts.sort((a, b) => a.x - b.x);
            draggedCurvePtIdx = pts.findIndex(p => p.x === coords.x && p.y === coords.y);
            drawCurvesWidget();
            livePreviewCurves(); // punto añadido
          }
        }
      }
    });

    curvesCv.addEventListener("contextmenu", (e) => e.preventDefault());

    curvesCv.addEventListener("pointermove", (e) => {
      const coords = getMouseNormCoords(e);
      const pts = state.curves[activeCurveChan];
      
      if (draggedCurvePtIdx !== -1) {
        const pt = pts[draggedCurvePtIdx];
        if (draggedCurvePtIdx === 0) {
          pt.y = coords.y;
        } else if (draggedCurvePtIdx === pts.length - 1) {
          pt.y = coords.y;
        } else {
          const minX = pts[draggedCurvePtIdx - 1].x + 0.01;
          const maxX = pts[draggedCurvePtIdx + 1].x - 0.01;
          pt.x = Math.max(minX, Math.min(maxX, coords.x));
          pt.y = coords.y;
        }
        
        const hintLbl = el("lblPostCurvesHint");
        if (hintLbl) {
          const lang = document.documentElement.lang || "es";
          if (lang === "es") {
            hintLbl.innerHTML = `Punto seleccionado: <b>X: ${pt.x.toFixed(2)}, Y: ${pt.y.toFixed(2)}</b> (Canal: ${activeCurveChan})`;
          } else {
            hintLbl.innerHTML = `Selected point: <b>X: ${pt.x.toFixed(2)}, Y: ${pt.y.toFixed(2)}</b> (Channel: ${activeCurveChan})`;
          }
        }
        drawCurvesWidget();
        livePreviewCurves(); // curva modificada al arrastrar un punto
      } else {
        const ptIdx = findPointIndex(coords);
        if (ptIdx !== hoveredCurvePtIdx) {
          hoveredCurvePtIdx = ptIdx;
          drawCurvesWidget(); // solo hover: no dispara preview Live
        }
      }
    });

    window.addEventListener("pointerup", () => {
      if (draggedCurvePtIdx !== -1) {
        draggedCurvePtIdx = -1;
        drawCurvesWidget();
        const hintLbl = el("lblPostCurvesHint");
        if (hintLbl) {
          const lang = document.documentElement.lang || "es";
          hintLbl.textContent = lang === "es" 
            ? "Curvas: click izquierdo añade/arrastra, click derecho elimina."
            : "Curves: left click adds/drags, right click deletes.";
        }
      }
    });
  }

  const curvesChanSel = el("selPostCurvesChan");
  if (curvesChanSel) {
    curvesChanSel.addEventListener("change", (e) => {
      activeCurveChan = e.target.value;
      drawCurvesWidget();
    });
  }

  // POST-CONTROLS-ENABLE-BEGIN
  // Color Balance y Curves tenían sus controles funcionales en estado `disabled`/`piw-disabled-control`
  // (los handlers ya eran reales). Se habilitan al cargar imagen y se cablean los sliders de Curves
  // al editor de curva (antes no estaban conectados a nada).
  function enablePostProcessControls() {
    [
      "sldPostBalanceR", "sldPostBalanceG", "sldPostBalanceB", "sldPostBalanceSat",
      "chkPostBalanceSCNR", "sldPostBalanceSCNR", "btnPostColorBalanceReset",
      "chkPostColorBalanceLive", "chkPostCurvesLive",
      "sldPostCurvesContrast", "sldPostCurvesBright", "sldPostCurvesShadows",
      "sldPostCurvesHighlights", "sldPostCurvesSaturation"
    ].forEach((id) => {
      const e = el(id);
      if (!e) return;
      e.disabled = false;
      const grp = e.closest(".piw-disabled-control");
      if (grp) grp.classList.remove("piw-disabled-control");
    });
  }

  // Reconstruye las curvas K (luminancia) y S (saturación) a partir de los 5 sliders de Curves.
  function rebuildCurvesFromSliders() {
    const cl = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
    const c = parseFloat(el("sldPostCurvesContrast").value) || 0;
    const b = parseFloat(el("sldPostCurvesBright").value) || 0;
    const sh = parseFloat(el("sldPostCurvesShadows").value) || 0;
    const hi = parseFloat(el("sldPostCurvesHighlights").value) || 0;
    const sat = parseFloat(el("sldPostCurvesSaturation").value);
    el("valPostCurvesContrast").textContent = c.toFixed(2);
    el("valPostCurvesBright").textContent = b.toFixed(3);
    el("valPostCurvesShadows").textContent = sh.toFixed(3);
    el("valPostCurvesHighlights").textContent = hi.toFixed(3);
    el("valPostCurvesSaturation").textContent = sat.toFixed(2);
    state.curves.K = [
      { x: 0, y: 0 },
      { x: 0.25, y: cl(0.25 + sh - c * 0.12 + b * 0.6) },
      { x: 0.5, y: cl(0.5 + b) },
      { x: 0.75, y: cl(0.75 + hi + c * 0.12 + b * 0.4) },
      { x: 1, y: 1 }
    ];
    if (Math.abs(sat - 1) < 1e-3) {
      state.curves.S = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    } else {
      state.curves.S = [{ x: 0, y: 0 }, { x: 0.5, y: cl(0.5 * sat) }, { x: 1, y: 1 }];
    }
    drawCurvesWidget();
    livePreviewCurves();
  }
  ["sldPostCurvesContrast", "sldPostCurvesBright", "sldPostCurvesShadows", "sldPostCurvesHighlights", "sldPostCurvesSaturation"].forEach((id) => {
    const s = el(id);
    if (s) s.addEventListener("input", rebuildCurvesFromSliders);
  });
  // POST-CONTROLS-ENABLE-END


  // 3. Rueda de Balance de Color Cromático (Mockup)
  const wheelRadius = 65;
  const wheelCenterX = 75;
  const wheelCenterY = 75;
  let cachedWheelImgData = null;
  state.colorBalanceAnchor = { x: 0, y: 0 };

  function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  function initColorWheel(canvas) {
    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(150, 150);
    const data = imgData.data;
    
    for (let y = 0; y < 150; y++) {
      for (let x = 0; x < 150; x++) {
        const dx = x - wheelCenterX;
        const dy = y - wheelCenterY;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const idx = (y * 150 + x) * 4;
        
        if (dist <= wheelRadius) {
          let angle = Math.atan2(dy, dx) * (180 / Math.PI);
          if (angle < 0) angle += 360;
          
          const rgb = hslToRgb(angle / 360, dist / wheelRadius, 0.5);
          data[idx] = rgb[0];
          data[idx+1] = rgb[1];
          data[idx+2] = rgb[2];
          data[idx+3] = 255;
        } else {
          data[idx] = 0;
          data[idx+1] = 0;
          data[idx+2] = 0;
          data[idx+3] = 0;
        }
      }
    }
    cachedWheelImgData = imgData;
  }

  function drawColorBalanceWidget() {
    const canvas = el("colorBalanceCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (!cachedWheelImgData) {
      initColorWheel(canvas);
    }
    ctx.putImageData(cachedWheelImgData, 0, 0);
    
    // Borde
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(wheelCenterX, wheelCenterY, wheelRadius, 0, 2*Math.PI);
    ctx.stroke();
    
    // Ejes
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(wheelCenterX - wheelRadius, wheelCenterY);
    ctx.lineTo(wheelCenterX + wheelRadius, wheelCenterY);
    ctx.moveTo(wheelCenterX, wheelCenterY - wheelRadius);
    ctx.lineTo(wheelCenterX, wheelCenterY + wheelRadius);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Ancla
    const ax = wheelCenterX + state.colorBalanceAnchor.x;
    const ay = wheelCenterY + state.colorBalanceAnchor.y;
    
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(ax, ay, 4, 0, 2*Math.PI);
    ctx.fill();
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.arc(ax, ay, 2, 0, 2*Math.PI);
    ctx.fill();
  }

  function updateColorBalanceReadout() {
    const dx = state.colorBalanceAnchor.x;
    const dy = state.colorBalanceAnchor.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const sat = dist / wheelRadius;
    
    let angle = Math.atan2(dy, dx) * (180 / Math.PI);
    if (angle < 0) angle += 360;
    
    const rad = angle * (Math.PI / 180);
    const rShift = 1.0 + Math.cos(rad) * sat * 0.3;
    const gShift = 1.0 + Math.cos(rad - 2*Math.PI/3) * sat * 0.3;
    const bShift = 1.0 + Math.cos(rad - 4*Math.PI/3) * sat * 0.3;
    
    const sldR = el("sldPostBalanceR");
    const sldG = el("sldPostBalanceG");
    const sldB = el("sldPostBalanceB");
    const sldSat = el("sldPostBalanceSat");
    
    if (sldR) { sldR.value = rShift; el("valPostBalanceR").textContent = rShift.toFixed(3); }
    if (sldG) { sldG.value = gShift; el("valPostBalanceG").textContent = gShift.toFixed(3); }
    if (sldB) { sldB.value = bShift; el("valPostBalanceB").textContent = bShift.toFixed(3); }
    if (sldSat) { sldSat.value = 1.0 + sat; el("valPostBalanceSat").textContent = (1.0 + sat).toFixed(2); }
    
    const readout = el("lblPostColorBalanceReadout");
    if (readout) {
      const lang = document.documentElement.lang || "es";
      if (lang === "es") {
        readout.innerHTML = `<b>Media:</b> 0.142 | <b>Objetivo:</b> H:${Math.round(angle)}°, S:${(sat*100).toFixed(1)}% | <b>Desv:</b> R:${rShift.toFixed(3)}, G:${gShift.toFixed(3)}, B:${bShift.toFixed(3)}`;
      } else {
        readout.innerHTML = `<b>Mean:</b> 0.142 | <b>Target:</b> H:${Math.round(angle)}°, S:${(sat*100).toFixed(1)}% | <b>Shift:</b> R:${rShift.toFixed(3)}, G:${gShift.toFixed(3)}, B:${bShift.toFixed(3)}`;
      }
    }
    // La rueda mueve los sliders programáticamente (sin evento 'input'); dispara aquí el preview Live.
    livePreviewColorBalance();
  }

  const cbCv = el("colorBalanceCanvas");
  let isDraggingCb = false;

  if (cbCv) {
    function updateCbAnchor(clientX, clientY) {
      const rect = cbCv.getBoundingClientRect();
      const mouseX = clientX - rect.left;
      const mouseY = clientY - rect.top;
      
      const dx = mouseX - wheelCenterX;
      const dy = mouseY - wheelCenterY;
      const dist = Math.sqrt(dx*dx + dy*dy);
      
      if (dist <= wheelRadius) {
        state.colorBalanceAnchor.x = dx;
        state.colorBalanceAnchor.y = dy;
      } else {
        const angle = Math.atan2(dy, dx);
        state.colorBalanceAnchor.x = wheelRadius * Math.cos(angle);
        state.colorBalanceAnchor.y = wheelRadius * Math.sin(angle);
      }
      
      updateColorBalanceReadout();
      drawColorBalanceWidget();
    }
    
    cbCv.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      isDraggingCb = true;
      updateCbAnchor(e.clientX, e.clientY);
    });
    
    window.addEventListener("pointermove", (e) => {
      if (isDraggingCb) {
        updateCbAnchor(e.clientX, e.clientY);
      }
    });
    
    window.addEventListener("pointerup", () => {
      isDraggingCb = false;
    });
  }

  const cbResetBtn = el("btnPostColorBalanceReset");
  if (cbResetBtn) {
    cbResetBtn.addEventListener("click", () => {
      state.colorBalanceAnchor.x = 0;
      state.colorBalanceAnchor.y = 0;
      updateColorBalanceReadout();
      drawColorBalanceWidget();
      logConsole("Ancla de balance de color restablecida al centro", "info");
    });
  }

  // Activar los widgets iniciales (estado vacío/por defecto)
  const cbCanvasOnStart = el("colorBalanceCanvas");
  if (cbCanvasOnStart) {
    initColorWheel(cbCanvasOnStart);
    drawColorBalanceWidget();
  }
  drawCurvesWidget();

  // --- BOTÓN APLICAR GRANDE (UNIFICADO) ---
  function updateBigApply() {
    const btn = el("btnBigApply");
    if (!btn) return;
    
    if (!state.activeImage) {
      btn.style.display = "none";
      return;
    }
    
    // Solo cuentan las secciones del TAB ACTIVO: las de Mezcla están siempre desplegadas y, al ir
    // antes en el DOM, eclipsaban a las secciones de pestañas posteriores (Mejora) — el botón
    // grande nunca aparecía para Color Mixer/Detail.
    const activeSection = document.querySelector(".piw-tab-content.active .piw-section:not(.collapsed)")
      || document.querySelector(".piw-section:not(.collapsed)");
    if (!activeSection) {
      btn.style.display = "none";
      return;
    }
    
    // APPLY-DATA-BEGIN: el botón grande se resuelve por el atributo data-apply de la sección
    // (declarado en el HTML), NO por el texto del título. Antes se hacía matching de strings del
    // título en ambos idiomas → renombrar un título rompía silenciosamente el Aplicar (frágil).
    const applyKey = activeSection.dataset ? (activeSection.dataset.apply || "") : "";
    const lang = document.documentElement.lang || "es";

    const doCommit = () => {
      if (state.activeImage) {
        recordUndo(); // registra el estado committeado anterior para poder deshacer
        state.stepInputImage = cloneImage(state.activeImage);
        if (state.activeWorkflowKey) {
          state.workflowImages[state.activeWorkflowKey] = state.activeImage;
        }
        state.pendingPreview = false; // ya aplicado → deshabilita "Aplicar" hasta el próximo preview
        scheduleSessionSave();        // U2: autoguardado (debounced) del flujo committeado
        logConsole(lang === "es" ? "Cambios aplicados y guardados en el flujo" : "Changes saved and committed to workflow", "ok");
        updateBigApply();
      }
    };
    // PROXY-PROBAR: NUNCA commitear un preview proxy (baja resolución) — perdería la imagen
    // real. Si el pase a resolución completa sigue en marcha, esperar a que reemplace al proxy
    // y commitear entonces; si no hay pase pendiente (falló o el Live aún no asentó), avisar.
    const commitPreview = () => {
      if (state.activeImage && state.activeImage._proxy) {
        if (_proxyPendingFull) {
          showLoader(lang === "es" ? "Terminando el cálculo a resolución completa..." : "Finishing the full-resolution pass...");
          _proxyPendingFull.then(() => {
            hideLoader();
            if (state.activeImage && state.activeImage._proxy) {
              logConsole(lang === "es" ? "No se pudo aplicar: el cálculo a resolución completa falló. Vuelve a pulsar Probar." : "Could not apply: the full-resolution pass failed. Press Test again.", "err");
            } else {
              doCommit();
            }
          });
        } else {
          logConsole(lang === "es" ? "La vista a resolución completa aún no está lista. Espera un instante y vuelve a pulsar Aplicar." : "The full-resolution view is not ready yet. Wait a moment and press Apply again.", "warn");
        }
        return;
      }
      doCommit();
    };

    // Mapa declarativo: etiqueta ES/EN + gating. noGate = secciones con flujo propio (aplican desde
    // selección/slot, no desde un preview pendiente).
    const APPLY_DEFS = {
      crop:        { es: "Recortar",             en: "Crop",              noGate: true },
      gradient:    { es: "Aplicar Gradiente",    en: "Apply Gradient" },
      calibration: { es: "Aplicar Calibración",  en: "Apply Calibration", noGate: true },
      deconv:      { es: "Aplicar Deconvolución",en: "Apply Deconvolve" },
      stretch:     { es: "Aplicar Estirado",     en: "Apply Stretch" },
      noise:       { es: "Aplicar Reducción",    en: "Apply Denoise" },
      sharpen:     { es: "Aplicar Enfoque",      en: "Apply Sharpen" },
      balance:     { es: "Aplicar Balance",      en: "Apply Balance" },
      curves:      { es: "Aplicar Curvas",       en: "Apply Curves" },
      scnr:        { es: "Aplicar SCNR",         en: "Apply SCNR" },
      mask:        { es: "Guardar Máscara",      en: "Save Mask",         noGate: true },
      saturation:  { es: "Aplicar Saturación",   en: "Apply Saturation" },
      saspro:      { es: "Aplicar SASPro",       en: "Apply SASPro" },
      colormixer:  { es: "Aplicar Color Mixer",  en: "Apply Color Mixer" },
      detail:      { es: "Aplicar Detalle",      en: "Apply Detail" }
    };

    const def = APPLY_DEFS[applyKey];
    if (!def) { btn.style.display = "none"; return; } // sección sin data-apply → sin botón contextual

    let action = null;
    if (applyKey === "crop") {
      // Crop delega en su propio botón de sección y commitea tras el recorte.
      const applyCropBtn = el("btnCropApplyCurrent");
      if (applyCropBtn && !applyCropBtn.disabled) {
        action = () => { applyCropBtn.click(); setTimeout(commitPreview, 100); };
      }
    } else if (applyKey === "calibration") {
      // Activo solo si hay un método previsualizado (card) o tras "Comparar Métodos".
      const activeCard = activeSection.querySelector(".piw-action-card.active-cc");
      if (activeCard || state.calibCompareReady) action = commitPreview;
    } else {
      action = commitPreview;
    }

    if (action) {
      btn.style.display = "block";
      btn.textContent = lang === "es" ? def.es : def.en;
      const enabled = def.noGate ? true : !!state.pendingPreview;

      const newBtn = btn.cloneNode(true);
      newBtn.disabled = !enabled;
      newBtn.style.opacity = enabled ? "" : "0.4";
      newBtn.style.cursor = enabled ? "" : "not-allowed";
      if (!enabled) newBtn.title = lang === "es" ? "Primero pulsa Probar/Preview para ver el cambio" : "Press Test/Preview first to see the change";
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener("click", () => { if (!newBtn.disabled) action(); });
    } else {
      btn.style.display = "none";
    }
    // APPLY-DATA-END
  }
  
  // Exponer a ámbito global/del módulo para que las tarjetas de calibración puedan actualizar el botón
  window.updateBigApply = updateBigApply;

  updateBigApply();

  // SESSION-RESTORE-PROMPT (U2): si hay una sesión autoguardada y aún no se ha cargado nada,
  // ofrecer recuperarla (banner persistente con Recuperar/Descartar).
  loadSessionMeta().then((meta) => {
    if (!meta || !meta.keys || !meta.keys.length || state.activeImage) return;
    showRestoreBanner(meta);
  }).catch(() => {});

  // E2E-HOOK-BEGIN
  if (typeof window !== "undefined" && window.location.search.includes("e2ehook=1")) {
    window.__piwTest = {
      setActiveImage: (img) => { setActiveImage(img); },
      getActiveImage: () => state.activeImage,
      getWorkflowImages: () => state.workflowImages,
      getStarlessImage: () => state.starlessImage,
      getStarsImage: () => state.starsImage,
      getScreenStretchMode: () => state.screenStretchMode,
      getPreviousImage: () => state.previousImage,
      getStepInputImage: () => state.stepInputImage,
      getViewingPrevious: () => state.viewingPrevious,
      getSplitViewMode: () => state.splitViewMode,
      getSplitCompareImage: () => state.splitCompareImage,
      getSplitPercent: () => state.splitPercent,
      refreshPathBar: () => { refreshPathBar(); },
      selectWorkflowKey: (key) => { selectWorkflowKey(key); },
      getCurves: () => state.curves,
      setCurves: (curves) => { state.curves = curves; drawCurvesWidget(); },
      // CF-WORKER-BEGIN
      setAstrometryProxyUrl: (url) => { ASTROMETRY_PROXY_URL = url; }
      // CF-WORKER-END
    };
    // R3: carga la suite de humo (tools/piw-smoke.js) SOLO en modo test. Define
    // window.__piwSmoke(); el resultado queda en window.__piwSmokeResult.
    const _smokeScript = document.createElement("script");
    _smokeScript.src = "tools/piw-smoke.js?v=" + (window.PIW_BUILD || "0");
    document.head.appendChild(_smokeScript);
  }
  // E2E-HOOK-END


  // --- U7: NOMBRES ACCESIBLES (aria-label) ---
  // En vez de escribir 138 aria-label a mano en el HTML (y duplicarlos en el i18n del EN),
  // los DERIVAMOS en runtime del texto que YA está junto a cada control (.piw-label del grupo,
  // cabecera de subcard o título de sección). Así el nombre accesible sale automáticamente en
  // el idioma correcto (lee el DOM ya traducido) y no se desincroniza. Idempotente: nunca
  // pisa un aria-label/title/label existente. Un MutationObserver debounced reaplica el pase a
  // los controles inyectados por JS después del arranque (sliders de recetas de banda estrecha
  // cargados por fetch, capas de mezcla, etc.). Los pocos textos propios (slots, lienzos) usan
  // el idioma del documento, igual que el resto de la UI.
  (function () {
    const lang = document.documentElement.lang || "es";
    const t = (es, en) => (lang === "es" ? es : en);
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

    // ¿Tiene ya nombre accesible? (label asociado, envolvente, aria-label o title)
    function hasName(node) {
      if (node.getAttribute("aria-label") || node.getAttribute("aria-labelledby") || node.title) return true;
      if (node.id && document.querySelector('label[for="' + CSS.escape(node.id) + '"]')) return true;
      if (node.closest("label")) return true;
      return false;
    }

    // Texto descriptivo más cercano hacia arriba para un control de formulario.
    function deriveLabel(ctrl) {
      const grp = ctrl.closest(".piw-control-group");
      if (grp) {
        const lbl = grp.querySelector(".piw-label");
        if (lbl && clean(lbl.textContent)) return clean(lbl.textContent);
      }
      // select/entrada suelta: cabecera de subcard o título de sección
      const sub = ctrl.closest(".piw-subcard");
      if (sub) {
        const hd = sub.querySelector(".piw-subcard-header");
        if (hd && clean(hd.textContent)) return clean(hd.textContent);
      }
      const sec = ctrl.closest(".piw-section");
      if (sec) {
        const tl = sec.querySelector(".piw-section-title");
        if (tl && clean(tl.textContent)) return clean(tl.textContent);
      }
      return "";
    }

    function applyLabels() {
      let n = 0;
      // 1) Controles de formulario sin nombre: aria-label derivado del contexto.
      document.querySelectorAll(
        ".piw-preview-panel input, .piw-preview-panel select, .piw-container input, .piw-container select"
      ).forEach((ctrl) => {
        if (hasName(ctrl)) return;
        let label = deriveLabel(ctrl);
        if (!label && ctrl.type === "file") label = t("Seleccionar archivo", "Choose file");
        if (label) { ctrl.setAttribute("aria-label", label); n++; }
      });

      // 2) Slots de memoria (texto visible "1"/"M1" poco descriptivo para lectores de pantalla).
      document.querySelectorAll(".piw-slot-btn[data-slot]").forEach((b) => {
        if (!hasName(b)) { b.setAttribute("aria-label", t("Slot de imagen ", "Image slot ") + b.dataset.slot); n++; }
      });
      document.querySelectorAll(".piw-slot-btn[data-mask-slot]").forEach((b) => {
        if (!hasName(b)) { b.setAttribute("aria-label", t("Slot de máscara ", "Mask slot ") + b.dataset.maskSlot); n++; }
      });

      // 3) Lienzos/SVG interactivos.
      const canvasNames = {
        piwCanvas: t("Visor de imagen", "Image viewer"),
        curvesCanvas: t("Editor de curvas", "Curves editor"),
        maskColorWheel: t("Rueda de color de máscara", "Mask color wheel"),
        histogramSvg: t("Histograma", "Histogram")
      };
      Object.keys(canvasNames).forEach((id) => {
        const node = document.getElementById(id);
        if (node && !node.getAttribute("aria-label")) {
          node.setAttribute("role", "img");
          node.setAttribute("aria-label", canvasNames[id]);
          n++;
        }
      });
      return n;
    }

    const total = applyLabels();
    if (window.location.search.includes("e2ehook=1")) console.log("[a11y] aria-labels iniciales: " + total);

    // Reaplicar (debounced) cuando se inyectan controles nuevos por JS tras el arranque.
    let raf = 0;
    const root = document.querySelector(".piw-container") || document.body;
    const obs = new MutationObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; applyLabels(); });
    });
    obs.observe(root, { childList: true, subtree: true });
    // Red de seguridad para contenido que se construye en varios pasos de forma asíncrona
    // (p. ej. los sliders de recetas de banda estrecha: primero el input, luego su .piw-label;
    // si el observer corre justo en medio, el control quedaría sin texto). Dos pasadas tardías
    // recogen lo que el observer no vio ya asentado. Idempotentes (no repiten trabajo).
    setTimeout(applyLabels, 600);
    setTimeout(applyLabels, 2000);
    // Exponer para el hook de test (verificación determinista sin esperar al observer).
    window.__piwApplyA11y = applyLabels;
  })();
  // ============================================================================
  // ANOTAR (pestaña de anotación) — identifica objetos del catálogo local
  // (annotate-catalog.json: OpenNGC + Sharpless + Barnard; ver tools/build_catalog.py)
  // sobre la imagen usando el WCS del Plate Solving, al estilo PixInsight/AstroBin.
  //
  // Matemática (derivada del código fuente de astrometry.net: util/sip.c
  // tan_get_orientation() y net/models.py Calibration.get_orientation()):
  //   - la API devuelve parity = signo de det(CD) (±1);
  //   - para envíos JPEG (nuestro caso), orientation_api = (180 − orient_tan) mod 360,
  //     y el espacio de píxeles del WCS coincide con el del JPEG (x→derecha, y→abajo).
  // Reconstruimos la CD con escala pixscale, sin skew, y proyección TAN (gnomónica)
  // centrada en el (ra, dec) del centro del campo que reporta la calibración.
  // OJO: pixscale corresponde al JPEG reducido a 800 px que se sube al solver
  // (getActiveImageAsJpegBlob), no a la imagen completa: se reescala con sf.
  // ============================================================================
  const annot = {
    on: false,             // overlay visible
    flip: 1,               // guardia manual ⇄ Este/Oeste (multiplica la paridad)
    catalog: null,         // objetos [name, common, cat, ra, dec, majA, minA, pa, mag]
    catalogPromise: null,
    list: [],              // objetos proyectados a px de la imagen actual
    card: null             // tarjeta de detalles abierta
  };

  const ANNOT_COLORS = { g: "#63c7ff", n: "#ff8fb0", c: "#ffd76a", s: "#e8e8e8" };
  const ANNOT_TYPES_ES = { g: "Galaxia", n: "Nebulosa", c: "Cúmulo", s: "Estrella(s)" };
  const ANNOT_TYPES_EN = { g: "Galaxy", n: "Nebula", c: "Cluster", s: "Star(s)" };

  function annotLang() { return document.documentElement.lang === "en" ? "en" : "es"; }

  // WCS vigente y válido para la imagen actual. state.wcs es la única autoridad:
  // lo escribe el Plate Solving (04) y lo anula el Crop (03) al cambiar la geometría.
  function annotWcs() {
    const w = state.wcs, img = state.activeImage;
    if (!w || !img || typeof w.ra !== "number" || typeof w.pixscale !== "number") return null;
    if (w.imgW && (w.imgW !== img.w || w.imgH !== img.h)) return null; // geometría desfasada
    return w;
  }

  // Dimensiones del JPEG que se envió a Astrometry.net (mismo cálculo que
  // getActiveImageAsJpegBlob: lado mayor limitado a 800 px). Como el crop anula el
  // WCS, la imagen actual tiene las mismas dimensiones que cuando se resolvió.
  function annotJpegDims(imgW, imgH) {
    const maxDim = 800;
    if (imgW <= maxDim && imgH <= maxDim) return { w: imgW, h: imgH };
    if (imgW > imgH) return { w: maxDim, h: Math.round(imgH * maxDim / imgW) };
    return { w: Math.round(imgW * maxDim / imgH), h: maxDim };
  }

  // Transformación cielo↔píxel para la imagen ACTUAL (CD reconstruida + escala sf).
  function annotBuildTransform() {
    const wcs = annotWcs(), img = state.activeImage;
    if (!wcs || !img) return null;
    const D2R = Math.PI / 180;
    const jp = annotJpegDims(img.w, img.h);
    const sf = img.w / jp.w;                        // px del jpeg → px de la imagen
    const s = wcs.pixscale / 3600;                  // grados por px del jpeg
    const theta = (180 - (wcs.orientation || 0)) * D2R; // deshace el ajuste JPEG de la API
    const p = ((wcs.parity != null && wcs.parity < 0) ? -1 : 1) * annot.flip;
    // Construcción verificada contra tan_get_orientation(): reproducir (s, theta, p)
    const c = Math.cos(theta), n = Math.sin(theta);
    let cd11, cd12, cd21, cd22;
    if (p >= 0) { cd11 = s * c;  cd12 = s * n; cd21 = -s * n; cd22 = s * c; }
    else        { cd11 = -s * c; cd12 = s * n; cd21 = s * n;  cd22 = s * c; }
    return {
      ra0: wcs.ra * D2R, de0: wcs.dec * D2R,
      cd11, cd12, cd21, cd22, det: cd11 * cd22 - cd12 * cd21,
      jp, sf,
      pixscaleImg: wcs.pixscale / sf,               // arcsec por px de la imagen actual
      radius: wcs.radius || 0
    };
  }

  // Cielo (grados J2000) → píxel de la imagen actual. null si cae fuera del hemisferio.
  function annotSkyToPx(T, raDeg, decDeg) {
    const D2R = Math.PI / 180, R2D = 180 / Math.PI;
    const ra = raDeg * D2R, de = decDeg * D2R;
    const dra = ra - T.ra0;
    const den = Math.sin(de) * Math.sin(T.de0) + Math.cos(de) * Math.cos(T.de0) * Math.cos(dra);
    if (den <= 0.02) return null;
    const xi = R2D * Math.cos(de) * Math.sin(dra) / den;                                                    // → Este
    const eta = R2D * (Math.sin(de) * Math.cos(T.de0) - Math.cos(de) * Math.sin(T.de0) * Math.cos(dra)) / den; // → Norte
    const dx = (T.cd22 * xi - T.cd12 * eta) / T.det;   // CD⁻¹ · [xi, eta]
    const dy = (-T.cd21 * xi + T.cd11 * eta) / T.det;
    return { x: (T.jp.w / 2 + dx) * T.sf, y: (T.jp.h / 2 + dy) * T.sf };
  }

  // Píxel de la imagen actual → cielo (huella de la imagen en Aladin).
  function annotPxToSky(T, x, y) {
    const D2R = Math.PI / 180, R2D = 180 / Math.PI;
    const dx = x / T.sf - T.jp.w / 2, dy = y / T.sf - T.jp.h / 2;
    const xi = (T.cd11 * dx + T.cd12 * dy) * D2R;
    const eta = (T.cd21 * dx + T.cd22 * dy) * D2R;
    const den = Math.cos(T.de0) - eta * Math.sin(T.de0);
    const ra = T.ra0 + Math.atan2(xi, den);
    const de = Math.atan2(Math.sin(T.de0) + eta * Math.cos(T.de0), Math.sqrt(xi * xi + den * den));
    return { ra: ((ra * R2D) % 360 + 360) % 360, dec: de * R2D };
  }

  function annotLoadCatalog() {
    if (annot.catalogPromise) return annot.catalogPromise;
    const v = (typeof window.PIW_BUILD === "string") ? window.PIW_BUILD : "0";
    annot.catalogPromise = fetch("annotate-catalog.json?v=" + v)
      .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(d => { annot.catalog = d.objects || []; return annot.catalog; })
      .catch(err => { annot.catalogPromise = null; throw err; });
    return annot.catalogPromise;
  }

  // Proyecta el catálogo al campo actual según chips de categoría y magnitud límite.
  function annotCompute() {
    annot.list = [];
    const T = annotBuildTransform(), img = state.activeImage;
    if (!T || !annot.catalog || !img) return 0;
    const magLim = el("sldAnnotMag") ? (parseFloat(el("sldAnnotMag").value) || 12) : 12;
    const cats = {
      g: !el("chkAnnotG") || el("chkAnnotG").checked,
      n: !el("chkAnnotN") || el("chkAnnotN").checked,
      c: !el("chkAnnotC") || el("chkAnnotC").checked,
      s: !el("chkAnnotS") || el("chkAnnotS").checked
    };
    const D2R = Math.PI / 180;
    const sinDe0 = Math.sin(T.de0), cosDe0 = Math.cos(T.de0);
    // Pre-filtro angular barato: radio del campo + 1.5° de margen (objetos grandes
    // cuyo centro cae algo fuera del encuadre).
    const fieldR = T.radius || (Math.hypot(img.w, img.h) / 2) * T.pixscaleImg / 3600;
    const cosRMax = Math.cos(Math.min(89, fieldR + 1.5) * D2R);
    let cosNearest = -1, nearest = null; // objeto más cercano al centro (para avisar en campos escasos)
    for (let i = 0; i < annot.catalog.length; i++) {
      const o = annot.catalog[i];
      const cat = o[2];
      if (!cats[cat]) continue;
      const de = o[4] * D2R;
      const cosSep = sinDe0 * Math.sin(de) + cosDe0 * Math.cos(de) * Math.cos(o[3] * D2R - T.ra0);
      if (cosSep > cosNearest) { cosNearest = cosSep; nearest = o; }
      const mag = o[8];
      // Los objetos "más señalados" (nombre común o número Messier) SIEMPRE se muestran; la
      // magnitud límite (densidad) solo filtra las designaciones anónimas NGC/IC más débiles.
      // Las nebulosas Sh2/Barnard no traen magnitud (null) y también pasan siempre.
      const named = !!o[1] || o[0].indexOf("M ") === 0;
      if (!named && mag != null && mag > magLim) continue;
      if (cosSep < cosRMax) continue;
      const px = annotSkyToPx(T, o[3], o[4]);
      if (!px) continue;
      // Semiejes de la elipse en px de la imagen (majA/minA vienen en arcmin).
      const rx = Math.max(12, (o[5] || 2) * 30 / T.pixscaleImg);
      const ry = Math.max(10, (o[6] || o[5] || 2) * 30 / T.pixscaleImg);
      if (px.x < -rx || px.x > img.w + rx || px.y < -rx || px.y > img.h + rx) continue;
      // Dirección en pantalla del eje mayor: PA se mide de Norte hacia Este.
      const paR = (o[7] || 0) * D2R;
      const dxd = T.cd22 * Math.sin(paR) - T.cd12 * Math.cos(paR);
      const dyd = -T.cd21 * Math.sin(paR) + T.cd11 * Math.cos(paR);
      annot.list.push({
        x: px.x, y: px.y, rx, ry, rot: Math.atan2(dyd, dxd),
        name: o[0], common: o[1], cat, mag
      });
    }
    // Los grandes se dibujan primero (los pequeños quedan encima y clicables);
    // cap de seguridad para campos enormes con magnitud alta.
    annot.nearest = nearest
      ? { name: nearest[1] || nearest[0], sep: Math.acos(Math.min(1, cosNearest)) / D2R }
      : null;
    annot.list.sort((a, b) => b.rx - a.rx);
    if (annot.list.length > 400) annot.list.length = 400;
    annotRenderList();
    return annot.list.length;
  }

  // Dibujado del overlay: lo llama render() (15) tras pintar la imagen.
  function drawAnnotationsOverlay() {
    if (!annot.on || !annot.list.length) return;
    const dispW = cv.getBoundingClientRect().width || cv.width;
    const r = dispW > 0 ? cv.width / dispW : 1; // px de canvas por px visual (para grosor/tipografía)
    const font = Math.max(10, Math.round(12 * r));
    ctx.save();
    ctx.font = "600 " + font + "px system-ui, -apple-system, sans-serif";
    ctx.textBaseline = "bottom";
    for (let i = 0; i < annot.list.length; i++) {
      const a = annot.list[i];
      const col = ANNOT_COLORS[a.cat] || "#ffffff";
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1, 1.3 * r);
      ctx.beginPath();
      ctx.ellipse(a.x, a.y, a.rx, a.ry, a.rot, 0, Math.PI * 2);
      ctx.stroke();
      const label = a.common || a.name;
      const tx = a.x - a.rx * 0.6, ty = a.y - a.ry - 4 * r;
      ctx.lineWidth = Math.max(2.5, 3 * r);
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.strokeText(label, tx, ty);
      ctx.fillStyle = col;
      ctx.fillText(label, tx, ty);
    }
    ctx.restore();
  }

  // --- Click sobre un objeto → tarjeta con detalles y enlaces ---
  let _annotDownPos = null;
  cv.addEventListener("pointerdown", (e) => { _annotDownPos = { x: e.clientX, y: e.clientY }; });
  cv.addEventListener("click", (e) => {
    if (!annot.on || !annot.list.length) return;
    // Si hubo arrastre (pan/zoom), no es un click de selección.
    if (_annotDownPos && Math.hypot(e.clientX - _annotDownPos.x, e.clientY - _annotDownPos.y) > 6) return;
    const rect = cv.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (e.clientX - rect.left) * cv.width / rect.width;
    const y = (e.clientY - rect.top) * cv.height / rect.height;
    const slack = 12 * (cv.width / rect.width); // holgura táctil
    let best = null, bestArea = Infinity;
    for (let i = 0; i < annot.list.length; i++) {
      const a = annot.list[i];
      const co = Math.cos(a.rot), si = Math.sin(a.rot);
      const dx = x - a.x, dy = y - a.y;
      const u = (dx * co + dy * si) / (a.rx + slack);
      const v = (-dx * si + dy * co) / (a.ry + slack);
      if (u * u + v * v <= 1) {
        const area = a.rx * a.ry;
        if (area < bestArea) { bestArea = area; best = a; } // el más pequeño gana (más específico)
      }
    }
    if (best) annotShowCard(best, e.clientX, e.clientY); else annotHideCard();
  });

  function annotHideCard() {
    if (annot.card) { annot.card.remove(); annot.card = null; }
  }

  function annotShowCard(a, clientX, clientY) {
    annotHideCard();
    const lang = annotLang();
    const types = lang === "en" ? ANNOT_TYPES_EN : ANNOT_TYPES_ES;
    const card = document.createElement("div");
    card.className = "piw-annot-card";
    const wikiHost = lang === "en" ? "en.wikipedia.org" : "es.wikipedia.org";
    const wikiQ = encodeURIComponent(a.common || a.name);
    // SIMBAD entiende M/NGC/IC/Sh2/B; para Caldwell ("C 9") el nombre común resuelve mejor.
    const simbadQ = encodeURIComponent((a.name.indexOf("C ") === 0 && a.common) ? a.common : a.name);
    card.innerHTML =
      '<button class="close" type="button">✕</button><h4></h4><div class="sub"></div>' +
      '<a target="_blank" rel="noopener" href="https://' + wikiHost + '/wiki/Special:Search?search=' + wikiQ + '">📖 Wikipedia</a>' +
      '<a target="_blank" rel="noopener" href="https://simbad.cds.unistra.fr/simbad/sim-id?Ident=' + simbadQ + '">🔭 SIMBAD</a>';
    card.querySelector("h4").textContent = a.common || a.name;
    card.querySelector(".sub").textContent =
      (a.common ? a.name + " · " : "") + (types[a.cat] || "") + (a.mag != null ? " · mag " + a.mag : "");
    card.querySelector(".close").addEventListener("click", annotHideCard);
    container.appendChild(card);
    const contRect = container.getBoundingClientRect();
    let lx = clientX - contRect.left + 12, ly = clientY - contRect.top + 12;
    card.style.left = lx + "px";
    card.style.top = ly + "px";
    annot.card = card;
    // Reposicionar si se sale del contenedor (necesita las medidas ya renderizadas).
    requestAnimationFrame(() => {
      if (annot.card !== card) return;
      if (lx + card.offsetWidth > contRect.width - 8) lx = Math.max(8, contRect.width - card.offsetWidth - 8);
      if (ly + card.offsetHeight > contRect.height - 8) ly = Math.max(8, contRect.height - card.offsetHeight - 8);
      card.style.left = lx + "px";
      card.style.top = ly + "px";
    });
  }

  // --- F3: lista lateral de objetos encontrados y exportación del PNG anotado ---
  function annotShowCardForObject(a) {
    const rect = cv.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const clientX = rect.left + a.x * rect.width / cv.width;
    const clientY = rect.top + a.y * rect.height / cv.height;
    annotShowCard(a, clientX, clientY);
  }

  function annotRenderList() {
    const box = el("annotObjList");
    const expBtn = el("btnAnnotExport");
    const active = annot.on && annot.list.length > 0;
    if (expBtn) expBtn.disabled = !active;
    if (!box) return;
    if (!active) { box.style.display = "none"; box.innerHTML = ""; return; }
    const lang = annotLang();
    const icon = { g: "🌌", n: "☁️", c: "✨", s: "⭐" };
    // Lista ordenada por brillo (los objetos sin magnitud —Sh2/Barnard— al final).
    const items = annot.list.slice().sort((a, b) => (a.mag == null ? 99 : a.mag) - (b.mag == null ? 99 : b.mag));
    box.innerHTML = "";
    const head = document.createElement("div");
    head.className = "piw-annot-list-head";
    head.textContent = (lang === "es" ? "Objetos en el campo: " : "Objects in field: ") + annot.list.length;
    box.appendChild(head);
    items.forEach(a => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "piw-annot-list-item";
      row.innerHTML = '<span class="ic"></span><span class="nm"></span><span class="mg"></span>';
      row.querySelector(".ic").textContent = icon[a.cat] || "•";
      row.querySelector(".nm").textContent = a.common || a.name;
      row.querySelector(".mg").textContent = a.mag != null ? ("m" + a.mag) : "";
      row.addEventListener("click", () => annotShowCardForObject(a));
      box.appendChild(row);
    });
    box.style.display = "block";
  }

  // Exporta el canvas actual (imagen mostrada + overlay ya pintado) como PNG.
  function annotExportPng() {
    const lang = annotLang();
    if (!annot.on || !annot.list.length) return;
    render(); // garantiza el overlay pintado en el canvas antes de capturar
    const done = (blob) => {
      if (!blob) { showToast(lang === "es" ? "No se pudo exportar el PNG" : "PNG export failed", "err"); return; }
      _downloadBlob(blob, "cabraspace-anotada.png");
      showToast(lang === "es" ? "PNG anotado exportado" : "Annotated PNG exported", "ok");
    };
    if (cv.toBlob) { cv.toBlob(done, "image/png"); return; }
    try {
      const parts = cv.toDataURL("image/png").split(",");
      const bin = atob(parts[1]); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      done(new Blob([arr], { type: "image/png" }));
    } catch (e) { done(null); }
  }

  // --- Estado de la sección y arranque ---
  function annotRefreshStatus() {
    const lbl = el("lblAnnotWcs");
    if (!lbl) return;
    const lang = annotLang();
    const wcs = annotWcs();
    const hasImg = !!state.activeImage;
    if (wcs) {
      lbl.textContent = (lang === "es" ? "● WCS resuelto — AR " : "● WCS solved — RA ") +
        wcs.ra.toFixed(3) + "°, DEC " + wcs.dec.toFixed(3) + "° · " + wcs.pixscale.toFixed(2) + '"/px';
      lbl.style.color = "#7ed89b";
    } else {
      lbl.textContent = lang === "es"
        ? (hasImg ? "Sin solución astrométrica: ejecuta Plate Solving para poder anotar."
                  : "Carga una imagen y ejecuta Plate Solving para poder anotar.")
        : (hasImg ? "No astrometric solution: run Plate Solving to enable annotation."
                  : "Load an image and run Plate Solving to enable annotation.");
      lbl.style.color = "#c9a06a";
    }
    if (el("btnAnnotate")) el("btnAnnotate").disabled = !wcs;
    if (el("btnAnnotSky")) el("btnAnnotSky").disabled = !wcs;
    if (el("btnAnnotGoSolve")) el("btnAnnotGoSolve").style.display = (!wcs && hasImg) ? "" : "none";
  }

  function annotOnTabOpen() {
    annotRefreshStatus();
    annotLoadCatalog().catch(() => {}); // precarga silenciosa (~300 KB, una sola vez)
  }

  // Lo llaman 04 (solve exitoso) y 03 (crop → WCS anulado).
  function annotOnWcsChanged() {
    if (annot.on) {
      if (annotWcs()) {
        annotCompute();
      } else {
        annot.on = false;
        annot.list = [];
        annotHideCard();
        annotRenderList();
        const btn = el("btnAnnotate");
        if (btn) { btn.classList.remove("active"); btn.textContent = annotLang() === "es" ? "Anotar imagen" : "Annotate image"; }
      }
      render();
    }
    annotRefreshStatus();
  }

  async function annotToggle() {
    const lang = annotLang();
    const btn = el("btnAnnotate");
    if (annot.on) {
      annot.on = false;
      annot.list = [];
      annotHideCard();
      annotRenderList();
      if (btn) { btn.classList.remove("active"); btn.textContent = lang === "es" ? "Anotar imagen" : "Annotate image"; }
      render();
      return;
    }
    if (!annotWcs()) { annotRefreshStatus(); return; }
    if (!annot.catalog) {
      try {
        if (btn) btn.disabled = true;
        await annotLoadCatalog();
      } catch (e) {
        showToast(lang === "es" ? "No se pudo cargar el catálogo de objetos" : "Could not load the object catalog", "err");
        return;
      } finally {
        if (btn) btn.disabled = false;
      }
    }
    annot.on = true;
    const n = annotCompute();
    if (btn) { btn.classList.add("active"); btn.textContent = lang === "es" ? "Ocultar anotaciones" : "Hide annotations"; }
    if (el("btnAnnotFlip")) el("btnAnnotFlip").style.display = "";
    render();
    logConsole(lang === "es" ? `Anotación: ${n} objetos del catálogo en el campo.` : `Annotation: ${n} catalog objects in the field.`, "info");
    if (!n) {
      const near = annot.nearest;
      showToast(near
        ? (lang === "es"
            ? `Campo escaso: nada del catálogo dentro del encuadre. Lo más cercano: ${near.name} a ${near.sep.toFixed(1)}° del centro.`
            : `Sparse field: nothing from the catalog inside the frame. Nearest: ${near.name} at ${near.sep.toFixed(1)}° from center.`)
        : (lang === "es" ? "Ningún objeto del catálogo en el campo con los filtros actuales" : "No catalog objects in the field with current filters"), "err");
    }
  }

  if (el("btnAnnotate")) el("btnAnnotate").addEventListener("click", annotToggle);
  if (el("btnAnnotExport")) el("btnAnnotExport").addEventListener("click", annotExportPng);
  ["chkAnnotG", "chkAnnotN", "chkAnnotC", "chkAnnotS"].forEach(id => {
    if (el(id)) el(id).addEventListener("change", () => { if (annot.on) { annotCompute(); render(); } });
  });
  if (el("sldAnnotMag")) el("sldAnnotMag").addEventListener("input", () => {
    if (el("valAnnotMag")) el("valAnnotMag").textContent = (parseFloat(el("sldAnnotMag").value) || 12).toFixed(1);
    if (annot.on) { annotCompute(); render(); }
  });
  if (el("btnAnnotFlip")) el("btnAnnotFlip").addEventListener("click", () => {
    annot.flip = -annot.flip;
    if (annot.on) { annotCompute(); render(); }
  });
  if (el("btnAnnotGoSolve")) el("btnAnnotGoSolve").addEventListener("click", () => {
    // Llevar al usuario a la sección de Plate Solving (pestaña Pre).
    const preBtn = document.querySelector('.piw-tab-btn[data-tab="tab-pre"]');
    if (preBtn) preBtn.click();
    const sec = el("btnSolveImage") ? el("btnSolveImage").closest(".piw-section") : null;
    if (sec) {
      sec.classList.remove("collapsed");
      sec.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });

  // --- F2: "Ver en el cielo" — Aladin Lite v3 (CDS), carga bajo demanda ---
  let _aladinReady = null;
  function annotLoadAladin() {
    if (_aladinReady) return _aladinReady;
    _aladinReady = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js";
      s.onload = () => {
        if (window.A && window.A.init) window.A.init.then(resolve, reject);
        else reject(new Error("Aladin unavailable"));
      };
      s.onerror = () => reject(new Error("download failed"));
      document.head.appendChild(s);
    }).catch(err => { _aladinReady = null; throw err; });
    return _aladinReady;
  }

  // Construye un FITS (8-bit gris + cabecera WCS TAN) de la imagen mostrada, reducida,
  // para incrustarla en Aladin vía displayFITS. La cabecera se deriva de la MISMA
  // transformación con la que anotamos (annotBuildTransform), así la imagen cae en Aladin
  // exactamente donde está la huella. Filas de arriba abajo (y-down), coherente con la CD.
  function annotBuildFitsBlob() {
    const wcs = annotWcs(), img = state.activeImage, T = annotBuildTransform();
    if (!wcs || !img || !T || typeof displayImageDataFor !== "function") return null;
    const MAX = 512;
    const sc = Math.min(1, MAX / Math.max(img.w, img.h));
    const fw = Math.max(1, Math.round(img.w * sc));
    const fh = Math.max(1, Math.round(img.h * sc));
    // Reducir la imagen mostrada (con el estirado de pantalla ya aplicado) a fw×fh.
    let px;
    try {
      const full = displayImageDataFor(img);
      const c1 = document.createElement("canvas"); c1.width = img.w; c1.height = img.h;
      c1.getContext("2d").putImageData(full, 0, 0);
      const c2 = document.createElement("canvas"); c2.width = fw; c2.height = fh;
      const cx2 = c2.getContext("2d"); cx2.drawImage(c1, 0, 0, fw, fh);
      px = cx2.getImageData(0, 0, fw, fh).data;
    } catch (e) { return null; }
    const g = fw / img.w;                     // px de imagen → px del FITS
    const k = 1 / (T.sf * g);                 // deg/px(JPEG) → deg/px(FITS)
    const D11 = T.cd11 * k, D12 = T.cd12 * k, D21 = T.cd21 * k, D22 = T.cd22 * k;
    const fnum = (x) => (isFinite(x) ? x.toFixed(12) : "0");
    const pad80 = (s) => (s.length >= 80 ? s.slice(0, 80) : s + " ".repeat(80 - s.length));
    const kv = (key, val) => pad80(key.padEnd(8) + "= " + val);
    const cards = [
      kv("SIMPLE", "T".padStart(20)),
      kv("BITPIX", "8".padStart(20)),
      kv("NAXIS", "2".padStart(20)),
      kv("NAXIS1", String(fw).padStart(20)),
      kv("NAXIS2", String(fh).padStart(20)),
      kv("CTYPE1", "'RA---TAN'".padEnd(20)),
      kv("CTYPE2", "'DEC--TAN'".padEnd(20)),
      kv("CUNIT1", "'deg'".padEnd(20)),
      kv("CUNIT2", "'deg'".padEnd(20)),
      kv("CRPIX1", fnum(fw / 2 + 0.5).padStart(20)),
      kv("CRPIX2", fnum(fh / 2 + 0.5).padStart(20)),
      kv("CRVAL1", fnum(wcs.ra).padStart(20)),
      kv("CRVAL2", fnum(wcs.dec).padStart(20)),
      kv("CD1_1", fnum(D11).padStart(20)),
      kv("CD1_2", fnum(D12).padStart(20)),
      kv("CD2_1", fnum(D21).padStart(20)),
      kv("CD2_2", fnum(D22).padStart(20)),
      kv("EQUINOX", fnum(2000).padStart(20)),
      pad80("END")
    ];
    let hs = cards.join("");
    while (hs.length % 2880 !== 0) hs += " ";
    const n = fw * fh;
    const dataLen = Math.ceil(n / 2880) * 2880;
    const out = new Uint8Array(hs.length + dataLen);
    for (let i = 0; i < hs.length; i++) out[i] = hs.charCodeAt(i) & 0xff;
    for (let i = 0, p = 0, o = hs.length; i < n; i++, p += 4, o++) {
      out[o] = (px[p] * 0.299 + px[p + 1] * 0.587 + px[p + 2] * 0.114) | 0;
    }
    return new Blob([out], { type: "application/fits" });
  }

  async function annotOpenSky() {
    const lang = annotLang();
    const wcs = annotWcs(), img = state.activeImage;
    if (!wcs || !img) return;
    const panel = el("aladinPanel"), mapDiv = el("aladinMap");
    if (!panel || !mapDiv) return;
    try {
      showLoader(lang === "es" ? "Cargando Aladin Lite (CDS)..." : "Loading Aladin Lite (CDS)...");
      await annotLoadAladin();
    } catch (e) {
      hideLoader();
      showToast(lang === "es" ? "No se pudo cargar Aladin Lite (¿sin conexión?)" : "Could not load Aladin Lite (offline?)", "err");
      return;
    }
    hideLoader();
    panel.style.display = "flex";
    mapDiv.innerHTML = ""; // reinicio limpio en cada apertura (instancia ligera)
    const aladin = window.A.aladin(mapDiv, {
      survey: "P/DSS2/color",
      fov: Math.max(0.3, (wcs.radius || 1) * 4),
      target: wcs.ra.toFixed(5) + " " + (wcs.dec >= 0 ? "+" : "") + wcs.dec.toFixed(5),
      cooFrame: "ICRSd",
      showProjectionControl: false,
      showContextMenu: false
    });
    if (window.__piwAnnot) window.__piwAnnot._aladin = aladin; // solo test (hook e2e)
    // Imagen del usuario incrustada en el cielo. OJO: displayFITS carga el FITS como capa
    // BASE (tapa el mapa del cielo y deja un vacío gris fuera del encuadre). Por eso, cuando
    // termina, movemos el FITS a una capa OVERLAY y restauramos DSS como base: así la imagen
    // queda SOBRE el cielo real y se conserva colocada al hacer zoom/pan.
    try {
      const fitsBlob = annotBuildFitsBlob();
      if (fitsBlob && typeof aladin.displayFITS === "function") {
        const url = URL.createObjectURL(fitsBlob);
        const revoke = () => setTimeout(() => URL.revokeObjectURL(url), 20000);
        aladin.displayFITS(url);
        // displayFITS pone el FITS como capa BASE (tapa el cielo → vacío gris fuera del encuadre).
        // Sondeamos hasta que la base SEA el FITS (blob), lo pasamos a overlay y restauramos DSS
        // como base. Pase lo que pase, forzamos DSS al final para no dejar nunca el vacío gris.
        let tries = 0;
        const iv = setInterval(() => {
          let bid = "";
          try { const b = aladin.getBaseImageLayer(); bid = String((b && (b.rootUrl || b.id || b.name)) || ""); } catch (e) {}
          if (bid.indexOf("blob") >= 0) {
            clearInterval(iv);
            try { aladin.setOverlayImageLayer(aladin.getBaseImageLayer(), "cabraspace-img"); } catch (e) {}
            try { aladin.setImageSurvey("P/DSS2/color"); } catch (e) {}
            revoke();
          } else if (++tries > 30) {           // ~6 s de margen
            clearInterval(iv);
            try { aladin.setImageSurvey("P/DSS2/color"); } catch (e) {} // garantiza el cielo de fondo
            revoke();
          }
        }, 200);
      }
    } catch (e) { /* sin incrustación: seguimos con la huella */ }

    // Huella de la imagen (resalte naranja): esquinas px → cielo.
    const T = annotBuildTransform();
    if (T) {
      const corners = [[0, 0], [img.w, 0], [img.w, img.h], [0, img.h]].map(c => {
        const sSky = annotPxToSky(T, c[0], c[1]);
        return [sSky.ra, sSky.dec];
      });
      const ov = window.A.graphicOverlay({ color: "#ffb347", lineWidth: 2 });
      aladin.addOverlay(ov);
      ov.add(window.A.polygon(corners));
    }
  }
  if (el("btnAnnotSky")) el("btnAnnotSky").addEventListener("click", annotOpenSky);
  if (el("btnAladinClose")) el("btnAladinClose").addEventListener("click", () => {
    const p = el("aladinPanel");
    if (p) p.style.display = "none";
  });

  // Hook de test (solo con ?e2ehook=1, igual que __piwTest en 20).
  if (typeof window !== "undefined" && window.location.search.includes("e2ehook=1")) {
    window.__piwAnnot = {
      annot, annotBuildTransform, annotSkyToPx, annotPxToSky, annotCompute, annotToggle, annotJpegDims, annotWcs,
      annotLoadCatalog, annotRefreshStatus, annotBuildFitsBlob,
      _setWcs: (w) => { state.wcs = w; }   // solo para tests: inyectar una solución astrométrica
    };
  }
})();
