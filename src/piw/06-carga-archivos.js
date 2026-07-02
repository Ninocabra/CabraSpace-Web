  // --- CARGA DE ARCHIVOS ---
  let targetLoadingChannel = -1;

  // Cargar canales individuales
  document.querySelectorAll(".piw-channel-row").forEach(row => {
    row.addEventListener("click", () => {
      targetLoadingChannel = parseInt(row.getAttribute("data-channel"), 10);
      el("fileInputChannel").value = "";
      el("fileInputChannel").click();
    });
  });

  el("fileInputChannel").addEventListener("change", async (e) => {
    if (e.target.files && e.target.files[0] && targetLoadingChannel !== -1) {
      const file = e.target.files[0];
      const chanIdx = targetLoadingChannel;
      showLoader(`Cargando canal ${file.name}...`);
      
      setTimeout(async () => {
        try {
          const loaded = await AutoGHS.loadFromFile(file);
          // Reducir la resolución de trabajo para rendimiento óptimo
          const capped = AutoGHS.capChannels(loaded.ch, loaded.w, loaded.h, loaded.nc, MAX_PREVIEW_DIM);
          
          let loadedItem;
          if (chanIdx === 7) {
            // Guardar imagen color/mono original
            loadedItem = {
              ch: capped.ch,
              w: capped.w,
              h: capped.h,
              nc: loaded.nc,
              isColor: loaded.isColor
            };
          } else {
            // Guardar canal (monocromo, cogemos la luminancia si el canal cargado es color)
            let monoCh;
            if (loaded.isColor) {
              monoCh = new Float32Array(capped.w * capped.h);
              for (let i = 0; i < monoCh.length; ++i) {
                monoCh[i] = wl[0] * capped.ch[0][i] + wl[1] * capped.ch[1][i] + wl[2] * capped.ch[2][i];
              }
            } else {
              monoCh = capped.ch[0];
            }
            loadedItem = {
              ch: [monoCh],
              w: capped.w,
              h: capped.h,
              nc: 1,
              isColor: false
            };
          }

          state.loadedChannels[chanIdx] = loadedItem;
          state.channelNames[chanIdx] = file.name;

          // Actualizar UI
          const rowEl = document.querySelector(`.piw-channel-row[data-channel="${chanIdx}"]`);
          if (rowEl) rowEl.classList.add("loaded");
          
          const filenameEl = el(`file-name-${chanIdx}`);
          if (filenameEl) {
            filenameEl.textContent = file.name;
            filenameEl.title = file.name;
          }

          logConsole(`Canal ${chanIdx} cargado: ${file.name} (${capped.w}x${capped.h})`, "info");
          
          // Habilitar combinación
          checkCombineState();
        } catch (err) {
          logConsole(`Error al cargar canal: ${err.message}`, "err");
        } finally {
          hideLoader();
        }
      }, 50);
    }
  });

  // Habilita el botón de combinación si hay suficientes canales cargados
  function checkCombineState() {
    // 1. R+G+B
    const hasR = state.loadedChannels[0] !== null;
    const hasG = state.loadedChannels[1] !== null;
    const hasB = state.loadedChannels[2] !== null;
    const hasL = state.loadedChannels[3] !== null;
    const rgbValid = (hasR && hasG) || (hasR && hasG && hasB) || hasL;
    el("btnCombineRGB").disabled = !rgbValid;
    // "Por Separado" carga cada canal cargado como imagen independiente → basta con tener ≥1 canal
    // (no exige la receta completa como "Combinar").
    if (el("btnSeparateRGB")) el("btnSeparateRGB").disabled = !(hasR || hasG || hasB || hasL);
    
    // 2. NB (Narrowband)
    const hasSII = state.loadedChannels[4] !== null;
    const hasHa = state.loadedChannels[5] !== null;
    const hasOIII = state.loadedChannels[6] !== null;
    
    let nbValid = false;
    const selectEl = el("selNbRecipe");
    if (selectEl) {
      const recipeId = selectEl.value;
      const formula = narrowbandFormulas && narrowbandFormulas.find(f => f.id === recipeId);
      if (formula) {
        nbValid = true;
        const reqSources = formula.sources || ['sii', 'ha', 'oiii'];
        if (reqSources.includes("sii") && !hasSII) nbValid = false;
        if (reqSources.includes("ha") && !hasHa) nbValid = false;
        if (reqSources.includes("oiii") && !hasOIII) nbValid = false;
      } else {
        // Fallback si no han cargado aún las fórmulas de la PixelMath-teca
        if (recipeId === "sho" && hasSII && hasHa && hasOIII) nbValid = true;
        else if (recipeId === "hoo" && hasHa && hasOIII) nbValid = true;
        else if (recipeId === "hso" && hasSII && hasHa && hasOIII) nbValid = true;
      }
    }
    el("btnCombineNB").disabled = !nbValid;
    // "Por Separado" carga cada canal NB cargado como imagen independiente → basta con tener ≥1 canal.
    if (el("btnSeparateNB")) el("btnSeparateNB").disabled = !(hasSII || hasHa || hasOIII);

    // 3. RGB Color (Direct)
    const hasColorImg = state.loadedChannels[7] !== null;
    el("btnLoadRGBColor").disabled = !hasColorImg;
  }

  // Combinación de canales RGB (Tab 0)
  el("btnCombineRGB").addEventListener("click", () => {
    showLoader("Combinando canales RGB...");
    setTimeout(() => {
      try {
        const hasR = state.loadedChannels[0] !== null;
        const hasG = state.loadedChannels[1] !== null;
        const hasB = state.loadedChannels[2] !== null;
        const hasL = state.loadedChannels[3] !== null;

        let w = 0, h = 0;
        // Obtener dimensiones de referencia
        for (let i = 0; i < 4; ++i) {
          if (state.loadedChannels[i]) {
            w = state.loadedChannels[i].w;
            h = state.loadedChannels[i].h;
            break;
          }
        }

        if (w === 0 || h === 0) throw new Error("No hay canales válidos cargados.");

        const n = w * h;
        let finalImage;

        if (hasR && hasG) {
          // Es una imagen color (clonamos para no mutar los cargados originales)
          const rChan = Float32Array.from(state.loadedChannels[0].ch[0]);
          const gChan = Float32Array.from(state.loadedChannels[1].ch[0]);
          let bChan;

          if (hasB) {
            bChan = Float32Array.from(state.loadedChannels[2].ch[0]);
          } else {
            // Sintetizar bicolor (HOO): B = OIII (G)
            bChan = Float32Array.from(gChan);
            logConsole("Mezcla bicolor HOO autodetectada (duplicando canal Verde en Azul)", "info");
          }

          // Inyectar luminancia si está cargada
          if (hasL) {
            const lChan = state.loadedChannels[3].ch[0];
            const rgbL = new Float32Array(n);
            for (let i = 0; i < n; ++i) {
              rgbL[i] = wl[0] * rChan[i] + wl[1] * gChan[i] + wl[2] * bChan[i];
            }
            // Escalar canales cromáticos por el ratio L / Luminancia_RGB
            for (let i = 0; i < n; ++i) {
              const ratio = rgbL[i] > 1e-5 ? lChan[i] / rgbL[i] : 1;
              rChan[i] = Math.min(1, rChan[i] * ratio);
              gChan[i] = Math.min(1, gChan[i] * ratio);
              bChan[i] = Math.min(1, bChan[i] * ratio);
            }
            logConsole("Luminancia inyectada en canales de crominancia", "info");
          }

          finalImage = {
            ch: [rChan, gChan, bChan],
            w: w,
            h: h,
            nc: 3,
            isColor: true
          };
        } else if (hasL) {
          // Solo luminancia (monocromo, clonamos para no mutar)
          finalImage = {
            ch: [Float32Array.from(state.loadedChannels[3].ch[0])],
            w: w,
            h: h,
            nc: 1,
            isColor: false
          };
          logConsole("Imagen monocroma (Luminancia) generada", "info");
        }

        // Limpiar claves de Banda Estrecha
        const nbKeys = ["S", "H", "O", "HSO"];
        nbKeys.forEach(k => delete state.workflowImages[k]);

        state.workflowImages["MonoRGB"] = finalImage;
        state.activeWorkflowKey = "MonoRGB";
        setActiveImage(finalImage);
        refreshPathBar();
        logConsole(`Combinación completada con éxito (${w}x${h} px)`, "info");
      } catch (err) {
        logConsole(`Error al combinar canales: ${err.message}`, "err");
      } finally {
        hideLoader();
      }
    }, 50);
  });

  // Combinación de canales NB (Tab 0)
  el("btnCombineNB").addEventListener("click", () => {
    showLoader("Combinando canales Banda Estrecha...");
    setTimeout(() => {
      try {
        const hasSII = state.loadedChannels[4] !== null;
        const hasHa = state.loadedChannels[5] !== null;
        const hasOIII = state.loadedChannels[6] !== null;
        const recipeId = el("selNbRecipe").value;
        const formula = narrowbandFormulas.find(f => f.id === recipeId);
        if (!formula) throw new Error("Fórmula no encontrada.");

        let w = 0, h = 0;
        // Obtener dimensiones de referencia
        for (let i = 4; i <= 6; ++i) {
          if (state.loadedChannels[i]) {
            w = state.loadedChannels[i].w;
            h = state.loadedChannels[i].h;
            break;
          }
        }

        if (w === 0 || h === 0) throw new Error("No hay canales válidos cargados para Banda Estrecha.");

        const n = w * h;
        let finalImage;

        // Reservar canales R, G, B
        const rChan = new Float32Array(n);
        const gChan = new Float32Array(n);
        const bChan = new Float32Array(n);

        const sii = hasSII ? state.loadedChannels[4].ch[0] : new Float32Array(n);
        const ha = hasHa ? state.loadedChannels[5].ch[0] : new Float32Array(n);
        const oiii = hasOIII ? state.loadedChannels[6].ch[0] : new Float32Array(n);

        // Compile expressions for R, G, B
        // Collect slider keys and values
        const sliderKeys = formula.sliders ? formula.sliders.map(s => s.id) : [];
        const sliderVals = sliderKeys.map(key => {
          const inputEl = el(`sldNb_${key}`);
          return inputEl ? parseFloat(inputEl.value) : (formula.sliders.find(s => s.id === key).value);
        });

        const fnR = compilePixelMathExpression(formula.r || 'Ha', sliderKeys);
        const fnG = compilePixelMathExpression(formula.g || 'OIII', sliderKeys);
        const fnB = compilePixelMathExpression(formula.b || 'OIII', sliderKeys);

        if (!fnR || !fnG || !fnB) {
          throw new Error("No se pudo compilar la expresión matemática de la fórmula.");
        }

        // Ejecutar píxel a píxel
        for (let i = 0; i < n; ++i) {
          rChan[i] = Math.min(1.0, Math.max(0.0, fnR(sii[i], ha[i], oiii[i], sii[i], ha[i], oiii[i], ...sliderVals)));
          gChan[i] = Math.min(1.0, Math.max(0.0, fnG(sii[i], ha[i], oiii[i], sii[i], ha[i], oiii[i], ...sliderVals)));
          bChan[i] = Math.min(1.0, Math.max(0.0, fnB(sii[i], ha[i], oiii[i], sii[i], ha[i], oiii[i], ...sliderVals)));
        }

        logConsole(`Mezcla PixelMath aplicada: ${formula.name}`, "info");

        finalImage = {
          ch: [rChan, gChan, bChan],
          w: w,
          h: h,
          nc: 3,
          isColor: true
        };

        // Limpiar claves de Banda Ancha RGB
        const rgbKeys = ["MonoRGB", "RGB", "R", "G", "B", "L"];
        rgbKeys.forEach(k => delete state.workflowImages[k]);

        state.workflowImages["HSO"] = finalImage;
        state.activeWorkflowKey = "HSO";
        setActiveImage(finalImage);
        refreshPathBar();
        logConsole(`Combinación NB completada con éxito (${w}x${h} px)`, "info");
      } catch (err) {
        logConsole(`Error al combinar canales NB: ${err.message}`, "err");
      } finally {
        hideLoader();
      }
    }, 50);
  });

  // Carga de imagen a color directa (Tab 0)
  el("btnLoadRGBColor").addEventListener("click", () => {
    showLoader("Cargando imagen a color...");
    setTimeout(() => {
      try {
        const loadedColor = state.loadedChannels[7];
        if (!loadedColor) throw new Error("No hay imagen color cargada.");

        // Clonamos la imagen para no machacar la guardada
        const finalImage = cloneImage(loadedColor);

        // Limpiar claves de Banda Estrecha
        const nbKeys = ["S", "H", "O", "HSO"];
        nbKeys.forEach(k => delete state.workflowImages[k]);

        state.workflowImages["RGB"] = finalImage;
        state.activeWorkflowKey = "RGB";
        setActiveImage(finalImage);
        refreshPathBar();
        logConsole(`Carga de imagen color completada con éxito (${finalImage.w}x${finalImage.h} px)`, "info");
      } catch (err) {
        logConsole(`Error al cargar imagen color: ${err.message}`, "err");
      } finally {
        hideLoader();
      }
    }, 50);
  });

  // Procesar por separado RGB (Tab 0)
  el("btnSeparateRGB").addEventListener("click", () => {
    showLoader("Separando canales RGB...");
    setTimeout(() => {
      try {
        const hasR = state.loadedChannels[0] !== null;
        const hasG = state.loadedChannels[1] !== null;
        const hasB = state.loadedChannels[2] !== null;
        const hasL = state.loadedChannels[3] !== null;

        let w = 0, h = 0;
        for (let i = 0; i < 4; ++i) {
          if (state.loadedChannels[i]) {
            w = state.loadedChannels[i].w;
            h = state.loadedChannels[i].h;
            break;
          }
        }

        if (w === 0 || h === 0) throw new Error("No hay canales válidos cargados.");

        // Limpiar claves de Banda Estrecha
        const nbKeys = ["S", "H", "O", "HSO"];
        nbKeys.forEach(k => delete state.workflowImages[k]);
        
        if (hasR) state.workflowImages["R"] = cloneImage(state.loadedChannels[0]);
        if (hasG) state.workflowImages["G"] = cloneImage(state.loadedChannels[1]);
        if (hasB) state.workflowImages["B"] = cloneImage(state.loadedChannels[2]);
        if (hasL) state.workflowImages["L"] = cloneImage(state.loadedChannels[3]);

        const keys = Object.keys(state.workflowImages);
        if (keys.length === 0) throw new Error("No hay ningún canal cargado.");

        state.activeWorkflowKey = keys[0];
        setActiveImage(state.workflowImages[state.activeWorkflowKey]);
        refreshPathBar();
        logConsole(`Canales separados cargados con éxito (${w}x${h} px)`, "info");
      } catch (err) {
        logConsole(`Error al cargar canales por separado: ${err.message}`, "err");
      } finally {
        hideLoader();
      }
    }, 50);
  });

  // Procesar por separado NB (Tab 0)
  el("btnSeparateNB").addEventListener("click", () => {
    showLoader("Separando canales Banda Estrecha...");
    setTimeout(() => {
      try {
        const hasSII = state.loadedChannels[4] !== null;
        const hasHa = state.loadedChannels[5] !== null;
        const hasOIII = state.loadedChannels[6] !== null;

        let w = 0, h = 0;
        for (let i = 4; i <= 6; ++i) {
          if (state.loadedChannels[i]) {
            w = state.loadedChannels[i].w;
            h = state.loadedChannels[i].h;
            break;
          }
        }

        if (w === 0 || h === 0) throw new Error("No hay canales válidos cargados.");

        // Limpiar claves de Banda Ancha RGB
        const rgbKeys = ["MonoRGB", "RGB", "R", "G", "B", "L"];
        rgbKeys.forEach(k => delete state.workflowImages[k]);
        
        if (hasSII) state.workflowImages["S"] = cloneImage(state.loadedChannels[4]);
        if (hasHa) state.workflowImages["H"] = cloneImage(state.loadedChannels[5]);
        if (hasOIII) state.workflowImages["O"] = cloneImage(state.loadedChannels[6]);

        const keys = Object.keys(state.workflowImages);
        if (keys.length === 0) throw new Error("No hay ningún canal cargado.");

        state.activeWorkflowKey = keys[0];
        setActiveImage(state.workflowImages[state.activeWorkflowKey]);
        refreshPathBar();
        logConsole(`Canales de banda estrecha cargados por separado (${w}x${h} px)`, "info");
      } catch (err) {
        logConsole(`Error al cargar canales NB por separado: ${err.message}`, "err");
      } finally {
        hideLoader();
      }
    }, 50);
  });

  // Refresca la barra de botones del flujo de canales (path buttons)
  function refreshPathBar() {
    const bar = el("piwPathBar");
    if (!bar) return;
    bar.innerHTML = "";
    
    const keys = Object.keys(state.workflowImages);
    if (keys.length === 0) {
      bar.style.display = "none";
      return;
    }
    
    bar.style.display = "flex";
    keys.forEach(key => {
      const btn = document.createElement("button");
      btn.className = "piw-path-btn";
      btn.setAttribute("data-key", key);
      
      const imgObj = state.workflowImages[key];
      const hasTransforms = imgObj && imgObj.hasTransforms;
      
      if (key === state.activeWorkflowKey) {
        btn.classList.add("active");
        btn.textContent = `[${key}]`;
      } else {
        btn.textContent = key;
        if (hasTransforms) {
          btn.classList.add("done");
        }
      }
      
      btn.addEventListener("click", () => {
        selectWorkflowKey(key);
      });
      
      bar.appendChild(btn);
    });
  }

  // Cambia el canal/imagen del flujo activo actual
  function selectWorkflowKey(key) {
    if (!state.workflowImages[key]) return;
    state.activeWorkflowKey = key;
    state.activeImage = state.workflowImages[key];
    state.originalImage = cloneImage(state.activeImage);
    // La imagen seleccionada pasa a ser la Imagen Inicial de las operaciones (estirado, etc.),
    // para que se apliquen sobre lo que el usuario tiene seleccionado (RGB/Starless/Stars/…).
    state.stepInputImage = cloneImage(state.activeImage);
    state.pendingPreview = false;

    // MONO-RGB-VIS-BEGIN
    el("piwHint").style.display = "none";
    el("piwToolbar").style.display = "flex";
    // Autostretch al revisitar SOLO si la imagen sigue siendo lineal (no se le aplicó un
    // estirado permanente). Se deriva del historial de stages (modelo del script), no de
    // hasTransforms — que ahora marca "se aplicó cualquier proceso", incluidos los lineales (PRE).
    const isStretched = state.activeImage && Array.isArray(state.activeImage.stages)
      && state.activeImage.stages.indexOf("Stretch") >= 0;
    if (state.activeImage && !isStretched) {
      state.screenStretchMode = true;
    }
    const btnAutoStf = el("btnToolAutoSTF");
    if (btnAutoStf) {
      if (state.screenStretchMode) {
        btnAutoStf.classList.add("active");
      } else {
        btnAutoStf.classList.remove("active");
      }
    }
    // MONO-RGB-VIS-END
    
    // Reset A/B comparison for the new workflow key context
    state.previousImage = null;
    state._lastImgRef = state.activeImage;
    state.viewingPrevious = false;
    const btnToggle = el("btnToolToggleAB");
    if (btnToggle) {
      btnToggle.classList.remove("active");
      btnToggle.textContent = "Toggle A/B";
    }
    state.splitViewMode = false;
    const btnSplit = el("btnToolSplitView");
    if (btnSplit) {
      btnSplit.classList.remove("active");
    }
    el("piwSplitSlider").style.display = "none";
    
    // Si la imagen es a color, habilitar SCNR/Saturación, etc.
    el("btnApplyScnr").disabled = !state.activeImage.isColor;
    el("btnApplySat").disabled = !state.activeImage.isColor;
    // SCNR-PRE-BEGIN
    el("btnApplyScnrPre").disabled = !state.activeImage.isColor;
    el("sldScnrIntPre").disabled = !state.activeImage.isColor;
    // SCNR-PRE-END
    el("btnApplyPostSharp").disabled = false;
    { const b = el("btnComparePostSharp"); if (b) b.disabled = false; }
    el("btnApplyPostCurves").disabled = false;
    el("btnApplyPostColor").disabled = false;

    // Forzar redibujado de la pantalla
    render();
    drawHistogram();
    refreshPathBar();
    logConsole(`Visualizando canal/imagen del flujo: ${key}`, "info");
  }

  // Establece la imagen activa y refresca el canvas
  function setActiveImage(img) {
    state.activeImage = img;
    state.originalImage = cloneImage(img);
    state.stepInputImage = cloneImage(img);
    state.pendingPreview = false;
    state.calibCompareReady = false;
    state.undoStack.length = 0; state.redoStack.length = 0; updateUndoButtons();

    // Reset A/B comparison
    state.previousImage = null;
    state._lastImgRef = img;
    state.viewingPrevious = false;
    const btnToggle = el("btnToolToggleAB");
    if (btnToggle) {
      btnToggle.classList.remove("active");
      btnToggle.textContent = "Toggle A/B";
    }
    state.splitViewMode = false;
    const btnSplit = el("btnToolSplitView");
    if (btnSplit) {
      btnSplit.classList.remove("active");
    }
    el("piwSplitSlider").style.display = "none";
    
    // AutoSTF habilitado por defecto para ver imágenes lineales combinadas/cargadas
    state.screenStretchMode = true;
    const btnAutoStf = el("btnToolAutoSTF");
    if (btnAutoStf) btnAutoStf.classList.add("active");
    logConsole("Estirado de pantalla AutoSTF activado automáticamente", "info");
    
    // Reset de visualización
    zoomFit();
    setTimeout(zoomFit, 100);
    setTimeout(zoomFit, 300); // Doble cobertura por si la interfaz tarda en renderizar el acordeón o scrollbar
    
    // Habilitar botones de acción en las pestañas
    const cardLF = el("cardLinearFit");
    if (cardLF) {
      if (img.isColor) {
        cardLF.classList.remove("disabled");
      } else {
        cardLF.classList.add("disabled");
      }
    }
    const cardBN = el("cardBN");
    if (cardBN) {
      cardBN.classList.remove("disabled");
    }
    const cardSPCC = el("cardSPCC");
    if (cardSPCC) {
      if (img.isColor) {
        cardSPCC.classList.remove("disabled");
      } else {
        cardSPCC.classList.add("disabled");
      }
    }
    const cardOT = el("cardOT");
    if (cardOT) {
      if (img.isColor) {
        cardOT.classList.remove("disabled");
      } else {
        cardOT.classList.add("disabled");
      }
    }
    const btnCmpColor = el("btnCompareColor");
    if (btnCmpColor) btnCmpColor.disabled = !img.isColor;
    el("btnApplyDecon").disabled = false;
    { const b = el("btnCompareDecon"); if (b) b.disabled = false; }
    el("btnApplyStretch").disabled = false;
    el("btnApplyScnr").disabled = !img.isColor;
    // SCNR-PRE-BEGIN
    el("btnApplyScnrPre").disabled = !img.isColor;
    el("sldScnrIntPre").disabled = !img.isColor;
    // SCNR-PRE-END
    el("btnPreviewMask").disabled = false;
    el("btnApplyMask").disabled = false;
    el("btnApplySat").disabled = !img.isColor;
    el("btnDownloadPNG").disabled = false;
    { const b = el("btnApplyColorMixer"); if (b) b.disabled = false; }
    { const b = el("btnApplyDetail"); if (b) b.disabled = false; }
    el("btnApplyPostNR").disabled = false;
    { const b = el("btnComparePostNR"); if (b) b.disabled = false; }
    el("btnApplyPostSharp").disabled = false;
    { const b = el("btnComparePostSharp"); if (b) b.disabled = false; }
    el("btnApplyPostCurves").disabled = false;
    el("btnApplyPostColor").disabled = false;
    enablePostProcessControls();

    el("piwHint").style.display = "none";
    el("piwToolbar").style.display = "flex";

    // Rellenar selectores de la pestaña Mezcla
    updateMixSourceOptions();

    // Dibujar
    render();
    drawHistogram();
    drawCurvesWidget();
    drawColorBalanceWidget();
  }

