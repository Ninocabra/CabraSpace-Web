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


