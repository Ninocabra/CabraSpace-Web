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
      cropState.rect = null;
      cropUpdateStatus();
      refreshPathBar();
      render();
      const lang = document.documentElement.lang || "es";
      logConsole(lang === "es" ? `Crop aplicado a todo el flujo (${state.activeImage.w}×${state.activeImage.h} px)` : `Crop applied to all workflow images (${state.activeImage.w}×${state.activeImage.h} px)`, "info");
      if (hadWcs) logConsole(lang === "es" ? "El recorte invalidó la solución astrométrica: vuelve a ejecutar Plate Solving antes de PCC." : "Crop invalidated the astrometric solution: re-run Plate Solving before PCC.", "warn");
    });
  }

