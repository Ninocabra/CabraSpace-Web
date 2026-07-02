  // --- OPERACIONES DE ESTIRADO / STRETCHING (TAB 1) ---

  // Auto STF
  // runAutoSTF (estirado STF del menú Estirar) vive ahora en imgops.js (autoSTFInPlace, misma
  // matemática) y se invoca vía ImgOps.computeStretch({algo:"stf"}) — también desde el worker.

  // Cargar Starless
  el("btnLoadStarless").addEventListener("click", () => {
    el("fileInputStarless").value = "";
    el("fileInputStarless").click();
  });
  el("fileInputStarless").addEventListener("change", async (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      showLoader("Cargando Starless...");
      setTimeout(async () => {
        try {
          const loaded = await AutoGHS.loadFromFile(file);
          const capped = AutoGHS.capChannels(loaded.ch, loaded.w, loaded.h, loaded.nc, MAX_PREVIEW_DIM);
          state.starlessImage = {
            ch: capped.ch,
            w: capped.w,
            h: capped.h,
            nc: loaded.nc,
            isColor: loaded.isColor
          };
          state.workflowImages["Starless"] = state.starlessImage;
          el("btnLoadStarless").classList.add("primary");
          logConsole(`Imagen sin estrellas (Starless) cargada: ${file.name}`, "info");
          updateMixSourceOptions();
          refreshPathBar();
        } catch (err) {
          logConsole(`Error al cargar Starless: ${err.message}`, "err");
        } finally {
          hideLoader();
        }
      }, 50);
    }
  });

  // Cargar Estrellas
  el("btnLoadStars").addEventListener("click", () => {
    el("fileInputStars").value = "";
    el("fileInputStars").click();
  });
  el("fileInputStars").addEventListener("change", async (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      showLoader("Cargando capa de estrellas...");
      setTimeout(async () => {
        try {
          const loaded = await AutoGHS.loadFromFile(file);
          const capped = AutoGHS.capChannels(loaded.ch, loaded.w, loaded.h, loaded.nc, MAX_PREVIEW_DIM);
          state.starsImage = {
            ch: capped.ch,
            w: capped.w,
            h: capped.h,
            nc: loaded.nc,
            isColor: loaded.isColor
          };
          state.workflowImages["Stars"] = state.starsImage;
          el("btnLoadStars").classList.add("primary");
          logConsole(`Imagen de estrellas cargada: ${file.name}`, "info");
          updateMixSourceOptions();
          refreshPathBar();
        } catch (err) {
          logConsole(`Error al cargar Estrellas: ${err.message}`, "err");
        } finally {
          hideLoader();
        }
      }, 50);
    }
  });

  // Escuchar cambios en el checkbox de Starless para refrescar la visualización
  el("chkStarlessView").addEventListener("change", () => {
    render();
    drawHistogram();
  });

  // STAR-REMOVAL-INTEGRATION-BEGIN
  el("btnRemoveStars").addEventListener("click", () => {
    if (!state.activeImage) {
      logConsole(window.location.pathname.includes("-en.html")
        ? "Please load an image before separating stars."
        : "Carga una imagen antes de separar estrellas.", "err");
      return;
    }

    const runExecution = () => {
      const lang = window.location.pathname.includes("-en.html") ? "en" : "es";
      showLoader(lang === "es" ? "Cargando modelo StarNet2..." : "Loading StarNet2 model...");

      setTimeout(async () => {
        try {
          const isLinear = state.screenStretchMode === true;
          let inputImg = state.activeImage;
          let shadows = null;
          let midtones = null;

          if (isLinear) {
            logConsole(lang === "es" ? "Imagen lineal detectada. Aplicando STF temporal..." : "Linear image detected. Applying temporary STF...", "info");
            const nc = state.activeImage.nc;
            const n = state.activeImage.ch[0].length;
            shadows = [];
            midtones = [];
            const stretchedCh = [];
            const TB = 0.25;

            function mtfPure(m, x) {
              if (x <= 0) return 0;
              if (x >= 1) return 1;
              const denom = (2 * m - 1) * x - m;
              if (Math.abs(denom) < 1e-12) return x;
              return (m - 1) * x / denom;
            }

            for (let c = 0; c < nc; c++) {
              const src = state.activeImage.ch[c];
              const median = fastSampledMedian(src);
              const mad    = Math.max(0.0005, fastSampledMAD(src, median));
              const shadow = Math.max(0.0, median - 1.25 * mad);
              const sh     = isFinite(shadow) ? shadow : 0.0;
              const mt     = optMadMidtone(median, sh, TB);
              shadows.push(sh);
              midtones.push(mt);

              const dst = new Float32Array(n);
              const scale = sh >= 1.0 ? 1.0 : (1.0 - sh);
              for (let i = 0; i < n; i++) {
                const x = Math.max(0.0, Math.min(1.0, (src[i] - sh) / scale));
                dst[i] = mtfPure(mt, x);
              }
              stretchedCh.push(dst);
            }

            inputImg = {
              ch: stretchedCh,
              w: state.activeImage.w,
              h: state.activeImage.h,
              nc: state.activeImage.nc,
              isColor: state.activeImage.isColor
            };
          }

          const runFn = window.StarRemoval.runStarNet2;
          const result = await runFn(
            inputImg,
            // Callback para progreso de descarga
            (p) => {
              showLoader(lang === "es"
                ? `Descargando modelo StarNet2: ${(p * 100).toFixed(0)}%`
                : `Downloading StarNet2 model: ${(p * 100).toFixed(0)}%`
              );
            },
            // Callback para progreso de tiles
            (completed, total) => {
              showLoader(lang === "es"
                ? `Procesando tiles: ${completed}/${total}`
                : `Processing tiles: ${completed}/${total}`
              );
            },
            // Recuperación de detalle de nebulosa (slider; 0 = starless crudo del modelo)
            (el("sldStarRecover") ? parseFloat(el("sldStarRecover").value) : 0)
          );

          let starlessOut = result.starless;
          let starsOut = result.stars;

          if (isLinear) {
            logConsole(lang === "es" ? "Invirtiendo STF temporal para obtener datos lineales..." : "Inverting temporary STF to obtain linear data...", "info");
            const nc = state.activeImage.nc;
            const n = state.activeImage.ch[0].length;
            const starlessLinearCh = [];
            const starsLinearCh = [];

            function mtfPure(m, x) {
              if (x <= 0) return 0;
              if (x >= 1) return 1;
              const denom = (2 * m - 1) * x - m;
              if (Math.abs(denom) < 1e-12) return x;
              return (m - 1) * x / denom;
            }

            for (let c = 0; c < nc; c++) {
              const sh = shadows[c];
              const mt = midtones[c];
              const starlessStretched = result.starless.ch[c];
              const starlessLinear = new Float32Array(n);
              const invMt = 1.0 - mt;

              for (let i = 0; i < n; i++) {
                const val = sh + (1.0 - sh) * mtfPure(invMt, starlessStretched[i]);
                starlessLinear[i] = val < 0.0 ? 0.0 : (val > 1.0 ? 1.0 : val);
              }
              starlessLinearCh.push(starlessLinear);

              // stars_linear = max(0, original_linear - starless_linear)
              const origLinear = state.activeImage.ch[c];
              const starsLinear = new Float32Array(n);
              for (let i = 0; i < n; i++) {
                const diff = origLinear[i] - starlessLinear[i];
                starsLinear[i] = diff > 0.0 ? diff : 0.0;
              }
              starsLinearCh.push(starsLinear);
            }

            starlessOut = {
              ch: starlessLinearCh,
              w: state.activeImage.w,
              h: state.activeImage.h,
              nc: nc,
              isColor: state.activeImage.isColor
            };
            starsOut = {
              ch: starsLinearCh,
              w: state.activeImage.w,
              h: state.activeImage.h,
              nc: nc,
              isColor: state.activeImage.isColor
            };
          }

          state.starlessImage = starlessOut;
          state.starsImage = starsOut;

          // Nombrar por ORIGEN: "Starless <key>" / "Stars <key>" para soportar splits de varias
          // fuentes (RGB, MonoRGB, ...). Cada una mantiene su propio par seleccionable en el flujo.
          const srcKey = state.activeWorkflowKey || "RGB";
          const starlessKey = "Starless " + srcKey;
          const starsKey = "Stars " + srcKey;
          state.workflowImages[starlessKey] = starlessOut;
          state.workflowImages[starsKey] = starsOut;

          logConsole(lang === "es"
            ? `Eliminación de estrellas completada: creados "${starlessKey}" y "${starsKey}".`
            : `Star removal completed: created "${starlessKey}" and "${starsKey}".`,
            "info"
          );

          updateMixSourceOptions();
          selectWorkflowKey(starlessKey); // ver el starless de esa fuente
        } catch (err) {
          logConsole(`Error en eliminación de estrellas: ${err.message}`, "err");
          console.error(err);
        } finally {
          hideLoader();
        }
      }, 50);
    };

    runExecution();
  });
  // STAR-REMOVAL-INTEGRATION-END

  // Mostrar u ocultar controles dinámicos de estirado según algoritmo seleccionado
  el("selStretchAlgo").addEventListener("change", (e) => {
    const val = e.target.value;
    el("stretch-stf-controls").style.display = val === "stf" ? "block" : "none";
    el("stretch-ghs-controls").style.display = val === "ghs" ? "block" : "none";
    el("stretch-stars-controls").style.display = val === "stars" ? "block" : "none";
    const statCtl = el("stretch-stat-controls");
    if (statCtl) statCtl.style.display = val === "statistical_stretch" ? "block" : "none";
    const curvesCtl = el("stretch-curves-controls");
    if (curvesCtl) {
      curvesCtl.style.display = val === "curves" ? "block" : "none";
      if (val === "curves") drawHistogram();
    }
  });

  // Sliders de la Curva Manual: actualizan el valor y redibujan la curva en vivo.
  ["Black", "Mid", "Contrast"].forEach((suffix) => {
    const sld = el("sldStretch" + suffix);
    if (!sld) return;
    sld.addEventListener("input", () => {
      const v = el("valStretch" + suffix);
      if (v) v.textContent = parseFloat(sld.value).toFixed(2);
      setStretchPointsFromSliders(); // los sliders re-siembran la curva por puntos
      drawStretchCurve();
    });
  });

  // Slider "Recuperar nebulosa" del star split
  {
    const sldRec = el("sldStarRecover");
    if (sldRec) sldRec.addEventListener("input", () => {
      const v = el("valStarRecover");
      if (v) v.textContent = parseFloat(sldRec.value).toFixed(2);
    });
  }

  // STRETCH-COMPARE-BEGIN
  // STRETCH-PARAMS: params PLANOS (serializables) del estirado según el algoritmo seleccionado,
  // leídos de los sliders de la UI. Sirven igual para ImgOps.computeStretch en el hilo principal
  // (proxy del Probar, Comparar) y para el Web Worker (resolución completa sin congelar la UI).
  function getStretchParams(algo, srcImg) {
    if (algo === "stf") {
      return { algo, targetBg: parseFloat(el("sldStfBg").value), clipSigmas: parseFloat(el("sldStfClip").value) };
    }
    if (algo === "ghs") {
      const cfg = AutoGHS.defaultConfig();
      cfg.sigmasFromCenter = parseFloat(el("sldGhsSig").value);
      cfg.stretchIntensity = parseFloat(el("sldGhsInt").value);
      const _ghsIters = el("sldGhsIters");
      if (_ghsIters) cfg.maxIterations = parseInt(_ghsIters.value, 10);
      cfg.colorMode = srcImg.isColor ? "luminance" : "rgb";
      return { algo, cfg };
    }
    if (algo === "stars") {
      const boostEl = el("sldStarsBoost");
      return { algo, amount: parseFloat(el("sldStarsStretch").value), boost: boostEl ? parseFloat(boostEl.value) : 1.0 };
    }
    if (algo === "statistical_stretch") {
      // STAT-STRETCH-PYODIDE->JS: estirado en JS (sin Pyodide), mismo algoritmo (MAD + MTF por canal).
      return { algo, target: parseFloat(el("sldStretchStatTgt").value), sigma: parseFloat(el("sldStretchStatSigma").value) };
    }
    if (algo === "curves") {
      return { algo, points: stretchPoints.map((p) => [p[0], p[1]]) };
    }
    return { algo };
  }

  // Motor de estirado reutilizable (Preview y Comparar). No destructivo: devuelve una imagen nueva.
  // V2 (Fase 4): la matemática vive en ImgOps.computeStretch (imgops.js), compartida con el worker.
  async function computeStretch(algo, srcImg) {
    return window.ImgOps.computeStretch(srcImg, getStretchParams(algo, srcImg));
  }

  // Aplicar estirado (Preview no destructivo)
  el("btnApplyStretch").addEventListener("click", () => {
    if (!state.activeImage) return;
    const algo = el("selStretchAlgo").value;
    const lang = document.documentElement.lang || "es";
    showLoader(lang === "es" ? "Estirando imagen (Preview)..." : "Stretching image (Preview)...");

    setTimeout(async () => {
      try {
        const srcImg = state.stepInputImage || state.activeImage;
        // Los params se leen UNA vez: proxy y resolución completa usan exactamente los mismos.
        const params = getStretchParams(algo, srcImg);
        // PROXY-PROBAR (V1) + worker (V2): preview instantáneo sobre el proxy y recomputo a
        // resolución completa en el Web Worker (fallback CPU), que reemplaza el preview al llegar.
        await previewProxyThenFull(srcImg, "Stretch", (img) => {
          if (img === srcImg) {
            return runImgWorker("stretch", img, params).catch(() => window.ImgOps.computeStretch(img, params));
          }
          return window.ImgOps.computeStretch(img, params);
        }, () => {
          // Tras estirar, desactivar el estirado de pantalla AutoSTF (vemos los datos ya estirados, no doble)
          state.screenStretchMode = false;
          const btnAutoStf = el("btnToolAutoSTF");
          if (btnAutoStf) btnAutoStf.classList.remove("active");
        });
        logConsole(lang === "es" ? `Estirado aplicado: ${algo}` : `Stretch applied: ${algo}`, "info");
        logConsole(lang === "es" ? "Vista previa de estirado (Preview). Pulsa 'Aplicar Estirado' para confirmar." : "Stretch preview. Press 'Apply Stretch' to commit.", "info");
      } catch (err) {
        logConsole(`Error en estirado: ${err.message}`, "err");
      } finally {
        hideLoader();
      }
    }, 50);
  });

  // "Comparar estirados": ejecuta todos los algoritmos y guarda cada resultado en un Slot de memoria.
  if (el("btnCompareStretch")) {
    el("btnCompareStretch").addEventListener("click", () => {
      const srcImg = state.stepInputImage || state.activeImage;
      if (!srcImg) return;
      const lang = document.documentElement.lang || "es";
      showLoader(lang === "es" ? "Comparando estirados (puede tardar por Statistical Stretch)..." : "Comparing stretches (may take a while for Statistical Stretch)...");
      setTimeout(async () => {
        try {
          const variants = [
            { name: "STF", algo: "stf" },
            { name: "AutoGHS", algo: "ghs" },
            { name: "Statistical Stretch", algo: "statistical_stretch" },
            { name: lang === "es" ? "Estrellas (asinh)" : "Stars (asinh)", algo: "stars" },
            { name: lang === "es" ? "Curva Manual" : "Manual Curve", algo: "curves" }
          ];
          const results = [];
          for (const v of variants) {
            try {
              results.push({ name: v.name, img: await computeStretch(v.algo, srcImg) });
            } catch (e) {
              logConsole((lang === "es" ? `${v.name} omitido: ` : `${v.name} skipped: `) + e.message, "warn");
            }
          }
          for (let i = 0; i < results.length; i++) {
            const r = results[i];
            state.imageSlots[i] = cloneImage({ ch: r.img.ch, w: r.img.w, h: r.img.h, nc: r.img.nc, isColor: r.img.isColor, wcs: srcImg && srcImg.wcs });
            const slotBtn = document.querySelector(`.piw-slot-btn[data-slot="${i + 1}"]`);
            if (slotBtn) { slotBtn.classList.add("filled"); slotBtn.title = "Stretch: " + r.name; }
            logConsole(`Slot ${i + 1} ← ${r.name}`, "info");
          }
          updateMixSourceOptions();
          hideLoader();
          logConsole(lang === "es"
            ? `Comparación lista: ${results.length} estirados en Slots 1-${results.length}. Carga un slot para verlo.`
            : `Comparison ready: ${results.length} stretches in Slots 1-${results.length}.`, "ok");
        } catch (e) {
          hideLoader();
          logConsole(`Error: ${e.message}`, "err");
        }
      }, 50);
    });
  }
  // STRETCH-COMPARE-END

