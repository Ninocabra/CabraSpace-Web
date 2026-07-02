
  // --- U7: NOMBRES ACCESIBLES (aria-label) ---
  // En vez de escribir 138 aria-label a mano en el HTML (y duplicarlos en el i18n del EN),
  // los DERIVAMOS en runtime del texto que YA está junto a cada control (.piw-label del grupo,
  // cabecera de subcard o título de sección). Así el nombre accesible sale automáticamente en
  // el idioma correcto (lee el DOM ya traducido) y no se desincroniza. Idempotente: nunca
  // pisa un aria-label/title/label existente. Un MutationObserver debounced reaplica el pase a
  // los controles inyectados por JS después del arranque (sliders de recetas de banda estrecha
  // cargados por fetch, capas de mezcla, etc.). Los pocos textos propios (slots, lienzos) usan
  // el idioma del documento, igual que el resto de la UI.
  (function () {
    const lang = document.documentElement.lang || "es";
    const t = (es, en) => (lang === "es" ? es : en);
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

    // ¿Tiene ya nombre accesible? (label asociado, envolvente, aria-label o title)
    function hasName(node) {
      if (node.getAttribute("aria-label") || node.getAttribute("aria-labelledby") || node.title) return true;
      if (node.id && document.querySelector('label[for="' + CSS.escape(node.id) + '"]')) return true;
      if (node.closest("label")) return true;
      return false;
    }

    // Texto descriptivo más cercano hacia arriba para un control de formulario.
    function deriveLabel(ctrl) {
      const grp = ctrl.closest(".piw-control-group");
      if (grp) {
        const lbl = grp.querySelector(".piw-label");
        if (lbl && clean(lbl.textContent)) return clean(lbl.textContent);
      }
      // select/entrada suelta: cabecera de subcard o título de sección
      const sub = ctrl.closest(".piw-subcard");
      if (sub) {
        const hd = sub.querySelector(".piw-subcard-header");
        if (hd && clean(hd.textContent)) return clean(hd.textContent);
      }
      const sec = ctrl.closest(".piw-section");
      if (sec) {
        const tl = sec.querySelector(".piw-section-title");
        if (tl && clean(tl.textContent)) return clean(tl.textContent);
      }
      return "";
    }

    function applyLabels() {
      let n = 0;
      // 1) Controles de formulario sin nombre: aria-label derivado del contexto.
      document.querySelectorAll(
        ".piw-preview-panel input, .piw-preview-panel select, .piw-container input, .piw-container select"
      ).forEach((ctrl) => {
        if (hasName(ctrl)) return;
        let label = deriveLabel(ctrl);
        if (!label && ctrl.type === "file") label = t("Seleccionar archivo", "Choose file");
        if (label) { ctrl.setAttribute("aria-label", label); n++; }
      });

      // 2) Slots de memoria (texto visible "1"/"M1" poco descriptivo para lectores de pantalla).
      document.querySelectorAll(".piw-slot-btn[data-slot]").forEach((b) => {
        if (!hasName(b)) { b.setAttribute("aria-label", t("Slot de imagen ", "Image slot ") + b.dataset.slot); n++; }
      });
      document.querySelectorAll(".piw-slot-btn[data-mask-slot]").forEach((b) => {
        if (!hasName(b)) { b.setAttribute("aria-label", t("Slot de máscara ", "Mask slot ") + b.dataset.maskSlot); n++; }
      });

      // 3) Lienzos/SVG interactivos.
      const canvasNames = {
        piwCanvas: t("Visor de imagen", "Image viewer"),
        curvesCanvas: t("Editor de curvas", "Curves editor"),
        maskColorWheel: t("Rueda de color de máscara", "Mask color wheel"),
        histogramSvg: t("Histograma", "Histogram")
      };
      Object.keys(canvasNames).forEach((id) => {
        const node = document.getElementById(id);
        if (node && !node.getAttribute("aria-label")) {
          node.setAttribute("role", "img");
          node.setAttribute("aria-label", canvasNames[id]);
          n++;
        }
      });
      return n;
    }

    const total = applyLabels();
    if (window.location.search.includes("e2ehook=1")) console.log("[a11y] aria-labels iniciales: " + total);

    // Reaplicar (debounced) cuando se inyectan controles nuevos por JS tras el arranque.
    let raf = 0;
    const root = document.querySelector(".piw-container") || document.body;
    const obs = new MutationObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; applyLabels(); });
    });
    obs.observe(root, { childList: true, subtree: true });
    // Red de seguridad para contenido que se construye en varios pasos de forma asíncrona
    // (p. ej. los sliders de recetas de banda estrecha: primero el input, luego su .piw-label;
    // si el observer corre justo en medio, el control quedaría sin texto). Dos pasadas tardías
    // recogen lo que el observer no vio ya asentado. Idempotentes (no repiten trabajo).
    setTimeout(applyLabels, 600);
    setTimeout(applyLabels, 2000);
    // Exponer para el hook de test (verificación determinista sin esperar al observer).
    window.__piwApplyA11y = applyLabels;
  })();
