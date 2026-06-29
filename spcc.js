/* =========================================================================
 * spcc.js — Calibración de color SPCC (Spectrophotometric Color Calibration)
 *           en JS puro. Port 1:1 de saspro.calibration.apply_spcc (Pyodide/
 *           astropy), para eliminar la dependencia de Pyodide.
 *
 * Reemplaza a window.SASProPyodide.processImageRaw(img,"spcc",...). La
 * proyección WCS es TAN (gnomónica) reconstruida desde {ra,dec,pixscale,
 * orientation,parity} (igual que el Python: WCS(naxis=2) con CD matrix), por
 * lo que NO hay distorsión SIP que portar.
 *
 * window.SPCC.calibrate(img, catalogStars, wcsMeta) -> { ch, w, h, nc,
 *   isColor, extra:{ factors:[k_R,1,k_B] } }  (R y B calibrados, G de ref.)
 * ========================================================================= */

window.SPCC = (function () {
  "use strict";

  const D2R = Math.PI / 180.0;
  const R2D = 180.0 / Math.PI;

  // Mediana exacta (sobre copia ordenada). El Python usa np.median; el heap
  // de JS no tiene el límite de Pyodide, así que podemos permitirnos exacto.
  function median(arr) {
    if (arr.length === 0) return 0;
    const a = Float64Array.from(arr);
    a.sort();
    const m = a.length >> 1;
    return a.length % 2 === 0 ? (a[m - 1] + a[m]) * 0.5 : a[m];
  }

  // WCS TAN world->pixel (0-based), replicando astropy con la CD construida en
  // apply_spcc. crpix = [w/2, h/2] (1-based FITS); world_to_pixel_values
  // devuelve 0-based, de ahí el "-1".
  function worldToPixel(ra, dec, m, w, h) {
    const scale = m.pixscale / 3600.0;                 // deg/px
    const theta = (m.orientation || 0.0) * D2R;
    const parity = (m.parity === undefined || m.parity === null) ? 1 : m.parity;
    const cd11 = scale * parity * Math.cos(theta);
    const cd12 = -scale * Math.sin(theta);
    const cd21 = scale * parity * Math.sin(theta);
    const cd22 = scale * Math.cos(theta);

    const a = ra * D2R, d = dec * D2R, a0 = m.ra * D2R, d0 = m.dec * D2R;
    const da = a - a0;
    const sinD = Math.sin(d), cosD = Math.cos(d);
    const sinD0 = Math.sin(d0), cosD0 = Math.cos(d0);
    const cosDa = Math.cos(da), sinDa = Math.sin(da);
    // cos de la distancia angular al punto de referencia (proyección frontal).
    const cosc = sinD0 * sinD + cosD0 * cosD * cosDa;
    if (cosc <= 0) return null;                        // detrás del plano tangente
    // Coordenadas estándar gnomónicas (rad -> deg). x = intermediate RA-axis.
    const xi = (cosD * sinDa) / cosc;
    const eta = (cosD0 * sinD - sinD0 * cosD * cosDa) / cosc;
    const xdeg = xi * R2D;
    const ydeg = eta * R2D;

    // Inversa de la matriz CD.
    const det = cd11 * cd22 - cd12 * cd21;
    if (Math.abs(det) < 1e-30) return null;
    const dx = (cd22 * xdeg - cd12 * ydeg) / det;
    const dy = (-cd21 * xdeg + cd11 * ydeg) / det;

    const px = (w / 2.0) + dx - 1.0;
    const py = (h / 2.0) + dy - 1.0;
    return [px, py];
  }

  // Ajuste fase 2: er ≈ a·mr² + b·mr + c. Prueba escala-pura, afín y cuadrática
  // (esta última solo si >=6 puntos y todas las predicciones >0); elige menor RMS
  // relativo. Devuelve [a,b,c]. Réplica de _fit_best (numpy).
  function rms(predArr, evArr) {
    const eps = 1e-30;
    let s = 0;
    const n = predArr.length;
    for (let i = 0; i < n; i++) {
      const ev = evArr[i] > eps ? evArr[i] : eps;
      const r = (predArr[i] / ev) - 1.0;
      s += r * r;
    }
    return Math.sqrt(s / n);
  }

  function fitBest(mr, er) {
    const n = mr.length;
    // Escala pura: s = Σ(mr·er)/Σ(mr²)
    let smr2 = 0, smre = 0;
    for (let i = 0; i < n; i++) { smr2 += mr[i] * mr[i]; smre += mr[i] * er[i]; }
    const s = smr2 > 0 ? smre / smr2 : 1.0;
    let bestCoef = [0.0, s, 0.0];
    const predS = new Float64Array(n);
    for (let i = 0; i < n; i++) predS[i] = s * mr[i];
    let bestRms = rms(predS, er);

    // Afín (lstsq): er ≈ ma·mr + ba. Normal equations 2x2.
    {
      let Sx = 0, Sxx = 0, Sy = 0, Sxy = 0;
      for (let i = 0; i < n; i++) { Sx += mr[i]; Sxx += mr[i] * mr[i]; Sy += er[i]; Sxy += mr[i] * er[i]; }
      const denom = n * Sxx - Sx * Sx;
      if (Math.abs(denom) > 1e-30) {
        const ma = (n * Sxy - Sx * Sy) / denom;
        const ba = (Sy - ma * Sx) / n;
        const predA = new Float64Array(n);
        for (let i = 0; i < n; i++) predA[i] = ma * mr[i] + ba;
        const rA = rms(predA, er);
        if (rA < bestRms) { bestRms = rA; bestCoef = [0.0, ma, ba]; }
      }
    }

    // Cuadrática: er ≈ a·mr² + b·mr + c (solo si >=6 y todas pred>0). Normal eqns 3x3.
    if (n >= 6) {
      let S0 = n, S1 = 0, S2 = 0, S3 = 0, S4 = 0, T0 = 0, T1 = 0, T2 = 0;
      for (let i = 0; i < n; i++) {
        const x = mr[i], x2 = x * x, y = er[i];
        S1 += x; S2 += x2; S3 += x2 * x; S4 += x2 * x2;
        T0 += y; T1 += x * y; T2 += x2 * y;
      }
      // Resolver [[S4,S3,S2],[S3,S2,S1],[S2,S1,S0]]·[a,b,c] = [T2,T1,T0]
      const sol = solve3x3(
        [[S4, S3, S2], [S3, S2, S1], [S2, S1, S0]],
        [T2, T1, T0]
      );
      if (sol) {
        const a = sol[0], b = sol[1], c = sol[2];
        const predQ = new Float64Array(n);
        let allPos = true;
        for (let i = 0; i < n; i++) {
          const p = a * mr[i] * mr[i] + b * mr[i] + c;
          predQ[i] = p;
          if (!(p > 0)) allPos = false;
        }
        if (allPos) {
          const rQ = rms(predQ, er);
          if (rQ < bestRms) { bestRms = rQ; bestCoef = [a, b, c]; }
        }
      }
    }
    return bestCoef;
  }

  // Eliminación gaussiana 3x3 con pivoteo parcial.
  function solve3x3(A, bvec) {
    const M = [
      [A[0][0], A[0][1], A[0][2], bvec[0]],
      [A[1][0], A[1][1], A[1][2], bvec[1]],
      [A[2][0], A[2][1], A[2][2], bvec[2]]
    ];
    for (let col = 0; col < 3; col++) {
      let piv = col;
      for (let r = col + 1; r < 3; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      if (Math.abs(M[piv][col]) < 1e-30) return null;
      if (piv !== col) { const t = M[piv]; M[piv] = M[col]; M[col] = t; }
      for (let r = 0; r < 3; r++) {
        if (r === col) continue;
        const f = M[r][col] / M[col][col];
        for (let k = col; k < 4; k++) M[r][k] -= f * M[col][k];
      }
    }
    return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  }

  function clip(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /**
   * Calibración SPCC. img = {ch:[R,G,B], w, h, nc, isColor}, cada canal
   * Float32Array row-major (idx = y*w + x). Devuelve un objeto nuevo (no muta
   * el de entrada) con R/B calibrados y G intacto, más extra.factors.
   * @returns {{ch:Float32Array[], w:number, h:number, nc:number, isColor:boolean, extra:{factors:number[]}}}
   */
  function calibrate(img, catalogStars, wcsMeta) {
    const w = img.w, h = img.h, nc = img.nc, npx = w * h;
    // Copia de trabajo (R,G,B). No mutamos el original.
    const R = Float32Array.from(img.ch[0]);
    const G = nc >= 2 ? Float32Array.from(img.ch[1]) : null;
    const B = nc >= 3 ? Float32Array.from(img.ch[2]) : null;

    const identity = () => ({
      ch: img.ch.map(c => Float32Array.from(c)),
      w, h, nc, isColor: img.isColor, extra: { factors: [1.0, 1.0, 1.0] }
    });
    if (nc < 3) return identity();

    const AP_RADIUS = 4, BG_IN = 6, BG_OUT = 10, WIN = 4;

    const measuredFluxes = [];   // [[mR,mG,mB], ...]
    const catalogFluxes = [];    // [[cR,cG,cB], ...]

    for (let si = 0; si < catalogStars.length; si++) {
      const star = catalogStars[si];
      const s_ra = star.ra, s_dec = star.dec, bp = star.bp, g = star.g, rp = star.rp;
      if (bp === undefined || bp === null || g === undefined || g === null || rp === undefined || rp === null) continue;

      const proj = worldToPixel(s_ra, s_dec, wcsMeta, w, h);
      if (!proj) continue;
      let px = proj[0], py = proj[1];
      const ix = Math.round(px), iy = Math.round(py);
      if (ix < BG_OUT || ix >= (w - BG_OUT) || iy < BG_OUT || iy >= (h - BG_OUT)) continue;

      // Centroide (centro de masa) en verde, ventana 9x9 (±WIN). En bounds por el guard previo.
      let denom = 0, sx = 0, sy = 0;
      for (let yy = iy - WIN; yy <= iy + WIN; yy++) {
        const row = yy * w;
        for (let xx = ix - WIN; xx <= ix + WIN; xx++) {
          const v = G[row + xx];
          denom += v; sx += v * xx; sy += v * yy;
        }
      }
      let cx, cy;
      if (denom > 0) { cx = sx / denom; cy = sy / denom; } else { cx = px; cy = py; }
      if (Math.abs(cx - px) > WIN || Math.abs(cy - py) > WIN) { cx = px; cy = py; }

      // Fotometría de apertura: caja [int(c)-BG_OUT .. int(c)+BG_OUT], clampada a bounds.
      const icx = Math.trunc(cx), icy = Math.trunc(cy);
      const y0 = Math.max(0, icy - BG_OUT), y1 = Math.min(h - 1, icy + BG_OUT);
      const x0 = Math.max(0, icx - BG_OUT), x1 = Math.min(w - 1, icx + BG_OUT);

      const chans = [R, G, B];
      const sumAp = [0, 0, 0], cntAp = [0, 0, 0], maxAp = [0, 0, 0];
      const bgVals = [[], [], []];
      for (let yy = y0; yy <= y1; yy++) {
        const row = yy * w;
        const dyv = yy - cy;
        for (let xx = x0; xx <= x1; xx++) {
          const dxv = xx - cx;
          const dist = Math.sqrt(dxv * dxv + dyv * dyv);
          const idx = row + xx;
          if (dist <= AP_RADIUS) {
            for (let c = 0; c < 3; c++) {
              const v = chans[c][idx];
              sumAp[c] += v; cntAp[c]++;
              if (v > maxAp[c]) maxAp[c] = v;
            }
          } else if (dist >= BG_IN && dist <= BG_OUT) {
            for (let c = 0; c < 3; c++) bgVals[c].push(chans[c][idx]);
          }
        }
      }
      if (bgVals[0].length < 5) continue;

      let saturated = false;
      const measured = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        if (maxAp[c] > 0.98) { saturated = true; break; }
        const bgLocal = median(bgVals[c]);
        measured[c] = sumAp[c] - bgLocal * cntAp[c];
      }
      if (saturated) continue;

      if (measured[0] > 0 && measured[1] > 0 && measured[2] > 0) {
        // Flujos catálogo Gaia anclados a estrella blanca G2V (colores solares Gaia restados).
        const cat_r = Math.pow(10.0, -0.4 * rp);
        const cat_g = Math.pow(10.0, -0.4 * (g - 0.49));
        const cat_b = Math.pow(10.0, -0.4 * (bp - 0.82));
        measuredFluxes.push(measured.slice());
        catalogFluxes.push([cat_r, cat_g, cat_b]);
      }
    }

    if (measuredFluxes.length < 3) {
      return {
        ch: [R, G, B], w, h, nc, isColor: img.isColor, extra: { factors: [1.0, 1.0, 1.0] }
      };
    }

    // Ratios medidos / esperados.
    const meas_RG = [], meas_BG = [], exp_RG = [], exp_BG = [];
    for (let i = 0; i < measuredFluxes.length; i++) {
      const m = measuredFluxes[i], c = catalogFluxes[i];
      const mRG = m[0] / m[1], mBG = m[2] / m[1];
      const eRG = c[0] / c[1], eBG = c[2] / c[1];
      if (isFinite(mRG) && isFinite(mBG) && isFinite(eRG) && isFinite(eBG) &&
          mRG > 0 && mBG > 0 && eRG > 0 && eBG > 0) {
        meas_RG.push(mRG); meas_BG.push(mBG); exp_RG.push(eRG); exp_BG.push(eBG);
      }
    }
    if (meas_RG.length < 3) {
      return {
        ch: [R, G, B], w, h, nc, isColor: img.isColor, extra: { factors: [1.0, 1.0, 1.0] }
      };
    }

    // Fase 1: ganancias escalares (mediana de ratios).
    const ratioR = meas_RG.map((v, i) => v / exp_RG[i]);
    const ratioB = meas_BG.map((v, i) => v / exp_BG[i]);
    const k_R = clip(median(ratioR), 0.1, 10.0);
    const k_B = clip(median(ratioB), 0.1, 10.0);

    // Fase 2: sigma-clip de outliers (sobre residuo combinado |r_RG|+|r_BG|).
    const N = meas_RG.length;
    const raw = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const rRG = (meas_RG[i] / (k_R * exp_RG[i])) - 1.0;
      const rBG = (meas_BG[i] / (k_B * exp_BG[i])) - 1.0;
      raw[i] = Math.abs(rRG) + Math.abs(rBG);
    }
    const med_r = median(raw);
    const absdev = new Float64Array(N);
    for (let i = 0; i < N; i++) absdev[i] = Math.abs(raw[i] - med_r);
    const mad_r = median(absdev) * 1.4826;
    const keepRG_m = [], keepRG_e = [], keepBG_m = [], keepBG_e = [];
    for (let i = 0; i < N; i++) {
      const keep = mad_r > 0 ? (raw[i] < med_r + 3.0 * mad_r) : true;
      if (keep) {
        keepRG_m.push(meas_RG[i]); keepRG_e.push(exp_RG[i]);
        keepBG_m.push(meas_BG[i]); keepBG_e.push(exp_BG[i]);
      }
    }

    const cR = fitBest(keepRG_m, keepRG_e);
    const cB = fitBest(keepBG_m, keepBG_e);

    // Aplicar Fase 2 por píxel: pivot-scale alrededor de la mediana del canal.
    // Gc = max(G, 1e-8). gain(rg) = clip(c0·rg² + c1·rg + c2, 0.25, 4)/max(rg,1e-8).
    const applyChan = (chan, coef) => {
      const c0 = coef[0], c1 = coef[1], c2 = coef[2];
      const gains = new Float64Array(npx);
      for (let i = 0; i < npx; i++) {
        const gc = G[i] > 1e-8 ? G[i] : 1e-8;
        let rg = chan[i] / gc;
        let gain = c0 * rg * rg + c1 * rg + c2;
        gain = clip(gain, 0.25, 4.0);
        const rgs = rg > 1e-8 ? rg : 1e-8;
        gains[i] = gain / rgs;
      }
      const pv = median(chan);
      for (let i = 0; i < npx; i++) {
        let v = (chan[i] - pv) * gains[i] + pv;
        chan[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
      }
    };
    applyChan(R, cR);
    applyChan(B, cB);

    return {
      ch: [R, G, B], w, h, nc, isColor: img.isColor,
      extra: { factors: [k_R, 1.0, k_B] }
    };
  }

  return { calibrate, worldToPixel };
})();
