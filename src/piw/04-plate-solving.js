  // --- PLATE SOLVING CON ASTROMETRY.NET ---
  const ASTROMETRY_API_KEY = "coqpscljnloiluyi";
  // CF-WORKER-BEGIN
  // Proxy CORS para Astrometry.net en producción (Vercel Edge Function).
  // Código y despliegue: vercel-proxy/. Vacío = en producción muestra el mensaje guía.
  let ASTROMETRY_PROXY_URL = "https://astronomy-proxy.vercel.app";
  // CF-WORKER-END

  // Redirige a través del proxy CORS local (puerto 8010) para gestionar OPTIONS y subidas de archivos
  function corsFetch(url, options = {}) {
    // CF-WORKER-BEGIN
    const hostname = window.location.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      const proxyUrl = url.replace("https://nova.astrometry.net", "http://localhost:8010");
      return fetch(proxyUrl, options);
    } else {
      if (ASTROMETRY_PROXY_URL) {
        // Rewrite request URL to point to the Cloudflare Worker
        const proxyUrl = url.replace("https://nova.astrometry.net", ASTROMETRY_PROXY_URL);
        return fetch(proxyUrl, options);
      } else {
        const errMsg = document.documentElement.lang === "es"
          ? "El plate solve en producción requiere configurar ASTROMETRY_PROXY_URL (proxy Vercel). Consulta vercel-proxy/README.md."
          : "Plate solving in production requires configuring ASTROMETRY_PROXY_URL (Vercel proxy). Refer to vercel-proxy/README.md.";
        logConsole(errMsg, "error");
        return Promise.reject(new Error(errMsg));
      }
    }
    // CF-WORKER-END
  }

  // PLATE-SOLVE-HARDEN-BEGIN
  // Lee una respuesta del plate solve como JSON con error CLARO si llega HTML/no-OK (en vez del
  // críptico "Unexpected token '<'"). Reintenta en fallos transitorios (solo peticiones idempotentes).
  async function solveFetchJson(url, options, label, retries = 0) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await corsFetch(url, options);
        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          const snip = (text || "").trim().slice(0, 140).replace(/\s+/g, " ");
          const server = res.headers.get("server") || "?";
          const sw = (typeof navigator !== "undefined" && navigator.serviceWorker && navigator.serviceWorker.controller) ? "SW-activo" : "sin-SW";
          throw new Error(`${label} → no-JSON (HTTP ${res.status}, server=${server}, ${sw}). Servidor devolvió: "${snip}…"`);
        }
        if (!res.ok) throw new Error(`${label} → HTTP ${res.status}: ${data.errmessage || data.error || "error del servidor"}`);
        return data;
      } catch (e) {
        lastErr = e;
        if (attempt < retries) { await new Promise(r => setTimeout(r, 1500)); continue; }
      }
    }
    throw lastErr;
  }

  async function getSessionKey() {
    const data = await solveFetchJson("https://nova.astrometry.net/api/login", {
      method: "POST",
      body: new URLSearchParams({
        "request-json": JSON.stringify({ apikey: ASTROMETRY_API_KEY })
      })
    }, "Login");
    if (data.status !== "success") {
      throw new Error(data.errmessage || "Login fallido");
    }
    return data.session;
  }

  // Comprimir imagen activa a Blob JPEG usando un canvas temporal de tamaño optimizado
  function getActiveImageAsJpegBlob() {
    return new Promise((resolve, reject) => {
      if (!state.activeImage) return reject(new Error("No active image"));
      
      const img = state.activeImage;
      const tempCv = document.createElement("canvas");
      // Escalar la imagen a un tamaño máximo de 800px para subirla super rápido
      const maxDim = 800;
      let w = img.w;
      let h = img.h;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      
      tempCv.width = w;
      tempCv.height = h;
      const tempCtx = tempCv.getContext("2d");
      
      // Dibujar imagen a color u monocromo en el canvas temporal
      let channelsToDraw = img.ch;
      if (state.screenStretchMode) {
        try {
          channelsToDraw = applyAutoSTF(img.ch, img.nc, img.isColor);
        } catch (e) {}
      }
      const id = AutoGHS.channelsToImageData(channelsToDraw, img.w, img.h, img.nc);
      
      // Para redimensionar con suavizado, dibujamos primero a tamaño completo y luego escalamos
      const fullCv = document.createElement("canvas");
      fullCv.width = img.w;
      fullCv.height = img.h;
      fullCv.getContext("2d").putImageData(id, 0, 0);
      
      tempCtx.drawImage(fullCv, 0, 0, w, h);
      
      tempCv.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Blob conversion failed"));
      }, "image/jpeg", 0.85);
    });
  }

  async function uploadImageToAstrometry(session, jpegBlob) {
    const form = new FormData();
    form.append("request-json", JSON.stringify({
      session: session,
      allow_commercial_use: "n",
      allow_modifications: "n",
      publicly_visible: "y"
    }));
    form.append("file", jpegBlob, "solve_img.jpg");

    const data = await solveFetchJson("https://nova.astrometry.net/api/upload", {
      method: "POST",
      body: form
    }, "Upload");
    if (data.status !== "success") {
      throw new Error(data.errmessage || "Upload fallido");
    }
    return data.subid;
  }

  async function pollSubmissionStatus(subid) {
    const url = `https://nova.astrometry.net/api/submissions/${subid}`;
    // Intentos de polling con reintento cada 5 segundos
    for (let i = 0; i < 40; i++) {
      const data = await solveFetchJson(url, undefined, "Estado de envío", 2);

      if (data.processing_finished === "true" || data.jobs && data.jobs.length > 0) {
        const job = data.jobs[0];
        if (job) return job;
      }
      
      await new Promise(r => setTimeout(r, 5000));
    }
    throw new Error("Timeout esperando resolución en Astrometry.net");
  }

  async function checkJobSolved(jobId) {
    const url = `https://nova.astrometry.net/api/jobs/${jobId}/info`;
    const data = await solveFetchJson(url, undefined, "Info del job", 2);
    if (data.status === "success") {
      return data;
    }
    return null;
  }

  // Espera a que el JOB termine de resolver (no basta con que exista). El job pasa por estados
  // "solving" -> "success"/"failure". Sondea /info cada 3s hasta terminar o agotar el tiempo.
  async function pollJobUntilSolved(jobId) {
    for (let i = 0; i < 60; i++) {
      const data = await solveFetchJson(`https://nova.astrometry.net/api/jobs/${jobId}/info`, undefined, "Estado del job", 2);
      if (data.status === "success") return true;
      if (data.status === "failure") return false;
      await new Promise(r => setTimeout(r, 3000));
    }
    throw new Error("Timeout esperando que Astrometry.net resuelva el campo.");
  }

  async function getCalibrationData(jobId) {
    const url = `https://nova.astrometry.net/api/jobs/${jobId}/calibration`;
    const data = await solveFetchJson(url, undefined, "Calibración", 2);
    return data;
  }
  // PLATE-SOLVE-HARDEN-END

  // Ejecución principal del solved
  async function performPlateSolving() {
    const lang = document.documentElement.lang || "es";
    if (!state.activeImage) {
      logConsole(lang === "es" ? "No hay ninguna imagen activa para resolver" : "No active image to solve", "err");
      return;
    }

    showLoader(lang === "es" ? "Iniciando Plate Solving..." : "Starting Plate Solving...");
    logConsole(lang === "es" ? "Conectando con Astrometry.net..." : "Connecting to Astrometry.net...", "info");
    
    try {
      const session = await getSessionKey();
      
      showLoader(lang === "es" ? "Comprimiendo y preparando imagen..." : "Compressing image...");
      const jpegBlob = await getActiveImageAsJpegBlob();
      
      showLoader(lang === "es" ? "Subiendo imagen a Astrometry.net..." : "Uploading image to Astrometry.net...");
      const subid = await uploadImageToAstrometry(session, jpegBlob);
      logConsole(lang === "es" ? `Envío de imagen exitoso (Submission ID: ${subid})` : `Upload successful (Submission ID: ${subid})`, "info");
      
      // Polling para esperar a que termine el procesamiento y nos devuelva el id del Job
      showLoader(lang === "es" ? "Resolviendo campo (espera de 10-30s)..." : "Solving field (waiting 10-30s)...");
      const jobId = await pollSubmissionStatus(subid);
      logConsole(lang === "es" ? `Job ID asignado: ${jobId}. Esperando a que resuelva...` : `Job ID assigned: ${jobId}. Waiting for solve...`, "info");

      // Esperar a que el job termine de RESOLVER (no basta con que exista; tarda 15-60s).
      showLoader(lang === "es" ? "Resolviendo campo (puede tardar 15-60s)..." : "Solving field (may take 15-60s)...");
      const solved = await pollJobUntilSolved(jobId);
      if (!solved) {
        throw new Error(lang === "es"
          ? "Astrometry.net no pudo resolver la imagen (campo no reconocido: prueba con más estrellas/menos procesada)."
          : "Astrometry.net could not solve the image (field not recognized: try a less-processed image with more stars).");
      }
      const calibration = await getCalibrationData(jobId);
      
      hideLoader();

      if (calibration && calibration.ra) {
        // Guardar metadatos WCS globalmente en state
        state.wcs = {
          ra: calibration.ra,
          dec: calibration.dec,
          radius: calibration.radius,
          pixscale: calibration.pixscale,
          orientation: calibration.orientation,
          parity: calibration.parity,
          // Dimensiones de la imagen al resolver: la pestaña Anotar rechaza el WCS
          // si la geometría cambió después (además del crop, que ya lo anula).
          imgW: state.activeImage.w,
          imgH: state.activeImage.h
        };
        // También en la imagen activa por compatibilidad
        state.activeImage.wcs = state.wcs;
        if (typeof annotOnWcsChanged === "function") annotOnWcsChanged();
        
        // Actualizar UI
        const statusLbl = el("lblSolveStatus");
        if (statusLbl) {
          const ar = calibration.ra.toFixed(4);
          const dec = calibration.dec.toFixed(4);
          statusLbl.textContent = `● AR:${ar}°, DEC:${dec}° (${calibration.pixscale.toFixed(2)}"/px)`;
          statusLbl.style.color = "#7ed89b";
        }
        
        logConsole(lang === "es" 
          ? `Plate Solving Exitoso! Centro AR: ${calibration.ra.toFixed(4)}°, DEC: ${calibration.dec.toFixed(4)}°, Escala: ${calibration.pixscale.toFixed(2)}"/px, Rotación: ${calibration.orientation.toFixed(1)}°`
          : `Plate Solving Successful! Center RA: ${calibration.ra.toFixed(4)}°, DEC: ${calibration.dec.toFixed(4)}°, Scale: ${calibration.pixscale.toFixed(2)}"/px, Rotation: ${calibration.orientation.toFixed(1)}°`, 
          "info"
        );
      } else {
        throw new Error("Astrometry.net no pudo resolver la imagen.");
      }
    } catch (err) {
      hideLoader();
      logConsole(lang === "es" ? `Error en Plate Solving: ${err.message}` : `Plate Solving Error: ${err.message}`, "err");
      const statusLbl = el("lblSolveStatus");
      if (statusLbl) {
        statusLbl.textContent = lang === "es" ? "● Error al resolver" : "● Solve failed";
        statusLbl.style.color = "#ff4a4a";
      }
    }
  }

  // Bind del botón
  if (el("btnSolveImage")) {
    el("btnSolveImage").addEventListener("click", (e) => {
      e.preventDefault();
      performPlateSolving();
    });
  }

