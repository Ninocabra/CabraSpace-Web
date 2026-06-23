/* =========================================================================
 * pi-workflow.js — Motor de Procesado y UI de PI Workflow
 *
 * Coordina las operaciones cliente de pre-procesado, estirado, máscaras
 * y mezcla de canales directamente en el navegador.
 * ========================================================================= */

(function () {
  "use strict";

  // --- CONFIGURACIÓN Y ESTADO GLOBAL ---
  let MAX_PREVIEW_DIM = 2000; // Resolución máx. de trabajo (default 2000; ajustable por el selector "Resolución de trabajo", máx 4000). Se aplica al cargar.
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
    return img;
  }
  // IMAGE-MODEL-END

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
    
    // Reverse the scale & translation of the canvas style transform
    // The CSS transform: translate(panX, panY) scale(zoom)
    // The canvas's intrinsic size is cv.width x cv.height, but it's rendered at clientWidth x clientHeight.
    // However, coordinate-wise inside the canvas, the mouse position on the canvas coordinate space (0 to cv.width/height):
    const imgX = (mouseX / rect.width) * cv.width;
    const imgY = (mouseY / rect.height) * cv.height;
    
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
      cropState.rect = null;
      cropUpdateStatus();
      refreshPathBar();
      render();
      const lang = document.documentElement.lang || "es";
      logConsole(lang === "es" ? `Crop aplicado a imagen actual (${cropped.w}×${cropped.h} px)` : `Crop applied to current image (${cropped.w}×${cropped.h} px)`, "info");
      if (hadWcs) logConsole(lang === "es" ? "El recorte invalidó la solución astrométrica: vuelve a ejecutar Plate Solving antes de SPCC." : "Crop invalidated the astrometric solution: re-run Plate Solving before SPCC.", "warn");
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
      cropState.rect = null;
      cropUpdateStatus();
      refreshPathBar();
      render();
      const lang = document.documentElement.lang || "es";
      logConsole(lang === "es" ? `Crop aplicado a todo el flujo (${state.activeImage.w}×${state.activeImage.h} px)` : `Crop applied to all workflow images (${state.activeImage.w}×${state.activeImage.h} px)`, "info");
      if (hadWcs) logConsole(lang === "es" ? "El recorte invalidó la solución astrométrica: vuelve a ejecutar Plate Solving antes de SPCC." : "Crop invalidated the astrometric solution: re-run Plate Solving before SPCC.", "warn");
    });
  }

  // --- PLATE SOLVING CON ASTROMETRY.NET ---
  const ASTROMETRY_API_KEY = "coqpscljnloiluyi";
  // CF-WORKER-BEGIN
  // Proxy CORS para Astrometry.net en producción (Vercel Edge Function).
  // Código y despliegue: vercel-proxy/. Vacío = en producción muestra el mensaje guía.
  let ASTROMETRY_PROXY_URL = "https://astronomy-proxy.vercel.app";
  // CF-WORKER-END

  // Redirige a través del proxy CORS local (puerto 8010) para gestionar OPTIONS y subidas de archivos
  function corsFetch(url, options = {}) {
    // CF-WORKER-BEGIN
    const hostname = window.location.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      const proxyUrl = url.replace("https://nova.astrometry.net", "http://localhost:8010");
      return fetch(proxyUrl, options);
    } else {
      if (ASTROMETRY_PROXY_URL) {
        // Rewrite request URL to point to the Cloudflare Worker
        const proxyUrl = url.replace("https://nova.astrometry.net", ASTROMETRY_PROXY_URL);
        return fetch(proxyUrl, options);
      } else {
        const errMsg = document.documentElement.lang === "es"
          ? "El plate solve en producción requiere configurar ASTROMETRY_PROXY_URL (proxy Vercel). Consulta vercel-proxy/README.md."
          : "Plate solving in production requires configuring ASTROMETRY_PROXY_URL (Vercel proxy). Refer to vercel-proxy/README.md.";
        logConsole(errMsg, "error");
        return Promise.reject(new Error(errMsg));
      }
    }
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
          parity: calibration.parity
        };
        // También en la imagen activa por compatibilidad
        state.activeImage.wcs = state.wcs;
        
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

  // --- Lógica del modelo GraXpert ---
  function applyGraXpert(img, correction, smoothness) {
    // GraXpert web simula una interpolación bicúbica multiescala de muy baja frecuencia
    const w = img.w;
    const h = img.h;
    const result = { w, h, nc: img.nc, isColor: img.isColor, ch: [] };
    const grad = { w, h, nc: img.nc, isColor: img.isColor, ch: [] };
    
    // Estimación bicúbica del fondo
    const coeffs = fitPolynomial2D(img, 2, true);
    
    for (let c = 0; c < img.nc; c++) {
      const src = img.ch[c];
      const dst = new Float32Array(w * h);
      const bgCh = new Float32Array(w * h);
      const coeff = coeffs[c];
      
      // Calcular la media para normalización
      let sum = 0;
      for (let i = 0; i < src.length; i++) sum += src[i];
      const mean = sum / src.length;
      
      for (let y = 0; y < h; y++) {
        const ny = y / h;
        for (let x = 0; x < w; x++) {
          const nx = x / w;
          const idx = y * w + x;
          
          const background = evaluatePolynomial(nx, ny, coeff, 2) * (1 - smoothness * 0.15);
          bgCh[idx] = background;
          
          if (correction === "subtraction") {
            dst[idx] = Math.max(0, src[idx] - background);
          } else {
            const denom = Math.max(0.001, background);
            dst[idx] = Math.max(0, Math.min(1.0, src[idx] / denom)) * mean;
          }
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
    } else if (algo === "graxpert") {
      const corr = el("selGraXpertCorrection").value;
      const smooth = parseFloat(el("sldGraXpertSmooth").value);
      return applyGraXpert(img, corr, smooth);
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
    if (algo === "graxpert") {
      return { corrected: applyGraXpert(srcImg, el("selGraXpertCorrection").value, parseFloat(el("sldGraXpertSmooth").value)), bgCh: null };
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
          const { corrected, bgCh } = await computeGradient(algo, srcImg);
          if (bgCh) {
            state.subtractedGradient = { ch: bgCh, w: corrected.w, h: corrected.h, nc: corrected.nc, isColor: corrected.isColor };
          }
          previewActiveImage(corrected, srcImg, "Background Extraction");
          // Activar estirado automático de pantalla (AutoSTF) para que el resultado lineal no se vea negro
          state.screenStretchMode = true;
          const stfBtn = el("btnToolAutoSTF");
          if (stfBtn) stfBtn.classList.add("active");

          hideLoader();
          render();
          drawHistogram();
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
            { id: "graxpert",    name: "GraXpert (Sim)" },
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
            ? "Comparación lista: 4 algoritmos guardados en Slots 1-4. Pulsa un slot para verlo."
            : "Comparison ready: 4 algorithms saved to Slots 1-4. Click a slot to view it.", "ok");
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
    if (el("btnSeparateRGB")) el("btnSeparateRGB").disabled = !rgbValid;
    
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
    if (el("btnSeparateNB")) el("btnSeparateNB").disabled = !nbValid;

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
    state.calibCompareReady = false;

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
    el("btnGenerateBlend").disabled = false;
    el("btnApplyPostNR").disabled = false;
    { const b = el("btnComparePostNR"); if (b) b.disabled = false; }
    el("btnApplyPostSharp").disabled = false;
    { const b = el("btnComparePostSharp"); if (b) b.disabled = false; }
    el("btnApplyPostCurves").disabled = false;
    el("btnApplyPostColor").disabled = false;

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
    return await window.SASProPyodide.processImageRaw(srcImg, "spcc", {
      catalogStars: stars,
      wcsMeta: { ra: wcsData.ra, dec: wcsData.dec, pixscale: wcsData.pixscale, orientation: wcsData.orientation, parity: wcsData.parity }
    });
  }
  // CALIB-COMPUTE-END

  function runLinearFit() {
    const srcImg = state.stepInputImage || state.activeImage;
    if (!srcImg || !srcImg.isColor) return;
    showLoader("Alineando canales (Linear Fit)...");
    setTimeout(() => {
      try {
        const img = computeLinearFit(srcImg);
        // CALIB-PREVIEW: preview no destructivo (commit en "Aplicar Calibración")
        previewActiveImage(img, srcImg, "Linear Fit");
        render();
        drawHistogram();
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
    setTimeout(() => {
      try {
        const img = computeOptimalTransport(srcImg);
        // CALIB-PREVIEW: preview no destructivo (commit en "Aplicar Calibración")
        previewActiveImage(img, srcImg, "Optimal Transport");
        render();
        drawHistogram();
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
    showLoader(lang === "es" ? "Neutralizando fondo (SetiAstro)..." : "Neutralizing background (SetiAstro)...");
    
    setTimeout(() => {
      try {
        const srcImg = state.stepInputImage || state.activeImage;
        const { img: res, bgVals } = computeBackgroundNeutralizationCalib(srcImg);

        // CALIB-PREVIEW: preview no destructivo (commit en "Aplicar Calibración")
        previewActiveImage(res, srcImg, "Background Neutralization");

        render();
        drawHistogram();

        const bgStr = Array.from(bgVals).map(v => v.toFixed(4)).join(", ");
        logConsole(lang === "es" ? `Fondo detectado (R,G,B): [${bgStr}]` : `Detected background (R,G,B): [${bgStr}]`, "info");
        logConsole(lang === "es" ? "Neutralización de fondo (SetiAstro) completada" : "Background Neutralization (SetiAstro) completed", "info");
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

  // Web-SPCC helper function
  async function runSPCC() {
    if (!state.activeImage) return;
    const lang = document.documentElement.lang || "es";
    const wcsData = state.wcs || state.activeImage.wcs;
    if (!wcsData) {
      logConsole(lang === "es" 
        ? "Error: Web-SPCC requiere que la imagen esté resuelta (Plate Solving) previamente." 
        : "Error: Web-SPCC requires the image to be solved (Plate Solving) first.", "err");
      alert(lang === "es" 
        ? "Por favor, ejecute Plate Solving en la pestaña correspondiente antes de usar SPCC." 
        : "Please run Plate Solving in the corresponding tab before using SPCC.");
      return;
    }
    
    showLoader(lang === "es" ? "Consultando catálogo Gaia DR3 en VizieR..." : "Querying Gaia DR3 catalog on VizieR...");
    
    try {
      const srcImg = state.stepInputImage || state.activeImage;
      const res = await computeSPCCNeutralized(srcImg, wcsData);

      // CALIB-PREVIEW: preview no destructivo (commit en "Aplicar Calibración")
      previewActiveImage(res, srcImg, "SPCC");

      render();
      drawHistogram();

      if (res.extra && res.extra.factors) {
        const k = res.extra.factors;
        logConsole(lang === "es"
          ? `SSSC + fondo neutralizado + SCNR verde. Ganancias Fase 1 (k_R,k_G,k_B): [${k[0].toFixed(4)}, ${k[1].toFixed(4)}, ${k[2].toFixed(4)}]`
          : `SSSC + background neutralized + green SCNR. Stage 1 gains (k_R,k_G,k_B): [${k[0].toFixed(4)}, ${k[1].toFixed(4)}, ${k[2].toFixed(4)}]`,
          "ok"
        );
      } else {
        logConsole(lang === "es" ? "Web-SPCC completado sin cambios de factores." : "Web-SPCC completed without factor changes.", "info");
      }
    } catch (err) {
      logConsole(`Error en Web-SPCC: ${err.message}`, "err");
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
              results.push({ name: "SSSC", img: await computeSPCCNeutralized(srcImg, wcsData) });
            } catch (e) {
              logConsole((lang === "es" ? "SPCC omitido: " : "SPCC skipped: ") + e.message, "warn");
            }
          } else {
            logConsole(lang === "es" ? "SPCC omitido: la imagen no está resuelta (Plate Solving)." : "SPCC skipped: image is not plate-solved.", "warn");
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
  const STELLAR_MODEL_URL = RELEASE_BASE + "deep_sharp_stellar_cnn_AI3_5s.onnx";
  // En la Release solo está el nonstellar radius_2; todas las opciones de radio usan ese modelo.
  const NONSTELLAR_MODEL_URLS = {
    radius_1: RELEASE_BASE + "deep_nonstellar_sharp_cnn_radius_2AI3_5s.onnx",
    radius_2: RELEASE_BASE + "deep_nonstellar_sharp_cnn_radius_2AI3_5s.onnx",
    radius_4: RELEASE_BASE + "deep_nonstellar_sharp_cnn_radius_2AI3_5s.onnx",
    radius_8: RELEASE_BASE + "deep_nonstellar_sharp_cnn_radius_2AI3_5s.onnx"
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
  // han sido movidas al módulo independiente 'onnx-engine.js' para modularidad y reutilización en nox/GraXpert.
  // ONNX-ENGINE-REF-END

  // Event Listener para Deconvolución
  // DECON-COMPUTE-BEGIN
  // Calcula la deconvolución para un algoritmo EXPLÍCITO (cosmic_std | cosmic_ia) sobre srcImg,
  // leyendo los parámetros actuales de la UI. Reutilizado por "Probar" y "Comparar".
  async function computeDeconv(algo, srcImg) {
    const lang = document.documentElement.lang || "es";
    const mode = el("selCcSharpenMode").value;
    const stellarAmt = parseFloat(el("sldCcStellarAmt").value);
    const nsStrength = parseFloat(el("sldCcNsStrength").value);
    const nsAmount = parseFloat(el("sldCcNsAmount").value);
    const removeAb = el("chkCcRemoveAb").checked;
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
        stellarAiCh = _unstretch(await window.OnnxEngine.runOnnxModelTiled(session, stretchedSrc, { tileSize: 256, fixedTile: 256, overlap: 32 }));
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
        nonstellarAiCh = _unstretch(await window.OnnxEngine.runOnnxModelTiled(session, stretchedSrc, { tileSize: 256, fixedTile: 256, overlap: 32 }));
      }
      // ONNX-ENGINE-REF-END
    }

    showLoader(lang === "es" ? "Realizando mezcla final en Pyodide..." : "Performing final blending in Pyodide...");
    const params = { mode, stellar_amt: stellarAmt, ns_strength: nsStrength, ns_amount: nsAmount, remove_aberration: removeAb, stellar_ai: stellarAiCh, nonstellar_ai: nonstellarAiCh };
    return await window.SASProPyodide.processImageRaw(srcImg, "cosmic", params);
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
          if (algo === "cosmic_ia") {
            logConsole(lang === "es" ? "Fallo en Cosmic Clarity IA. Reintentando con Deconvolución Estándar automáticamente..." : "Cosmic Clarity AI failed. Retrying with Standard Deconvolution automatically...", "warn");
            res = await computeDeconv("cosmic_std", srcImg);
          } else {
            throw err;
          }
        }
        // CALIB-PREVIEW: preview no destructivo (commit en "Aplicar Deconvolución")
        previewActiveImage(res, srcImg, "Deconvolution");
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
            { name: "Standard", algo: "cosmic_std" },
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
  function runAutoSTF(img, targetBg, clipSigmas) {
    const n = img.w * img.h;
    
    for (let c = 0; c < img.nc; ++c) {
      const ch = img.ch[c];
      const stats = AutoGHS.medianMAD(ch, n, 200000);
      
      // Calcular punto negro (c0)
      let c0 = stats.median + clipSigmas * stats.sigma;
      if (c0 < 0) c0 = 0;
      if (c0 > stats.median) c0 = stats.median;

      // Rescalar
      const c0Den = (1 - c0) || 1e-6;
      const rescaledCh = new Float32Array(n);
      for (let i = 0; i < n; ++i) {
        const val = (ch[i] - c0) / c0Den;
        rescaledCh[i] = val < 0 ? 0 : (val > 1 ? 1 : val);
      }

      // Calcular nueva mediana tras el punto negro
      const stats2 = AutoGHS.medianMAD(rescaledCh, n, 100000);
      const mPrime = Math.max(0.0001, Math.min(0.9999, stats2.median));

      // Resolver Midtones Balance (m)
      const m = ((targetBg - 1) * mPrime) / (2 * targetBg * mPrime - targetBg - mPrime);
      
      // Aplicar MTF
      if (m > 0 && m < 1) {
        const m1 = m - 1;
        const m2 = 2 * m - 1;
        // LUT-MTF-BEGIN
        const mtfLut = window.LUT.buildLUT(x => {
          const den = m2 * x - m;
          return Math.abs(den) > 1e-12 ? Math.min(1, Math.max(0, (m1 * x) / den)) : x;
        }, 65536);
        img.ch[c] = window.LUT.applyLUT(rescaledCh, mtfLut);
        // LUT-MTF-END
        logConsole(`Canal ${c} estirado con STF: bp = ${c0.toFixed(4)}, m = ${m.toFixed(4)}`, "info");
      }
    }
  }

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

  // NOX-INTEGRATION-BEGIN
  el("btnRunNox").addEventListener("click", () => {
    if (!state.activeImage) {
      logConsole(window.location.pathname.includes("-en.html")
        ? "Please load an image before running nox."
        : "Carga una imagen antes de ejecutar nox.", "err");
      return;
    }

    const runExecution = () => {
      const lang = window.location.pathname.includes("-en.html") ? "en" : "es";
      showLoader(lang === "es" ? "Cargando modelo nox..." : "Loading nox model...");

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

          const starAlgo = el("selStarAlgo") ? el("selStarAlgo").value : "starnet2";
          const runFn = (starAlgo === "nox") ? window.NoxStarRemoval.runNox : window.NoxStarRemoval.runStarNet2;
          const result = await runFn(
            inputImg,
            // Callback para progreso de descarga
            (p) => {
              showLoader(lang === "es"
                ? `Descargando modelo nox: ${(p * 100).toFixed(0)}%`
                : `Downloading nox model: ${(p * 100).toFixed(0)}%`
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
            (el("sldNoxRecover") ? parseFloat(el("sldNoxRecover").value) : 0)
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
            ? `Eliminación de estrellas (nox) completada: creados "${starlessKey}" y "${starsKey}".`
            : `Star removal (nox) completed: created "${starlessKey}" and "${starsKey}".`,
            "info"
          );

          updateMixSourceOptions();
          selectWorkflowKey(starlessKey); // ver el starless de esa fuente
        } catch (err) {
          logConsole(`Error en nox: ${err.message}`, "err");
          console.error(err);
        } finally {
          hideLoader();
        }
      }, 50);
    };

    runExecution();
  });
  // NOX-INTEGRATION-END

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

  // Slider "Recuperar nebulosa" del star split (nox)
  {
    const sldRec = el("sldNoxRecover");
    if (sldRec) sldRec.addEventListener("input", () => {
      const v = el("valNoxRecover");
      if (v) v.textContent = parseFloat(sldRec.value).toFixed(2);
    });
  }

  // STRETCH-COMPARE-BEGIN
  // Motor de estirado reutilizable (Preview y Comparar). No destructivo: clona srcImg y devuelve img.
  // Lee los valores actuales de los sliders de cada algoritmo.
  async function computeStretch(algo, srcImg) {
    const lang = document.documentElement.lang || "es";
    let img = cloneImage(srcImg);
    if (algo === "stf") {
      const bg = parseFloat(el("sldStfBg").value);
      const clip = parseFloat(el("sldStfClip").value);
      runAutoSTF(img, bg, clip);
    } else if (algo === "ghs") {
      const cfg = AutoGHS.defaultConfig();
      cfg.sigmasFromCenter = parseFloat(el("sldGhsSig").value);
      cfg.stretchIntensity = parseFloat(el("sldGhsInt").value);
      cfg.colorMode = img.isColor ? "luminance" : "rgb";
      const res = AutoGHS.process(img.ch, img.w * img.h, img.nc, img.isColor, cfg);
      img.ch = res.channels;
    } else if (algo === "stars") {
      const amt = parseFloat(el("sldStarsStretch").value);
      const asinhLut = window.LUT.buildLUT(x => Math.asinh(amt * x) / Math.asinh(amt), 65536);
      for (let c = 0; c < img.nc; ++c) img.ch[c] = window.LUT.applyLUT(img.ch[c], asinhLut);
    } else if (algo === "statistical_stretch") {
      const tgt = parseFloat(el("sldStretchStatTgt").value);
      const sig = parseFloat(el("sldStretchStatSigma").value);
      const res = await window.SASProPyodide.processImageRaw(img, "statistical_stretch", { target_median: tgt, sigma_clip: sig });
      img = { ch: res.ch, w: res.w, h: res.h, nc: res.nc, isColor: res.isColor };
    } else if (algo === "curves") {
      const lut = window.LUT.buildLUT((x) => curveEval(x), 65536);
      for (let c = 0; c < img.nc; ++c) img.ch[c] = window.LUT.applyLUT(img.ch[c], lut);
    }
    return img;
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
        if (algo === "statistical_stretch") {
          showLoader(lang === "es" ? "Statistical Stretch (Pyodide, puede tardar la 1ª vez)..." : "Statistical Stretch (Pyodide, may take a while first run)...");
        }
        const img = await computeStretch(algo, srcImg);
        logConsole(lang === "es" ? `Estirado aplicado: ${algo}` : `Stretch applied: ${algo}`, "info");

        // Preview NO destructivo sobre la Imagen Inicial; el commit lo hace el botón grande "Aplicar Estirado".
        previewActiveImage(img, srcImg, "Stretch");
        // Tras estirar, desactivar el estirado de pantalla AutoSTF (vemos los datos ya estirados, no doble)
        state.screenStretchMode = false;
        const btnAutoStf = el("btnToolAutoSTF");
        if (btnAutoStf) btnAutoStf.classList.remove("active");
        render();
        drawHistogram();
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
  const DEEPSNR_PROD = RELEASE_BASE + "deepsnr_v2.onnx";
  function resolveDenoiseModel(prodUrl, scratchFile) {
    const host = window.location.hostname;
    return (host === "localhost" || host === "127.0.0.1") ? ("scratch/" + scratchFile) : prodUrl;
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
      const aiS = await window.OnnxEngine.runOnnxModelTiled(session, stretchedSrc, { tileSize: 256, fixedTile: 256, overlap: 32, layout: "NCHW" });
      const ai = piwMtfStretchChans(aiS, 1 - m);
      return blendDenoise(srcImg, ai, parseFloat(el("sldPostCcnrLuma").value));
    }
    if (algo === "deepsnr") {
      showLoader(lang === "es" ? "Cargando DeepSNR..." : "Loading DeepSNR...");
      const url = resolveDenoiseModel(DEEPSNR_PROD, "deepsnr_v2.onnx");
      // DeepSNR tiene ops que WebGPU no ejecuta (Mul broadcast) -> forzar WASM (CPU).
      const session = await window.OnnxEngine.loadSession(url, { executionProviders: ["wasm"] }, (p) => {
        showLoader(lang === "es" ? `Descargando modelo: ${(p * 100).toFixed(0)}%` : `Downloading model: ${(p * 100).toFixed(0)}%`);
      });
      showLoader(lang === "es" ? "Procesando DeepSNR..." : "Processing DeepSNR...");
      const ai = await window.OnnxEngine.runOnnxModelTiled(session, srcImg, { tileSize: 512, fixedTile: 512, overlap: 32, layout: "NHWC" });
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
  function sharpGaussCh(ch, w, h, sigma) {
    return window.Sharpening.gaussianBlur({ ch: [ch], w, h, nc: 1, isColor: false }, sigma).ch[0];
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
    if (algo === "cosmic") {
      // Cosmic Clarity = el mismo sharpen IA de la deconvolución (modelos stellar/nonstellar + estirado).
      return await computeDeconv("cosmic_ia", srcImg);
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
            { name: "Cosmic Clarity", algo: "cosmic" },
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
  el("btnApplyPostCurves").addEventListener("click", () => {
    const srcImg = state.stepInputImage || state.activeImage;
    if (!srcImg) return;

    const lang = document.documentElement.lang || "es";
    showLoader(lang === "es" ? "Aplicando curvas..." : "Applying curves...");

    setTimeout(() => {
      try {
        // Build LUTs for each channel
        const lutK = window.LUT.buildLUT(getCubicSpline(state.curves.K));
        const lutR = window.LUT.buildLUT(getCubicSpline(state.curves.R));
        const lutG = window.LUT.buildLUT(getCubicSpline(state.curves.G));
        const lutB = window.LUT.buildLUT(getCubicSpline(state.curves.B));
        const lutS = window.LUT.buildLUT(getCubicSpline(state.curves.S));

        const w = srcImg.w;
        const h = srcImg.h;
        const nc = srcImg.nc;
        const isColor = srcImg.isColor || nc === 3;
        const size = w * h;

        const dstCh = [];
        for (let c = 0; c < nc; c++) {
          dstCh.push(new Float32Array(size));
        }

        // Helper: clamp and index
        const clampIdx = (val) => {
          let idx = Math.round(val * 65535);
          return idx < 0 ? 0 : (idx > 65535 ? 65535 : idx);
        };

        if (isColor && nc === 3) {
          const rSrc = srcImg.ch[0];
          const gSrc = srcImg.ch[1];
          const bSrc = srcImg.ch[2];

          const rDst = dstCh[0];
          const gDst = dstCh[1];
          const bDst = dstCh[2];

          // Check if saturation spline is modified
          const isSatModified = state.curves.S.some(p => Math.abs(p.x - p.y) > 1e-4);

          for (let i = 0; i < size; i++) {
            let r = rSrc[i];
            let g = gSrc[i];
            let b = bSrc[i];

            // 1. Master/Luminance curve
            r = lutK[clampIdx(r)];
            g = lutK[clampIdx(g)];
            b = lutK[clampIdx(b)];

            // 2. Individual channel curves
            r = lutR[clampIdx(r)];
            g = lutG[clampIdx(g)];
            b = lutB[clampIdx(b)];

            // 3. Saturation curve
            if (isSatModified) {
              // RGB to HSL
              let max = r, min = r;
              if (g > max) max = g;
              if (b > max) max = b;
              if (g < min) min = g;
              if (b < min) min = b;

              let h = 0, s = 0, l = (max + min) / 2;
              if (max !== min) {
                const d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                if (max === r) {
                  h = (g - b) / d + (g < b ? 6 : 0);
                } else if (max === g) {
                  h = (b - r) / d + 2;
                } else {
                  h = (r - g) / d + 4;
                }
                h /= 6;
              }

              // Apply Saturation curve
              s = lutS[clampIdx(s)];

              // HSL to RGB
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
            }

            // Clamp results to [0, 1]
            rDst[i] = r < 0 ? 0 : (r > 1 ? 1 : r);
            gDst[i] = g < 0 ? 0 : (g > 1 ? 1 : g);
            bDst[i] = b < 0 ? 0 : (b > 1 ? 1 : b);
          }
        } else {
          // Grayscale or single channel image
          const srcCh = srcImg.ch[0];
          const dstCh0 = dstCh[0];
          for (let i = 0; i < size; i++) {
            const v = lutK[clampIdx(srcCh[i])];
            dstCh0[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
          }
        }

        commitActiveImage({ ch: dstCh, w, h, nc, isColor }, "Curves", srcImg);

        render();
        refreshPathBar();
        logConsole(
          lang === "es"
            ? "Ajuste de curvas aplicado con éxito."
            : "Curves adjustment applied successfully.",
          "ok"
        );
      } catch (err) {
        logConsole(`Error al aplicar curvas: ${err.message}`, "err");
      } finally {
        hideLoader();
      }
    }, 50);
  });
  // CURVES-END

  // COLOR-WHEEL-BEGIN
  el("btnApplyPostColor").addEventListener("click", () => {
    if (!state.activeImage) return;

    const rMult   = parseFloat(el("sldPostBalanceR").value);
    const gMult   = parseFloat(el("sldPostBalanceG").value);
    const bMult   = parseFloat(el("sldPostBalanceB").value);
    const satMult = parseFloat(el("sldPostBalanceSat").value);
    const doScnr  = !!(el("chkPostBalanceSCNR") && el("chkPostBalanceSCNR").checked);
    const scnrAmt = doScnr ? parseFloat(el("sldPostBalanceSCNR").value) : 0;

    const noRGB = (rMult === 1 && gMult === 1 && bMult === 1);
    const noSat = (satMult === 1);
    if (noRGB && noSat && !doScnr) {
      const lang = document.documentElement.lang || "es";
      logConsole(lang === "es" ? "Balance de color: ajuste neutro, sin cambios." : "Color balance: neutral adjustment, no changes.", "info");
      return;
    }

    const lang = document.documentElement.lang || "es";
    showLoader(lang === "es" ? "Aplicando balance de color..." : "Applying color balance...");

    setTimeout(() => {
      try {
        const srcImg = state.stepInputImage || state.activeImage;
        const img = cloneImage(srcImg);
        const n = img.w * img.h;
        const isColor = img.isColor;

        // 1. Multiplicadores RGB por canal
        const rCh = img.ch[0];
        if (rMult !== 1) {
          for (let i = 0; i < n; ++i) { rCh[i] = rCh[i] * rMult; if (rCh[i] > 1) rCh[i] = 1; else if (rCh[i] < 0) rCh[i] = 0; }
        }
        if (isColor) {
          const gCh = img.ch[1];
          if (gMult !== 1) {
            for (let i = 0; i < n; ++i) { gCh[i] = gCh[i] * gMult; if (gCh[i] > 1) gCh[i] = 1; else if (gCh[i] < 0) gCh[i] = 0; }
          }
          const bCh = img.ch[2];
          if (bMult !== 1) {
            for (let i = 0; i < n; ++i) { bCh[i] = bCh[i] * bMult; if (bCh[i] > 1) bCh[i] = 1; else if (bCh[i] < 0) bCh[i] = 0; }
          }
        }

        // 2. Ajuste de saturación vía HSL
        if (satMult !== 1 && isColor) {
          const rCh = img.ch[0], gCh = img.ch[1], bCh = img.ch[2];
          const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1; if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
          };
          for (let i = 0; i < n; ++i) {
            const rv = rCh[i], gv = gCh[i], bv = bCh[i];
            const mx = Math.max(rv, gv, bv);
            const mn = Math.min(rv, gv, bv);
            const d = mx - mn;
            if (d === 0) continue;
            const l = (mx + mn) / 2;
            const s = d / (l < 0.5 ? mx + mn : 2 - mx - mn);
            const sNew = s * satMult > 1 ? 1 : s * satMult < 0 ? 0 : s * satMult;
            const h = rv === mx ? ((gv - bv) / d + (gv < bv ? 6 : 0)) / 6
                    : gv === mx ? ((bv - rv) / d + 2) / 6
                    :             ((rv - gv) / d + 4) / 6;
            const q2 = l < 0.5 ? l * (1 + sNew) : l + sNew - l * sNew;
            const p2 = 2 * l - q2;
            rCh[i] = hue2rgb(p2, q2, h + 1/3);
            gCh[i] = hue2rgb(p2, q2, h);
            bCh[i] = hue2rgb(p2, q2, h - 1/3);
          }
        }

        // 3. SCNR Green (opcional)
        if (doScnr && isColor) {
          const rCh = img.ch[0], gCh = img.ch[1], bCh = img.ch[2];
          for (let i = 0; i < n; ++i) {
            const limit = (rCh[i] + bCh[i]) / 2;
            if (gCh[i] > limit) gCh[i] = (1 - scnrAmt) * gCh[i] + scnrAmt * limit;
          }
        }

        commitActiveImage(img, "Color Balance", srcImg);
        render(); refreshPathBar();
        logConsole(`Balance de color: R×${rMult.toFixed(3)} G×${gMult.toFixed(3)} B×${bMult.toFixed(3)} Sat×${satMult.toFixed(2)}${doScnr ? ` + SCNR(${(scnrAmt*100).toFixed(0)}%)` : ""}`, "info");
      } catch (err) {
        logConsole(`Error en balance de color: ${err.message}`, "err");
      } finally {
        hideLoader();
      }
    }, 50);
  });
  // COLOR-WHEEL-END

  // Rueda de color en Color Mask
  const wheel = el("maskColorWheel");
  const wheelIndicator = el("maskWheelIndicator");

  wheel.addEventListener("click", (e) => {
    const rect = wheel.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    
    // Obtener ángulo en grados [0, 360]
    let angle = Math.atan2(y, x) * (180 / Math.PI);
    if (angle < 0) angle += 360;
    
    state.selectedHue = Math.round(angle);
    el("sldMaskHue").value = state.selectedHue;
    el("valMaskHue").textContent = state.selectedHue + "°";

    // Mover indicador
    const rad = Math.min(rect.width / 2 - 10, Math.sqrt(x*x + y*y));
    const radAngle = angle * (Math.PI / 180);
    const indX = rect.width / 2 + rad * Math.cos(radAngle);
    const indY = rect.height / 2 + rad * Math.sin(radAngle);
    
    wheelIndicator.style.left = indX + "px";
    wheelIndicator.style.top = indY + "px";
  });

  el("sldMaskHue").addEventListener("input", (e) => {
    state.selectedHue = parseInt(e.target.value, 10);
    el("valMaskHue").textContent = state.selectedHue + "°";
    
    // Mover indicador
    const rect = wheel.getBoundingClientRect();
    const angle = state.selectedHue;
    const rad = rect.width / 2 - 12;
    const radAngle = angle * (Math.PI / 180);
    const indX = rect.width / 2 + rad * Math.cos(radAngle);
    const indY = rect.height / 2 + rad * Math.sin(radAngle);
    
    wheelIndicator.style.left = indX + "px";
    wheelIndicator.style.top = indY + "px";
  });

  // Mostrar u ocultar controles de máscara según tipo seleccionado
  el("selMaskType").addEventListener("change", (e) => {
    const val = e.target.value;
    el("mask-range-controls").style.display = val === "range" ? "block" : "none";
    el("mask-color-controls").style.display = val === "color" ? "block" : "none";
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

  // Función matemática de generación de máscaras
  function generateMaskData() {
    const img = state.activeImage;
    const n = img.w * img.h;
    const type = el("selMaskType").value;
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

  // --- OPERACIONES DE MEZCLA DE CANALES (TAB 3) ---

  // Actualiza los selectores de las capas de mezcla según las imágenes disponibles
  function updateMixSourceOptions() {
    const isEn = window.location.pathname.includes("-en.html");
    const options = [];
    options.push(isEn ? '<option value="none">-- No image --</option>' : '<option value="none">-- Sin imagen --</option>');
    if (state.activeImage) {
      options.push(isEn ? '<option value="active">Active Working Image</option>' : '<option value="active">Imagen de Trabajo Activa</option>');
    }
    if (state.starlessImage) {
      options.push(isEn ? '<option value="starless">Starless Layer (Starless)</option>' : '<option value="starless">Capa Sin Estrellas (Starless)</option>');
    }
    if (state.starsImage) {
      options.push(isEn ? '<option value="stars">Stars Layer (Stars)</option>' : '<option value="stars">Capa de Estrellas (Stars)</option>');
    }

    // Añadir ranuras rellenas
    for (let i = 0; i < 8; ++i) {
      if (state.imageSlots[i]) {
        options.push(isEn ? `<option value="slot-${i}">Memory Slot ${i + 1}</option>` : `<option value="slot-${i}">Slot de Memoria ${i + 1}</option>`);
      }
    }

    const html = options.join("");
    el("selMixSource1").innerHTML = html;
    el("selMixSource2").innerHTML = html;
    el("selMixSource3").innerHTML = html;

    // Valores por defecto inteligentes
    if (state.starlessImage) el("selMixSource1").value = "starless";
    else if (state.activeImage) el("selMixSource1").value = "active";

    if (state.activeImage && !state.starlessImage) el("selMixSource2").value = "active";
    
    if (state.starsImage) el("selMixSource3").value = "stars";
  }

  // Componer y Renderizar Mezcla (Tab 3)
  el("btnGenerateBlend").addEventListener("click", () => {
    showLoader("Componiendo mezcla de canales...");
    setTimeout(() => {
      try {
        const useLayer1 = el("chkMixLayer1").checked;
        const useLayer2 = el("chkMixLayer2").checked;
        const useLayer3 = el("chkMixLayer3").checked;

        const src1Key = el("selMixSource1").value;
        const src2Key = el("selMixSource2").value;
        const src3Key = el("selMixSource3").value;

        const getSourceImage = (key) => {
          if (key === "active") return state.activeImage;
          if (key === "starless") return state.starlessImage;
          if (key === "stars") return state.starsImage;
          if (key.startsWith("slot-")) {
            const idx = parseInt(key.split("-")[1], 10);
            return state.imageSlots[idx];
          }
          return null;
        };

        const img1 = useLayer1 ? getSourceImage(src1Key) : null;
        const img2 = useLayer2 ? getSourceImage(src2Key) : null;
        const img3 = useLayer3 ? getSourceImage(src3Key) : null;

        if (!img1) throw new Error("La Capa 1 es obligatoria y debe tener una imagen seleccionada.");

        const w = img1.w;
        const h = img1.h;
        const n = w * h;

        // Reservar memoria para salida RGB
        const outR = new Float32Array(n);
        const outG = new Float32Array(n);
        const outB = new Float32Array(n);

        // Inicializar con la Capa 1
        const op1 = parseFloat(el("sldMixOpacity1").value);
        for (let i = 0; i < n; ++i) {
          outR[i] = (img1.ch[0][i] || 0) * op1;
          outG[i] = (img1.nc > 1 ? img1.ch[1][i] : img1.ch[0][i]) * op1;
          outB[i] = (img1.nc > 2 ? img1.ch[2][i] : (img1.nc > 1 ? img1.ch[1][i] : img1.ch[0][i])) * op1;
        }

        // Fusión de la Capa 2
        if (img2) {
          const op2 = parseFloat(el("sldMixOpacity2").value);
          const blend2 = el("selMixBlend2").value;
          const r2 = img2.ch[0];
          const g2 = img2.nc > 1 ? img2.ch[1] : img2.ch[0];
          const b2 = img2.nc > 2 ? img2.ch[2] : (img2.nc > 1 ? img2.ch[1] : img2.ch[0]);

          for (let i = 0; i < n; ++i) {
            const vR = (r2[i] || 0) * op2;
            const vG = (g2[i] || 0) * op2;
            const vB = (b2[i] || 0) * op2;

            if (blend2 === "add") {
              outR[i] = Math.min(1, outR[i] + vR);
              outG[i] = Math.min(1, outG[i] + vG);
              outB[i] = Math.min(1, outB[i] + vB);
            } else if (blend2 === "screen") {
              outR[i] = 1 - (1 - outR[i]) * (1 - vR);
              outG[i] = 1 - (1 - outG[i]) * (1 - vG);
              outB[i] = 1 - (1 - outB[i]) * (1 - vB);
            } else if (blend2 === "lighten") {
              outR[i] = Math.max(outR[i], vR);
              outG[i] = Math.max(outG[i], vG);
              outB[i] = Math.max(outB[i], vB);
            } else {
              // Normal (interpolación)
              outR[i] = outR[i] * (1 - op2) + vR;
              outG[i] = outG[i] * (1 - op2) + vG;
              outB[i] = outB[i] * (1 - op2) + vB;
            }
          }
        }

        // Fusión de la Capa 3 (Estrellas)
        if (img3) {
          const op3 = parseFloat(el("sldMixOpacity3").value);
          const blend3 = el("selMixBlend3").value;
          const r3 = img3.ch[0];
          const g3 = img3.nc > 1 ? img3.ch[1] : img3.ch[0];
          const b3 = img3.nc > 2 ? img3.ch[2] : (img3.nc > 1 ? img3.ch[1] : img3.ch[0]);

          for (let i = 0; i < n; ++i) {
            const vR = (r3[i] || 0) * op3;
            const vG = (g3[i] || 0) * op3;
            const vB = (b3[i] || 0) * op3;

            if (blend3 === "add") {
              outR[i] = Math.min(1, outR[i] + vR);
              outG[i] = Math.min(1, outG[i] + vG);
              outB[i] = Math.min(1, outB[i] + vB);
            } else if (blend3 === "screen") {
              outR[i] = 1 - (1 - outR[i]) * (1 - vR);
              outG[i] = 1 - (1 - outG[i]) * (1 - vG);
              outB[i] = 1 - (1 - outB[i]) * (1 - vB);
            } else if (blend3 === "lighten") {
              outR[i] = Math.max(outR[i], vR);
              outG[i] = Math.max(outG[i], vG);
              outB[i] = Math.max(outB[i], vB);
            } else {
              outR[i] = outR[i] * (1 - op3) + vR;
              outG[i] = outG[i] * (1 - op3) + vG;
              outB[i] = outB[i] * (1 - op3) + vB;
            }
          }
        }

        // Reemplazar la imagen activa con la composición (hereda wcs/historial de la capa base).
        commitActiveImage({ ch: [outR, outG, outB], w: w, h: h, nc: 3, isColor: true }, "Blend", img1);

        render();
        drawHistogram();
        refreshPathBar();
        logConsole(`Composición multi-capa generada con éxito`, "info");
      } catch (err) {
        logConsole(`Error al generar mezcla: ${err.message}`, "err");
      } finally {
        hideLoader();
      }
    }, 50);
  });


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
        // Clic derecho: sobreescribir / forzar guardado
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
    if (!state.imageSlots[idx]) return;
    
    // Desmarcar anterior activo
    document.querySelectorAll(".piw-slot-btn").forEach(btn => btn.classList.remove("active-slot"));
    
    state.activeImage = cloneImage(state.imageSlots[idx]);
    state.subtractedGradient = null;
    state.previewGradientMode = false;
    if (state.activeWorkflowKey) {
      state.workflowImages[state.activeWorkflowKey] = state.activeImage;
    }
    const btn = document.querySelector(`.piw-slot-btn[data-slot="${idx + 1}"]`);
    btn.classList.add("active-slot");

    logConsole(`Slot de Imagen ${idx + 1} recuperado al espacio de trabajo`, "info");
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

  function render() {
    // Detect change of activeImage reference
    if (state.activeImage && state.activeImage !== state._lastImgRef) {
      if (state._lastImgRef) {
        state.previousImage = state._lastImgRef;
      }
      state._lastImgRef = state.activeImage;
      
      // Reset A/B viewing toggle and split when a new image operation runs
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
    }

    // Determine which image is active source
    const imgSource = (state.viewingPrevious && state.previousImage) ? state.previousImage : state.activeImage;
    const img = (el("chkStarlessView").checked && state.starlessImage) ? state.starlessImage : imgSource;

    if (!img) {
      const btn = el("btnBigApply");
      if (btn) btn.style.display = "none";
      return;
    }
    updateBigApply();
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

    // Generar imagen final a dibujar
    let id;
    if (state.previewMaskMode && state.activeMask) {
      // Dibujar máscara en escala de grises
      id = new ImageData(img.w, img.h);
      const d = id.data;
      for (let i = 0, p = 0; i < n; ++i, p += 4) {
        const val = Math.round(state.activeMask[i] * 255);
        d[p] = val; d[p+1] = val; d[p+2] = val; d[p+3] = 255;
      }
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
    } else {
      // Dibujar imagen (color o monocromo)
      let channelsToDraw = img.ch;
      if (state.screenStretchMode) {
        try {
          // Estirado de pantalla AutoSTF en modo UNLINKED
          channelsToDraw = applyAutoSTF(img.ch, img.nc, img.isColor, false);
        } catch (e) {
          console.warn("Failed to apply AutoSTF screen stretch:", e);
        }
      }
      id = AutoGHS.channelsToImageData(channelsToDraw, img.w, img.h, img.nc);
    }

    if (state.splitViewMode && state.splitCompareImage) {
      // Renderizar vista dividida A/B
      let compChannelsToDraw = state.splitCompareImage.ch;
      if (state.screenStretchMode) {
        try {
          compChannelsToDraw = applyAutoSTF(state.splitCompareImage.ch, state.splitCompareImage.nc, state.splitCompareImage.isColor, false);
        } catch (e) {
          console.warn("Failed to apply AutoSTF screen stretch to split image:", e);
        }
      }
      const compId = AutoGHS.channelsToImageData(compChannelsToDraw, img.w, img.h, img.nc);
      const splitX = Math.round(img.w * state.splitPercent);
      
      const tempCanvasA = document.createElement("canvas");
      tempCanvasA.width = img.w; tempCanvasA.height = img.h;
      tempCanvasA.getContext("2d").putImageData(id, 0, 0);

      const tempCanvasB = document.createElement("canvas");
      tempCanvasB.width = img.w; tempCanvasB.height = img.h;
      tempCanvasB.getContext("2d").putImageData(compId, 0, 0);

      // Dibujar porciones
      ctx.drawImage(tempCanvasA, 0, 0, splitX, img.h, 0, 0, splitX, img.h);
      ctx.drawImage(tempCanvasB, splitX, 0, img.w - splitX, img.h, splitX, 0, img.w - splitX, img.h);
      
      // Mostrar y posicionar el slider de cortinilla
      const containerRect = container.getBoundingClientRect();
      const splitSlider = el("piwSplitSlider");
      splitSlider.style.display = "block";
      splitSlider.style.left = (state.splitPercent * containerRect.width) + "px";
    } else {
      ctx.putImageData(id, 0, 0);
      el("piwSplitSlider").style.display = "none";
    }

    // Draw crop overlay if a selection exists
    if (cropState.rect) {
      drawCropOverlay(ctx, cropState.rect);
    }
  }

  // Dibujar Histograma SVG
  function drawHistogram() {
    const img = (el("chkStarlessView").checked && state.starlessImage) ? state.starlessImage : state.activeImage;
    if (!img) return;

    const n = img.w * img.h;
    const bins = new Uint32Array(256).fill(0);

    // Calcular distribución de luminancia
    const lum = new Float32Array(n);
    if (img.isColor) {
      for (let i = 0; i < n; ++i) lum[i] = wl[0]*img.ch[0][i] + wl[1]*img.ch[1][i] + wl[2]*img.ch[2][i];
    } else {
      lum.set(img.ch[0]);
    }

    for (let i = 0; i < n; ++i) {
      const idx = Math.min(255, Math.max(0, Math.floor(lum[i] * 255)));
      bins[idx]++;
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
  function curveEval(x) {
    const P = stretchPoints;
    const last = P.length - 1;
    if (x <= P[0][0]) return P[0][1];
    if (x >= P[last][0]) return P[last][1];
    let i = 0;
    while (i < last && x > P[i + 1][0]) i++;
    const x0 = P[i][0], y0 = P[i][1], x1 = P[i + 1][0], y1 = P[i + 1][1];
    const h = x1 - x0;
    if (h <= 1e-9) return y0;
    const sec = (a, b) => (P[b][1] - P[a][1]) / Math.max(1e-9, P[b][0] - P[a][0]);
    const s = sec(i, i + 1);
    let m0 = (i > 0) ? (sec(i - 1, i) + s) / 2 : s;
    let m1 = (i < last - 1) ? (s + sec(i + 1, i + 2)) / 2 : s;
    if (s === 0) { m0 = 0; m1 = 0; } else {
      if (m0 / s < 0) m0 = 0; if (m1 / s < 0) m1 = 0;
      const a = m0 / s, b = m1 / s;
      if (a * a + b * b > 9) { const tau = 3 / Math.sqrt(a * a + b * b); m0 = tau * a * s; m1 = tau * b * s; }
    }
    const t = (x - x0) / h, t2 = t * t, t3 = t2 * t;
    let v = (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m1;
    return v < 0 ? 0 : (v > 1 ? 1 : v);
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
    svg.addEventListener("mousedown", (ev) => {
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
    window.addEventListener("mousemove", (ev) => {
      if (dragIdx < 0) return;
      const [x, y] = toNorm(ev);
      const isEnd = dragIdx === 0 || dragIdx === stretchPoints.length - 1;
      const px = isEnd ? stretchPoints[dragIdx][0]
        : Math.max(stretchPoints[dragIdx - 1][0] + 0.005, Math.min(stretchPoints[dragIdx + 1][0] - 0.005, x));
      stretchPoints[dragIdx] = [px, y];
      drawStretchCurve();
    });
    window.addEventListener("mouseup", () => { dragIdx = -1; });
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
    const parentWidth = container.clientWidth;
    const parentHeight = container.clientHeight;
    
    const scaleX = parentWidth / state.activeImage.w;
    const scaleY = parentHeight / state.activeImage.h;
    
    state.zoom = Math.min(scaleX, scaleY) * 0.95;
    state.panX = 0;
    state.panY = 0;
    updateTransform();
  }

  function updateTransform() {
    cv.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  }

  // Zoom de la rueda del ratón
  container.addEventListener("wheel", (e) => {
    if (!state.activeImage) return;
    e.preventDefault();
    const zoomFactor = 1.15;
    if (e.deltaY < 0) {
      state.zoom = Math.min(15, state.zoom * zoomFactor);
    } else {
      state.zoom = Math.max(0.2, state.zoom / zoomFactor);
    }
    updateTransform();
  }, { passive: false });

  // Paneo y Crop con arrastre del ratón
  cv.addEventListener("mousedown", (e) => {
    if (!state.activeImage) return;
    
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

  window.addEventListener("mousemove", (e) => {
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

  window.addEventListener("mouseup", () => {
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
    state.zoom = 1;
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

  // Toggle A/B (Vista Alternada)
  el("btnToolToggleAB").addEventListener("click", () => {
    const lang = document.documentElement.lang || "es";
    if (!state.previousImage) {
      logConsole(lang === "es" ? "No hay imagen anterior para comparar" : "No previous image to compare", "err");
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
      logConsole(lang === "es" ? "Mostrando imagen anterior (A)" : "Showing previous image (A)", "info");
    } else {
      el("btnToolToggleAB").classList.remove("active");
      el("btnToolToggleAB").textContent = "Toggle A/B (B)";
      logConsole(lang === "es" ? "Mostrando imagen activa (B)" : "Showing active image (B)", "info");
    }
    render();
  });

  // Toggle Cortinilla A/B (Split A/B)
  el("btnToolSplitView").addEventListener("click", () => {
    const lang = document.documentElement.lang || "es";
    if (!state.previousImage) {
      logConsole(lang === "es" ? "No hay imagen anterior para comparar" : "No previous image to compare", "err");
      return;
    }
    state.splitViewMode = !state.splitViewMode;
    
    if (state.splitViewMode) {
      el("btnToolSplitView").classList.add("active");
      state.splitCompareImage = state.previousImage;
      
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

  // Arrastrar Cortinilla Split View
  const splitSlider = el("piwSplitSlider");
  splitSlider.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    state.isDraggingSplit = true;
  });

  window.addEventListener("mousemove", (e) => {
    if (state.isDraggingSplit) {
      const rect = container.getBoundingClientRect();
      const posX = e.clientX - rect.left;
      state.splitPercent = Math.max(0.01, Math.min(0.99, posX / rect.width));
      render();
    }
  });

  window.addEventListener("mouseup", () => {
    state.isDraggingSplit = false;
  });


  // --- CAMBIO DE PESTAÑAS (TABS) ---
  document.querySelectorAll(".piw-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".piw-tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".piw-tab-content").forEach(c => c.classList.remove("active"));

      btn.classList.add("active");
      el(btn.getAttribute("data-tab")).classList.add("active");
      updateBigApply();
    });
  });

  // --- EXPORTAR PNG ---
  el("btnDownloadPNG").addEventListener("click", () => {
    if (!state.activeImage) return;
    cv.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); 
      a.download = "PI_Workflow_Final.png"; 
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      logConsole("Imagen final exportada y descargada como PNG", "info");
    }, "image/png");
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
    { s: "sldStfBg", v: "valStfBg", p: 2 },
    { s: "sldStfClip", v: "valStfClip", p: 2 },
    { s: "sldGhsSig", v: "valGhsSig", p: 2 },
    { s: "sldGhsInt", v: "valGhsInt", p: 2 },
    { s: "sldStarsStretch", v: "valStarsStretch", p: 2 },
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
    { s: "sldPostGraXpertStrength", v: "valPostGraXpertStrength", p: 2 }
  ];

  dynamicSliders.forEach(({ s, v, p }) => {
    const sld = el(s);
    const val = el(v);
    if (sld && val) {
      sld.addEventListener("input", () => {
        val.textContent = parseFloat(sld.value).toFixed(p);
      });
    }
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
      btnApplyPostCurves: "Las curvas interactivas son un mockup de diseño. Use procesos activos como STF o GHS para estirar.",
      btnPostFameNext: "El enmascaramiento FAME requiere el script de PixInsight local.",
      btnPostFameUndo: "El enmascaramiento FAME requiere el script de PixInsight local.",
      btnPostFameReset: "El enmascaramiento FAME requiere el script de PixInsight local.",
      cardSPCC: "SSSC: calibración de color por estrellas (Gaia DR3, respuesta dependiente del color) + neutralización de fondo + SCNR verde. Requiere Plate Solving.",
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
      btnApplyPostCurves: "Interactive curves are a design mockup. Use active processes like STF or GHS to stretch.",
      btnPostFameNext: "FAME masking requires the local PixInsight script.",
      btnPostFameUndo: "FAME masking requires the local PixInsight script.",
      btnPostFameReset: "FAME masking requires the local PixInsight script.",
      cardSPCC: "SSSC: star-based color calibration (Gaia DR3, color-dependent response) + background neutralization + green SCNR. Requires Plate Solving.",
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
    graxpert: "gradient-graxpert-controls",
    graxpert_ia: "gradient-graxpert-controls"
  });

  setupDropdownToggle("selDeconAlgo", {
    cosmic_std: "decon-cosmic-controls",
    cosmic_ia: "decon-cosmic-controls"
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
    dse: "post-sharp-dse-controls",
    cosmic: "post-sharp-cosmic-controls"
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
        const isCollapsed = section.classList.contains("collapsed");
        if (isCollapsed) {
          // Descolapsar esta sección y colapsar todas las demás
          document.querySelectorAll(".piw-section").forEach(s => s.classList.add("collapsed"));
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
        await SASProPyodide.init();
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
          const result = await SASProPyodide.processImageFile(file, algo, params);
          
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
          logConsole(`Error: ${err.message}`, "err");
        }
      }
    });
  }

  // Desactivar tarjetas e inicializar comportamiento interactivo para botones y tarjetas mock
  const mockButtons = [
    "btnPostFameNext", "btnPostFameUndo", "btnPostFameReset"
  ];
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
  function getCubicSpline(points) {
    const n = points.length;
    if (n < 2) return (x) => 0;
    if (n === 2) {
      const p0 = points[0], p1 = points[1];
      return (x) => p0.y + (x - p0.x) * (p1.y - p0.y) / ((p1.x - p0.x) || 1e-6);
    }
    
    const dx = [];
    const dy = [];
    const ms = [];
    for (let i = 0; i < n - 1; i++) {
      dx[i] = points[i+1].x - points[i].x;
      dy[i] = points[i+1].y - points[i].y;
      ms[i] = dy[i] / (dx[i] || 1e-6);
    }
    
    const ds = [];
    ds[0] = ms[0];
    ds[n-1] = ms[n-2];
    for (let i = 1; i < n - 1; i++) {
      const m0 = ms[i-1];
      const m1 = ms[i];
      if (m0 * m1 <= 0) {
        ds[i] = 0;
      } else {
        ds[i] = 2 * m0 * m1 / (m0 + m1);
      }
    }
    
    return function(x) {
      if (x <= points[0].x) return points[0].y;
      if (x >= points[n-1].x) return points[n-1].y;
      
      let idx = 0;
      for (let i = 0; i < n - 1; i++) {
        if (x >= points[i].x && x <= points[i+1].x) {
          idx = i;
          break;
        }
      }
      
      const x0 = points[idx].x;
      const x1 = points[idx+1].x;
      const h = x1 - x0;
      const t = (x - x0) / (h || 1e-6);
      
      const a = points[idx].y;
      const b = h * ds[idx];
      const c = 3 * (points[idx+1].y - points[idx].y) - h * (2 * ds[idx] + ds[idx+1]);
      const d = 2 * (points[idx].y - points[idx+1].y) + h * (ds[idx] + ds[idx+1]);
      
      return a + b * t + c * t * t + d * t * t * t;
    };
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

    curvesCv.addEventListener("mousedown", (e) => {
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
          }
        }
      }
    });

    curvesCv.addEventListener("contextmenu", (e) => e.preventDefault());

    curvesCv.addEventListener("mousemove", (e) => {
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
      } else {
        const ptIdx = findPointIndex(coords);
        if (ptIdx !== hoveredCurvePtIdx) {
          hoveredCurvePtIdx = ptIdx;
          drawCurvesWidget();
        }
      }
    });

    window.addEventListener("mouseup", () => {
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
    
    cbCv.addEventListener("mousedown", (e) => {
      e.preventDefault();
      isDraggingCb = true;
      updateCbAnchor(e.clientX, e.clientY);
    });
    
    window.addEventListener("mousemove", (e) => {
      if (isDraggingCb) {
        updateCbAnchor(e.clientX, e.clientY);
      }
    });
    
    window.addEventListener("mouseup", () => {
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
    
    const activeSection = document.querySelector(".piw-section:not(.collapsed)");
    if (!activeSection) {
      btn.style.display = "none";
      return;
    }
    
    const titleEl = activeSection.querySelector(".piw-section-title");
    const titleText = titleEl ? titleEl.textContent.trim().toLowerCase() : "";
    const id = activeSection.id;
    
    let action = null;
    let btnText = "Aplicar";
    const lang = document.documentElement.lang || "es";

    const commitPreview = () => {
      if (state.activeImage) {
        state.stepInputImage = cloneImage(state.activeImage);
        if (state.activeWorkflowKey) {
          state.workflowImages[state.activeWorkflowKey] = state.activeImage;
        }
        logConsole(lang === "es" ? "Cambios aplicados y guardados en el flujo" : "Changes saved and committed to workflow", "ok");
        updateBigApply();
      }
    };
    
    if (id === "sectionCrop" || titleText.includes("crop") || titleText.includes("recorte")) {
      const applyCropBtn = el("btnCropApplyCurrent");
      if (applyCropBtn && !applyCropBtn.disabled) {
        action = () => {
          applyCropBtn.click();
          setTimeout(commitPreview, 100);
        };
        btnText = lang === "es" ? "Recortar" : "Crop";
      }
    } else if (id === "sectionSolve" || titleText.includes("solve")) {
      action = () => el("btnSolveImage")?.click();
      btnText = lang === "es" ? "Resolver" : "Solve";
    } else if (id === "sectionGradient" || titleText.includes("gradient") || titleText.includes("gradiente")) {
      action = () => {
        commitPreview();
      };
      btnText = lang === "es" ? "Aplicar Gradiente" : "Apply Gradient";
    } else if (titleText.includes("calibration") || titleText.includes("calibración")) {
      const activeCard = activeSection.querySelector(".piw-action-card.active-cc");
      // Botón activo si hay un método previsualizado (card) o si se hizo "Comparar Métodos"
      // (para poder cargar un slot y aplicarlo).
      if (activeCard || state.calibCompareReady) {
        action = () => {
          commitPreview();
        };
        btnText = lang === "es" ? "Aplicar Calibración" : "Apply Calibration";
      }
    } else if (titleText.includes("deconvolución") || titleText.includes("deconvolution")) {
      action = () => {
        commitPreview();
      };
      btnText = lang === "es" ? "Aplicar Deconvolución" : "Apply Deconvolve";
    } else if (titleText.includes("estirado") || titleText.includes("stretching")) {
      action = () => {
        commitPreview();
      };
      btnText = lang === "es" ? "Aplicar Estirado" : "Apply Stretch";
    } else if (titleText.includes("ruido") || titleText.includes("noise")) {
      action = () => {
        commitPreview();
      };
      btnText = lang === "es" ? "Aplicar Reducción" : "Apply Denoise";
    } else if (titleText.includes("enfoque") || titleText.includes("sharp")) {
      action = () => {
        commitPreview();
      };
      btnText = lang === "es" ? "Aplicar Enfoque" : "Apply Sharpen";
    } else if (titleText.includes("balance") || titleText.includes("color balance")) {
      action = () => {
        commitPreview();
      };
      btnText = lang === "es" ? "Aplicar Balance" : "Apply Balance";
    } else if (titleText.includes("curves") || titleText.includes("curvas")) {
      action = () => {
        commitPreview();
      };
      btnText = lang === "es" ? "Aplicar Curvas" : "Apply Curves";
    } else if (titleText.includes("scnr") || titleText.includes("verde")) {
      action = () => {
        commitPreview();
      };
      btnText = lang === "es" ? "Aplicar SCNR" : "Apply SCNR";
    } else if (titleText.includes("máscaras") || titleText.includes("mask")) {
      action = () => {
        commitPreview();
      };
      btnText = lang === "es" ? "Guardar Máscara" : "Save Mask";
    } else if (titleText.includes("saturación") || titleText.includes("saturation")) {
      action = () => {
        commitPreview();
      };
      btnText = lang === "es" ? "Aplicar Saturación" : "Apply Saturation";
    } else if (id === "sectionSaspro" || titleText.includes("sas pro")) {
      action = () => {
        commitPreview();
      };
      btnText = lang === "es" ? "Aplicar SASPro" : "Apply SASPro";
    }

    if (action) {
      btn.style.display = "block";
      btn.textContent = btnText;
      
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener("click", action);
    } else {
      btn.style.display = "none";
    }
  }
  
  // Exponer a ámbito global/del módulo para que las tarjetas de calibración puedan actualizar el botón
  window.updateBigApply = updateBigApply;

  updateBigApply();

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
      getViewingPrevious: () => state.viewingPrevious,
      getSplitViewMode: () => state.splitViewMode,
      getSplitPercent: () => state.splitPercent,
      refreshPathBar: () => { refreshPathBar(); },
      selectWorkflowKey: (key) => { selectWorkflowKey(key); },
      getCurves: () => state.curves,
      setCurves: (curves) => { state.curves = curves; drawCurvesWidget(); },
      // CF-WORKER-BEGIN
      setAstrometryProxyUrl: (url) => { ASTROMETRY_PROXY_URL = url; }
      // CF-WORKER-END
    };
  }
  // E2E-HOOK-END

})();
