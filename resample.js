/* =========================================================================
 * resample.js — Módulo para remuestreo de canales de imagen (downsample/upscale)
 * ========================================================================= */

window.Resample = (function () {
  "use strict";

  /**
   * Reduce un canal de imagen utilizando un filtro de promedio de área (box filter).
   *
   * @param {Float32Array} ch Canal de imagen original.
   * @param {number} w Ancho original.
   * @param {number} h Alto original.
   * @param {number} targetW Ancho de destino.
   * @returns {{ch: Float32Array, w: number, h: number}} Objeto con el canal reducido, ancho y alto.
   */
  function downsampleChannel(ch, w, h, targetW) {
    const scale = targetW / w;
    const targetH = Math.round(h * scale);
    const target = new Float32Array(targetW * targetH);

    const xRatio = w / targetW;
    const yRatio = h / targetH;

    for (let ty = 0; ty < targetH; ty++) {
      for (let tx = 0; tx < targetW; tx++) {
        const sx0 = tx * xRatio;
        const sx1 = (tx + 1) * xRatio;
        const sy0 = ty * yRatio;
        const sy1 = (ty + 1) * yRatio;

        let sum = 0;
        let totalWeight = 0;

        const startX = Math.floor(sx0);
        const endX = Math.ceil(sx1);
        const startY = Math.floor(sy0);
        const endY = Math.ceil(sy1);

        for (let sy = startY; sy < endY; sy++) {
          if (sy < 0 || sy >= h) continue;
          const weightY = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
          for (let sx = startX; sx < endX; sx++) {
            if (sx < 0 || sx >= w) continue;
            const weightX = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
            const weight = weightX * weightY;
            sum += ch[sy * w + sx] * weight;
            totalWeight += weight;
          }
        }
        target[ty * targetW + tx] = totalWeight > 0 ? sum / totalWeight : 0;
      }
    }
    return { ch: target, w: targetW, h: targetH };
  }

  /**
   * Reescala bilinealmente un canal de imagen pequeño a dimensiones grandes,
   * aplicando extrapolación lineal en los bordes para mantener la precisión matemática.
   *
   * @param {Float32Array} small Canal reducido.
   * @param {number} sw Ancho del canal reducido.
   * @param {number} sh Alto del canal reducido.
   * @param {number} W Ancho de destino.
   * @param {number} H Alto de destino.
   * @returns {Float32Array} Canal reescalado.
   */
  function bilinearUpscale(small, sw, sh, W, H) {
    const target = new Float32Array(W * H);

    if (sw === 1 && sh === 1) {
      target.fill(small[0]);
      return target;
    }

    const xRatio = W / sw;
    const yRatio = H / sh;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // Mapeo del centro del píxel a coordenadas del grid pequeño
        const sx = (x + 0.5) / xRatio - 0.5;
        const sy = (y + 0.5) / yRatio - 0.5;

        let x_low = Math.floor(sx);
        let x_high = x_low + 1;
        let y_low = Math.floor(sy);
        let y_high = y_low + 1;

        if (sw > 1) {
          if (x_low < 0) {
            x_low = 0;
            x_high = 1;
          } else if (x_high >= sw) {
            x_low = sw - 2;
            x_high = sw - 1;
          }
        } else {
          x_low = 0;
          x_high = 0;
        }

        if (sh > 1) {
          if (y_low < 0) {
            y_low = 0;
            y_high = 1;
          } else if (y_high >= sh) {
            y_low = sh - 2;
            y_high = sh - 1;
          }
        } else {
          y_low = 0;
          y_high = 0;
        }

        const wx = sw > 1 ? sx - x_low : 0;
        const wy = sh > 1 ? sy - y_low : 0;

        const val00 = small[y_low * sw + x_low];
        const val10 = small[y_low * sw + x_high];
        const val01 = small[y_high * sw + x_low];
        const val11 = small[y_high * sw + x_high];

        target[y * W + x] = val00 * (1 - wx) * (1 - wy) +
                            val10 * wx * (1 - wy) +
                            val01 * (1 - wx) * wy +
                            val11 * wx * wy;
      }
    }
    return target;
  }

  /**
   * Reescala un canal de imagen a dimensiones de destino arbitrarias utilizando interpolación bilineal.
   * Aplica clamping en los bordes.
   *
   * @param {Float32Array} ch Canal original.
   * @param {number} w Ancho original.
   * @param {number} h Alto original.
   * @param {number} newW Ancho de destino.
   * @param {number} newH Alto de destino.
   * @returns {Float32Array} Canal reescalado.
   */
  function resizeBilinear(ch, w, h, newW, newH) {
    const target = new Float32Array(newW * newH);
    const xRatio = newW / w;
    const yRatio = newH / h;

    for (let y = 0; y < newH; y++) {
      for (let x = 0; x < newW; x++) {
        const sx = (x + 0.5) / xRatio - 0.5;
        const sy = (y + 0.5) / yRatio - 0.5;

        let x0 = Math.floor(sx);
        let y0 = Math.floor(sy);
        let x1 = x0 + 1;
        let y1 = y0 + 1;

        x0 = Math.max(0, Math.min(w - 1, x0));
        x1 = Math.max(0, Math.min(w - 1, x1));
        y0 = Math.max(0, Math.min(h - 1, y0));
        y1 = Math.max(0, Math.min(h - 1, y1));

        const wx = Math.max(0, Math.min(1, sx - Math.floor(sx)));
        const wy = Math.max(0, Math.min(1, sy - Math.floor(sy)));

        const val00 = ch[y0 * w + x0];
        const val10 = ch[y0 * w + x1];
        const val01 = ch[y1 * w + x0];
        const val11 = ch[y1 * w + x1];

        target[y * newW + x] = val00 * (1 - wx) * (1 - wy) +
                               val10 * wx * (1 - wy) +
                               val01 * (1 - wx) * wy +
                               val11 * wx * wy;
      }
    }
    return target;
  }

  /**
   * Ejecuta el auto-test de paridad sobre un plano constante y un gradiente lineal.
   *
   * @returns {{flatDiff: number, gradDiff: number}} Diferencias máximas absolutas.
   */
  function runAutoTest() {
    const W = 512;
    const H = 512;
    const targetW = 64;

    // 1. Test de plano constante (0.4)
    const flat = new Float32Array(W * H).fill(0.4);
    const flatDown = downsampleChannel(flat, W, H, targetW);
    const flatUp = bilinearUpscale(flatDown.ch, flatDown.w, flatDown.h, W, H);

    let flatDiff = 0;
    for (let i = 0; i < W * H; i++) {
      flatDiff = Math.max(flatDiff, Math.abs(flatUp[i] - 0.4));
    }

    // 2. Test de gradiente lineal horizontal (0 -> 1)
    const grad = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        grad[y * W + x] = x / (W - 1);
      }
    }
    const gradDown = downsampleChannel(grad, W, H, targetW);
    const gradUp = bilinearUpscale(gradDown.ch, gradDown.w, gradDown.h, W, H);

    let gradDiff = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        const original = x / (W - 1);
        gradDiff = Math.max(gradDiff, Math.abs(gradUp[idx] - original));
      }
    }

    console.log(`[Resample Auto-Test] Flat max absolute diff: ${flatDiff} (Acceptance: <= 1e-4)`);
    console.log(`[Resample Auto-Test] Gradient max absolute diff: ${gradDiff} (Acceptance: <= 5e-3)`);

    return { flatDiff, gradDiff };
  }

  let testResults = null;
  // RESAMPLE-SELFTEST-BEGIN
  if (typeof window !== "undefined" && window.location && window.location.search && window.location.search.includes("resampletest=1")) {
    testResults = runAutoTest();
  }
  // RESAMPLE-SELFTEST-END

  return {
    downsampleChannel,
    bilinearUpscale,
    resizeBilinear,
    runAutoTest,
    testResults
  };
})();
