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

