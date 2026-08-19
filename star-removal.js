/* =========================================================================
 * star-removal.js — Módulo de integración para eliminación de estrellas (StarNet2)
 *
 * Carga el modelo starnet2 en formato ONNX, ejecuta inferencia por tiles con
 * solapamiento, y separa la imagen en capas Starless y Stars.
 * ========================================================================= */

window.StarRemoval = (function () {
  "use strict";

  // Servido vía proxy Vercel (añade CORS sobre la Release models-v1; GitHub Releases no da CORS).
  let MODEL_URL_STARNET2 = "https://astronomy-proxy.vercel.app/m/starnet2.onnx";

  // Usar modelo local al probar en entorno de desarrollo local
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    MODEL_URL_STARNET2 = "scratch/starnet2.onnx";
  }

  // Recuperación de detalle de nebulosa: el modelo quita estrellas pero suaviza un poco la textura
  // de la nebulosa. Usamos el starless del modelo SOLO donde se quitó algo significativo (estrellas:
  // diff alto/localizado) y mantenemos el original donde no (preserva la textura). `recover` (0..1)
  // controla el umbral: 0 = starless crudo del modelo; mayor = más nebulosa original conservada.
  function applyNebulaRecover(imgData, starlessCh, recover) {
    const w = imgData.w, h = imgData.h, n = w * h, nc = imgData.nc;
    const thr = Math.max(0.01, recover * 0.12);
    const lumW = imgData.isColor && nc >= 3;
    const diff = new Float32Array(n);
    for (let i = 0; i < n; ++i) {
      let lo, ls;
      if (lumW) {
        lo = 0.2126 * imgData.ch[0][i] + 0.7152 * imgData.ch[1][i] + 0.0722 * imgData.ch[2][i];
        ls = 0.2126 * starlessCh[0][i] + 0.7152 * starlessCh[1][i] + 0.0722 * starlessCh[2][i];
      } else {
        lo = imgData.ch[0][i]; ls = starlessCh[0][i];
      }
      const d = lo - ls;
      diff[i] = d > 0 ? d : 0;
    }
    // máscara suavizada (box 3x3 separable) para transiciones limpias alrededor de estrellas
    const mask = new Float32Array(n);
    for (let i = 0; i < n; ++i) { let m = diff[i] / thr; mask[i] = m > 1 ? 1 : (m < 0 ? 0 : m); }
    const tmp = new Float32Array(n);
    const blur1D = (src, dst, horiz) => {
      for (let y = 0; y < h; ++y) for (let x = 0; x < w; ++x) {
        const i = y * w + x; let s = src[i], c = 1;
        if (horiz) { if (x > 0) { s += src[i - 1]; c++; } if (x < w - 1) { s += src[i + 1]; c++; } }
        else { if (y > 0) { s += src[i - w]; c++; } if (y < h - 1) { s += src[i + w]; c++; } }
        dst[i] = s / c;
      }
    };
    blur1D(mask, tmp, true); blur1D(tmp, mask, false);
    const out = [];
    for (let c = 0; c < nc; ++c) {
      const o = imgData.ch[c], s = starlessCh[c], dst = new Float32Array(n);
      for (let i = 0; i < n; ++i) { const m = mask[i]; dst[i] = o[i] * (1 - m) + s[i] * m; }
      out.push(dst);
    }
    return out;
  }

  // StarNet2: starless directo. NHWC 512x512 fijo, normalización [0,1] (sin escalado).
  async function runStarNet2(imgData, onDownloadProgress, onTileProgress, recover) {
    if (!imgData || !imgData.ch || imgData.ch.length === 0) {
      throw new Error("No hay datos de imagen de entrada válidos.");
    }
    const isColor = imgData.isColor || imgData.nc === 3;
    const session = await window.OnnxEngine.loadSession(MODEL_URL_STARNET2, {}, onDownloadProgress);
    const options = {
      tileSize: 512, overlap: 64, padMode: "reflect", layout: "NHWC",
      scaleIn: 1.0, offsetIn: 0.0, scaleOut: 1.0, offsetOut: 0.0,
      onProgress: onTileProgress, channels: 3, fixedTile: 512
    };
    let starlessCh = await window.OnnxEngine.runOnnxModelTiled(session, imgData, options);
    return finishStarRemoval(imgData, starlessCh, recover, isColor);
  }

  // Post-proceso común: recuperación de nebulosa (opcional) + capa de estrellas = max(0, orig - starless).
  function finishStarRemoval(imgData, starlessCh, recover, isColor) {
    if (typeof recover === "number" && recover > 0) {
      starlessCh = applyNebulaRecover(imgData, starlessCh, recover);
    }
    const nc = imgData.nc, len = imgData.w * imgData.h, starsCh = [];
    for (let c = 0; c < nc; ++c) {
      const orig = imgData.ch[c], starless = starlessCh[c], stars = new Float32Array(len);
      for (let i = 0; i < len; ++i) { const d = orig[i] - starless[i]; stars[i] = d > 0 ? d : 0; }
      starsCh.push(stars);
    }
    return {
      starless: { ch: starlessCh, w: imgData.w, h: imgData.h, nc: nc, isColor: isColor },
      stars: { ch: starsCh, w: imgData.w, h: imgData.h, nc: nc, isColor: isColor }
    };
  }

  /* =======================================================================
   * CabraStars Web — red starless PROPIA (destilada, con GARANTIA ESTRUCTURAL).
   * Porte fiel de src/starless_infer.py (net_starless, 1 pasada + guard):
   *   - normalizacion por-imagen (x-med)*scale de la luminancia (como el entreno).
   *   - la red predice la CAPA de estrellas; starless = orig - capa.
   *   - garantias POR CONSTRUCCION (no por entrenamiento): capa>=0, starless>=fondo local
   *     (imposible el "foso"/agujero negro), y el COLOR de la capa sale del DATO (anti anillo cromatico).
   * ONNX NCHW [1,3,H,W], head_mode='residual' (el que reproduce net_starless), GAIN=2.
   * ===================================================================== */
  const DISTILL_GAIN = 2.0;
  // OJO (bug cazado 2026-07-24 en el test E2E): la variante FP16 produce NaN en WebGPU (overflow
  // de activaciones >65504 en los nucleos brillantes) -> la red devolvia TODO NaN y el starless
  // salia solo de la garantia de saturadas (dejaba TODAS las estrellas no saturadas). En WASM el
  // FP16 va bien, pero es lento. Solucion: usar el ONNX FP32 (WebGPU lo corre sin overflow, rapido;
  // paridad con Python EXACTA). Coste: descarga ~81MB en vez de ~40MB (una vez, cacheada en IndexedDB).
  let MODEL_URL_CABRASTARS = "https://astronomy-proxy.vercel.app/m/cabrastars_web.onnx";
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    MODEL_URL_CABRASTARS = "scratch/cabrastars_web.onnx";
  }
  // Tamano EXACTO del ONNX FP32. Sirve de checksum barato contra la cache envenenada (ver
  // CACHE-INTEGRITY en onnx-engine.js). SI CAMBIAS EL MODELO, ACTUALIZA ESTE NUMERO: si no, se
  // redescargara en cada uso y la consola lo gritara. El FP16 (el que rompia) mide 40497959.
  const CABRASTARS_BYTES = 80868064;
  const LUM = [0.2126, 0.7152, 0.0722];

  function lumAt(imgData, i) {
    if (imgData.nc >= 3) return LUM[0] * imgData.ch[0][i] + LUM[1] * imgData.ch[1][i] + LUM[2] * imgData.ch[2][i];
    return imgData.ch[0][i];
  }

  // med = mediana de L; scale = 1/max(p99.9(L submuestreada ::3) - med, 1e-4). Igual que net_starless.
  function computeNorm(imgData) {
    const w = imgData.w, h = imgData.h, n = w * h;
    const L = new Float32Array(n);
    for (let i = 0; i < n; ++i) L[i] = lumAt(imgData, i);
    const Lsort = Float32Array.from(L).sort();
    const med = Lsort[Math.floor(n / 2)];
    const sub = [];
    for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) sub.push(L[y * w + x]);
    sub.sort((a, b) => a - b);
    const hi = sub[Math.min(sub.length - 1, Math.floor(0.999 * sub.length))];
    const scale = 1.0 / Math.max(hi - med, 1e-4);
    return { med, scale };
  }

  // Fondo local ROBUSTO A ESTRELLAS. PORTE FIEL de local_background (starless_infer.py):
  //   small = rgb[::step]                         (SUBMUESTREO, no agregado por bloque)
  //   bg_s  = percentile_filter(small, pct, 9x9)  (percentil BAJO sobre ventana ANCHA ~288px)
  //   bg_s  = gaussian_filter(bg_s, sigma=1.2)
  //   return zoom(bg_s, order=1)  (bilinear)
  // CLAVE: el percentil se toma sobre una ventana de 9 celdas (=9*step px), NO sobre un solo
  // bloque de 32px. Un bloque de 32px junto a una brillante es CASI TODO estrella -> su percentil
  // sale contaminado (alto) -> head chico -> el guard recorta la resta -> RESIDUO. La ventana ancha
  // encuentra cielo de verdad aunque la celda central caiga sobre la estrella (bug cazado 2026-07-24).
  function percentileSorted(sorted, pct) {
    const N = sorted.length;
    if (N === 0) return 0;
    if (N === 1) return sorted[0];
    const rank = (pct / 100) * (N - 1);       // np.percentile 'linear'
    const lo = Math.floor(rank), hi = Math.min(N - 1, lo + 1), fr = rank - lo;
    return sorted[lo] * (1 - fr) + sorted[hi] * fr;
  }

  function localBackground(ch, w, h, nc, pct) {
    const step = 32;
    const sh = Math.max(1, Math.ceil(h / step)), sw = Math.max(1, Math.ceil(w / step));
    const R = 4; // ventana 9x9 (percentile_filter size=9) -> radio 4, borde "nearest" (clamp)
    // kernel gaussiano 1D sigma=1.2 (gaussian_filter truncate=4 -> radio 5), borde reflect
    const sig = 1.2, gr = Math.max(1, Math.round(4 * sig));
    const gk = []; let gs = 0;
    for (let k = -gr; k <= gr; ++k) { const v = Math.exp(-(k * k) / (2 * sig * sig)); gk.push(v); gs += v; }
    for (let k = 0; k < gk.length; ++k) gk[k] /= gs;
    const bg = [];
    for (let c = 0; c < nc; ++c) {
      const src = ch[c];
      // 1) submuestreo -> coarse[sh][sw] (rgb[::step])
      const coarse = new Float32Array(sw * sh);
      for (let cy = 0; cy < sh; ++cy) {
        const yy = Math.min(h - 1, cy * step);
        for (let cx = 0; cx < sw; ++cx) coarse[cy * sw + cx] = src[yy * w + Math.min(w - 1, cx * step)];
      }
      // 2) percentile_filter 9x9 (borde clamp/nearest)
      const pf = new Float32Array(sw * sh);
      const win = [];
      for (let cy = 0; cy < sh; ++cy) for (let cx = 0; cx < sw; ++cx) {
        win.length = 0;
        for (let dy = -R; dy <= R; ++dy) {
          const yy = Math.min(sh - 1, Math.max(0, cy + dy));
          for (let dx = -R; dx <= R; ++dx) {
            const xx = Math.min(sw - 1, Math.max(0, cx + dx));
            win.push(coarse[yy * sw + xx]);
          }
        }
        win.sort((a, b) => a - b);
        pf[cy * sw + cx] = percentileSorted(win, pct);
      }
      // 3) gaussian_filter sigma=1.2 (separable, borde reflect)
      const gtmp = new Float32Array(sw * sh), gout = new Float32Array(sw * sh);
      const refl = (i, N) => { if (N === 1) return 0; while (i < 0 || i >= N) { if (i < 0) i = -i - 1; if (i >= N) i = 2 * N - 1 - i; } return i; };
      for (let cy = 0; cy < sh; ++cy) for (let cx = 0; cx < sw; ++cx) {
        let s = 0; for (let k = -gr; k <= gr; ++k) s += pf[cy * sw + refl(cx + k, sw)] * gk[k + gr];
        gtmp[cy * sw + cx] = s;
      }
      for (let cy = 0; cy < sh; ++cy) for (let cx = 0; cx < sw; ++cx) {
        let s = 0; for (let k = -gr; k <= gr; ++k) s += gtmp[refl(cy + k, sh) * sw + cx] * gk[k + gr];
        gout[cy * sw + cx] = s;
      }
      // 4) zoom order=1 (bilinear). ndi.zoom: in_coord = out / (dim/coarse) = out * coarse / dim
      const up = new Float32Array(w * h);
      const zy = h / sh, zx = w / sw;
      for (let y = 0; y < h; ++y) {
        const fy = y / zy, cy = Math.min(sh - 1, Math.floor(fy)), cy2 = Math.min(sh - 1, cy + 1), wy = fy - cy;
        for (let x = 0; x < w; ++x) {
          const fx = x / zx, cx = Math.min(sw - 1, Math.floor(fx)), cx2 = Math.min(sw - 1, cx + 1), wx = fx - cx;
          const a = gout[cy * sw + cx], b = gout[cy * sw + cx2], d = gout[cy2 * sw + cx], e = gout[cy2 * sw + cx2];
          up[y * w + x] = (a * (1 - wx) + b * wx) * (1 - wy) + (d * (1 - wx) + e * wx) * wy;
        }
      }
      bg.push(up);
    }
    return bg;
  }

  // Garantias sobre la capa inferida (porte de _apply_guard): nucleos saturados -> quitar hasta el
  // fondo; y COLOR de la capa = f*head con f=lum(capa)/lum(head) recortado a [0,1] (subsume el tope de
  // fondo: f<=1 => capa<=head => starless>=fondo; y el color sale del dato).
  function applyCabraGuard(imgData, layerCh, bg) {
    const w = imgData.w, h = imgData.h, n = w * h, nc = imgData.nc;
    const head = [];
    for (let c = 0; c < nc; ++c) {
      const hc = new Float32Array(n);
      for (let i = 0; i < n; ++i) { const d = imgData.ch[c][i] - bg[c][i]; hc[i] = d > 0 ? d : 0; }
      head.push(hc);
    }
    const sat = new Float32Array(n);
    for (let i = 0; i < n; ++i) {
      let mx = imgData.ch[0][i];
      if (nc >= 3) { if (imgData.ch[1][i] > mx) mx = imgData.ch[1][i]; if (imgData.ch[2][i] > mx) mx = imgData.ch[2][i]; }
      sat[i] = mx >= 0.90 ? 1 : 0;
    }
    const dil = new Float32Array(n);
    for (let y = 0; y < h; ++y) for (let x = 0; x < w; ++x) {
      let m = 0;
      for (let dy = -2; dy <= 2 && !m; ++dy) for (let dx = -2; dx <= 2 && !m; ++dx) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < h && xx >= 0 && xx < w && sat[yy * w + xx]) m = 1;
      }
      dil[y * w + x] = m;
    }
    const tmp = new Float32Array(n), satm = new Float32Array(n);
    for (let y = 0; y < h; ++y) for (let x = 0; x < w; ++x) {
      const i = y * w + x; let s = dil[i], k = 1;
      if (x > 0) { s += dil[i - 1]; k++; } if (x < w - 1) { s += dil[i + 1]; k++; }
      tmp[i] = s / k;
    }
    for (let y = 0; y < h; ++y) for (let x = 0; x < w; ++x) {
      const i = y * w + x; let s = tmp[i], k = 1;
      if (y > 0) { s += tmp[i - w]; k++; } if (y < h - 1) { s += tmp[i + w]; k++; }
      satm[i] = s / k;
    }
    const out = [];
    for (let c = 0; c < nc; ++c) out.push(new Float32Array(n));
    for (let i = 0; i < n; ++i) {
      const m = satm[i];
      for (let c = 0; c < nc; ++c) out[c][i] = layerCh[c][i] * (1 - m) + head[c][i] * m;
      let layL, headL;
      if (nc >= 3) {
        layL = LUM[0] * out[0][i] + LUM[1] * out[1][i] + LUM[2] * out[2][i];
        headL = LUM[0] * head[0][i] + LUM[1] * head[1][i] + LUM[2] * head[2][i];
      } else { layL = out[0][i]; headL = head[0][i]; }
      let f = headL > 1e-8 ? layL / headL : 0; f = f < 0 ? 0 : (f > 1 ? 1 : f);
      for (let c = 0; c < nc; ++c) out[c][i] = f * head[c][i];
    }
    return out;
  }

  // UNA pasada de la red: devuelve la capa CRUDA (sin guard), ya en unidades de la imagen.
  // La normalizacion (med/scale) se recalcula por pasada, igual que hace net_starless en cada llamada.
  async function cabraInferLayer(img, onDownloadProgress, onTileProgress) {
    const { med, scale } = computeNorm(img);
    const session = await window.OnnxEngine.loadSession(
      MODEL_URL_CABRASTARS, { expectedBytes: CABRASTARS_BYTES }, onDownloadProgress
    );
    const S = await window.OnnxEngine.runOnnxModelTiled(session, img, {
      tileSize: 768, overlap: 96, padMode: "reflect", layout: "NCHW", channels: 3,
      scaleIn: scale, offsetIn: -med * scale, scaleOut: 1.0, offsetOut: 0.0,
      clampOut: false, onProgress: onTileProgress
    });
    // GUARDIA NaN (bug 2026-07-25). Si la red devuelve NaN, la linea de abajo lo degrada en SILENCIO:
    // (v > 0 ? v : 0) es false para NaN -> capa de estrellas = 0 en TODA la imagen -> el starless sale
    // solo de la garantia de saturadas = TODAS las estrellas intactas + agujero negro en los nucleos
    // brillantes. Sin un solo error en consola. Causa tipica: un ONNX FP16 desbordando en WebGPU
    // (activaciones >65504), normalmente por una entrada FP16 vieja pegada en la cache de IndexedDB.
    // Mejor abortar con un mensaje accionable que entregar una imagen destrozada.
    let nonFinite = 0;
    for (let c = 0; c < S.length; ++c) {
      const sc = S[c];
      for (let i = 0; i < sc.length; ++i) if (!Number.isFinite(sc[i])) ++nonFinite;
    }
    if (nonFinite > 0) {
      throw new Error(
        `CabraStars: la red devolvio ${nonFinite} valores no finitos (NaN/Inf). El modelo cargado no es ` +
        `valido (tipicamente un FP16 antiguo cacheado, que desborda en WebGPU). Recarga con Ctrl+F5; si ` +
        `persiste, borra la cache de modelos (IndexedDB "cosmic-clarity-models-db") y reintenta.`
      );
    }
    const nc = img.nc, n = img.w * img.h, inv = 1.0 / (DISTILL_GAIN * scale);
    const layerCh = [];
    for (let c = 0; c < nc; ++c) {
      const lc = new Float32Array(n);
      for (let i = 0; i < n; ++i) { const v = S[c][i]; lc[i] = (v > 0 ? v : 0) * inv; }
      layerCh.push(lc);
    }
    return layerCh;
  }

  /* CabraStars Web: DOS pasadas + guard (= net_starless con su default passes=2).
   * Porte fiel de starless_infer.py:92-138. ANTES esto hacia UNA sola pasada, y esa era la causa del
   * starless roto reportado el 2026-07-25: la 1a pasada solo quita el nucleo (~84%) y deja las alas
   * (~12%) -> cada estrella queda como un DONUT. El docstring de net_starless ya lo decia: "la 1a
   * pasada deja un resto (~10 sigmas) en las estrellas DEBILES; la 2a se aplica al starless de la 1a".
   * Medido en LDu2 (100 estrellas, % del perfil radial eliminado por radio 0..6):
   *    1 pasada:  84 70 49 34 21 13 12      2 pasadas: 101 101 102 104 106 93 78
   * Son 2 inferencias en total (no 3): la capa CRUDA de la 1a se reutiliza aplicandole el guard a
   * posteriori con el fondo bueno. CLAVE: el fondo del guard NO es el percentil-20 sobre la imagen
   * con estrellas (sesgado hacia arriba junto a las brillantes -> nucleo residual; y hacia abajo en
   * nebulosa -> foso), sino la MEDIANA (pct=50) sobre el starless APROXIMADO de la 1a pasada, donde
   * al no haber estrellas la mediana es insesgada. Ese mismo fondo alimenta el guard de AMBAS pasadas.
   */
  async function runCabraStars(imgData, onDownloadProgress, onTileProgress, recover) {
    if (!imgData || !imgData.ch || imgData.ch.length === 0) throw new Error("No hay datos de imagen validos.");
    const isColor = imgData.isColor || imgData.nc === 3;
    const nc = imgData.nc, n = imgData.w * imgData.h;
    const restar = (base, layer) => {
      const out = [];
      for (let c = 0; c < nc; ++c) {
        const o = base.ch[c], l = layer[c], d = new Float32Array(n);
        for (let i = 0; i < n; ++i) { const v = o[i] - l[i]; d[i] = v < 0 ? 0 : (v > 1 ? 1 : v); }
        out.push(d);
      }
      return { ch: out, w: imgData.w, h: imgData.h, nc: nc, isColor: isColor };
    };

    // PASADA 1 — inferencia cruda (sin guard) sobre la imagen original.
    const capaCruda1 = await cabraInferLayer(imgData, onDownloadProgress, onTileProgress);
    const starlessBurdo = restar(imgData, capaCruda1);                     // sin estrellas (aprox.)
    const bg = localBackground(starlessBurdo.ch, imgData.w, imgData.h, nc, 50);  // MEDIANA, insesgada
    const capa1 = applyCabraGuard(imgData, capaCruda1, bg);                // guard a posteriori
    const paso1 = restar(imgData, capa1);

    // PASADA 2 — la red vuelve a mirar el starless de la 1a y se lleva las estrellitas residuales.
    const capaCruda2 = await cabraInferLayer(paso1, null, onTileProgress);
    const capa2 = applyCabraGuard(paso1, capaCruda2, bg);                  // el MISMO fondo
    const paso2 = restar(paso1, capa2);

    if (window.__cabraDebug) {
      window.__cabraDbg = { capaCruda1: capaCruda1, fondo: bg, capa1: capa1, capa2: capa2 };
    }
    return finishStarRemoval(imgData, paso2.ch, recover, isColor);
  }

  return {
    runStarNet2,
    runCabraStars
  };
})();
