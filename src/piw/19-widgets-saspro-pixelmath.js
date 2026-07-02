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
      cardSPCC: "PCC (Photometric Color Calibration): balance por fotometría de estrellas Gaia DR3 (banda ancha, respuesta dependiente del color) + neutralización de fondo + SCNR. Requiere Plate Solving.",
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
      cardSPCC: "PCC (Photometric Color Calibration): white balance from Gaia DR3 broadband star photometry (color-dependent response) + background neutralization + SCNR. Requires Plate Solving.",
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
    graxpert_ia: "gradient-graxpert-controls"
  });

  setupDropdownToggle("selDeconAlgo", {
    rl_auto: "decon-rl-controls",
    cosmic_ia: "decon-cosmic-controls",
    cs_ia_beta: "decon-csia-controls"
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
    dse: "post-sharp-dse-controls"
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
        // La pestaña Mezcla no participa del acordeón: sus capas quedan siempre desplegadas.
        if (section.closest("#tab-combine")) return;
        const isCollapsed = section.classList.contains("collapsed");
        if (isCollapsed) {
          // Descolapsar esta sección y colapsar todas las demás (excepto las de la pestaña Mezcla).
          document.querySelectorAll(".piw-section").forEach(s => { if (!s.closest("#tab-combine")) s.classList.add("collapsed"); });
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
          state.pendingPreview = false; // menú nuevo: aún no hay nada que aplicar
          // Cada menú arranca con la comparación limpia: Toggle/Split se referirán a la Imagen
          // Inicial recién capturada (antes de aplicar cambios en este menú).
          state.viewingPrevious = false;
          state.splitViewMode = false;
          state.splitCompareImage = state.stepInputImage;
          { const bT = el("btnToolToggleAB"); if (bT) { bT.classList.remove("active"); bT.textContent = "Toggle A/B"; } }
          { const bS = el("btnToolSplitView"); if (bS) bS.classList.remove("active"); }
          { const sl = el("piwSplitSlider"); if (sl) sl.style.display = "none"; }
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
        // SAS Pro y SPCC ahora son 100% JS: ya NO se carga Pyodide (antes esta era la última descarga
        // del runtime WASM ~10MB). El botón solo revela los controles, instantáneo.
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
          // SAS-PRO-PYODIDE->JS: carga con autoghs.js (JS) + algo en JS (sin Pyodide).
          showLoader(lang === "es" ? "Procesando archivo (JS)..." : "Processing file (JS)...");
          const loaded = await AutoGHS.loadFromFile(file);
          let result;
          if (algo === "statistical_stretch") result = computeStatisticalStretchJS(loaded, params.target_median, params.sigma_clip);
          else if (algo === "star_stretch") result = computeStarStretchJS(loaded, params.target_median, params.sigma_clip, params.color_preservation);
          else if (algo === "scnr") result = computeScnrGreenJS(loaded, params.amount);
          else result = loaded;
          hideLoader();
          
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
          hideLoader();
          logConsole(`Error: ${err.message}`, "err");
        }
      }
    });
  }

  // Desactivar tarjetas e inicializar comportamiento interactivo para botones y tarjetas mock
  // FAME ya está implementado (pincel manual de máscara); no quedan botones mock.
  const mockButtons = [];
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
  // V2 (Fase 4): la spline cúbica monótona vive en ImgOps.cubicSplineFn (imgops.js), compartida
  // con el worker; aquí queda el delegado para el widget de curvas y llamadores existentes.
  function getCubicSpline(points) {
    return window.ImgOps.cubicSplineFn(points);
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

    curvesCv.addEventListener("pointerdown", (e) => {
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
          livePreviewCurves(); // punto eliminado
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
            livePreviewCurves(); // punto añadido
          }
        }
      }
    });

    curvesCv.addEventListener("contextmenu", (e) => e.preventDefault());

    curvesCv.addEventListener("pointermove", (e) => {
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
        livePreviewCurves(); // curva modificada al arrastrar un punto
      } else {
        const ptIdx = findPointIndex(coords);
        if (ptIdx !== hoveredCurvePtIdx) {
          hoveredCurvePtIdx = ptIdx;
          drawCurvesWidget(); // solo hover: no dispara preview Live
        }
      }
    });

    window.addEventListener("pointerup", () => {
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

