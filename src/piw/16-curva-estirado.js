  // STRETCH-CURVE-BEGIN
  // Curva de estirado "Curva Manual / Sigmoide". Dos formas de definirla:
  //  - Sliders (rápidos): Punto Negro, Medios (MTF midtone) y Contraste (sigmoide) -> siembran puntos.
  //  - Editor de puntos: añadir (clic), arrastrar y quitar (doble clic) puntos sobre el histograma.
  // La curva final es una spline cúbica monótona (PCHIP) por los puntos. mover un slider re-siembra.
  let stretchPoints = [[0, 0], [1, 1]];

  function stretchCurveValue(x, black, mid, contrast) {
    let v = (x - black) / Math.max(1e-6, 1.0 - black);
    if (v < 0) v = 0; else if (v > 1) v = 1;
    if (Math.abs(mid - 0.5) > 1e-4) {
      const m = mid;
      const den = (2 * m - 1) * v - m;
      if (Math.abs(den) > 1e-12) v = ((m - 1) * v) / den;
    }
    if (Math.abs(contrast) > 1e-4) {
      const k = contrast * 6;
      const sig = (t) => 1 / (1 + Math.exp(-k * (t - 0.5)));
      const s0 = sig(0), s1 = sig(1);
      v = (sig(v) - s0) / (s1 - s0);
    }
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }

  function setStretchPointsFromSliders() {
    const black = parseFloat(el("sldStretchBlack").value);
    const mid = parseFloat(el("sldStretchMid").value);
    const contrast = parseFloat(el("sldStretchContrast").value);
    stretchPoints = [];
    for (let i = 0; i <= 8; i++) {
      const x = i / 8;
      stretchPoints.push([x, stretchCurveValue(x, black, mid, contrast)]);
    }
  }

  // Spline cúbica monótona (Hermite con tangentes acotadas) por stretchPoints (ordenados por x).
  // V2 (Fase 4): la matemática vive en ImgOps.monotoneCurveFn (imgops.js), compartida con el worker.
  function curveEval(x) {
    return window.ImgOps.monotoneCurveFn(stretchPoints)(x);
  }

  function drawStretchCurve() {
    const path = el("stretchCurvePath");
    if (!path) return;
    const W = 330, H = 60, pts = [];
    for (let i = 0; i <= 80; i++) {
      const x = i / 80;
      pts.push(`${(x * W).toFixed(1)},${((1 - curveEval(x)) * H).toFixed(1)}`);
    }
    path.setAttribute("d", `M ${pts.join(" L ")}`);
    const svg = path.ownerSVGElement;
    if (!svg) return;
    svg.querySelectorAll("circle.stretch-pt").forEach((c) => c.remove());
    const NS = "http://www.w3.org/2000/svg";
    stretchPoints.forEach((p) => {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("class", "stretch-pt");
      c.setAttribute("cx", (p[0] * W).toFixed(1));
      c.setAttribute("cy", ((1 - p[1]) * H).toFixed(1));
      c.setAttribute("r", "2.5");
      c.setAttribute("fill", "var(--gold-primary)");
      svg.appendChild(c);
    });
  }

  // Editor interactivo de puntos sobre el SVG del histograma de estirado.
  function setupStretchCurveEditor() {
    const svg = el("stretchCurvePath") && el("stretchCurvePath").ownerSVGElement;
    if (!svg) return;
    let dragIdx = -1;
    const toNorm = (ev) => {
      const r = svg.getBoundingClientRect();
      const x = (ev.clientX - r.left) / r.width;
      const y = 1 - (ev.clientY - r.top) / r.height;
      return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
    };
    const findNear = (x, y) => {
      for (let i = 0; i < stretchPoints.length; i++) {
        const dx = stretchPoints[i][0] - x, dy = stretchPoints[i][1] - y;
        if (dx * dx + dy * dy < 0.0016) return i;
      }
      return -1;
    };
    svg.style.cursor = "crosshair";
    svg.addEventListener("pointerdown", (ev) => {
      const [x, y] = toNorm(ev);
      let idx = findNear(x, y);
      if (idx < 0) {
        stretchPoints.push([x, y]);
        stretchPoints.sort((a, b) => a[0] - b[0]);
        idx = stretchPoints.findIndex((p) => p[0] === x && p[1] === y);
      }
      dragIdx = idx;
      drawStretchCurve();
      ev.preventDefault();
    });
    window.addEventListener("pointermove", (ev) => {
      if (dragIdx < 0) return;
      const [x, y] = toNorm(ev);
      const isEnd = dragIdx === 0 || dragIdx === stretchPoints.length - 1;
      const px = isEnd ? stretchPoints[dragIdx][0]
        : Math.max(stretchPoints[dragIdx - 1][0] + 0.005, Math.min(stretchPoints[dragIdx + 1][0] - 0.005, x));
      stretchPoints[dragIdx] = [px, y];
      drawStretchCurve();
    });
    window.addEventListener("pointerup", () => { dragIdx = -1; });
    svg.addEventListener("dblclick", (ev) => {
      const [x, y] = toNorm(ev);
      const idx = findNear(x, y);
      if (idx > 0 && idx < stretchPoints.length - 1) {
        stretchPoints.splice(idx, 1);
        drawStretchCurve();
      }
    });
  }
  setStretchPointsFromSliders();
  setupStretchCurveEditor();
  // STRETCH-CURVE-END

