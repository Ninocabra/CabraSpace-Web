  // --- CORRECCIÓN DE GRADIENTES (MGC, ABE, AutoDBE, GraXpert) ---

  // Ajusta un polinomio 2D de bajo grado sobre una imagen reducida (para rendimiento)
  // Grado 1 (plano inclinado): ax + by + c
  // Grado 2 (superficie cuadrática / viñeteo): ax^2 + by^2 + cxy + dx + ey + f
  function fitPolynomial2D(img, degree = 2, outlierRejection = true) {
    const w = img.w;
    const h = img.h;
    
    // Submuestrear la imagen a un tamaño manejable (~100 píxeles de ancho) para ajustar rápido
    const step = Math.max(1, Math.floor(w / 100));
    const samples = [];
    
    for (let c = 0; c < img.nc; c++) {
      const ch = img.ch[c];
      const chSamples = [];
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const val = ch[y * w + x];
          chSamples.push({ x: x / w, y: y / h, val: val }); // Coordenadas normalizadas [0, 1]
        }
      }
      
      // Ajuste iterativo por mínimos cuadrados con rechazo de valores atípicos (outliers de estrellas/nebulosas)
      let coeffs = solveLeastSquaresPolynomial(chSamples, degree);
      if (outlierRejection) {
        for (let iter = 0; iter < 3; iter++) {
          // Calcular desviación estándar de los residuos
          let sumSq = 0;
          const count = chSamples.length;
          const residuals = new Float32Array(count);
          for (let i = 0; i < count; i++) {
            const s = chSamples[i];
            const pVal = evaluatePolynomial(s.x, s.y, coeffs, degree);
            residuals[i] = s.val - pVal;
            sumSq += residuals[i] * residuals[i];
          }
          const stdDev = Math.sqrt(sumSq / count);
          
          // Filtrar muestras que se alejen demasiado (estrellas o nebulosas brillantes)
          // Evitamos que el umbral colapse a cero en tomas ya corregidas usando un mínimo de 0.002
          const filtered = chSamples.filter((s, idx) => Math.abs(residuals[idx]) < Math.max(2.0 * stdDev, 0.002));
          if (filtered.length > 10) {
            coeffs = solveLeastSquaresPolynomial(filtered, degree);
          }
        }
      }
      samples.push(coeffs);
    }
    return samples;
  }

  function evaluatePolynomial(x, y, c, d) {
    if (d === 1) {
      // ax + by + c
      return c[0] * x + c[1] * y + c[2];
    } else {
      // ax^2 + by^2 + cxy + dx + ey + f
      return c[0] * x * x + c[1] * y * y + c[2] * x * y + c[3] * x + c[4] * y + c[5];
    }
  }

  // Resuelve A * coeffs = B mediante eliminación de Gauss-Jordan con pivoteo parcial
  function solveLinearSystem(A, B) {
    const n = B.length;
    const mat = Array.from({ length: n }, (_, i) => Float64Array.from(A[i]));
    const rhs = Float64Array.from(B);
    
    for (let i = 0; i < n; i++) {
      // Búsqueda de pivote (pivoteo parcial)
      let maxRow = i;
      let maxVal = Math.abs(mat[i][i]);
      for (let r = i + 1; r < n; r++) {
        const val = Math.abs(mat[r][i]);
        if (val > maxVal) {
          maxVal = val;
          maxRow = r;
        }
      }
      
      // Intercambio de filas
      if (maxRow !== i) {
        const tempRow = mat[i];
        mat[i] = mat[maxRow];
        mat[maxRow] = tempRow;
        
        const tempRhs = rhs[i];
        rhs[i] = rhs[maxRow];
        rhs[maxRow] = tempRhs;
      }
      
      let pivot = mat[i][i];
      if (Math.abs(pivot) < 1e-15) {
        pivot = pivot >= 0 ? 1e-12 : -1e-12;
      }
      
      // Normalizar fila pivote
      for (let j = i; j < n; j++) {
        mat[i][j] /= pivot;
      }
      rhs[i] /= pivot;
      
      // Eliminar el resto de filas
      for (let k = 0; k < n; k++) {
        if (k !== i) {
          const factor = mat[k][i];
          for (let j = i; j < n; j++) {
            mat[k][j] -= factor * mat[i][j];
          }
          rhs[k] -= factor * rhs[i];
        }
      }
    }
    return rhs;
  }

  // Resuelve A * coeffs = B
  function solveLeastSquaresPolynomial(samples, degree) {
    const numCoeffs = degree === 1 ? 3 : 6;
    const A = Array.from({ length: numCoeffs }, () => new Float64Array(numCoeffs));
    const B = new Float64Array(numCoeffs);
    
    for (const s of samples) {
      let terms;
      if (degree === 1) {
        terms = [s.x, s.y, 1];
      } else {
        terms = [s.x * s.x, s.y * s.y, s.x * s.y, s.x, s.y, 1];
      }
      for (let i = 0; i < numCoeffs; i++) {
        for (let j = 0; j < numCoeffs; j++) {
          A[i][j] += terms[i] * terms[j];
        }
        B[i] += terms[i] * s.val;
      }
    }
    
    return solveLinearSystem(A, B);
  }

  // --- Lógica del modelo MGC ---
  function applyMGC(img, smooth, multipliers) {
    // Generar gradiente sintético bilineal/bicúbico suave
    const w = img.w;
    const h = img.h;
    const result = { w, h, nc: img.nc, isColor: img.isColor, ch: [] };
    
    // Ajustar un polinomio de grado 2 (con rechazo moderado)
    const coeffs = fitPolynomial2D(img, 2, true);
    
    for (let c = 0; c < img.nc; c++) {
      const src = img.ch[c];
      const dst = new Float32Array(w * h);
      const coeff = coeffs[c];
      const mult = multipliers[c] || 1.0;
      
      for (let y = 0; y < h; y++) {
        const ny = y / h;
        for (let x = 0; x < w; x++) {
          const nx = x / w;
          const idx = y * w + x;
          
          // Evaluar polinomio de fondo modelado
          const gradVal = evaluatePolynomial(nx, ny, coeff, 2) * smooth * mult;
          
          // Resta del gradiente
          dst[idx] = Math.max(0, src[idx] - gradVal);
        }
      }
      result.ch.push(dst);
    }
    return result;
  }

  // --- Lógica del modelo ABE ---
  // --- Lógica del modelo ABE ---
  function applyABE(img, degree, method, normalize) {
    const w = img.w;
    const h = img.h;
    const result = { w, h, nc: img.nc, isColor: img.isColor, ch: [] };
    const grad = { w, h, nc: img.nc, isColor: img.isColor, ch: [] };
    
    // Ajustar polinomio del grado configurado con fuerte rechazo de outliers
    const coeffs = fitPolynomial2D(img, degree, true);
    
    for (let c = 0; c < img.nc; c++) {
      const src = img.ch[c];
      const dst = new Float32Array(w * h);
      const bgCh = new Float32Array(w * h);
      const coeff = coeffs[c];
      
      // Calcular la media del canal original para normalización si es requerida
      let mean = 0;
      if (normalize) {
        let sum = 0;
        for (let i = 0; i < src.length; i++) sum += src[i];
        mean = sum / src.length;
      }
      
      for (let y = 0; y < h; y++) {
        const ny = y / h;
        for (let x = 0; x < w; x++) {
          const nx = x / w;
          const idx = y * w + x;
          
          const background = evaluatePolynomial(nx, ny, coeff, degree === 1 ? 1 : 2);
          bgCh[idx] = background;
          
          if (method === "subtraction") {
            dst[idx] = Math.max(0, src[idx] - background);
            if (normalize) dst[idx] = Math.min(1.0, dst[idx] + mean);
          } else {
            // División (Division)
            const denom = Math.max(0.001, background);
            dst[idx] = Math.max(0, Math.min(1.0, src[idx] / denom));
            if (normalize) dst[idx] = Math.min(1.0, dst[idx] * mean);
          }
        }
      }
      result.ch.push(dst);
      grad.ch.push(bgCh);
    }
    state.subtractedGradient = grad;
    return result;
  }

  // --- Lógica del modelo AutoDBE por RBF (Radial Basis Functions) ---
  function applyAutoDBE(img, pathCount, tolerance, smoothness) {
    const w = img.w;
    const h = img.h;
    const result = { w, h, nc: img.nc, isColor: img.isColor, ch: [] };
    const grad = { w, h, nc: img.nc, isColor: img.isColor, ch: [] };
    
    // Generar muestras dinámicas automáticas en áreas oscuras de la toma
    // Para simplificar y optimizar, seleccionamos puntos aleatorios y nos quedamos con los de menor luminancia
    const points = [];
    const step = Math.max(1, Math.floor(w / 100));
    
    // Evaluar luminancia para evitar nebulosas/estrellas
    const lum = new Float32Array(w * h);
    if (img.isColor) {
      for (let i = 0; i < w*h; i++) {
        lum[i] = wl[0] * img.ch[0][i] + wl[1] * img.ch[1][i] + wl[2] * img.ch[2][i];
      }
    } else {
      lum.set(img.ch[0]);
    }
    
    // Dividir la imagen en una cuadrícula de bloques (ej. 8x6) para asegurar distribución uniforme
    const cols = 8;
    const rows = 6;
    const cellW = Math.floor(w / cols);
    const cellH = Math.floor(h / rows);
    
    const selectedPoints = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const startX = c * cellW + 10;
        const endX = Math.min(w - 10, (c + 1) * cellW);
        const startY = r * cellH + 10;
        const endY = Math.min(h - 10, (r + 1) * cellH);
        
        let minVal = Infinity;
        let minX = startX;
        let minY = startY;
        
        for (let y = startY; y < endY; y += 4) {
          for (let x = startX; x < endX; x += 4) {
            const val = lum[y * w + x];
            if (val < minVal) {
              minVal = val;
              minX = x;
              minY = y;
            }
          }
        }
        selectedPoints.push({ x: minX, y: minY, val: minVal });
      }
    }
    
    for (let c = 0; c < img.nc; c++) {
      const src = img.ch[c];
      const dst = new Float32Array(w * h);
      const bgCh = new Float32Array(w * h);
      
      // RBF interpolator (Multiquadric radial basis)
      // f(x,y) = sum( w_i * phi(r_i) ) donde phi(r) = sqrt(r^2 + s^2)
      const nPoints = selectedPoints.length;
      const rbfWeights = new Float64Array(nPoints);
      const s2 = smoothness * smoothness * 0.1; // Parámetro de suavizado
      
      // Ajustar pesos RBF resolviendo sistema lineal
      const mat = Array.from({ length: nPoints }, () => new Float64Array(nPoints));
      const rhs = new Float64Array(nPoints);
      
      for (let i = 0; i < nPoints; i++) {
        const p1 = selectedPoints[i];
        rhs[i] = src[p1.y * w + p1.x];
        for (let j = 0; j < nPoints; j++) {
          const p2 = selectedPoints[j];
          const dx = (p1.x - p2.x) / w;
          const dy = (p1.y - p2.y) / h;
          const r2 = dx*dx + dy*dy;
          mat[i][j] = Math.sqrt(r2 + s2);
        }
      }
      
      // Solve system using robust solver with partial pivoting
      const weights = solveLinearSystem(mat, rhs);
      rbfWeights.set(weights);
      
      // Evaluar RBF en toda la cuadrícula
      for (let y = 0; y < h; y++) {
        const ny = y / h;
        for (let x = 0; x < w; x++) {
          const nx = x / w;
          const idx = y * w + x;
          
          let background = 0;
          for (let i = 0; i < nPoints; i++) {
            const p = selectedPoints[i];
            const dx = nx - (p.x / w);
            const dy = ny - (p.y / h);
            const r2 = dx*dx + dy*dy;
            background += rbfWeights[i] * Math.sqrt(r2 + s2);
          }
          bgCh[idx] = Math.max(0, background);
          
          // Resta del gradiente elástico
          dst[idx] = Math.max(0, src[idx] - Math.max(0, background));
        }
      }
      
      result.ch.push(dst);
      grad.ch.push(bgCh);
    }
    
    state.subtractedGradient = grad;
    return result;
  }

  // --- PROCESAMIENTO GENERAL DE GRADIENTE ---
  function applyGradientCorrection(img) {
    if (!img) return null;
    const algo = el("selGradientAlgo").value;
    
    if (algo === "dbe") {
      const paths = parseInt(el("sldAdbePaths").value, 10);
      const tol = parseFloat(el("sldAdbeTol").value);
      const smooth = parseFloat(el("sldAdbeSmooth").value);
      return applyAutoDBE(img, paths, tol, smooth);
    } else if (algo === "abe") {
      const degree = parseInt(el("sldAbeDegree").value, 10);
      const corr = el("selAbeCorrection").value;
      const norm = el("chkAbeNormalize").checked;
      // Mapear grados impares a 1 y pares a 2 en la aproximación analítica
      const fitDegree = degree <= 2 ? 1 : 2;
      return applyABE(img, fitDegree, corr, norm);
    }
    return img;
  }

  // GRADIENT-COMPUTE-BEGIN
  // Calcula la corrección de gradiente para un algoritmo EXPLÍCITO sobre srcImg, sin depender
  // del valor actual del desplegable (lo necesita "Comparar" para iterar los 4 algoritmos).
  // Devuelve { corrected, bgCh } (bgCh = mapa de fondo si el algoritmo lo produce, si no null).
  async function computeGradient(algo, srcImg) {
    if (algo === "graxpert_ia") {
      const params = { correction: el("selGraXpertCorrection").value, smoothing: parseFloat(el("sldGraXpertSmooth").value) };
      const res = await window.GraXpert.applyGraXpertBG(srcImg, params);
      return { corrected: { ch: res.ch, w: res.w, h: res.h, nc: res.nc, isColor: res.isColor, wcs: srcImg.wcs }, bgCh: res.bgCh || null };
    }
    if (algo === "dbe") {
      const density = parseInt(el("sldAdbePaths").value, 10);
      const params = { targetW: 250, gridCols: density, gridRows: density, smoothness: parseFloat(el("sldAdbeSmooth").value), correction: el("selAdbeCorrection").value };
      const res = window.BackgroundExtraction.applyOptimizedBackgroundExtraction(srcImg, params);
      return { corrected: { ch: res.ch, w: res.w, h: res.h, nc: res.nc, isColor: res.isColor, wcs: srcImg.wcs }, bgCh: res.bgCh || null };
    }
    if (algo === "abe") {
      const degree = parseInt(el("sldAbeDegree").value, 10);
      const fitDegree = degree <= 2 ? 1 : 2;
      return { corrected: applyABE(srcImg, fitDegree, el("selAbeCorrection").value, el("chkAbeNormalize").checked), bgCh: null };
    }
    return { corrected: srcImg, bgCh: null };
  }
  // GRADIENT-COMPUTE-END

  // Bind de sliders dinámicos del gradiente
  const gradSliders = [
    { s: "sldAdbePaths", v: "valAdbePaths", p: 0 },
    { s: "sldAdbeTol", v: "valAdbeTol", p: 2 },
    { s: "sldAdbeSmooth", v: "valAdbeSmooth", p: 2 },
    { s: "sldAbeDegree", v: "valAbeDegree", p: 0 },
    { s: "sldGraXpertSmooth", v: "valGraXpertSmooth", p: 3 }
  ];

  gradSliders.forEach(({ s, v, p }) => {
    const sld = el(s);
    const val = el(v);
    if (sld && val) {
      sld.addEventListener("input", () => {
        val.textContent = parseFloat(sld.value).toFixed(p);
      });
    }
  });

  // Event Listeners de Botones de Gradiente
  if (el("btnApplyGradient")) {
    el("btnApplyGradient").addEventListener("click", () => {
      if (!state.activeImage) return;
      const lang = document.documentElement.lang || "es";
      showLoader(lang === "es" ? "Aplicando Corrección de Gradiente..." : "Applying Gradient Correction...");
      
      setTimeout(async () => {
        try {
          // PROBAR-GRADIENTE-BEGIN
          // "Probar Gradiente": aplica el algoritmo seleccionado a la Imagen Inicial
          // (state.stepInputImage) y muestra el resultado como PREVIEW no destructivo.
          // No persiste en el flujo; el commit lo hace el botón "Aplicar Gradiente"
          // (btnBigApply). Cambiar de algoritmo siempre parte de la Imagen Inicial.
          const algo = el("selGradientAlgo").value;
          const srcImg = state.stepInputImage || state.activeImage;
          // PROXY-PROBAR (V1): ABE/AutoDBE (no-IA) previsualizan primero sobre el proxy ≤1000px
          // (el ajuste de fondo es global: el proxy es representativo) y refinan a resolución
          // completa en segundo plano. GraXpert IA va directo a resolución completa.
          const computeFn = async (img) => {
            const { corrected, bgCh } = await computeGradient(algo, img);
            // el gradiente restado solo se guarda del pase a resolución completa
            if (bgCh && img === srcImg) {
              state.subtractedGradient = { ch: bgCh, w: corrected.w, h: corrected.h, nc: corrected.nc, isColor: corrected.isColor };
            }
            return corrected;
          };
          const extraFn = () => {
            // Activar estirado automático de pantalla (AutoSTF) para que el resultado lineal no se vea negro
            state.screenStretchMode = true;
            const stfBtn = el("btnToolAutoSTF");
            if (stfBtn) stfBtn.classList.add("active");
          };
          if (algo !== "graxpert_ia") {
            await previewProxyThenFull(srcImg, "Background Extraction", computeFn, extraFn);
          } else {
            previewActiveImage(await computeFn(srcImg), srcImg, "Background Extraction");
            extraFn();
            render();
            drawHistogram();
          }
          hideLoader();
          logConsole(lang === "es" ? "Vista previa de gradiente (Probar). Pulsa 'Aplicar Gradiente' para confirmar." : "Gradient preview (Test). Press 'Apply Gradient' to commit.", "info");
          // PROBAR-GRADIENTE-END
        } catch (e) {
          hideLoader();
          logConsole(`Error: ${e.message}`, "err");
        }
      }, 50);
    });
  }

  // COMPARE-SLOTS-BEGIN
  // "Comparar": corre los 4 algoritmos con sus argumentos actuales sobre la Imagen Inicial
  // y guarda cada resultado en un Slot de Memoria (1-4) para poder compararlos. No commitea.
  if (el("btnCompareGradient")) {
    el("btnCompareGradient").addEventListener("click", () => {
      if (!state.activeImage) return;
      const lang = document.documentElement.lang || "es";
      showLoader(lang === "es" ? "Comparando algoritmos de gradiente..." : "Comparing gradient algorithms...");

      setTimeout(async () => {
        try {
          const srcImg = state.stepInputImage || state.activeImage;
          const algos = [
            { id: "graxpert_ia", name: "GraXpert IA" },
            { id: "abe",         name: "ABE" },
            { id: "dbe",         name: "AutoDBE" }
          ];
          for (let i = 0; i < algos.length; i++) {
            const { corrected } = await computeGradient(algos[i].id, srcImg);
            state.imageSlots[i] = cloneImage({
              ch: corrected.ch, w: corrected.w, h: corrected.h, nc: corrected.nc,
              isColor: corrected.isColor, wcs: corrected.wcs || (srcImg && srcImg.wcs)
            });
            const slotBtn = document.querySelector(`.piw-slot-btn[data-slot="${i + 1}"]`);
            if (slotBtn) {
              slotBtn.classList.add("filled");
              slotBtn.title = (lang === "es" ? "Gradiente: " : "Gradient: ") + algos[i].name;
            }
            logConsole(`Slot ${i + 1} ← ${algos[i].name}`, "info");
          }
          updateMixSourceOptions();

          // Estirado de pantalla para que los resultados lineales no se vean negros al cargarlos
          state.screenStretchMode = true;
          const stfBtn = el("btnToolAutoSTF");
          if (stfBtn) stfBtn.classList.add("active");

          hideLoader();
          logConsole(lang === "es"
            ? "Comparación lista: 3 algoritmos guardados en Slots 1-3. Pulsa un slot para verlo."
            : "Comparison ready: 3 algorithms saved to Slots 1-3. Click a slot to view it.", "ok");
        } catch (e) {
          hideLoader();
          logConsole(`Error: ${e.message}`, "err");
        }
      }, 50);
    });
  }
  // COMPARE-SLOTS-END

  if (el("btnGradientApplyAll")) {
    el("btnGradientApplyAll").addEventListener("click", () => {
      if (!state.activeImage) return;
      const lang = document.documentElement.lang || "es";
      showLoader(lang === "es" ? "Aplicando Gradiente a todo el flujo..." : "Applying Gradient to all workflow images...");
      
      setTimeout(async () => {
        try {
          const algo = el("selGradientAlgo").value;
          for (const key of Object.keys(state.workflowImages)) {
            if (algo === "graxpert_ia" || algo === "dbe") {
              let params = {};
              // GRAXPERT-AI-BEGIN
              if (algo === "graxpert_ia") {
                params = {
                  correction: el("selGraXpertCorrection").value,
                  smoothing: parseFloat(el("sldGraXpertSmooth").value)
                };
                const res = await window.GraXpert.applyGraXpertBG(state.workflowImages[key], params);
                state.workflowImages[key] = { ch: res.ch, w: res.w, h: res.h, nc: res.nc, isColor: res.isColor, wcs: state.workflowImages[key].wcs };
                if (key === state.activeWorkflowKey && res.bgCh) {
                  state.subtractedGradient = { ch: res.bgCh, w: res.w, h: res.h, nc: res.nc, isColor: res.isColor };
                }
              }
              // GRAXPERT-AI-END
              else {
                const density = parseInt(el("sldAdbePaths").value, 10);
                params = {
                  targetW: 250,
                  gridCols: density,
                  gridRows: density,
                  smoothness: parseFloat(el("sldAdbeSmooth").value),
                  correction: el("selAdbeCorrection").value
                };
                // RBF-OPT-BEGIN
                const res = window.BackgroundExtraction.applyOptimizedBackgroundExtraction(state.workflowImages[key], params);
                state.workflowImages[key] = { ch: res.ch, w: res.w, h: res.h, nc: res.nc, isColor: res.isColor, wcs: state.workflowImages[key].wcs };
                if (key === state.activeWorkflowKey && res.bgCh) {
                  state.subtractedGradient = { ch: res.bgCh, w: res.w, h: res.h, nc: res.nc, isColor: res.isColor };
                }
                // RBF-OPT-END
              }
            } else {
              state.workflowImages[key] = applyGradientCorrection(state.workflowImages[key]);
            }
          }
          if (state.activeWorkflowKey && state.workflowImages[state.activeWorkflowKey]) {
            state.activeImage = state.workflowImages[state.activeWorkflowKey];
          }
          
          // Activar estirado automático de pantalla (AutoSTF)
          state.screenStretchMode = true;
          const stfBtn = el("btnToolAutoSTF");
          if (stfBtn) stfBtn.classList.add("active");

          hideLoader();
          render();
          drawHistogram();
          logConsole(lang === "es" ? "Corrección de gradiente aplicada a todo el flujo (AutoSTF habilitado)" : "Gradient correction applied to all workflow images (AutoSTF enabled)", "info");
        } catch (e) {
          hideLoader();
          logConsole(`Error: ${e.message}`, "err");
        }
      }, 50);
    });
  }

