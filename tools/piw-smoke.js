/* =========================================================================
 * piw-smoke.js — R3: suite de HUMO del CabraSpace Imaging Workflow.
 *
 * Solo se carga en modo test (?e2ehook=1; ver E2E-HOOK en pi-workflow.js).
 * Cubre los flujos críticos de extremo a extremo sobre imágenes sintéticas:
 * arranque, paridad worker↔CPU, Probar con proxy→full-res, commit del botón
 * grande (incluida la espera al full-res pendiente), Curvas/Balance por
 * worker, Linear Fit con proxy e histograma.
 *
 * Uso (consola o puente de evaluación):
 *   window.__piwSmoke();                 // lanza; deja el resultado en
 *   window.__piwSmokeResult              // null mientras corre; {pass,fail,steps} al acabar
 * El puente de evaluación tiene timeouts cortos: lanzar SIN await y sondear
 * __piwSmokeResult desde llamadas separadas.
 * ========================================================================= */
(function () {
  "use strict";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(fn, timeoutMs, everyMs) {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > timeoutMs) throw new Error("timeout (" + timeoutMs + " ms)");
      await sleep(everyMs || 100);
    }
  }
  function assert(cond, msg) { if (!cond) throw new Error(msg); }

  // Imagen sintética determinista (lineal, con gradiente suave + textura)
  function synthImage(w, h) {
    const n = w * h, ch = [];
    for (let c = 0; c < 3; c++) {
      const a = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = i % w, y = (i / w) | 0;
        a[i] = 0.01 + 0.005 * (x / w) + 0.004 * (y / h) + ((i * (7 + c)) % 97) / 97 * 0.002;
      }
      ch.push(a);
    }
    return { ch, w, h, nc: 3, isColor: true };
  }

  function openSection(applyKey) {
    document.querySelectorAll(".piw-section").forEach((s) => s.classList.add("collapsed"));
    const sec = document.querySelector('.piw-section[data-apply="' + applyKey + '"]');
    assert(sec, "no existe la sección data-apply=" + applyKey);
    sec.classList.remove("collapsed");
    window.updateBigApply();
  }

  async function run() {
    const T = window.__piwTest;
    const steps = [];
    const step = async (name, fn) => {
      const t0 = performance.now();
      try {
        const info = await fn();
        steps.push({ name, ok: true, ms: Math.round(performance.now() - t0), info: info || "" });
      } catch (e) {
        steps.push({ name, ok: false, ms: Math.round(performance.now() - t0), info: String((e && e.message) || e) });
      }
    };

    await step("boot", async () => {
      assert(window.PIW_BUILD, "PIW_BUILD ausente");
      assert(T, "__piwTest ausente (¿falta ?e2ehook=1?)");
      ["ImgProc", "ImgOps", "LUT", "AutoGHS"].forEach((m) => assert(window[m], m + " ausente"));
      ["computeCurves", "computeColorBalance", "computeStretch"].forEach((f) => assert(window.ImgOps[f], "ImgOps." + f + " ausente"));
      return "build " + window.PIW_BUILD;
    });

    await step("worker-parity", async () => {
      const img = synthImage(64, 64);
      const wrk = new Worker("imgworker.js?v=" + window.PIW_BUILD);
      const runW = (op, params) => new Promise((res, rej) => {
        const id = Math.random();
        const onMsg = (e) => { if (e.data.id !== id) return; wrk.removeEventListener("message", onMsg); e.data.error ? rej(new Error(e.data.error)) : res(e.data); };
        wrk.addEventListener("message", onMsg);
        wrk.postMessage({ id, op, img: { ch: img.ch.map((c) => Float32Array.from(c)), w: img.w, h: img.h, nc: 3, isColor: true }, params });
        setTimeout(() => rej(new Error("timeout worker " + op)), 10000);
      });
      const maxDiff = (a, b) => { let m = 0; for (let c = 0; c < 3; c++) for (let i = 0; i < a.ch[c].length; i++) { const d = Math.abs(a.ch[c][i] - b.ch[c][i]); if (d > m) m = d; } return m; };
      const curves = { K: [{ x: 0, y: 0 }, { x: 0.4, y: 0.55 }, { x: 1, y: 1 }], R: [{ x: 0, y: 0 }, { x: 1, y: 1 }], G: [{ x: 0, y: 0 }, { x: 1, y: 1 }], B: [{ x: 0, y: 0 }, { x: 1, y: 1 }], S: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
      const d1 = maxDiff(await runW("curves", { curves }), window.ImgOps.computeCurves(img, { curves }));
      const p2 = { algo: "stf", targetBg: 0.25, clipSigmas: -2.8 };
      const d2 = maxDiff(await runW("stretch", p2), window.ImgOps.computeStretch(img, p2));
      const p3 = { rMult: 1.2, gMult: 0.9, bMult: 1.05, satMult: 1.3, scnrAmt: 0.5 };
      const d3 = maxDiff(await runW("colorBalance", p3), window.ImgOps.computeColorBalance(img, p3));
      wrk.terminate();
      assert(d1 === 0 && d2 === 0 && d3 === 0, "paridad rota: curves=" + d1 + " stretch=" + d2 + " balance=" + d3);
      return "diff 0 en curves/stretch/balance";
    });

    // Imagen grande (dispara el proxy ≤1000px) para el resto de la suite
    const W = 1600, H = 1200;
    await step("cargar-imagen", async () => {
      T.setActiveImage(synthImage(W, H));
      const a = T.getActiveImage();
      assert(a && a.w === W && a.h === H, "setActiveImage no dejó la imagen activa");
      return W + "x" + H;
    });

    await step("probar-estirado+aplicar", async () => {
      openSection("stretch");
      document.getElementById("selStretchAlgo").value = "stf";
      document.getElementById("btnApplyStretch").click();
      // fase proxy (instantánea) — si el full-res gana la carrera, también vale
      const first = await until(() => { const a = T.getActiveImage(); return (a._proxy || (a.stages || []).indexOf("Stretch") >= 0) ? a : null; }, 8000, 40);
      const sawProxy = !!first._proxy;
      // "Aplicar" (botón grande) con lo que haya en pantalla: si es proxy, debe ESPERAR al full-res
      window.updateBigApply();
      const btn = document.getElementById("btnBigApply");
      assert(btn && btn.style.display !== "none" && !btn.disabled, "btnBigApply no disponible");
      btn.click();
      const committed = await until(() => { const s = T.getStepInputImage(); return (s && s.w === W && s.stages && s.stages.indexOf("Stretch") >= 0) ? s : null; }, 20000, 150);
      assert(!committed._proxy, "se commiteó un proxy");
      return (sawProxy ? "proxy visto; " : "full directo; ") + "commit " + committed.w + "x" + committed.h;
    });

    await step("curvas-worker", async () => {
      const before = T.getActiveImage();
      T.setCurves({ K: [{ x: 0, y: 0 }, { x: 0.5, y: 0.62 }, { x: 1, y: 1 }], R: [{ x: 0, y: 0 }, { x: 1, y: 1 }], G: [{ x: 0, y: 0 }, { x: 1, y: 1 }], B: [{ x: 0, y: 0 }, { x: 1, y: 1 }], S: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
      document.getElementById("btnApplyPostCurves").click();
      const a = await until(() => { const x = T.getActiveImage(); return (x !== before && x.stages && x.stages.indexOf("Curves") >= 0) ? x : null; }, 20000, 150);
      assert(a.w === W, "curvas no es full-res");
      return "stage Curves, " + a.w + "x" + a.h;
    });

    await step("balance-worker", async () => {
      const before = T.getActiveImage();
      document.getElementById("sldPostBalanceR").value = "1.15";
      document.getElementById("btnApplyPostColor").click();
      const a = await until(() => { const x = T.getActiveImage(); return (x !== before && x.stages && x.stages.indexOf("Color Balance") >= 0) ? x : null; }, 20000, 150);
      document.getElementById("sldPostBalanceR").value = "1.00";
      return "stage Color Balance, " + a.w + "x" + a.h;
    });

    await step("linearfit-proxy", async () => {
      openSection("calibration");
      document.getElementById("cardLinearFit").click();
      const a = await until(() => { const x = T.getActiveImage(); return (!x._proxy && x.w === W && x.stages && x.stages.indexOf("Linear Fit") >= 0) ? x : null; }, 20000, 150);
      return "Linear Fit full-res " + a.w + "x" + a.h;
    });

    await step("histograma", async () => {
      const d = document.getElementById("histogramPath").getAttribute("d");
      assert(d && d.length > 100, "histogramPath vacío");
      return d.length + " chars";
    });

    const fail = steps.filter((s) => !s.ok).length;
    return { pass: steps.length - fail, fail, steps };
  }

  window.__piwSmoke = function () {
    window.__piwSmokeResult = null;
    return run().then((r) => (window.__piwSmokeResult = r), (e) => (window.__piwSmokeResult = { pass: 0, fail: 1, steps: [{ name: "run", ok: false, info: String(e) }] }));
  };
})();
