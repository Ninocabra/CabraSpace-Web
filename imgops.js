/* =========================================================================
 * imgops.js — Operaciones de imagen PURAS y serializables (sin DOM).
 *
 * Contiene la matemática de Color Mixer, Detail & Contrast, Curvas, Balance de
 * Color y Estirados en funciones puras (reciben {ch,w,h,nc,isColor} + params
 * planos, devuelven una imagen nueva), de modo que sirven IGUAL en el hilo
 * principal (preview Live/proxy) y en un Web Worker (aplicar a resolución
 * completa sin congelar la UI).
 *
 * Dependencias (cargar antes): imgproc.js (ImgProc) siempre; lut.js (LUT) para
 * curvas/estirados; autoghs.js (AutoGHS) para los estirados "stf" y "ghs".
 * Expone (window|self).ImgOps.
 * ========================================================================= */
(function (root) {
  "use strict";
  var IP = root.ImgProc; // primitivas comunes (blur, clamp)
  var clamp01 = IP.clamp01;

  // --- COLOR MIXER (color selectivo por 8 bandas de tono) ---
  var CM_CENTERS = [0, 30, 60, 120, 180, 240, 275, 315]; // red, orange, yellow, green, cyan, blue, purple, magenta
  var CM_AXIS = 1 / Math.sqrt(3);
  var CM_POS_LUM_GAIN = 0.5;
  function cmSmooth(a, b, x) { if (a >= b) return x < a ? 0 : 1; var t = (x - a) / (b - a); t = t < 0 ? 0 : (t > 1 ? 1 : t); return t * t * (3 - 2 * t); }
  function cmApplyPixel(R, G, B, p, mask, satBase, lumBase, hasHue, hueRad) {
    var rr = R[p], gg = G[p], bb = B[p];
    var y = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
    var cr = rr - y, cg = gg - y, cb = bb - y;
    var satScale = 1 + satBase * mask; if (satScale < 0) satScale = 0;
    cr *= satScale; cg *= satScale; cb *= satScale;
    if (hasHue) {
      var ang = hueRad * mask, cosA = Math.cos(ang), sinA = Math.sin(ang), invc = 1 - cosA, ax = CM_AXIS, ay = CM_AXIS, az = CM_AXIS;
      var dot = cr * ax + cg * ay + cb * az;
      var xr = ay * cb - az * cg, xg = az * cr - ax * cb, xb = ax * cg - ay * cr;
      cr = cr * cosA + xr * sinA + ax * dot * invc; cg = cg * cosA + xg * sinA + ay * dot * invc; cb = cb * cosA + xb * sinA + az * dot * invc;
    }
    var y2 = lumBase >= 0 ? y + (lumBase * CM_POS_LUM_GAIN) * mask * (1 - y) : y + lumBase * mask * y;
    R[p] = clamp01(y2 + cr); G[p] = clamp01(y2 + cg); B[p] = clamp01(y2 + cb);
  }
  function cmHasWork(st) { for (var i = 0; i < st.bands.length; i++) { var b = st.bands[i]; if (Math.abs(b.hueShift) > 1e-6 || Math.abs(b.saturation) > 1e-6 || Math.abs(b.luminance) > 1e-6) return true; } return false; }
  function computeColorMixer(srcImg, st) {
    if (!srcImg.isColor || srcImg.nc < 3) throw new Error("Color Mixer requiere imagen RGB.");
    var w = srcImg.w, h = srcImg.h, count = w * h;
    if (!cmHasWork(st)) return { ch: [Float32Array.from(srcImg.ch[0]), Float32Array.from(srcImg.ch[1]), Float32Array.from(srcImg.ch[2])], w: w, h: h, nc: 3, isColor: true, wcs: srcImg.wcs };
    var R = Float32Array.from(srcImg.ch[0]), G = Float32Array.from(srcImg.ch[1]), B = Float32Array.from(srcImg.ch[2]);
    var srcH = new Float32Array(count), srcS = new Float32Array(count), srcL = new Float32Array(count);
    for (var i = 0; i < count; i++) {
      var r = R[i], g = G[i], b = B[i]; var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, li = (mx + mn) * 0.5, hue = 0, sat = 0;
      if (d > 1e-7) { sat = li > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); if (mx === r) hue = ((g - b) / d) % 6; else if (mx === g) hue = (b - r) / d + 2; else hue = (r - g) / d + 4; hue *= 60; if (hue < 0) hue += 360; }
      srcH[i] = hue; srcS[i] = sat; srcL[i] = li;
    }
    var gs = st.globalStrength != null ? st.globalStrength : 1;
    for (var bi = 0; bi < st.bands.length; bi++) {
      var band = st.bands[bi];
      var satBase = band.saturation / 100, lumBase = band.luminance / 100, hueRad = band.hueShift * Math.PI / 180, hasHue = Math.abs(band.hueShift) > 1e-6;
      if (Math.abs(satBase) < 1e-6 && Math.abs(lumBase) < 1e-6 && !hasHue) continue;
      var outerW = band.width, innerW = band.feather <= 1e-6 ? outerW : outerW * (1 - band.feather), featherDen = outerW - innerW, center = band.center;
      for (var p = 0; p < count; p++) {
        var delta = Math.abs((srcH[p] % 360) - center); var dist = delta < (360 - delta) ? delta : (360 - delta);
        var hueMask; if (dist <= innerW + 1e-6) hueMask = 1; else if (dist <= outerW + 1e-6 && featherDen > 1e-6) { var t = (dist - innerW) / featherDen; t = t < 0 ? 0 : (t > 1 ? 1 : t); hueMask = 1 - (t * t * (3 - 2 * t)); } else continue;
        if (hueMask <= 0) continue;
        var s = srcS[p], l = srcL[p];
        var satMask = st.protectLowSat ? cmSmooth(st.satFloor, st.satFull, s) : 1;
        var darkMask = cmSmooth(st.darkFloor, st.darkFull, l);
        var hiMask = st.protectStars ? (1 - cmSmooth(st.highlightStart, st.highlightFull, l)) : 1;
        var m = hueMask * satMask * darkMask * hiMask * gs;
        if (m > 0) cmApplyPixel(R, G, B, p, m, satBase, lumBase, hasHue, hueRad);
      }
    }
    return { ch: [R, G, B], w: w, h: h, nc: 3, isColor: true, wcs: srcImg.wcs };
  }

  // --- DETAIL & CONTRAST (sobre luminancia; reaplica el DELTA de luma para preservar color) ---
  function detailAtrous(Y, w, h, gains) { var count = w * h, out = new Float32Array(count); var cur = Y; for (var i = 0; i < count; i++) out[i] = Y[i]; for (var k = 0; k < gains.length; k++) { var g = gains[k], blur = IP.boxBlur(cur, w, h, 1 << k); if (g !== 0) for (var p = 0; p < count; p++) out[p] += g * (cur[p] - blur[p]); cur = blur; } return out; }
  function detailApplyLuma(srcImg, lumaFn) {
    var w = srcImg.w, h = srcImg.h, count = w * h;
    if (srcImg.isColor && srcImg.nc >= 3) {
      var R = Float32Array.from(srcImg.ch[0]), G = Float32Array.from(srcImg.ch[1]), B = Float32Array.from(srcImg.ch[2]);
      var Y = new Float32Array(count); for (var i = 0; i < count; i++) Y[i] = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i];
      var nY = lumaFn(Y, w, h);
      for (var j = 0; j < count; j++) { var dlt = nY[j] - Y[j]; R[j] = clamp01(R[j] + dlt); G[j] = clamp01(G[j] + dlt); B[j] = clamp01(B[j] + dlt); }
      return { ch: [R, G, B], w: w, h: h, nc: 3, isColor: true, wcs: srcImg.wcs };
    }
    var C = Float32Array.from(srcImg.ch[0]); var nC = lumaFn(C, w, h); for (var q = 0; q < count; q++) C[q] = clamp01(nC[q]);
    return { ch: [C], w: w, h: h, nc: 1, isColor: false, wcs: srcImg.wcs };
  }
  function computeDetail(srcImg, algo, pr) {
    if (algo === "localContrast") return detailApplyLuma(srcImg, function (Y, w, h) { var bl = IP.boxBlur(Y, w, h, Math.max(2, Math.round(pr.lcRadius))); var o = new Float32Array(w * h); for (var i = 0; i < o.length; i++) o[i] = Y[i] + pr.lcAmount * (Y[i] - bl[i]); return o; });
    if (algo === "highPass") return detailApplyLuma(srcImg, function (Y, w, h) { var bl = IP.boxBlur(Y, w, h, Math.max(1, Math.round(pr.hpRadius))); var o = new Float32Array(w * h); for (var i = 0; i < o.length; i++) o[i] = Y[i] + pr.hpAmount * (Y[i] - bl[i]); return o; });
    if (algo === "multiscale") return detailApplyLuma(srcImg, function (Y, w, h) { return detailAtrous(Y, w, h, [pr.mdFine, pr.mdMedium, pr.mdMedium * 0.5]); });
    return { ch: srcImg.ch.map(function (c) { return Float32Array.from(c); }), w: srcImg.w, h: srcImg.h, nc: srcImg.nc, isColor: srcImg.isColor, wcs: srcImg.wcs };
  }

  // --- MUESTREO ESTADÍSTICO (ports exactos de fastSampledMedian/fastSampledMAD/_ssStd de
  // pi-workflow.js): mediana/MAD/desviación por submuestreo regular (≤500k muestras) para
  // que el coste sea constante respecto al tamaño real de la imagen. ---
  var SAMPLED_MAX = 500000;
  function _sampleChannel(ch) {
    var n = ch.length;
    if (n <= SAMPLED_MAX) return Float32Array.from(ch);
    var arr = new Float32Array(SAMPLED_MAX), step = Math.floor(n / SAMPLED_MAX);
    for (var i = 0; i < SAMPLED_MAX; i++) arr[i] = ch[i * step];
    return arr;
  }
  function sampledMedian(ch) {
    var arr = _sampleChannel(ch);
    arr.sort();
    var mid = arr.length >> 1;
    return arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) * 0.5 : arr[mid];
  }
  function sampledMAD(ch, median) {
    var arr = _sampleChannel(ch);
    for (var i = 0; i < arr.length; i++) arr[i] = Math.abs(arr[i] - median);
    arr.sort();
    var mid = arr.length >> 1;
    return arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) * 0.5 : arr[mid];
  }
  function sampledStd(ch) {
    var s = _sampleChannel(ch);
    var mean = 0; for (var i = 0; i < s.length; i++) mean += s[i]; mean /= s.length;
    var v = 0; for (var j = 0; j < s.length; j++) { var d = s[j] - mean; v += d * d; }
    return Math.sqrt(v / s.length);
  }

  // --- SPLINES (ports exactos de getCubicSpline y curveEval de pi-workflow.js) ---
  // Spline cúbica monótona por puntos {x,y} (la del editor de Curvas K/R/G/B/S).
  function cubicSplineFn(points) {
    var n = points.length;
    if (n < 2) return function () { return 0; };
    if (n === 2) {
      var p0 = points[0], p1 = points[1];
      return function (x) { return p0.y + (x - p0.x) * (p1.y - p0.y) / ((p1.x - p0.x) || 1e-6); };
    }
    var dx = [], dy = [], ms = [];
    for (var i = 0; i < n - 1; i++) {
      dx[i] = points[i + 1].x - points[i].x;
      dy[i] = points[i + 1].y - points[i].y;
      ms[i] = dy[i] / (dx[i] || 1e-6);
    }
    var ds = [];
    ds[0] = ms[0];
    ds[n - 1] = ms[n - 2];
    for (var k = 1; k < n - 1; k++) {
      var m0 = ms[k - 1], m1 = ms[k];
      ds[k] = (m0 * m1 <= 0) ? 0 : (2 * m0 * m1 / (m0 + m1));
    }
    return function (x) {
      if (x <= points[0].x) return points[0].y;
      if (x >= points[n - 1].x) return points[n - 1].y;
      var idx = 0;
      for (var j = 0; j < n - 1; j++) {
        if (x >= points[j].x && x <= points[j + 1].x) { idx = j; break; }
      }
      var x0 = points[idx].x, x1 = points[idx + 1].x;
      var h = x1 - x0;
      var t = (x - x0) / (h || 1e-6);
      var a = points[idx].y;
      var b = h * ds[idx];
      var c = 3 * (points[idx + 1].y - points[idx].y) - h * (2 * ds[idx] + ds[idx + 1]);
      var d = 2 * (points[idx].y - points[idx + 1].y) + h * (ds[idx] + ds[idx + 1]);
      return a + b * t + c * t * t + d * t * t * t;
    };
  }
  // Spline Hermite monótona (tangentes acotadas, salida clampada a [0,1]) por pares [x,y]
  // ordenados por x (la de la "Curva Manual" del estirado).
  function monotoneCurveFn(P) {
    return function (x) {
      var last = P.length - 1;
      if (x <= P[0][0]) return P[0][1];
      if (x >= P[last][0]) return P[last][1];
      var i = 0;
      while (i < last && x > P[i + 1][0]) i++;
      var x0 = P[i][0], y0 = P[i][1], x1 = P[i + 1][0], y1 = P[i + 1][1];
      var h = x1 - x0;
      if (h <= 1e-9) return y0;
      var sec = function (a, b) { return (P[b][1] - P[a][1]) / Math.max(1e-9, P[b][0] - P[a][0]); };
      var s = sec(i, i + 1);
      var m0 = (i > 0) ? (sec(i - 1, i) + s) / 2 : s;
      var m1 = (i < last - 1) ? (s + sec(i + 1, i + 2)) / 2 : s;
      if (s === 0) { m0 = 0; m1 = 0; } else {
        if (m0 / s < 0) m0 = 0; if (m1 / s < 0) m1 = 0;
        var a = m0 / s, b = m1 / s;
        if (a * a + b * b > 9) { var tau = 3 / Math.sqrt(a * a + b * b); m0 = tau * a * s; m1 = tau * b * s; }
      }
      var t = (x - x0) / h, t2 = t * t, t3 = t2 * t;
      var v = (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m1;
      return v < 0 ? 0 : (v > 1 ? 1 : v);
    };
  }

  // --- CURVAS (port exacto de computeCurvesImage de pi-workflow.js) ---
  // params.curves = { K,R,G,B,S: [{x,y},...] }. K primero, luego R/G/B por canal y S sobre la
  // saturación HSL. Requiere root.LUT.
  function computeCurves(srcImg, params) {
    var LUT = root.LUT;
    var cv = params.curves;
    var lutK = LUT.buildLUT(cubicSplineFn(cv.K));
    var lutR = LUT.buildLUT(cubicSplineFn(cv.R));
    var lutG = LUT.buildLUT(cubicSplineFn(cv.G));
    var lutB = LUT.buildLUT(cubicSplineFn(cv.B));
    var lutS = LUT.buildLUT(cubicSplineFn(cv.S));

    var w = srcImg.w, h = srcImg.h, nc = srcImg.nc;
    var isColor = srcImg.isColor || nc === 3;
    var size = w * h;
    var dstCh = [];
    for (var c = 0; c < nc; c++) dstCh.push(new Float32Array(size));
    var clampIdx = function (val) { var idx = Math.round(val * 65535); return idx < 0 ? 0 : (idx > 65535 ? 65535 : idx); };

    if (isColor && nc === 3) {
      var rSrc = srcImg.ch[0], gSrc = srcImg.ch[1], bSrc = srcImg.ch[2];
      var rDst = dstCh[0], gDst = dstCh[1], bDst = dstCh[2];
      var isSatModified = cv.S.some(function (p) { return Math.abs(p.x - p.y) > 1e-4; });
      for (var i = 0; i < size; i++) {
        var r = rSrc[i], g = gSrc[i], b = bSrc[i];
        r = lutK[clampIdx(r)]; g = lutK[clampIdx(g)]; b = lutK[clampIdx(b)];
        r = lutR[clampIdx(r)]; g = lutG[clampIdx(g)]; b = lutB[clampIdx(b)];
        if (isSatModified) {
          var max = r, min = r;
          if (g > max) max = g; if (b > max) max = b;
          if (g < min) min = g; if (b < min) min = b;
          var hh = 0, s = 0, l = (max + min) / 2;
          if (max !== min) {
            var d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) hh = (g - b) / d + (g < b ? 6 : 0);
            else if (max === g) hh = (b - r) / d + 2;
            else hh = (r - g) / d + 4;
            hh /= 6;
          }
          s = lutS[clampIdx(s)];
          if (s === 0) { r = g = b = l; }
          else {
            var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            var p2 = 2 * l - q;
            r = IP.hue2rgb(p2, q, hh + 1 / 3); g = IP.hue2rgb(p2, q, hh); b = IP.hue2rgb(p2, q, hh - 1 / 3);
          }
        }
        rDst[i] = r < 0 ? 0 : (r > 1 ? 1 : r);
        gDst[i] = g < 0 ? 0 : (g > 1 ? 1 : g);
        bDst[i] = b < 0 ? 0 : (b > 1 ? 1 : b);
      }
    } else {
      var srcCh = srcImg.ch[0], dstCh0 = dstCh[0];
      for (var q2 = 0; q2 < size; q2++) { var v = lutK[clampIdx(srcCh[q2])]; dstCh0[q2] = v < 0 ? 0 : (v > 1 ? 1 : v); }
    }
    return { ch: dstCh, w: w, h: h, nc: nc, isColor: isColor, wcs: srcImg.wcs };
  }

  // --- BALANCE DE COLOR (port exacto de computeColorBalanceImage de pi-workflow.js) ---
  // p = { rMult, gMult, bMult, satMult, scnrAmt } (scnrAmt 0 = sin SCNR verde).
  function computeColorBalance(srcImg, p) {
    var rMult = p.rMult, gMult = p.gMult, bMult = p.bMult, satMult = p.satMult;
    var scnrAmt = p.scnrAmt || 0;
    var img = { ch: srcImg.ch.map(function (c) { return Float32Array.from(c); }), w: srcImg.w, h: srcImg.h, nc: srcImg.nc, isColor: srcImg.isColor, wcs: srcImg.wcs };
    var n = img.w * img.h;
    var isColor = img.isColor;

    // 1. Multiplicadores RGB por canal
    var rCh = img.ch[0];
    if (rMult !== 1) {
      for (var i = 0; i < n; ++i) { rCh[i] = rCh[i] * rMult; if (rCh[i] > 1) rCh[i] = 1; else if (rCh[i] < 0) rCh[i] = 0; }
    }
    if (isColor) {
      var gCh = img.ch[1];
      if (gMult !== 1) {
        for (var i1 = 0; i1 < n; ++i1) { gCh[i1] = gCh[i1] * gMult; if (gCh[i1] > 1) gCh[i1] = 1; else if (gCh[i1] < 0) gCh[i1] = 0; }
      }
      var bCh = img.ch[2];
      if (bMult !== 1) {
        for (var i2 = 0; i2 < n; ++i2) { bCh[i2] = bCh[i2] * bMult; if (bCh[i2] > 1) bCh[i2] = 1; else if (bCh[i2] < 0) bCh[i2] = 0; }
      }
    }

    // 2. Ajuste de saturación vía HSL
    if (satMult !== 1 && isColor) {
      var rCh2 = img.ch[0], gCh2 = img.ch[1], bCh2 = img.ch[2];
      for (var i3 = 0; i3 < n; ++i3) {
        var rv = rCh2[i3], gv = gCh2[i3], bv = bCh2[i3];
        var mx = Math.max(rv, gv, bv);
        var mn = Math.min(rv, gv, bv);
        var d = mx - mn;
        if (d === 0) continue;
        var l = (mx + mn) / 2;
        var s = d / (l < 0.5 ? mx + mn : 2 - mx - mn);
        var sNew = s * satMult > 1 ? 1 : s * satMult < 0 ? 0 : s * satMult;
        var hh = rv === mx ? ((gv - bv) / d + (gv < bv ? 6 : 0)) / 6
              : gv === mx ? ((bv - rv) / d + 2) / 6
              :             ((rv - gv) / d + 4) / 6;
        var q2b = l < 0.5 ? l * (1 + sNew) : l + sNew - l * sNew;
        var p2b = 2 * l - q2b;
        rCh2[i3] = IP.hue2rgb(p2b, q2b, hh + 1 / 3);
        gCh2[i3] = IP.hue2rgb(p2b, q2b, hh);
        bCh2[i3] = IP.hue2rgb(p2b, q2b, hh - 1 / 3);
      }
    }

    // 3. SCNR Green (opcional)
    if (scnrAmt > 0 && isColor) {
      var rCh3 = img.ch[0], gCh3 = img.ch[1], bCh3 = img.ch[2];
      for (var i4 = 0; i4 < n; ++i4) {
        var limit = (rCh3[i4] + bCh3[i4]) / 2;
        if (gCh3[i4] > limit) gCh3[i4] = (1 - scnrAmt) * gCh3[i4] + scnrAmt * limit;
      }
    }
    return img;
  }

  // --- ESTIRADOS ---
  // Statistical Stretch de Seti Astro (port exacto de computeStatisticalStretchJS): por canal,
  // MAD robusto, punto de negro a sigma·MAD, normaliza [0,1] y MTF a la mediana objetivo.
  function computeStatisticalStretch(srcImg, target, sigma) {
    var w = srcImg.w, h = srcImg.h, n = w * h, nc = srcImg.nc;
    var out = [];
    for (var c = 0; c < nc; c++) {
      var ch = srcImg.ch[c];
      var med = sampledMedian(ch);
      var dev = sampledMAD(ch, med);
      if (dev < 1e-6) dev = sampledStd(ch);
      if (dev < 1e-6) dev = 0.001;
      var bp = Math.max(0, med - sigma * dev);
      var denom = 1 - bp; if (denom < 1e-6) denom = 1;
      var o = new Float32Array(n);
      for (var i = 0; i < n; i++) { var v = (ch[i] - bp) / denom; o[i] = v < 0 ? 0 : (v > 1 ? 1 : v); }
      var x = sampledMedian(o); if (x <= 0.0001) x = 0.002;
      var m = (target - 1) * x / (x * (2 * target - 1) - target);
      if (!isFinite(m)) m = 0.5;
      m = m < 0.0001 ? 0.0001 : (m > 0.9999 ? 0.9999 : m);
      var m2 = 2 * m - 1;
      for (var j = 0; j < n; j++) { var v2 = o[j]; var dm = m2 * v2 - m; if (Math.abs(dm) < 1e-12) dm = 1e-12; var r = (m - 1) * v2 / dm; o[j] = r < 0 ? 0 : (r > 1 ? 1 : r); }
      out.push(o);
    }
    return { ch: out, w: w, h: h, nc: nc, isColor: srcImg.isColor, wcs: srcImg.wcs };
  }

  // Auto STF por canal (port exacto de runAutoSTF de pi-workflow.js, sin el log por canal).
  // Muta img.ch. Requiere root.AutoGHS (medianMAD) y root.LUT.
  function autoSTFInPlace(img, targetBg, clipSigmas) {
    var LUT = root.LUT, AutoGHS = root.AutoGHS;
    var n = img.w * img.h;
    for (var c = 0; c < img.nc; ++c) {
      var ch = img.ch[c];
      var stats = AutoGHS.medianMAD(ch, n, 200000);
      var c0 = stats.median + clipSigmas * stats.sigma;
      if (c0 < 0) c0 = 0;
      if (c0 > stats.median) c0 = stats.median;
      var c0Den = (1 - c0) || 1e-6;
      var rescaledCh = new Float32Array(n);
      for (var i = 0; i < n; ++i) {
        var val = (ch[i] - c0) / c0Den;
        rescaledCh[i] = val < 0 ? 0 : (val > 1 ? 1 : val);
      }
      var stats2 = AutoGHS.medianMAD(rescaledCh, n, 100000);
      var mPrime = Math.max(0.0001, Math.min(0.9999, stats2.median));
      var m = ((targetBg - 1) * mPrime) / (2 * targetBg * mPrime - targetBg - mPrime);
      if (m > 0 && m < 1) {
        var m1 = m - 1;
        var m2 = 2 * m - 1;
        var mtfLut = LUT.buildLUT(function (x) {
          var den = m2 * x - m;
          return Math.abs(den) > 1e-12 ? Math.min(1, Math.max(0, (m1 * x) / den)) : x;
        }, 65536);
        img.ch[c] = LUT.applyLUT(rescaledCh, mtfLut);
      }
    }
  }

  // Motor de estirado (port de computeStretch de pi-workflow.js con params serializables en
  // lugar de lecturas de UI). No muta srcImg. params.algo y campos por algoritmo:
  //   "stf": { targetBg, clipSigmas } · "ghs": { cfg } (AutoGHS.defaultConfig + overrides)
  //   "stars": { amount, boost } · "statistical_stretch": { target, sigma }
  //   "curves": { points: [[x,y],...] }
  function computeStretch(srcImg, params) {
    var LUT = root.LUT;
    var img = { ch: srcImg.ch.map(function (c) { return Float32Array.from(c); }), w: srcImg.w, h: srcImg.h, nc: srcImg.nc, isColor: srcImg.isColor, wcs: srcImg.wcs };
    var algo = params.algo;
    if (algo === "stf") {
      autoSTFInPlace(img, params.targetBg, params.clipSigmas);
    } else if (algo === "ghs") {
      var res = root.AutoGHS.process(img.ch, img.w * img.h, img.nc, img.isColor, params.cfg);
      img.ch = res.channels;
    } else if (algo === "stars") {
      // STAR-STRETCH-SETIASTRO: f = 3^amount ; out = (f·x)/((f-1)·x + 1) por canal, y
      // Color Boost alrededor de la media RGB por píxel: out = media + (out-media)·boost.
      var f = Math.pow(3, params.amount);
      var denom = f - 1;
      var starLut = LUT.buildLUT(function (x) { var v = (f * x) / (denom * x + 1); return v < 0 ? 0 : (v > 1 ? 1 : v); }, 65536);
      for (var c = 0; c < img.nc; ++c) img.ch[c] = LUT.applyLUT(img.ch[c], starLut);
      var boost = params.boost != null ? params.boost : 1.0;
      if (img.isColor && img.nc >= 3 && Math.abs(boost - 1) > 1e-6) {
        var r = img.ch[0], g = img.ch[1], b = img.ch[2], nn = img.w * img.h;
        for (var i = 0; i < nn; ++i) {
          var m = (r[i] + g[i] + b[i]) / 3;
          var rr = m + (r[i] - m) * boost; var gg = m + (g[i] - m) * boost; var bb = m + (b[i] - m) * boost;
          r[i] = rr < 0 ? 0 : (rr > 1 ? 1 : rr);
          g[i] = gg < 0 ? 0 : (gg > 1 ? 1 : gg);
          b[i] = bb < 0 ? 0 : (bb > 1 ? 1 : bb);
        }
      }
    } else if (algo === "statistical_stretch") {
      img.ch = computeStatisticalStretch(img, params.target, params.sigma).ch;
    } else if (algo === "curves") {
      var fn = monotoneCurveFn(params.points);
      var lut = LUT.buildLUT(function (x) { return fn(x); }, 65536);
      for (var c2 = 0; c2 < img.nc; ++c2) img.ch[c2] = LUT.applyLUT(img.ch[c2], lut);
    }
    return img;
  }

  root.ImgOps = {
    computeColorMixer: computeColorMixer,
    computeDetail: computeDetail,
    computeCurves: computeCurves,
    computeColorBalance: computeColorBalance,
    computeStretch: computeStretch,
    computeStatisticalStretch: computeStatisticalStretch,
    cubicSplineFn: cubicSplineFn,
    monotoneCurveFn: monotoneCurveFn,
    sampledMedian: sampledMedian,
    sampledMAD: sampledMAD
  };
})(typeof window !== "undefined" ? window : self);
