/* =============================================================================
 * denoise-worker.js — Web Worker para GraXpert Denoise (ONNX tiled)
 *
 * Corre off-thread para evitar congelamiento de UI durante inferencia WASM.
 * Carga onnxruntime-web, gestiona caché IndexedDB y reproduce el pipeline
 * de computeDenoiseGraXpert de graxpert.js sin dependencias de window/DOM.
 * ============================================================================= */

importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js');

const IS_LOCAL = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';
const DENOISE_MODEL_URL = IS_LOCAL
  ? 'scratch/graxpert_denoise.onnx'
  : 'https://astronomy-proxy.vercel.app/m/graxpert_denoise.onnx'; // proxy Vercel (CORS sobre Release)

// --- IndexedDB helpers (mismo esquema que onnx-engine.js) ---
const DB_NAME   = 'cosmic-clarity-models-db';
const STORE_NAME = 'models';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME))
        db.createObjectStore(STORE_NAME, { keyPath: 'url' });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror  = (e) => reject(e.target.error);
  });
}

async function getCached(url) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(url);
      req.onsuccess = () => resolve(req.result ? req.result.data : null);
      req.onerror  = () => reject(req.error);
    });
  } catch { return null; }
}

async function setCache(url, data) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const req = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put({ url, data });
      req.onsuccess = () => resolve();
      req.onerror  = () => reject(req.error);
    });
  } catch { /* non-fatal */ }
}

