/* =========================================================================
 * imgproc.js — Primitivas de procesado de imagen COMPARTIDAS (sin dependencias).
 *
 * Objetivo: unificar utilidades que estaban duplicadas por el código (varias
 * implementaciones de blur, median/MAD, conversiones RGB<->HSL, clamp). Operan
 * sobre Float32Array en rango [0,1]. Expone window.ImgProc.
 *
 *   clamp01(x)
 *   boxBlur(src, w, h, radius)            -> Float32Array   (box separable O(n))
 *   gaussianBlur(src, w, h, sigma)        -> Float32Array   (gaussiana separable)
 *   medianMAD(arr, maxSamples)            -> { median, mad, sigma }
 *   rgbToHsl(r,g,b) / hslToRgb(h,s,l) / hue2rgb(p,q,t)
 * ========================================================================= */
(function (root) {
  "use strict";

  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

  // Box blur separable con ventana deslizante (suma acumulada) -> O(n) independiente del radio.
  // Bordes por clamp (repite el píxel del borde). radius en píxeles.
  function boxBlur(src, w, h, radius) {
    var r = Math.round(radius);
    if (r < 1) return src;
    var win = 2 * r + 1;
    var tmp = new Float32Array(w * h);
    var out = new Float32Array(w * h);
    var x, y, k;
    for (y = 0; y < h; ++y) {
      var base = y * w, sum = 0;
      for (k = -r; k <= r; ++k) { var xx = k < 0 ? 0 : (k >= w ? w - 1 : k); sum += src[base + xx]; }
      for (x = 0; x < w; ++x) {
        tmp[base + x] = sum / win;
        var xo = x - r, xi = x + r + 1;
        var xoC = xo < 0 ? 0 : (xo >= w ? w - 1 : xo);
        var xiC = xi < 0 ? 0 : (xi >= w ? w - 1 : xi);
        sum += src[base + xiC] - src[base + xoC];
      }
    }
    for (x = 0; x < w; ++x) {
      var sum2 = 0, j;
      for (j = -r; j <= r; ++j) { var yy = j < 0 ? 0 : (j >= h ? h - 1 : j); sum2 += tmp[yy * w + x]; }
      for (y = 0; y < h; ++y) {
        out[y * w + x] = sum2 / win;
        var yo = y - r, yi = y + r + 1;
        var yoC = yo < 0 ? 0 : (yo >= h ? h - 1 : yo);
        var yiC = yi < 0 ? 0 : (yi >= h ? h - 1 : yi);
        sum2 += tmp[yiC * w + x] - tmp[yoC * w + x];
      }
    }
    return out;
  }

  // Gaussiana separable con kernel truncado a 3*sigma. Bordes por clamp.
  function gaussianBlur(src, w, h, sigma) {
    if (sigma <= 0.01) return Float32Array.from(src);
    var r = Math.max(1, Math.ceil(3 * sigma));
    var kern = new Float32Array(2 * r + 1), s = 0, i;
    for (i = -r; i <= r; i++) { var v = Math.exp(-(i * i) / (2 * sigma * sigma)); kern[i + r] = v; s += v; }
    for (i = 0; i < kern.length; i++) kern[i] /= s;
    var tmp = new Float32Array(w * h), out = new Float32Array(w * h), x, y, j;
    for (y = 0; y < h; y++) { var row = y * w; for (x = 0; x < w; x++) { var a = 0; for (j = -r; j <= r; j++) { var xx = x + j; if (xx < 0) xx = 0; else if (xx >= w) xx = w - 1; a += src[row + xx] * kern[j + r]; } tmp[row + x] = a; } }
    for (y = 0; y < h; y++) { for (x = 0; x < w; x++) { var b = 0; for (j = -r; j <= r; j++) { var yy = y + j; if (yy < 0) yy = 0; else if (yy >= h) yy = h - 1; b += tmp[yy * w + x] * kern[j + r]; } out[y * w + x] = b; } }
    return out;
  }

  // Mediana y desviación robusta (MAD, y sigma = 1.4826*MAD) por submuestreo para velocidad.
  function medianMAD(arr, maxSamples) {
    var n = arr.length, step = Math.max(1, Math.floor(n / (maxSamples || 200000)));
    var s = [];
    for (var i = 0; i < n; i += step) s.push(arr[i]);
    s.sort(function (a, b) { return a - b; });
    var med = s[s.length >> 1];
    var d = new Array(s.length);
    for (var j = 0; j < s.length; ++j) d[j] = Math.abs(s[j] - med);
    d.sort(function (a, b) { return a - b; });
    var mad = d[d.length >> 1];
    return { median: med, mad: mad, sigma: 1.4826 * mad };
  }

  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
  function rgbToHsl(r, g, b) {
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) * 0.5, h = 0, s = 0;
    if (d > 1e-7) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6; if (h < 0) h += 1;
    }
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    if (s === 0) return [l, l, l];
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
  }

  root.ImgProc = {
    clamp01: clamp01,
    boxBlur: boxBlur,
    gaussianBlur: gaussianBlur,
    medianMAD: medianMAD,
    hue2rgb: hue2rgb,
    rgbToHsl: rgbToHsl,
    hslToRgb: hslToRgb
  };
})(typeof window !== "undefined" ? window : this);
