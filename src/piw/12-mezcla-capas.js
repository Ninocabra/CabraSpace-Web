  // --- MEZCLA DE CAPAS ESTILO PHOTOSHOP (TAB 3, drag & drop) ---
  // MIX-DND-BEGIN
  // Pila de capas: índice 0 = ARRIBA (se funde encima). Cada capa: { key, blend, opacity, visible }.
  if (!state.mixLayers) state.mixLayers = [];

  function mixSourceImage(key) {
    if (!key) return null;
    if (key.indexOf("wf-") === 0) return state.workflowImages[key.slice(3)];
    if (key === "starless") return state.starlessImage;
    if (key === "stars") return state.starsImage;
    if (key === "active") return state.activeImage;
    if (key.indexOf("slot-") === 0) return state.imageSlots[parseInt(key.slice(5), 10)];
    return null;
  }
  function mixLabelForKey(key) {
    if (key.indexOf("wf-") === 0) return key.slice(3);
    if (key === "starless") return "Starless";
    if (key === "stars") return "Stars";
    if (key === "active") return (document.documentElement.lang === "es" ? "Activa" : "Active");
    if (key.indexOf("slot-") === 0) return "Slot " + (parseInt(key.slice(5), 10) + 1);
    return key;
  }
  function mixAvailableSources() {
    // SOLO las imágenes del flujo (RGB, Starless RGB, Stars RGB, H/O/S, Final…). La paleta con
    // starless/stars/activa/slots duplicaba fuentes y hacía el sistema confuso e ininteligible.
    return Object.keys(state.workflowImages || {}).map(k => "wf-" + k);
  }

  // Añade una capa nueva desde una fuente (arriba de la pila). Usado por drag (ratón) y tap (táctil).
  function addMixLayer(key) {
    if (!key) return;
    const isBase = state.mixLayers.length === 0;
    state.mixLayers.unshift({ key: key, blend: isBase ? "normal" : "screen", opacity: 1.0, visible: true });
    renderMixStack(); mixRefreshPreview();
  }
  // Mueve una capa arriba/abajo en la pila (reordenar sin arrastrar → táctil).
  function moveMixLayer(idx, dir) {
    const to = idx + dir;
    if (to < 0 || to >= state.mixLayers.length) return;
    const m = state.mixLayers.splice(idx, 1)[0];
    state.mixLayers.splice(to, 0, m);
    renderMixStack(); mixRefreshPreview();
  }

  // Reconstruye la paleta de etiquetas (arrastrables con ratón, y con TAP para añadir en táctil).
  function updateMixSourceOptions() {
    const pal = el("mixPalette");
    if (!pal) return;
    const isEn = document.documentElement.lang !== "es";
    pal.innerHTML = "";
    const sources = mixAvailableSources();
    if (sources.length === 0) {
      pal.innerHTML = '<span class="piw-mix-empty">' + (isEn ? "Load images or separate stars first…" : "Carga imágenes o separa estrellas…") + '</span>';
    }
    sources.forEach((key) => {
      const chip = document.createElement("div");
      chip.className = "piw-mix-chip";
      chip.textContent = mixLabelForKey(key);
      chip.title = isEn ? "Tap or drag to add as a layer" : "Toca o arrastra para añadir como capa";
      chip.setAttribute("draggable", "true");
      chip.dataset.key = key;
      chip.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/mixkey", key); e.dataTransfer.effectAllowed = "copy"; chip.classList.add("dragging"); });
      chip.addEventListener("dragend", () => chip.classList.remove("dragging"));
      chip.addEventListener("click", () => addMixLayer(key)); // tap para añadir (táctil + ratón)
      pal.appendChild(chip);
    });
    renderMixStack();
  }

  const MIX_BLENDS = [
    { v: "normal", es: "Normal", en: "Normal" },
    { v: "screen", es: "Pantalla (Screen)", en: "Screen" },
    { v: "add", es: "Aditiva (Add)", en: "Add" },
    { v: "lighten", es: "Aclarar (Lighten)", en: "Lighten" }
  ];

  function renderMixStack() {
    const stack = el("mixStack");
    if (!stack) return;
    const isEn = document.documentElement.lang !== "es";
    const layers = state.mixLayers;
    stack.innerHTML = "";
    if (!layers.length) {
      stack.innerHTML = '<div class="piw-mix-empty">' + (isEn ? "Drag an image here to start" : "Arrastra aquí una imagen para empezar") + '</div>';
    }
    layers.forEach((L, idx) => {
      const isBase = (idx === layers.length - 1);
      const row = document.createElement("div");
      row.className = "piw-mix-layer-row";
      row.setAttribute("draggable", "true"); // arrastre para reordenar (ratón)
      row.dataset.idx = String(idx);

      // --- Línea 1: grip · ojo · nombre · ▲ ▼ · ✕ ---
      const top = document.createElement("div"); top.className = "mix-row-top";
      const grip = document.createElement("span"); grip.className = "mix-grip"; grip.textContent = "⠿";
      const eye = document.createElement("button");
      eye.className = "mix-eye" + (L.visible ? "" : " off"); eye.textContent = L.visible ? "👁" : "▫"; eye.title = isEn ? "Show/Hide" : "Ver/Ocultar";
      eye.addEventListener("click", (e) => { e.stopPropagation(); L.visible = !L.visible; renderMixStack(); mixRefreshPreview(); });
      const name = document.createElement("span"); name.className = "mix-name"; name.textContent = mixLabelForKey(L.key) + (isBase ? " · base" : "");
      const up = document.createElement("button"); up.className = "mix-move"; up.textContent = "▲"; up.title = isEn ? "Move up" : "Subir"; up.disabled = idx === 0;
      up.addEventListener("click", (e) => { e.stopPropagation(); moveMixLayer(idx, -1); });
      const down = document.createElement("button"); down.className = "mix-move"; down.textContent = "▼"; down.title = isEn ? "Move down" : "Bajar"; down.disabled = idx === layers.length - 1;
      down.addEventListener("click", (e) => { e.stopPropagation(); moveMixLayer(idx, 1); });
      const del = document.createElement("button"); del.className = "mix-del"; del.textContent = "✕"; del.title = isEn ? "Remove" : "Quitar";
      del.addEventListener("click", (e) => { e.stopPropagation(); state.mixLayers.splice(idx, 1); renderMixStack(); mixRefreshPreview(); });
      top.appendChild(grip); top.appendChild(eye); top.appendChild(name); top.appendChild(up); top.appendChild(down); top.appendChild(del);

      // --- Línea 2: modo de fusión + slider de opacidad ---
      const bottom = document.createElement("div"); bottom.className = "mix-row-bottom";
      const blend = document.createElement("select"); blend.className = "mix-blend";
      MIX_BLENDS.forEach(b => { const o = document.createElement("option"); o.value = b.v; o.textContent = isEn ? b.en : b.es; if (b.v === L.blend) o.selected = true; blend.appendChild(o); });
      blend.disabled = isBase; // la capa base es el fondo (sin modo de fusión)
      blend.addEventListener("click", (e) => e.stopPropagation());
      blend.addEventListener("change", (e) => { L.blend = e.target.value; mixRefreshPreview(); });
      const opWrap = document.createElement("label"); opWrap.className = "mix-op-wrap"; opWrap.title = isEn ? "Opacity" : "Opacidad";
      const opVal = document.createElement("span"); opVal.className = "mix-op"; opVal.textContent = Math.round(L.opacity * 100) + "%";
      const opSld = document.createElement("input"); opSld.type = "range"; opSld.className = "mix-op-slider"; opSld.min = "0"; opSld.max = "1"; opSld.step = "0.05"; opSld.value = String(L.opacity);
      opSld.addEventListener("click", (e) => e.stopPropagation());
      opSld.addEventListener("input", (e) => { L.opacity = parseFloat(e.target.value); opVal.textContent = Math.round(L.opacity * 100) + "%"; mixRefreshPreview(); });
      opWrap.appendChild(opSld); opWrap.appendChild(opVal);
      bottom.appendChild(blend); bottom.appendChild(opWrap);

      // Reordenar por arrastre dentro de la pila (ratón; en táctil se usan ▲▼)
      row.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/mixlayeridx", String(idx)); e.dataTransfer.effectAllowed = "move"; row.classList.add("dragging"); });
      row.addEventListener("dragend", () => { row.classList.remove("dragging"); Array.from(stack.children).forEach(c => c.classList.remove("drop-before", "drop-after")); });
      row.addEventListener("dragover", (e) => {
        if (Array.from(e.dataTransfer.types).indexOf("text/mixlayeridx") === -1) return;
        e.preventDefault();
        const rect = row.getBoundingClientRect(); const after = (e.clientY - rect.top) > rect.height / 2;
        row.classList.toggle("drop-after", after); row.classList.toggle("drop-before", !after);
      });
      row.addEventListener("dragleave", () => row.classList.remove("drop-before", "drop-after"));
      row.addEventListener("drop", (e) => {
        const from = parseInt(e.dataTransfer.getData("text/mixlayeridx"), 10);
        if (isNaN(from)) return;
        e.preventDefault(); e.stopPropagation();
        const rect = row.getBoundingClientRect(); const after = (e.clientY - rect.top) > rect.height / 2;
        let to = idx + (after ? 1 : 0);
        const moved = state.mixLayers.splice(from, 1)[0];
        if (from < to) to--;
        state.mixLayers.splice(to, 0, moved);
        renderMixStack(); mixRefreshPreview();
      });
      row.appendChild(top); row.appendChild(bottom);
      stack.appendChild(row);
    });
    const btn = el("btnGenerateBlend");
    if (btn) btn.disabled = state.mixLayers.filter(L => L.visible).length === 0;
  }

  // Zona de soltado de la pila: añadir una capa nueva desde la paleta (arriba del todo).
  {
    const stack = el("mixStack");
    if (stack) {
      stack.addEventListener("dragover", (e) => {
        if (Array.from(e.dataTransfer.types).indexOf("text/mixkey") === -1) return;
        e.preventDefault(); stack.classList.add("drop-hover");
      });
      stack.addEventListener("dragleave", () => stack.classList.remove("drop-hover"));
      stack.addEventListener("drop", (e) => {
        stack.classList.remove("drop-hover");
        const key = e.dataTransfer.getData("text/mixkey");
        if (!key) return;
        e.preventDefault();
        addMixLayer(key);
      });
    }
  }

  function mixBlendPix(base, top, mode) {
    if (mode === "screen") return 1 - (1 - base) * (1 - top);
    if (mode === "add") { const v = base + top; return v > 1 ? 1 : v; }
    if (mode === "lighten") return base > top ? base : top;
    return top; // normal
  }
  // Compone la pila (fondo→arriba). La opacidad interpola entre lo de debajo y el resultado fundido.
  function composeMixImage() {
    const visible = state.mixLayers.filter(L => L.visible);
    if (!visible.length) return null;
    const ordered = visible.slice().reverse(); // [fondo … arriba]
    const baseImg = mixSourceImage(ordered[0].key);
    if (!baseImg) return null;
    const w = baseImg.w, h = baseImg.h, n = w * h;
    const chans = (img) => [img.ch[0], img.nc > 1 ? img.ch[1] : img.ch[0], img.nc > 2 ? img.ch[2] : (img.nc > 1 ? img.ch[1] : img.ch[0])];
    const outR = new Float32Array(n), outG = new Float32Array(n), outB = new Float32Array(n);
    { const [r, g, b] = chans(baseImg); const op = ordered[0].opacity; for (let i = 0; i < n; i++) { outR[i] = r[i] * op; outG[i] = g[i] * op; outB[i] = b[i] * op; } }
    for (let li = 1; li < ordered.length; li++) {
      const L = ordered[li]; const img = mixSourceImage(L.key);
      if (!img || img.w !== w || img.h !== h) { logConsole((document.documentElement.lang === "es" ? "Capa omitida (tamaño distinto): " : "Layer skipped (size mismatch): ") + mixLabelForKey(L.key), "warn"); continue; }
      const [r, g, b] = chans(img); const op = L.opacity, mode = L.blend;
      for (let i = 0; i < n; i++) {
        const br = outR[i], bg = outG[i], bb = outB[i];
        outR[i] = br * (1 - op) + mixBlendPix(br, r[i], mode) * op;
        outG[i] = bg * (1 - op) + mixBlendPix(bg, g[i], mode) * op;
        outB[i] = bb * (1 - op) + mixBlendPix(bb, b[i], mode) * op;
      }
    }
    for (let i = 0; i < n; i++) { outR[i] = outR[i] < 0 ? 0 : (outR[i] > 1 ? 1 : outR[i]); outG[i] = outG[i] < 0 ? 0 : (outG[i] > 1 ? 1 : outG[i]); outB[i] = outB[i] < 0 ? 0 : (outB[i] > 1 ? 1 : outB[i]); }
    return { ch: [outR, outG, outB], w, h, nc: 3, isColor: true, wcs: baseImg.wcs };
  }

  // Preview en vivo de la mezcla (si el checkbox está marcado). No destructivo.
  function mixRefreshPreview() {
    const chk = el("chkMixPreview");
    if (!chk || !chk.checked) return;
    const img = composeMixImage();
    if (img) { previewActiveImage(img, state.stepInputImage || state.activeImage, "Blend"); state.screenStretchMode = false; render(); drawHistogram(); }
  }

  if (el("chkMixPreview")) {
    el("chkMixPreview").addEventListener("change", () => {
      if (el("chkMixPreview").checked) mixRefreshPreview();
      else if (state.stepInputImage) { state.activeImage = state.stepInputImage; render(); }
    });
  }

  if (el("btnGenerateBlend")) {
    el("btnGenerateBlend").addEventListener("click", () => {
      const lang = document.documentElement.lang || "es";
      showLoader(lang === "es" ? "Componiendo mezcla de capas..." : "Composing layer blend...");
      setTimeout(() => {
        try {
          const img = composeMixImage();
          if (!img) throw new Error(lang === "es" ? "No hay capas visibles en la pila." : "No visible layers in the stack.");
          // La mezcla se guarda como imagen NUEVA del flujo: "Final", "Final 1", "Final 2"…
          // Antes sobrescribía el canal activo (p. ej. Starless RGB) y parecía que "no fusionaba":
          // el resultado pisaba una fuente y no aparecía como imagen propia en la barra de canales.
          let name = "Final", nn = 0;
          while (state.workflowImages[name]) { nn++; name = "Final " + nn; }
          img.stages = ["Blend"];
          img.hasTransforms = true;
          state.workflowImages[name] = img;
          selectWorkflowKey(name);   // selecciona la nueva imagen (render + path bar + baseline)
          // Las capas mezcladas ya suelen estar estiradas: sin AutoSTF de pantalla (evita doble estirado).
          state.screenStretchMode = false;
          { const bStf = el("btnToolAutoSTF"); if (bStf) bStf.classList.remove("active"); }
          render();
          scheduleSessionSave();
          logConsole((lang === "es" ? "Mezcla compuesta → " : "Blend composed → ") + name, "ok");
        } catch (err) {
          logConsole((lang === "es" ? "Error al componer mezcla: " : "Blend error: ") + err.message, "err");
        } finally { hideLoader(); }
      }, 50);
    });
  }
  // MIX-DND-END