async function fetchModel(url) {
  const cached = await getCached(url);
  if (cached) return cached;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching model`);
  const buf = await resp.arrayBuffer();
  setCache(url, buf).catch(() => {});
  return buf;
}

async function createSession(modelData) {
  try {
    return await ort.InferenceSession.create(modelData, { executionProviders: ['webgpu', 'wasm'] });
  } catch {
    return await ort.InferenceSession.create(modelData, { executionProviders: ['wasm'] });
  }
}

// --- GraXpert Denoise functions (copiadas de graxpert.js, sin window/DOM) ---

function medianMAD(channel) {
  const n = channel.length;
  const sampleSize = Math.min(n, 200000);
  const step = Math.max(1, Math.floor(n / sampleSize));
  const samples = new Float32Array(sampleSize);
  for (let i = 0; i < sampleSize; i++) samples[i] = channel[i * step];
  samples.sort();
  const median = samples[Math.floor(sampleSize / 2)];
  const diffs = new Float32Array(sampleSize);
  for (let i = 0; i < sampleSize; i++) diffs[i] = Math.abs(samples[i] - median);
  diffs.sort();
  return { median, mad: Math.max(diffs[Math.floor(sampleSize / 2)], 1e-6) };
}

function normalizeBG(channel, median, mad, L = 1.0) {
  const n = channel.length;
  const out = new Float32Array(n);
  const scale = 0.04 / mad;
  for (let i = 0; i < n; i++) {
    const v = (channel[i] - median) * scale;
    out[i] = v < -L ? -L : (v > L ? L : v);
  }
  return out;
}

function denormalizeBG(norm, median, mad) {
  const n = norm.length;
  const out = new Float32Array(n);
  const scale = mad / 0.04;
  for (let i = 0; i < n; i++) out[i] = norm[i] * scale + median;
  return out;
}

function getReflectCoord(val, max) {
  if (max <= 1) return 0;
  while (val < 0 || val >= max) {
    if (val < 0) val = -val; else val = 2 * (max - 1) - val;
  }
  return val;
}

function padReflect(ch, w, h, pad) {
  const outW = w + 2 * pad;
  const outH = h + 2 * pad;
  const out = new Float32Array(outW * outH);
  for (let y = 0; y < outH; y++) {
    const sy = getReflectCoord(y - pad, h);
    const srcRowOffset = sy * w;
    const outRowOffset = y * outW;
    for (let x = 0; x < outW; x++) {
      out[outRowOffset + x] = ch[srcRowOffset + getReflectCoord(x - pad, w)];
    }
  }
  return out;
}

function getTilePositions(w, h, winSz, stride, pad) {
  const paddedW = w + 2 * pad;
  const paddedH = h + 2 * pad;
  const xs = []; let x = 0;
  while (x <= paddedW - winSz) { xs.push(x); x += stride; }
  if (xs[xs.length - 1] !== paddedW - winSz) xs.push(paddedW - winSz);
  const ys = []; let y = 0;
  while (y <= paddedH - winSz) { ys.push(y); y += stride; }
  if (ys[ys.length - 1] !== paddedH - winSz) ys.push(paddedH - winSz);
  const positions = [];
  for (let i = 0; i < ys.length; i++)
    for (let j = 0; j < xs.length; j++)
      positions.push({ tx: xs[j], ty: ys[i] });
  return positions;
}

function extractTile(padded, paddedW, tx, ty, winSz) {
  const out = new Float32Array(winSz * winSz);
  for (let y = 0; y < winSz; y++) {
    const inRowOffset  = (ty + y) * paddedW;
    const outRowOffset = y * winSz;
    for (let x = 0; x < winSz; x++)
      out[outRowOffset + x] = padded[inRowOffset + tx + x];
  }
  return out;
}

function placeCentral(output, w, h, tileOut, tx, ty, pad, central) {
  for (let y = 0; y < central; y++) {
    const origY = ty + y;
    if (origY < 0 || origY >= h) continue;
    const outRowOffset  = origY * w;
    const tileRowOffset = (pad + y) * 256;
    for (let x = 0; x < central; x++) {
      const origX = tx + x;
      if (origX < 0 || origX >= w) continue;
      output[outRowOffset + origX] = tileOut[tileRowOffset + pad + x];
    }
  }
}

function applyStarProtection(denoised, original, median, mad) {
  const len = original.length;
  const out = new Float32Array(len);
  const threshold = median + 250.0 * mad;
  for (let i = 0; i < len; i++)
    out[i] = (original[i] >= threshold) ? original[i] : denoised[i];
  return out;
}

async function computeDenoise(sess, img, opts, onProgress) {
  const { w: origW, h: origH, nc, isColor } = img;
  const paddedChannels = [];
  const stats = [];

  for (let c = 0; c < 3; c++) {
    const srcCh = img.ch[isColor ? c : 0];
    const stat  = medianMAD(srcCh);
    stats.push(stat);
    paddedChannels.push(padReflect(normalizeBG(srcCh, stat.median, stat.mad, 10.0), origW, origH, 64));
  }

  const paddedW = origW + 128;
  const [paddedR, paddedG, paddedB] = paddedChannels;
  const accumR = new Float32Array(origW * origH);
  const accumG = new Float32Array(origW * origH);
  const accumB = new Float32Array(origW * origH);

  const positions  = getTilePositions(origW, origH, 256, 128, 64);
  const totalTiles = positions.length;
  const K = opts.batchSize ?? 4;
  const tileOutR = new Float32Array(256 * 256);
  const tileOutG = new Float32Array(256 * 256);
  const tileOutB = new Float32Array(256 * 256);

  for (let b = 0; b < totalTiles; b += K) {
    const actualK = Math.min(K, totalTiles - b);
    const inputData = new Float32Array(actualK * 256 * 256 * 3);

    for (let i = 0; i < actualK; i++) {
      const pos    = positions[b + i];
      const rTile  = extractTile(paddedR, paddedW, pos.tx, pos.ty, 256);
      const gTile  = extractTile(paddedG, paddedW, pos.tx, pos.ty, 256);
      const bTile  = extractTile(paddedB, paddedW, pos.tx, pos.ty, 256);
      const offset = i * 256 * 256 * 3;
      for (let j = 0; j < 256 * 256; j++) {
        inputData[offset + j * 3 + 0] = rTile[j];
        inputData[offset + j * 3 + 1] = gTile[j];
        inputData[offset + j * 3 + 2] = bTile[j];
      }
    }

    const tensor  = new ort.Tensor('float32', inputData, [actualK, 256, 256, 3]);
    const results = await sess.run({ gen_input_image: tensor });
    const outData = results.output.data;

    for (let i = 0; i < actualK; i++) {
      const pos    = positions[b + i];
      const offset = i * 256 * 256 * 3;
      for (let j = 0; j < 256 * 256; j++) {
        tileOutR[j] = outData[offset + j * 3 + 0];
        tileOutG[j] = outData[offset + j * 3 + 1];
        tileOutB[j] = outData[offset + j * 3 + 2];
      }
      placeCentral(accumR, origW, origH, tileOutR, pos.tx, pos.ty, 64, 128);
      placeCentral(accumG, origW, origH, tileOutG, pos.tx, pos.ty, 64, 128);
      placeCentral(accumB, origW, origH, tileOutB, pos.tx, pos.ty, 64, 128);
      if (onProgress) onProgress(b + i + 1, totalTiles);
    }
  }

  const strength = opts.strength !== undefined ? parseFloat(opts.strength) : 1.0;

  function blendChannel(accum, stat, origCh) {
    const den = denormalizeBG(accum, stat.median, stat.mad);
    const prot = applyStarProtection(den, origCh, stat.median, stat.mad);
    for (let i = 0; i < prot.length; i++)
      prot[i] = origCh[i] * (1 - strength) + prot[i] * strength;
    return prot;
  }

  const origR = img.ch[0];
  const origG = img.ch[isColor ? 1 : 0];
  const origB = img.ch[isColor ? 2 : 0];
  const finalR = blendChannel(accumR, stats[0], origR);
  const finalG = blendChannel(accumG, stats[1], origG);
  const finalB = blendChannel(accumB, stats[2], origB);

  if (!isColor) {
    const meanCh = new Float32Array(origW * origH);
    for (let i = 0; i < meanCh.length; i++) meanCh[i] = (finalR[i] + finalG[i] + finalB[i]) / 3.0;
    return { ch: [meanCh], w: origW, h: origH, nc: 1, isColor: false };
  }
  return { ch: [finalR, finalG, finalB], w: origW, h: origH, nc: 3, isColor: true };
}

// --- Lifecycle del Worker ---
let sess = null;

self.onmessage = async (e) => {
  const { ch, w, h, nc, isColor, opts } = e.data;
  try {
    if (!sess) {
      self.postMessage({ type: 'status', message: 'Cargando modelo GraXpert Denoise...' });
      const modelData = await fetchModel(DENOISE_MODEL_URL);
      sess = await createSession(modelData);
    }
    const result = await computeDenoise(sess, { ch, w, h, nc, isColor }, opts || {}, (idx, total) => {
      self.postMessage({ type: 'progress', idx, total });
    });
    self.postMessage(
      { type: 'result', ch: result.ch, w: result.w, h: result.h, nc: result.nc, isColor: result.isColor },
      result.ch.map(c => c.buffer)
    );
  } catch (err) {
    sess = null; // reset para que el siguiente intento recargue el modelo
    self.postMessage({ type: 'error', message: err.message });
  }
};
