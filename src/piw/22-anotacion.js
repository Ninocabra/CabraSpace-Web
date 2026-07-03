  // ============================================================================
  // ANOTAR (pestaña de anotación) — identifica objetos del catálogo local
  // (annotate-catalog.json: OpenNGC + Sharpless + Barnard; ver tools/build_catalog.py)
  // sobre la imagen usando el WCS del Plate Solving, al estilo PixInsight/AstroBin.
  //
  // Matemática (derivada del código fuente de astrometry.net: util/sip.c
  // tan_get_orientation() y net/models.py Calibration.get_orientation()):
  //   - la API devuelve parity = signo de det(CD) (±1);
  //   - para envíos JPEG (nuestro caso), orientation_api = (180 − orient_tan) mod 360,
  //     y el espacio de píxeles del WCS coincide con el del JPEG (x→derecha, y→abajo).
  // Reconstruimos la CD con escala pixscale, sin skew, y proyección TAN (gnomónica)
  // centrada en el (ra, dec) del centro del campo que reporta la calibración.
  // OJO: pixscale corresponde al JPEG reducido a 800 px que se sube al solver
  // (getActiveImageAsJpegBlob), no a la imagen completa: se reescala con sf.
  // ============================================================================
  const annot = {
    on: false,             // overlay visible
    flip: 1,               // guardia manual ⇄ Este/Oeste (multiplica la paridad)
    catalog: null,         // objetos [name, common, cat, ra, dec, majA, minA, pa, mag]
    catalogPromise: null,
    list: [],              // objetos proyectados a px de la imagen actual
    card: null             // tarjeta de detalles abierta
  };

  const ANNOT_COLORS = { g: "#63c7ff", n: "#ff8fb0", c: "#ffd76a", s: "#e8e8e8" };
  const ANNOT_TYPES_ES = { g: "Galaxia", n: "Nebulosa", c: "Cúmulo", s: "Estrella(s)" };
  const ANNOT_TYPES_EN = { g: "Galaxy", n: "Nebula", c: "Cluster", s: "Star(s)" };

  function annotLang() { return document.documentElement.lang === "en" ? "en" : "es"; }

  // WCS vigente y válido para la imagen actual. state.wcs es la única autoridad:
  // lo escribe el Plate Solving (04) y lo anula el Crop (03) al cambiar la geometría.
  function annotWcs() {
    const w = state.wcs, img = state.activeImage;
    if (!w || !img || typeof w.ra !== "number" || typeof w.pixscale !== "number") return null;
    if (w.imgW && (w.imgW !== img.w || w.imgH !== img.h)) return null; // geometría desfasada
    return w;
  }

  // Dimensiones del JPEG que se envió a Astrometry.net (mismo cálculo que
  // getActiveImageAsJpegBlob: lado mayor limitado a 800 px). Como el crop anula el
  // WCS, la imagen actual tiene las mismas dimensiones que cuando se resolvió.
  function annotJpegDims(imgW, imgH) {
    const maxDim = 800;
    if (imgW <= maxDim && imgH <= maxDim) return { w: imgW, h: imgH };
    if (imgW > imgH) return { w: maxDim, h: Math.round(imgH * maxDim / imgW) };
    return { w: Math.round(imgW * maxDim / imgH), h: maxDim };
  }

  // Transformación cielo↔píxel para la imagen ACTUAL (CD reconstruida + escala sf).
  function annotBuildTransform() {
    const wcs = annotWcs(), img = state.activeImage;
    if (!wcs || !img) return null;
    const D2R = Math.PI / 180;
    const jp = annotJpegDims(img.w, img.h);
    const sf = img.w / jp.w;                        // px del jpeg → px de la imagen
    const s = wcs.pixscale / 3600;                  // grados por px del jpeg
    const theta = (180 - (wcs.orientation || 0)) * D2R; // deshace el ajuste JPEG de la API
    const p = ((wcs.parity != null && wcs.parity < 0) ? -1 : 1) * annot.flip;
    // Construcción verificada contra tan_get_orientation(): reproducir (s, theta, p)
    const c = Math.cos(theta), n = Math.sin(theta);
    let cd11, cd12, cd21, cd22;
    if (p >= 0) { cd11 = s * c;  cd12 = s * n; cd21 = -s * n; cd22 = s * c; }
    else        { cd11 = -s * c; cd12 = s * n; cd21 = s * n;  cd22 = s * c; }
    return {
      ra0: wcs.ra * D2R, de0: wcs.dec * D2R,
      cd11, cd12, cd21, cd22, det: cd11 * cd22 - cd12 * cd21,
      jp, sf,
      pixscaleImg: wcs.pixscale / sf,               // arcsec por px de la imagen actual
      radius: wcs.radius || 0
    };
  }

  // Cielo (grados J2000) → píxel de la imagen actual. null si cae fuera del hemisferio.
  function annotSkyToPx(T, raDeg, decDeg) {
    const D2R = Math.PI / 180, R2D = 180 / Math.PI;
    const ra = raDeg * D2R, de = decDeg * D2R;
    const dra = ra - T.ra0;
    const den = Math.sin(de) * Math.sin(T.de0) + Math.cos(de) * Math.cos(T.de0) * Math.cos(dra);
    if (den <= 0.02) return null;
    const xi = R2D * Math.cos(de) * Math.sin(dra) / den;                                                    // → Este
    const eta = R2D * (Math.sin(de) * Math.cos(T.de0) - Math.cos(de) * Math.sin(T.de0) * Math.cos(dra)) / den; // → Norte
    const dx = (T.cd22 * xi - T.cd12 * eta) / T.det;   // CD⁻¹ · [xi, eta]
    const dy = (-T.cd21 * xi + T.cd11 * eta) / T.det;
    return { x: (T.jp.w / 2 + dx) * T.sf, y: (T.jp.h / 2 + dy) * T.sf };
  }

  // Píxel de la imagen actual → cielo (huella de la imagen en Aladin).
  function annotPxToSky(T, x, y) {
    const D2R = Math.PI / 180, R2D = 180 / Math.PI;
    const dx = x / T.sf - T.jp.w / 2, dy = y / T.sf - T.jp.h / 2;
    const xi = (T.cd11 * dx + T.cd12 * dy) * D2R;
    const eta = (T.cd21 * dx + T.cd22 * dy) * D2R;
    const den = Math.cos(T.de0) - eta * Math.sin(T.de0);
    const ra = T.ra0 + Math.atan2(xi, den);
    const de = Math.atan2(Math.sin(T.de0) + eta * Math.cos(T.de0), Math.sqrt(xi * xi + den * den));
    return { ra: ((ra * R2D) % 360 + 360) % 360, dec: de * R2D };
  }

  function annotLoadCatalog() {
    if (annot.catalogPromise) return annot.catalogPromise;
    const v = (typeof window.PIW_BUILD === "string") ? window.PIW_BUILD : "0";
    annot.catalogPromise = fetch("annotate-catalog.json?v=" + v)
      .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(d => { annot.catalog = d.objects || []; return annot.catalog; })
      .catch(err => { annot.catalogPromise = null; throw err; });
    return annot.catalogPromise;
  }

  // Proyecta el catálogo al campo actual según chips de categoría y magnitud límite.
  function annotCompute() {
    annot.list = [];
    const T = annotBuildTransform(), img = state.activeImage;
    if (!T || !annot.catalog || !img) return 0;
    const magLim = el("sldAnnotMag") ? (parseFloat(el("sldAnnotMag").value) || 12) : 12;
    const cats = {
      g: !el("chkAnnotG") || el("chkAnnotG").checked,
      n: !el("chkAnnotN") || el("chkAnnotN").checked,
      c: !el("chkAnnotC") || el("chkAnnotC").checked,
      s: !el("chkAnnotS") || el("chkAnnotS").checked
    };
    const D2R = Math.PI / 180;
    const sinDe0 = Math.sin(T.de0), cosDe0 = Math.cos(T.de0);
    // Pre-filtro angular barato: radio del campo + 1.5° de margen (objetos grandes
    // cuyo centro cae algo fuera del encuadre).
    const fieldR = T.radius || (Math.hypot(img.w, img.h) / 2) * T.pixscaleImg / 3600;
    const cosRMax = Math.cos(Math.min(89, fieldR + 1.5) * D2R);
    let cosNearest = -1, nearest = null; // objeto más cercano al centro (para avisar en campos escasos)
    for (let i = 0; i < annot.catalog.length; i++) {
      const o = annot.catalog[i];
      const cat = o[2];
      if (!cats[cat]) continue;
      const de = o[4] * D2R;
      const cosSep = sinDe0 * Math.sin(de) + cosDe0 * Math.cos(de) * Math.cos(o[3] * D2R - T.ra0);
      if (cosSep > cosNearest) { cosNearest = cosSep; nearest = o; }
      const mag = o[8];
      // Los objetos "más señalados" (nombre común o número Messier) SIEMPRE se muestran; la
      // magnitud límite (densidad) solo filtra las designaciones anónimas NGC/IC más débiles.
      // Las nebulosas Sh2/Barnard no traen magnitud (null) y también pasan siempre.
      const named = !!o[1] || o[0].indexOf("M ") === 0;
      if (!named && mag != null && mag > magLim) continue;
      if (cosSep < cosRMax) continue;
      const px = annotSkyToPx(T, o[3], o[4]);
      if (!px) continue;
      // Semiejes de la elipse en px de la imagen (majA/minA vienen en arcmin).
      const rx = Math.max(12, (o[5] || 2) * 30 / T.pixscaleImg);
      const ry = Math.max(10, (o[6] || o[5] || 2) * 30 / T.pixscaleImg);
      if (px.x < -rx || px.x > img.w + rx || px.y < -rx || px.y > img.h + rx) continue;
      // Dirección en pantalla del eje mayor: PA se mide de Norte hacia Este.
      const paR = (o[7] || 0) * D2R;
      const dxd = T.cd22 * Math.sin(paR) - T.cd12 * Math.cos(paR);
      const dyd = -T.cd21 * Math.sin(paR) + T.cd11 * Math.cos(paR);
      annot.list.push({
        x: px.x, y: px.y, rx, ry, rot: Math.atan2(dyd, dxd),
        name: o[0], common: o[1], cat, mag
      });
    }
    // Los grandes se dibujan primero (los pequeños quedan encima y clicables);
    // cap de seguridad para campos enormes con magnitud alta.
    annot.nearest = nearest
      ? { name: nearest[1] || nearest[0], sep: Math.acos(Math.min(1, cosNearest)) / D2R }
      : null;
    annot.list.sort((a, b) => b.rx - a.rx);
    if (annot.list.length > 400) annot.list.length = 400;
    annotRenderList();
    return annot.list.length;
  }

  // Dibujado del overlay: lo llama render() (15) tras pintar la imagen.
  function drawAnnotationsOverlay() {
    if (!annot.on || !annot.list.length) return;
    const dispW = cv.getBoundingClientRect().width || cv.width;
    const r = dispW > 0 ? cv.width / dispW : 1; // px de canvas por px visual (para grosor/tipografía)
    const font = Math.max(10, Math.round(12 * r));
    ctx.save();
    ctx.font = "600 " + font + "px system-ui, -apple-system, sans-serif";
    ctx.textBaseline = "bottom";
    for (let i = 0; i < annot.list.length; i++) {
      const a = annot.list[i];
      const col = ANNOT_COLORS[a.cat] || "#ffffff";
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1, 1.3 * r);
      ctx.beginPath();
      ctx.ellipse(a.x, a.y, a.rx, a.ry, a.rot, 0, Math.PI * 2);
      ctx.stroke();
      const label = a.common || a.name;
      const tx = a.x - a.rx * 0.6, ty = a.y - a.ry - 4 * r;
      ctx.lineWidth = Math.max(2.5, 3 * r);
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.strokeText(label, tx, ty);
      ctx.fillStyle = col;
      ctx.fillText(label, tx, ty);
    }
    ctx.restore();
  }

  // --- Click sobre un objeto → tarjeta con detalles y enlaces ---
  let _annotDownPos = null;
  cv.addEventListener("pointerdown", (e) => { _annotDownPos = { x: e.clientX, y: e.clientY }; });
  cv.addEventListener("click", (e) => {
    if (!annot.on || !annot.list.length) return;
    // Si hubo arrastre (pan/zoom), no es un click de selección.
    if (_annotDownPos && Math.hypot(e.clientX - _annotDownPos.x, e.clientY - _annotDownPos.y) > 6) return;
    const rect = cv.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (e.clientX - rect.left) * cv.width / rect.width;
    const y = (e.clientY - rect.top) * cv.height / rect.height;
    const slack = 12 * (cv.width / rect.width); // holgura táctil
    let best = null, bestArea = Infinity;
    for (let i = 0; i < annot.list.length; i++) {
      const a = annot.list[i];
      const co = Math.cos(a.rot), si = Math.sin(a.rot);
      const dx = x - a.x, dy = y - a.y;
      const u = (dx * co + dy * si) / (a.rx + slack);
      const v = (-dx * si + dy * co) / (a.ry + slack);
      if (u * u + v * v <= 1) {
        const area = a.rx * a.ry;
        if (area < bestArea) { bestArea = area; best = a; } // el más pequeño gana (más específico)
      }
    }
    if (best) annotShowCard(best, e.clientX, e.clientY); else annotHideCard();
  });

  function annotHideCard() {
    if (annot.card) { annot.card.remove(); annot.card = null; }
  }

  function annotShowCard(a, clientX, clientY) {
    annotHideCard();
    const lang = annotLang();
    const types = lang === "en" ? ANNOT_TYPES_EN : ANNOT_TYPES_ES;
    const card = document.createElement("div");
    card.className = "piw-annot-card";
    const wikiHost = lang === "en" ? "en.wikipedia.org" : "es.wikipedia.org";
    const wikiQ = encodeURIComponent(a.common || a.name);
    // SIMBAD entiende M/NGC/IC/Sh2/B; para Caldwell ("C 9") el nombre común resuelve mejor.
    const simbadQ = encodeURIComponent((a.name.indexOf("C ") === 0 && a.common) ? a.common : a.name);
    card.innerHTML =
      '<button class="close" type="button">✕</button><h4></h4><div class="sub"></div>' +
      '<a target="_blank" rel="noopener" href="https://' + wikiHost + '/wiki/Special:Search?search=' + wikiQ + '">📖 Wikipedia</a>' +
      '<a target="_blank" rel="noopener" href="https://simbad.cds.unistra.fr/simbad/sim-id?Ident=' + simbadQ + '">🔭 SIMBAD</a>';
    card.querySelector("h4").textContent = a.common || a.name;
    card.querySelector(".sub").textContent =
      (a.common ? a.name + " · " : "") + (types[a.cat] || "") + (a.mag != null ? " · mag " + a.mag : "");
    card.querySelector(".close").addEventListener("click", annotHideCard);
    container.appendChild(card);
    const contRect = container.getBoundingClientRect();
    let lx = clientX - contRect.left + 12, ly = clientY - contRect.top + 12;
    card.style.left = lx + "px";
    card.style.top = ly + "px";
    annot.card = card;
    // Reposicionar si se sale del contenedor (necesita las medidas ya renderizadas).
    requestAnimationFrame(() => {
      if (annot.card !== card) return;
      if (lx + card.offsetWidth > contRect.width - 8) lx = Math.max(8, contRect.width - card.offsetWidth - 8);
      if (ly + card.offsetHeight > contRect.height - 8) ly = Math.max(8, contRect.height - card.offsetHeight - 8);
      card.style.left = lx + "px";
      card.style.top = ly + "px";
    });
  }

  // --- F3: lista lateral de objetos encontrados y exportación del PNG anotado ---
  function annotShowCardForObject(a) {
    const rect = cv.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const clientX = rect.left + a.x * rect.width / cv.width;
    const clientY = rect.top + a.y * rect.height / cv.height;
    annotShowCard(a, clientX, clientY);
  }

  function annotRenderList() {
    const box = el("annotObjList");
    const expBtn = el("btnAnnotExport");
    const active = annot.on && annot.list.length > 0;
    if (expBtn) expBtn.disabled = !active;
    if (!box) return;
    if (!active) { box.style.display = "none"; box.innerHTML = ""; return; }
    const lang = annotLang();
    const icon = { g: "🌌", n: "☁️", c: "✨", s: "⭐" };
    // Lista ordenada por brillo (los objetos sin magnitud —Sh2/Barnard— al final).
    const items = annot.list.slice().sort((a, b) => (a.mag == null ? 99 : a.mag) - (b.mag == null ? 99 : b.mag));
    box.innerHTML = "";
    const head = document.createElement("div");
    head.className = "piw-annot-list-head";
    head.textContent = (lang === "es" ? "Objetos en el campo: " : "Objects in field: ") + annot.list.length;
    box.appendChild(head);
    items.forEach(a => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "piw-annot-list-item";
      row.innerHTML = '<span class="ic"></span><span class="nm"></span><span class="mg"></span>';
      row.querySelector(".ic").textContent = icon[a.cat] || "•";
      row.querySelector(".nm").textContent = a.common || a.name;
      row.querySelector(".mg").textContent = a.mag != null ? ("m" + a.mag) : "";
      row.addEventListener("click", () => annotShowCardForObject(a));
      box.appendChild(row);
    });
    box.style.display = "block";
  }

  // Exporta el canvas actual (imagen mostrada + overlay ya pintado) como PNG.
  function annotExportPng() {
    const lang = annotLang();
    if (!annot.on || !annot.list.length) return;
    render(); // garantiza el overlay pintado en el canvas antes de capturar
    const done = (blob) => {
      if (!blob) { showToast(lang === "es" ? "No se pudo exportar el PNG" : "PNG export failed", "err"); return; }
      _downloadBlob(blob, "cabraspace-anotada.png");
      showToast(lang === "es" ? "PNG anotado exportado" : "Annotated PNG exported", "ok");
    };
    if (cv.toBlob) { cv.toBlob(done, "image/png"); return; }
    try {
      const parts = cv.toDataURL("image/png").split(",");
      const bin = atob(parts[1]); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      done(new Blob([arr], { type: "image/png" }));
    } catch (e) { done(null); }
  }

  // --- Estado de la sección y arranque ---
  function annotRefreshStatus() {
    const lbl = el("lblAnnotWcs");
    if (!lbl) return;
    const lang = annotLang();
    const wcs = annotWcs();
    const hasImg = !!state.activeImage;
    if (wcs) {
      lbl.textContent = (lang === "es" ? "● WCS resuelto — AR " : "● WCS solved — RA ") +
        wcs.ra.toFixed(3) + "°, DEC " + wcs.dec.toFixed(3) + "° · " + wcs.pixscale.toFixed(2) + '"/px';
      lbl.style.color = "#7ed89b";
    } else {
      lbl.textContent = lang === "es"
        ? (hasImg ? "Sin solución astrométrica: ejecuta Plate Solving para poder anotar."
                  : "Carga una imagen y ejecuta Plate Solving para poder anotar.")
        : (hasImg ? "No astrometric solution: run Plate Solving to enable annotation."
                  : "Load an image and run Plate Solving to enable annotation.");
      lbl.style.color = "#c9a06a";
    }
    if (el("btnAnnotate")) el("btnAnnotate").disabled = !wcs;
    if (el("btnAnnotSky")) el("btnAnnotSky").disabled = !wcs;
    if (el("btnAnnotGoSolve")) el("btnAnnotGoSolve").style.display = (!wcs && hasImg) ? "" : "none";
  }

  function annotOnTabOpen() {
    annotRefreshStatus();
    annotLoadCatalog().catch(() => {}); // precarga silenciosa (~300 KB, una sola vez)
  }

  // Lo llaman 04 (solve exitoso) y 03 (crop → WCS anulado).
  function annotOnWcsChanged() {
    if (annot.on) {
      if (annotWcs()) {
        annotCompute();
      } else {
        annot.on = false;
        annot.list = [];
        annotHideCard();
        annotRenderList();
        const btn = el("btnAnnotate");
        if (btn) { btn.classList.remove("active"); btn.textContent = annotLang() === "es" ? "Anotar imagen" : "Annotate image"; }
      }
      render();
    }
    annotRefreshStatus();
  }

  async function annotToggle() {
    const lang = annotLang();
    const btn = el("btnAnnotate");
    if (annot.on) {
      annot.on = false;
      annot.list = [];
      annotHideCard();
      annotRenderList();
      if (btn) { btn.classList.remove("active"); btn.textContent = lang === "es" ? "Anotar imagen" : "Annotate image"; }
      render();
      return;
    }
    if (!annotWcs()) { annotRefreshStatus(); return; }
    if (!annot.catalog) {
      try {
        if (btn) btn.disabled = true;
        await annotLoadCatalog();
      } catch (e) {
        showToast(lang === "es" ? "No se pudo cargar el catálogo de objetos" : "Could not load the object catalog", "err");
        return;
      } finally {
        if (btn) btn.disabled = false;
      }
    }
    annot.on = true;
    const n = annotCompute();
    if (btn) { btn.classList.add("active"); btn.textContent = lang === "es" ? "Ocultar anotaciones" : "Hide annotations"; }
    if (el("btnAnnotFlip")) el("btnAnnotFlip").style.display = "";
    render();
    logConsole(lang === "es" ? `Anotación: ${n} objetos del catálogo en el campo.` : `Annotation: ${n} catalog objects in the field.`, "info");
    if (!n) {
      const near = annot.nearest;
      showToast(near
        ? (lang === "es"
            ? `Campo escaso: nada del catálogo dentro del encuadre. Lo más cercano: ${near.name} a ${near.sep.toFixed(1)}° del centro.`
            : `Sparse field: nothing from the catalog inside the frame. Nearest: ${near.name} at ${near.sep.toFixed(1)}° from center.`)
        : (lang === "es" ? "Ningún objeto del catálogo en el campo con los filtros actuales" : "No catalog objects in the field with current filters"), "err");
    }
  }

  if (el("btnAnnotate")) el("btnAnnotate").addEventListener("click", annotToggle);
  if (el("btnAnnotExport")) el("btnAnnotExport").addEventListener("click", annotExportPng);
  ["chkAnnotG", "chkAnnotN", "chkAnnotC", "chkAnnotS"].forEach(id => {
    if (el(id)) el(id).addEventListener("change", () => { if (annot.on) { annotCompute(); render(); } });
  });
  if (el("sldAnnotMag")) el("sldAnnotMag").addEventListener("input", () => {
    if (el("valAnnotMag")) el("valAnnotMag").textContent = (parseFloat(el("sldAnnotMag").value) || 12).toFixed(1);
    if (annot.on) { annotCompute(); render(); }
  });
  if (el("btnAnnotFlip")) el("btnAnnotFlip").addEventListener("click", () => {
    annot.flip = -annot.flip;
    if (annot.on) { annotCompute(); render(); }
  });
  if (el("btnAnnotGoSolve")) el("btnAnnotGoSolve").addEventListener("click", () => {
    // Llevar al usuario a la sección de Plate Solving (pestaña Pre).
    const preBtn = document.querySelector('.piw-tab-btn[data-tab="tab-pre"]');
    if (preBtn) preBtn.click();
    const sec = el("btnSolveImage") ? el("btnSolveImage").closest(".piw-section") : null;
    if (sec) {
      sec.classList.remove("collapsed");
      sec.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });

  // --- F2: "Ver en el cielo" — Aladin Lite v3 (CDS), carga bajo demanda ---
  let _aladinReady = null;
  function annotLoadAladin() {
    if (_aladinReady) return _aladinReady;
    _aladinReady = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js";
      s.onload = () => {
        if (window.A && window.A.init) window.A.init.then(resolve, reject);
        else reject(new Error("Aladin unavailable"));
      };
      s.onerror = () => reject(new Error("download failed"));
      document.head.appendChild(s);
    }).catch(err => { _aladinReady = null; throw err; });
    return _aladinReady;
  }

  // Superpone la imagen del usuario EN COLOR sobre la vista de Aladin. Aladin Lite v3 no pinta
  // FITS de usuario en color (solo 1 canal + colormap; el color solo existe vía HiPS pre-teselado),
  // así que la incrustamos nosotros: un <canvas> reducido a color se coloca con una matriz AFÍN
  // calculada proyectando 3 esquinas de la imagen con world2pix, y se reajusta en cada zoom/pan.
  // La afín es exacta para campos pequeños (la proyección es localmente conforme).
  function annotSetupColorOverlay(aladin, img) {
    const mapDiv = el("aladinMap"), T = annotBuildTransform();
    if (!mapDiv || !T || typeof aladin.world2pix !== "function" || typeof displayImageDataFor !== "function") return;
    const MAX = 700;
    const sc = Math.min(1, MAX / Math.max(img.w, img.h));
    const fw = Math.max(1, Math.round(img.w * sc)), fh = Math.max(1, Math.round(img.h * sc));
    const cv2 = document.createElement("canvas");
    cv2.width = fw; cv2.height = fh;
    try {
      const full = displayImageDataFor(img);         // ImageData a color (estirado de pantalla incluido)
      const c1 = document.createElement("canvas"); c1.width = img.w; c1.height = img.h;
      c1.getContext("2d").putImageData(full, 0, 0);
      cv2.getContext("2d").drawImage(c1, 0, 0, fw, fh);
    } catch (e) { return; }
    if (getComputedStyle(mapDiv).position === "static") mapDiv.style.position = "relative";
    const wrap = document.createElement("div");     // recorta la imagen a los límites del mapa
    wrap.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:5;";
    cv2.style.cssText = "position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform;";
    wrap.appendChild(cv2);
    mapDiv.appendChild(wrap);
    // Esquinas de la imagen (px) → cielo; en cada frame se proyectan a pantalla y se resuelve la afín.
    const sky = [[0, 0], [img.w, 0], [0, img.h]].map(c => annotPxToSky(T, c[0], c[1]));
    const update = () => {
      const cnv = mapDiv.querySelector("canvas");
      const kk = (cnv && cnv.width) ? (cnv.clientWidth / cnv.width) : 1; // world2pix da px de canvas → CSS (HiDPI)
      let p;
      try { p = sky.map(s => aladin.world2pix(s.ra, s.dec)); } catch (e) { p = null; }
      if (!p || p.some(q => !q || !isFinite(q[0]) || !isFinite(q[1]))) { cv2.style.visibility = "hidden"; return; }
      const P = p.map(q => [q[0] * kk, q[1] * kk]);
      const a = (P[1][0] - P[0][0]) / fw, b = (P[1][1] - P[0][1]) / fw;
      const c = (P[2][0] - P[0][0]) / fh, d = (P[2][1] - P[0][1]) / fh;
      cv2.style.visibility = "visible";
      cv2.style.transform = "matrix(" + a + "," + b + "," + c + "," + d + "," + P[0][0] + "," + P[0][1] + ")";
    };
    update();
    try { aladin.on("zoomChanged", update); aladin.on("positionChanged", update); } catch (e) {}
    // La vista puede no estar lista en el primer frame: reintentos cortos.
    [150, 500, 1200].forEach(ms => setTimeout(update, ms));
  }

  async function annotOpenSky() {
    const lang = annotLang();
    const wcs = annotWcs(), img = state.activeImage;
    if (!wcs || !img) return;
    const panel = el("aladinPanel"), mapDiv = el("aladinMap");
    if (!panel || !mapDiv) return;
    try {
      showLoader(lang === "es" ? "Cargando Aladin Lite (CDS)..." : "Loading Aladin Lite (CDS)...");
      await annotLoadAladin();
    } catch (e) {
      hideLoader();
      showToast(lang === "es" ? "No se pudo cargar Aladin Lite (¿sin conexión?)" : "Could not load Aladin Lite (offline?)", "err");
      return;
    }
    hideLoader();
    panel.style.display = "flex";
    mapDiv.innerHTML = ""; // reinicio limpio en cada apertura (instancia ligera)
    const aladin = window.A.aladin(mapDiv, {
      survey: "P/DSS2/color",
      fov: Math.max(0.3, (wcs.radius || 1) * 4),
      target: wcs.ra.toFixed(5) + " " + (wcs.dec >= 0 ? "+" : "") + wcs.dec.toFixed(5),
      cooFrame: "ICRSd",
      showProjectionControl: false,
      showContextMenu: false
    });
    if (window.__piwAnnot) window.__piwAnnot._aladin = aladin; // solo test (hook e2e)
    // Imagen del usuario EN COLOR: Aladin Lite v3 no puede pintar FITS de usuario en color, así
    // que la incrustamos NOSOTROS como un <canvas> HTML superpuesto sobre la vista, siguiendo al
    // cielo: en cada zoom/pan proyectamos 3 esquinas con world2pix y aplicamos una transform afín
    // (exacta para campos pequeños). El cielo DSS a color queda de fondo intacto.
    annotSetupColorOverlay(aladin, img);

    // Huella de la imagen (resalte naranja): esquinas px → cielo.
    const T = annotBuildTransform();
    if (T) {
      const corners = [[0, 0], [img.w, 0], [img.w, img.h], [0, img.h]].map(c => {
        const sSky = annotPxToSky(T, c[0], c[1]);
        return [sSky.ra, sSky.dec];
      });
      const ov = window.A.graphicOverlay({ color: "#ffb347", lineWidth: 2 });
      aladin.addOverlay(ov);
      ov.add(window.A.polygon(corners));
    }
  }
  if (el("btnAnnotSky")) el("btnAnnotSky").addEventListener("click", annotOpenSky);
  if (el("btnAladinClose")) el("btnAladinClose").addEventListener("click", () => {
    const p = el("aladinPanel");
    if (p) p.style.display = "none";
  });

  // Hook de test (solo con ?e2ehook=1, igual que __piwTest en 20).
  if (typeof window !== "undefined" && window.location.search.includes("e2ehook=1")) {
    window.__piwAnnot = {
      annot, annotBuildTransform, annotSkyToPx, annotPxToSky, annotCompute, annotToggle, annotJpegDims, annotWcs,
      annotLoadCatalog, annotRefreshStatus, annotSetupColorOverlay,
      _setWcs: (w) => { state.wcs = w; }   // solo para tests: inyectar una solución astrométrica
    };
  }
