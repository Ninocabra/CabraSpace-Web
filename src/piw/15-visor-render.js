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

