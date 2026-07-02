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


