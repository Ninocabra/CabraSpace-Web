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
  cv.addEventListener("pointerdown", (e) => {
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

  window.addEventListener("pointermove", (e) => {
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

  window.addEventListener("pointerup", () => {
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


