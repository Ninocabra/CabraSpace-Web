/* =========================================================================
 * onnx-engine.js — Módulo unificado para inferencia y caché de modelos ONNX
 *
 * Proporciona el sistema de caché en IndexedDB, inicialización de sesión
 * y el tiler con soporte para reflect-padding, fixed-tile y NHWC layout.
 * ========================================================================= */

window.OnnxEngine = (function () {
  "use strict";

  const DB_NAME = "cosmic-clarity-models-db";
  const STORE_NAME = "models";

  function openModelDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "url" });
        }
      };
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async function getCachedModel(url) {
    try {
      const db = await openModelDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(url);
        req.onsuccess = () => resolve(req.result ? req.result.data : null);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn("IndexedDB error:", err);
      return null;
    }
  }

  async function cacheModel(url, arrayBuffer) {
    try {
      const db = await openModelDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const req = store.put({ url: url, data: arrayBuffer });
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn("Caching error:", err);
    }
  }

  async function fetchModelWithCache(url, onProgress) {
    const cached = await getCachedModel(url);
    if (cached) return cached;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error ${response.status} fetching model`);

    const contentLength = response.headers.get("content-length");
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    const reader = response.body.getReader();
    let received = 0;
    const chunks = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total && onProgress) {
        onProgress(received / total);
      }
    }

    const blob = new Blob(chunks);
    const arrayBuffer = await blob.arrayBuffer();
    cacheModel(url, arrayBuffer).catch((e) => console.warn("Cache write failed:", e));
    return arrayBuffer;
  }

  async function createSession(modelData, options = {}) {
    const executionProviders = options.executionProviders ?? ["webgpu", "wasm"];
    try {
      return await ort.InferenceSession.create(modelData, { executionProviders });
    } catch (e) {
      if (executionProviders.includes("webgpu") && executionProviders.includes("wasm")) {
        console.warn("Failed with WebGPU provider, trying WASM only:", e);
        return await ort.InferenceSession.create(modelData, { executionProviders: ["wasm"] });
      }
      throw e;
    }
  }

  async function runOnnxModelTiled(session, imgData, tileSizeOrOptions = 512, overlap = 32, padMode = 'clamp', fixedTile = null, layout = 'NCHW') {
    let tileSize = 512;
    let scaleIn = 1.0;
    let offsetIn = 0.0;
    let scaleOut = 1.0;
    let offsetOut = 0.0;
    let onProgress = null;
    let modelChannels = 3;

    if (typeof tileSizeOrOptions === "object" && tileSizeOrOptions !== null) {
      const options = tileSizeOrOptions;
      tileSize = options.tileSize ?? 512;
      overlap = options.overlap ?? 32;
      padMode = options.padMode ?? 'clamp';
      fixedTile = options.fixedTile ?? null;
      layout = options.layout ?? 'NCHW';
      scaleIn = options.scaleIn ?? 1.0;
      offsetIn = options.offsetIn ?? 0.0;
      scaleOut = options.scaleOut ?? 1.0;
      offsetOut = options.offsetOut ?? 0.0;
      onProgress = options.onProgress ?? null;
      modelChannels = options.channels ?? options.modelChannels ?? 3;
    }

    const W = imgData.w;
    const H = imgData.h;
    const nc = imgData.nc;
    const outCh = [];
    for (let c = 0; c < nc; ++c) {
      outCh.push(new Float32Array(W * H));
    }

    const step = tileSize - 2 * overlap;
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];

    const isNHWC = (layout.toUpperCase() === 'NHWC');

    // Count total tiles
    let totalTiles = 0;
    for (let y = 0; y < H; y += step) {
      for (let x = 0; x < W; x += step) {
        totalTiles++;
      }
    }
    let completedTiles = 0;

    for (let y = 0; y < H; y += step) {
      for (let x = 0; x < W; x += step) {
        const x_start = Math.max(0, x - overlap);
        const y_start = Math.max(0, y - overlap);
        const x_end = Math.min(W, x + tileSize - overlap);
        const y_end = Math.min(H, y + tileSize - overlap);

        const tw = x_end - x_start;
        const th = y_end - y_start;

        let pw, ph;
        if (typeof fixedTile === "number") {
          pw = fixedTile;
          ph = fixedTile;
        } else if (fixedTile && typeof fixedTile === "object") {
          pw = fixedTile.w;
          ph = fixedTile.h;
        } else {
          pw = Math.ceil(tw / 32) * 32;
          ph = Math.ceil(th / 32) * 32;
        }

        const tileData = new Float32Array(modelChannels * ph * pw);

        for (let row = 0; row < ph; ++row) {
          let imgY = y_start + row;
          if (imgY >= H) {
            if (padMode === 'reflect') {
              imgY = H - 1 - (imgY - H);
              if (imgY < 0) imgY = 0;
            } else {
              imgY = H - 1;
            }
          }

          for (let col = 0; col < pw; ++col) {
            let imgX = x_start + col;
            if (imgX >= W) {
              if (padMode === 'reflect') {
                imgX = W - 1 - (imgX - W);
                if (imgX < 0) imgX = 0;
              } else {
                imgX = W - 1;
              }
            }

            const pixelIdx = imgY * W + imgX;
            let rVal, gVal, bVal;
            if (nc === 3) {
              rVal = imgData.ch[0][pixelIdx];
              gVal = imgData.ch[1][pixelIdx];
              bVal = imgData.ch[2][pixelIdx];
            } else {
              const val = imgData.ch[0][pixelIdx];
              rVal = val;
              gVal = val;
              bVal = val;
            }

            // Apply preprocessing scale/offset
            rVal = rVal * scaleIn + offsetIn;
            gVal = gVal * scaleIn + offsetIn;
            bVal = bVal * scaleIn + offsetIn;

            if (modelChannels === 1) {
              const grayVal = (nc === 3) ? (rVal + gVal + bVal) / 3.0 : rVal;
              if (isNHWC) {
                tileData[row * pw * 1 + col * 1 + 0] = grayVal;
              } else {
                tileData[0 * ph * pw + row * pw + col] = grayVal;
              }
            } else {
              // modelChannels === 3
              if (isNHWC) {
                tileData[row * pw * 3 + col * 3 + 0] = rVal;
                tileData[row * pw * 3 + col * 3 + 1] = gVal;
                tileData[row * pw * 3 + col * 3 + 2] = bVal;
              } else {
                tileData[0 * ph * pw + row * pw + col] = rVal;
                tileData[1 * ph * pw + row * pw + col] = gVal;
                tileData[2 * ph * pw + row * pw + col] = bVal;
              }
            }
          }
        }

        const tensorShape = isNHWC ? [1, ph, pw, modelChannels] : [1, modelChannels, ph, pw];
        const inputTensor = new ort.Tensor("float32", tileData, tensorShape);
        const results = await session.run({ [inputName]: inputTensor });
        const outData = results[outputName].data;

        const col_start = (x_start === 0) ? 0 : overlap;
        const col_end = (x_end === W) ? tw : (tw - overlap);
        const row_start = (y_start === 0) ? 0 : overlap;
        const row_end = (y_end === H) ? th : (th - overlap);

        for (let r = row_start; r < row_end; ++r) {
          const globalY = y_start + r;
          if (globalY >= H) continue;

          for (let c = col_start; c < col_end; ++c) {
            const globalX = x_start + c;
            if (globalX >= W) continue;

            const globalIdx = globalY * W + globalX;
            let outR, outG, outB;

            if (modelChannels === 1) {
              let outVal;
              if (isNHWC) {
                outVal = outData[r * pw * 1 + c * 1 + 0];
              } else {
                outVal = outData[0 * ph * pw + r * pw + c];
              }
              outVal = outVal * scaleOut + offsetOut;
              if (outVal < 0.0) outVal = 0.0; else if (outVal > 1.0) outVal = 1.0;

              outR = outVal;
              outG = outVal;
              outB = outVal;
            } else {
              // modelChannels === 3
              if (isNHWC) {
                outR = outData[r * pw * 3 + c * 3 + 0];
                outG = outData[r * pw * 3 + c * 3 + 1];
                outB = outData[r * pw * 3 + c * 3 + 2];
              } else {
                outR = outData[0 * ph * pw + r * pw + c];
                outG = outData[1 * ph * pw + r * pw + c];
                outB = outData[2 * ph * pw + r * pw + c];
              }
              // Apply postprocessing scale/offset
              outR = outR * scaleOut + offsetOut;
              outG = outG * scaleOut + offsetOut;
              outB = outB * scaleOut + offsetOut;

              // Clamp values
              if (outR < 0.0) outR = 0.0; else if (outR > 1.0) outR = 1.0;
              if (outG < 0.0) outG = 0.0; else if (outG > 1.0) outG = 1.0;
              if (outB < 0.0) outB = 0.0; else if (outB > 1.0) outB = 1.0;
            }

            if (nc === 3) {
              outCh[0][globalIdx] = outR;
              outCh[1][globalIdx] = outG;
              outCh[2][globalIdx] = outB;
            } else {
              outCh[0][globalIdx] = (outR + outG + outB) / 3.0;
            }
          }
        }

        completedTiles++;
        if (onProgress) {
          onProgress(completedTiles, totalTiles);
        }
      }
    }
    return outCh;
  }

  return {
    fetchModelWithCache,
    createSession,
    runOnnxModelTiled
  };
})();
