/* =========================================================================
 * imgops.js — Operaciones de imagen PURAS y serializables (sin DOM).
 *
 * Contiene la matemática de Color Mixer y Detail & Contrast en funciones puras
 * (reciben {ch,w,h,nc,isColor} + params planos, devuelven una imagen nueva), de
 * modo que sirven IGUAL en el hilo principal (preview Live) y en un Web Worker
 * (aplicar a resolución completa sin congelar la UI). Depende de ImgProc.
 *
 * Requiere que imgproc.js se haya cargado antes (window.ImgProc / self.ImgProc).
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

  root.ImgOps = {
    computeColorMixer: computeColorMixer,
    computeDetail: computeDetail
  };
})(typeof window !== "undefined" ? window : self);
