/* =========================================================================
 * autoghs.js — AutoGHS para web (librería sin dependencias de UI).
 *
 * Algoritmo portado VERBATIM desde nuestro AutoGHS de PI Workflow
 * (AutoGHS_proto.js). Matemática GHS: ghsastro.co.uk (Payne & Cranfield).
 * Implementación independiente (clean-room), NO derivada de VeraLux (GPL).
 *
 * Expone window.AutoGHS con:
 *   - process(srcChannels, n, nc, isColor, cfg) -> { channels, log }
 *   - defaultConfig() -> cfg con los defaults validados
 *   - ghsMake / medianMAD                      (matemática expuesta por si acaso)
 *   - loadFromFile(file) -> Promise<{ ch, w, h, nc, isColor }>   (PNG/JPEG/TIFF/FITS)
 *   - normalizeByMax(ch, n, nc) / capChannels(ch, w, h, nc, maxDim)
 *   - channelsToImageData(ch, w, h, nc) -> ImageData
 *
 * TIFF de 16/32 bits requiere la librería global UTIF (incluir su <script>
 * antes que éste). PNG/JPEG y FITS no requieren dependencias.
 * ========================================================================= */
(function (root) {
  "use strict";

  /* ----------------------------------------------------------- GHS MATH ---- */
  function ghsBaseT(x, D, b) {
    if (b === -1)   return Math.log(1 + D * x);
    if (b < 0)      return (1 - Math.pow(1 - b * D * x, (b + 1) / b)) / (D * (b + 1));
    if (b === 0)    return 1 - Math.exp(-D * x);
    if (b === 1)    return 1 - 1 / (1 + D * x);
    /* b>0,b!=1 */  return 1 - Math.pow(1 + b * D * x, -1 / b);
  }
  function ghsBaseTp(x, D, b) {
    if (b === -1)   return D / (1 + D * x);
    if (b < 0)      return Math.pow(1 - b * D * x, 1 / b);
    if (b === 0)    return D * Math.exp(-D * x);
    if (b === 1)    return D * Math.pow(1 + D * x, -2);
    /* b>0,b!=1 */  return D * Math.pow(1 + b * D * x, -(1 + b) / b);
  }
  // Transformada GHS normalizada en x∈[0,1]. LP/SP/HP en [0,1], LP<SP<HP.
  function ghsMake(D, b, SP, LP, HP) {
    if (D <= 0) return function (x) { return x; };
    var tpLP = ghsBaseTp(SP - LP, D, b);
    var tpHP = ghsBaseTp(HP - SP, D, b);
    var tLP  = ghsBaseT(SP - LP, D, b);
    var tHP  = ghsBaseT(HP - SP, D, b);
    var q0 = -tLP + tpLP * (0 - LP);
    var q1 =  tHP + tpHP * (1 - HP);
    var den = (q1 - q0) || 1e-12;
    return function (x) {
      var q;
      if (x < LP)      q = -tLP + tpLP * (x - LP);
      else if (x < SP) q = -ghsBaseT(SP - x, D, b);
      else if (x < HP) q =  ghsBaseT(x - SP, D, b);
      else             q =  tHP + tpHP * (x - HP);
      var v = (q - q0) / den;
      return v < 0 ? 0 : (v > 1 ? 1 : v);
    };
  }
  function medianMAD(arr, n, maxSamples) {
    var step = Math.max(1, Math.floor(n / maxSamples));
    var s = [];
    for (var i = 0; i < n; i += step) s.push(arr[i]);
    s.sort(function (a, b) { return a - b; });
    var med = s[s.length >> 1];
    var d = new Array(s.length);
    for (var j = 0; j < s.length; ++j) d[j] = Math.abs(s[j] - med);
    d.sort(function (a, b) { return a - b; });
    var mad = d[d.length >> 1];
    return { median: med, sigma: 1.4826 * mad };
  }

  // Ruido de FONDO robusto = 1.4826*MAD de la población oscura (30% más bajo de la submuestra),
  // como el analizador. A diferencia del MAD de todo el frame, sigue solo el ruido del CIELO, así
  // que la estructura de una nebulosa que llene el cuadro no lo infla -> válido como techo de ruido.
  function bgNoise(arr, n, maxSamples) {
    var step = Math.max(1, Math.floor(n / maxSamples));
    var s = [];
    for (var i = 0; i < n; i += step) s.push(arr[i]);
    s.sort(function (a, b) { return a - b; });
    var darkN = Math.max(8, Math.floor(s.length * 0.30));
    var dmed = s[darkN >> 1] || 0, dev = [];
    for (var j = 0; j < darkN; ++j) dev.push(Math.abs(s[j] - dmed));
    dev.sort(function (a, b) { return a - b; });
    return 1.4826 * (dev[dev.length >> 1] || 0);
  }

  function defaultConfig() {
    return {
      sigmasFromCenter: 1.0,
      stretchIntensity: 0.7,
      maxIterations: 10,
      targetMedian: 0.22,
      blackPointSigmas: 2.8,
      highlightProtect: 0.92,
      localIntensity_b: 1.0,
      colorMode: "luminance",                  // "luminance" | "rgb"
      lumWeights: [0.2126, 0.7152, 0.0722],    // Rec.709
      maxStatsSamples: 300000,
      // --- Portados de AutoGHS de PI Workflow (Dev_200) ---
      // SATURACIÓN: en modo luminancia, cada canal = canal*ghs(L)/L mantiene el ratio RGB lineal,
      // lo que SOBRE-satura la señal muy realzada y quema el canal dominante de estrellas brillantes.
      // Con sat<1 mezclamos cada canal hacia la luminancia estirada Ls=ghs(L):
      //   out = Ls + sat*(canal*ghs(L)/L - Ls).  sat=1 -> color pleno (comportamiento antiguo).
      saturation: 0.92,
      // BG-FLOOR: elevación final del punto negro para que el fondo caiga aquí en vez de en 0 (negro
      // puro). Mapa afín una vez tras las iteraciones: out = floor + in*(1-floor). 0 = desactivado.
      backgroundFloor: 0.05,
      // NOISE-CEILING: la parada por mediana objetivo fuerza el estirado necesario para alcanzarla,
      // lo que en datos débiles/bajo SNR amplifica el ruido del cielo sin límite. Con techo>0 el bucle
      // TAMBIÉN para cuando el ruido de fondo post-estirado lo alcanza. 0 = desactivado (por defecto).
      noiseCeiling: 0
    };
  }

  // Procesa SIN mutar la entrada: clona los canales y ejecuta el GHS iterativo
  // re-anclado. Devuelve { channels, log }. Cada llamada parte del original.
  function process(srcChannels, n, nc, isColor, cfg) {
    var ch = [];
    for (var c = 0; c < nc; ++c) ch[c] = Float32Array.from(srcChannels[c]);
    var wl = cfg.lumWeights;
    var lum = new Float32Array(n);
    function computeLum() {
      if (isColor) for (var i = 0; i < n; ++i) lum[i] = wl[0]*ch[0][i] + wl[1]*ch[1][i] + wl[2]*ch[2][i];
      else         for (var k = 0; k < n; ++k) lum[k] = ch[0][k];
    }
    var D = Math.exp(cfg.stretchIntensity) - 1;
    var b = cfg.localIntensity_b;
    var iters = Math.max(1, Math.round(cfg.maxIterations));
    var sat = isFinite(cfg.saturation) ? cfg.saturation : 1;
    if (sat < 0) sat = 0;
    var noiseCeiling = isFinite(cfg.noiseCeiling) ? cfg.noiseCeiling : 0;
    var log = [];

    for (var iter = 1; iter <= iters; ++iter) {
      // 1) estadística robusta de la luminancia actual
      computeLum();
      var st = medianMAD(lum, n, cfg.maxStatsSamples);

      // 2) punto negro a la izquierda (ajuste de fondo)
      var bp = st.median - cfg.blackPointSigmas * st.sigma;
      if (bp < 0) bp = 0;
      if (bp > st.median) bp = st.median;
      var bpDen = (1 - bp) || 1e-6;
      if (bp > 0) for (var c2 = 0; c2 < nc; ++c2) {
        var a = ch[c2];
        for (var i2 = 0; i2 < n; ++i2) { var v = (a[i2] - bp) / bpDen; a[i2] = v < 0 ? 0 : v; }
      }

      // 3) re-anclado tras el punto negro
      computeLum();
      var st2 = medianMAD(lum, n, cfg.maxStatsSamples);
      var SP = st2.median + cfg.sigmasFromCenter * st2.sigma;
      var HP = cfg.highlightProtect;
      if (SP < 0.0001) SP = 0.0001;
      if (SP > HP - 0.0001) SP = HP - 0.0001;
      var ghs = ghsMake(D, b, SP, 0.0, HP);

      // 4) aplica la transformada — en modo luminancia con amortiguación de croma hacia la
      //    luminancia estirada (saturation) para domar la sobre-saturación y el quemado de núcleos.
      if (cfg.colorMode === "rgb" || !isColor) {
        for (var c3 = 0; c3 < nc; ++c3) { var a3 = ch[c3]; for (var i3 = 0; i3 < n; ++i3) a3[i3] = ghs(a3[i3]); }
      } else {
        for (var i4 = 0; i4 < n; ++i4) {
          var r0 = ch[0][i4], g0 = ch[1][i4], b0 = ch[2][i4];
          var L = wl[0]*r0 + wl[1]*g0 + wl[2]*b0;
          if (L < 1e-6) continue;
          var Ls = ghs(L);        // luminancia estirada (el objetivo neutro)
          var f = Ls / L;         // realce por píxel (== ghs(L)/L)
          var r = Ls + sat*(r0*f - Ls);
          var g = Ls + sat*(g0*f - Ls);
          var bl = Ls + sat*(b0*f - Ls);
          ch[0][i4] = r < 0 ? 0 : (r > 1 ? 1 : r);
          ch[1][i4] = g < 0 ? 0 : (g > 1 ? 1 : g);
          ch[2][i4] = bl < 0 ? 0 : (bl > 1 ? 1 : bl);
        }
      }

      // 5) parada de seguridad por mediana objetivo (y por techo de ruido de fondo si está activo)
      computeLum();
      var st3 = medianMAD(lum, n, cfg.maxStatsSamples);
      var bgN3 = (noiseCeiling > 0) ? bgNoise(lum, n, cfg.maxStatsSamples) : 0;
      log.push("iter " + iter + ": med " + st.median.toFixed(4) +
               " → bp " + bp.toFixed(4) + ", SP " + SP.toFixed(4) +
               ", D " + D.toFixed(3) + " ⇒ med " + st3.median.toFixed(4) +
               (noiseCeiling > 0 ? ", ruidoBg " + bgN3.toFixed(4) : ""));
      if (st3.median >= cfg.targetMedian) { log.push("mediana objetivo alcanzada, stop."); break; }
      if (noiseCeiling > 0 && bgN3 >= noiseCeiling) {
        log.push("techo de ruido de fondo alcanzado (" + bgN3.toFixed(4) + " >= " +
                 noiseCeiling.toFixed(3) + "), stop para no amplificar ruido.");
        break;
      }
    }

    // BG-FLOOR: eleva el fondo desde negro puro hasta el suelo configurado (afín: 0→floor, 1→1).
    // Una sola pasada por todos los canales tras el bucle.
    var bgFloor = isFinite(cfg.backgroundFloor) ? cfg.backgroundFloor : 0;
    if (bgFloor > 0) {
      var bgScale = 1 - bgFloor;
      for (var cf = 0; cf < nc; ++cf) {
        var af = ch[cf];
        for (var ifx = 0; ifx < n; ++ifx) {
          var vf = bgFloor + af[ifx] * bgScale;
          af[ifx] = vf < 0 ? 0 : (vf > 1 ? 1 : vf);
        }
      }
      log.push("fondo elevado al suelo " + bgFloor.toFixed(3) + ".");
    }
    return { channels: ch, log: log };
  }

  /* ----------------------------------------------------------- HELPERS ----- */
  // Normaliza por el máximo global (preserva ratios de color y la distribución
  // lineal; robusto a 8/16/32 bits y rangos arbitrarios).
  function normalizeByMax(ch, n, nc) {
    var mx = 0;
    for (var c = 0; c < nc; ++c) { var a = ch[c]; for (var i = 0; i < n; ++i) if (a[i] > mx) mx = a[i]; }
    if (mx <= 0) mx = 1;
    var inv = 1 / mx;
    for (var c2 = 0; c2 < nc; ++c2) { var a2 = ch[c2]; for (var i2 = 0; i2 < n; ++i2) a2[i2] *= inv; }
  }
  // Submuestreo nearest para topar la resolución de trabajo.
  function capChannels(ch, w, h, nc, maxDim) {
    var lng = Math.max(w, h);
    if (lng <= maxDim) return { ch: ch, w: w, h: h };
    // Reescala a EXACTAMENTE el cap (lado largo = maxDim) con promediado por AREA (alta calidad),
    // en vez del antiguo factor entero + vecino-mas-cercano (que daba p.ej. 6012->3006 y aliasing).
    var scale = maxDim / lng;
    var nw = Math.max(1, Math.round(w * scale));
    var nh = Math.max(1, Math.round(h * scale));
    var sx = w / nw, sy = h / nh; // tamaño de celda fuente por pixel destino (>= 1)
    var out = [];
    for (var c = 0; c < nc; ++c) {
      var a = ch[c], o = new Float32Array(nw * nh);
      for (var y = 0; y < nh; ++y) {
        var y0 = (y * sy) | 0, y1 = Math.min(h, ((y + 1) * sy) | 0); if (y1 <= y0) y1 = y0 + 1;
        for (var x = 0; x < nw; ++x) {
          var x0 = (x * sx) | 0, x1 = Math.min(w, ((x + 1) * sx) | 0); if (x1 <= x0) x1 = x0 + 1;
          var sum = 0, cnt = 0;
          for (var yy = y0; yy < y1; ++yy) { var row = yy * w; for (var xx = x0; xx < x1; ++xx) { sum += a[row + xx]; cnt++; } }
          o[y * nw + x] = sum / cnt;
        }
      }
      out[c] = o;
    }
    return { ch: out, w: nw, h: nh };
  }
  function clamp255(x) { return x <= 0 ? 0 : (x >= 1 ? 255 : (x * 255 + 0.5) | 0); }
  function channelsToImageData(ch, w, h, nc) {
    var id = new ImageData(w, h), d = id.data, n = w * h;
    for (var i = 0, p = 0; i < n; ++i, p += 4) {
      if (nc >= 3) { d[p] = clamp255(ch[0][i]); d[p+1] = clamp255(ch[1][i]); d[p+2] = clamp255(ch[2][i]); }
      else { var vv = clamp255(ch[0][i]); d[p] = vv; d[p+1] = vv; d[p+2] = vv; }
      d[p+3] = 255;
    }
    return id;
  }

  /* ----------------------------------------------------------- LOADERS ----- */
  // Movidos a io.js (window.ImgIO), modulo propio de E/S (mejora A3). Delegados para
  // mantener intacto el API publico window.AutoGHS que usa pi-workflow.js.
  function loadFromFile(file) { return root.ImgIO.loadFromFile(file); }
  function parseFITS(buffer) { return root.ImgIO.parseFITS(buffer); }
  function parseXISF(buffer) { return root.ImgIO.parseXISF(buffer); }

  root.AutoGHS = {
    process: process,
    defaultConfig: defaultConfig,
    ghsMake: ghsMake,
    medianMAD: medianMAD,
    loadFromFile: loadFromFile,
    parseFITS: parseFITS,
    parseXISF: parseXISF,
    normalizeByMax: normalizeByMax,
    capChannels: capChannels,
    channelsToImageData: channelsToImageData
  };
})(typeof window !== "undefined" ? window : this);
