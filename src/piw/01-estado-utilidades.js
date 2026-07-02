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

