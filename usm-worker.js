/* =============================================================================
 * usm-worker.js — Web Worker para USM Sharpening
 *
 * Corre off-thread para evitar congelamiento de UI en imágenes grandes.
 * Reproduce las funciones de sharpening.js sin dependencias de window/DOM.
 * ============================================================================= */

function gaussianKernel1D(sigma) {
  if (sigma <= 0) return new Float32Array([1]);
  const r = Math.ceil(3 * sigma);
  const size = 2 * r + 1;
  const kernel = new Float32Array(size);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const val = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + r] = val;
    sum += val;
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;
  return kernel;
}

function gaussianBlur(img, sigma) {
  if (sigma <= 0) {
    return { ch: img.ch.map(c => new Float32Array(c)), w: img.w, h: img.h, nc: img.nc, isColor: img.isColor };
  }
  const kernel = gaussianKernel1D(sigma);
  const r = Math.ceil(3 * sigma);
  const { w, h, nc } = img;
  const blurredCh = [];
  for (let c = 0; c < nc; c++) {
    const src = img.ch[c];
    const temp = new Float32Array(w * h);
    const dst  = new Float32Array(w * h);
    // Horizontal pass
    for (let y = 0; y < h; y++) {
      const yOffset = y * w;
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let k = -r; k <= r; k++) {
          const kx = Math.max(0, Math.min(w - 1, x + k));
          s += src[yOffset + kx] * kernel[k + r];
        }
        temp[yOffset + x] = s;
      }
    }
    // Vertical pass
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let s = 0;
        for (let k = -r; k <= r; k++) {
          const ky = Math.max(0, Math.min(h - 1, y + k));
          s += temp[ky * w + x] * kernel[k + r];
        }
        dst[y * w + x] = s;
      }
    }
    blurredCh.push(dst);
  }
  return { ch: blurredCh, w, h, nc, isColor: img.isColor };
}

function computeUSM(img, opts) {
  const sigma       = opts.sigma       !== undefined ? opts.sigma       : 2.0;
  const amount      = opts.amount      !== undefined ? opts.amount      : 0.5;
  const deringDark  = opts.deringDark  !== undefined ? opts.deringDark  : 0;
  const deringBright= opts.deringBright!== undefined ? opts.deringBright: 0;

  const blurred = gaussianBlur(img, sigma);
  const { nc, w, h } = img;
  const size = w * h;
  const outCh = [];

  for (let c = 0; c < nc; c++) {
    const src  = img.ch[c];
    const blur = blurred.ch[c];
    const dst  = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      const px = src[i];
      let delta = px - blur[i];
      if (deringDark   > 0 && delta < -deringDark  ) delta = -deringDark;
      if (deringBright > 0 && delta >  deringBright) delta =  deringBright;
      const val = px + amount * delta;
      dst[i] = val < 0 ? 0 : (val > 1 ? 1 : val);
    }
    outCh.push(dst);
  }
  return { ch: outCh, w, h, nc, isColor: img.isColor };
}

self.onmessage = (e) => {
  try {
    const { ch, w, h, nc, isColor, opts } = e.data;
    const result = computeUSM({ ch, w, h, nc, isColor }, opts);
    self.postMessage(
      { type: 'result', ch: result.ch, w: result.w, h: result.h, nc: result.nc, isColor: result.isColor },
      result.ch.map(c => c.buffer)
    );
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
