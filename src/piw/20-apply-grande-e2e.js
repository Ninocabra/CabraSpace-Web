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
    
    const activeSection = document.querySelector(".piw-section:not(.collapsed)");
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
      saspro:      { es: "Aplicar SASPro",       en: "Apply SASPro" }
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

