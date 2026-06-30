/* =============================================================================
 * deepsnr-worker.js — Worker dedicado para DeepSNR en WebGPU.
 *
 * Aísla ort-web 1.27 en su PROPIO scope global: la página principal sigue en
 * 1.19.2 (no se toca el resto de la pila IA). WebGPU primario + fallback WASM
 * dentro del propio worker. Replica EXACTAMENTE el tiling de
 * OnnxEngine.runOnnxModelTiled (rama NHWC / 3ch, scaleIn/Out=1, pad clamp,
 * recorte central sin feather) para dar el mismo resultado, solo que en GPU.
 * Modelo: deepsnr_v2_512.onnx (fp32 — el fp16 da NaN en WebGPU).
 * ============================================================================= */
importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.webgpu.min.js');

ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/';
try {
  ort.env.wasm.simd = true;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min((navigator.hardwareConcurrency || 4), 8) : 1;
} catch (e) { ort.env.wasm.numThreads = 1; }

// --- Caché IndexedDB (mismo esquema que denoise-worker.js / onnx-engine.js) ---
const DB_NAME = 'cosmic-clarity-models-db';
const STORE = 'models';
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'url' });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}
async function getCached(url) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(url);
      r.onsuccess = () => resolve(r.result ? r.result.data : null);
      r.onerror = () => reject(r.error);
    });
  } catch { return null; }
}
async function setCache(url, data) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const r = db.transaction(STORE, 'readwrite').objectStore(STORE).put({ url, data });
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  } catch { /* no-fatal */ }
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

let sess = null, sessKey = null, sessBackend = '';
async function getSession(modelUrl) {
  if (sess && sessKey === modelUrl) return sess;
  const data = await fetchModel(modelUrl);
  try {
    sess = await ort.InferenceSession.create(data, { executionProviders: ['webgpu', 'wasm'] });
    sessBackend = 'webgpu>wasm';
  } catch (e) {
    sess = await ort.InferenceSession.create(data, { executionProviders: ['wasm'] });
    sessBackend = 'wasm(fallback)';
  }
  sessKey = modelUrl;
  return sess;
}

// Réplica EXACTA de OnnxEngine.runOnnxModelTiled (NHWC/3ch, scaleIn/Out=1, pad clamp).
async function runTiled(session, img, opts, onProgress) {
  const W = img.w, H = img.h, nc = img.nc;
  const tileSize = opts.tileSize ?? 512;
  const overlap = opts.overlap ?? 32;
  const fixedTile = opts.fixedTile ?? 512;
  const isNHWC = (opts.layout || 'NHWC').toUpperCase() === 'NHWC';
  const modelChannels = 3;
  const pw = fixedTile, ph = fixedTile;

  const outCh = [];
  for (let c = 0; c < nc; c++) outCh.push(new Float32Array(W * H));
  const step = tileSize - 2 * overlap;
  const inName = session.inputNames[0], outName = session.outputNames[0];

  let total = 0;
  for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) total++;
  let done = 0;

  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const xs = Math.max(0, x - overlap), ys = Math.max(0, y - overlap);
      const xe = Math.min(W, x + tileSize - overlap), ye = Math.min(H, y + tileSize - overlap);
      const tw = xe - xs, th = ye - ys;

      const tile = new Float32Array(modelChannels * ph * pw);
      for (let row = 0; row < ph; row++) {
        let iy = ys + row; if (iy >= H) iy = H - 1;
        for (let col = 0; col < pw; col++) {
          let ix = xs + col; if (ix >= W) ix = W - 1;
          const p = iy * W + ix;
          let r, g, b;
          if (nc === 3) { r = img.ch[0][p]; g = img.ch[1][p]; b = img.ch[2][p]; }
          else { const v = img.ch[0][p]; r = g = b = v; }
          if (isNHWC) { tile[row * pw * 3 + col * 3] = r; tile[row * pw * 3 + col * 3 + 1] = g; tile[row * pw * 3 + col * 3 + 2] = b; }
          else { tile[row * pw + col] = r; tile[ph * pw + row * pw + col] = g; tile[2 * ph * pw + row * pw + col] = b; }
        }
      }

      const shape = isNHWC ? [1, ph, pw, 3] : [1, 3, ph, pw];
      const res = await session.run({ [inName]: new ort.Tensor('float32', tile, shape) });
      const od = res[outName].data;

      const cs = (xs === 0) ? 0 : overlap, ce = (xe === W) ? tw : (tw - overlap);
      const rs = (ys === 0) ? 0 : overlap, re = (ye === H) ? th : (th - overlap);
      for (let r = rs; r < re; r++) {
        const gy = ys + r; if (gy >= H) continue;
        for (let c = cs; c < ce; c++) {
          const gx = xs + c; if (gx >= W) continue;
          const gi = gy * W + gx;
          let oR, oG, oB;
          if (isNHWC) { oR = od[r * pw * 3 + c * 3]; oG = od[r * pw * 3 + c * 3 + 1]; oB = od[r * pw * 3 + c * 3 + 2]; }
          else { oR = od[r * pw + c]; oG = od[ph * pw + r * pw + c]; oB = od[2 * ph * pw + r * pw + c]; }
          if (oR < 0) oR = 0; else if (oR > 1) oR = 1;
          if (oG < 0) oG = 0; else if (oG > 1) oG = 1;
          if (oB < 0) oB = 0; else if (oB > 1) oB = 1;
          if (nc === 3) { outCh[0][gi] = oR; outCh[1][gi] = oG; outCh[2][gi] = oB; }
          else { outCh[0][gi] = (oR + oG + oB) / 3; }
        }
      }
      done++;
      if (onProgress) onProgress(done, total);
      await new Promise((r) => setTimeout(r)); // ceder al event loop
    }
  }
  return outCh;
}

self.onmessage = async (e) => {
  const { ch, w, h, nc, isColor, modelUrl, opts } = e.data;
  try {
    self.postMessage({ type: 'status', message: 'DeepSNR: cargando modelo (WebGPU)...' });
    const session = await getSession(modelUrl);
    const out = await runTiled(session, { ch, w, h, nc, isColor }, opts || {},
      (idx, total) => self.postMessage({ type: 'progress', idx, total }));
    self.postMessage({ type: 'result', ch: out, w, h, nc, isColor, backend: sessBackend }, out.map(c => c.buffer));
  } catch (err) {
    sess = null; sessKey = null; // reset para reintentar limpio
    self.postMessage({ type: 'error', message: (err && (err.message || String(err))) || 'worker error' });
  }
};
