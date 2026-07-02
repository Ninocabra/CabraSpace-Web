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

