#!/usr/bin/env node
// check_site.mjs - comprobador de la web (Node >= 22, sin dependencias, Chrome sin cabeza por DevTools).
//
// Recorre TODAS las .html de la raiz del repo (o de --dir) sobre un servidor ya encendido y, por pagina:
//   (a) recursos locales rotos: css, js, imagenes, url() de las hojas locales, <source>/<video>/iconos
//       y enlaces internos <a href> que no resuelven;
//   (b) excepciones de JavaScript y errores de consola al cargar;
//   (c) desborde horizontal (scrollWidth > innerWidth) a 1440 y a 390 px.
// Las peticiones a otros dominios NO se bloquean pero no cuentan para el veredicto (se cuentan aparte).
//
// Uso:
//   node tools/check_site.mjs [--base http://localhost:8099/] [--dir <carpeta con las .html>]
//        [--json salida.json] [--baseline linea_base.json] [--captures carpeta]
//        [--only a.html,b.html] [--concurrency 3] [--settle 1200]
// Codigo de salida: 0 = sin fallos NUEVOS; 1 = hay fallos que no estan en la linea base; 2 = error del propio comprobador.
// --baseline: los fallos presentes en el JSON de linea base se listan como "conocidos" y no cuentan.
// --captures: guarda <pagina>-1440.png, <pagina>-390.png y <pagina>-noche-1440.png (modo noche =
//   localStorage 'night-vision'='enabled' antes de cargar). Las redirecciones (meta refresh) se listan y no se capturan.
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- argumentos ----------
const argv = process.argv.slice(2), opt = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const k = argv[i].slice(2), v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  opt[k] = v;
}
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(opt.dir || join(here, '..'));
const BASE = new URL(opt.base || 'http://localhost:8099/');
const SETTLE = +opt.settle || 1200;
const CONC = Math.max(1, +opt.concurrency || 3);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sameOrigin = u => { try { return new URL(u).origin === BASE.origin; } catch { return false; } };

// ---------- lista de paginas ----------
let pages = readdirSync(ROOT).filter(f => f.toLowerCase().endsWith('.html')).sort();
if (opt.only && opt.only !== true) { const s = new Set(opt.only.split(',')); pages = pages.filter(p => s.has(p)); }
const isRedirect = f => /<meta[^>]+http-equiv=["']?refresh/i.test(readFileSync(join(ROOT, f), 'utf8'));
const redirects = new Set(pages.filter(isRedirect));
const stem = f => f.replace(/\.html$/i, '');

// ---------- comprobacion de URLs desde Node (cache) ----------
const urlCache = new Map();
async function urlStatus(u) {
  u = u.split('#')[0];
  if (urlCache.has(u)) return urlCache.get(u);
  const p = (async () => {
    try {
      let r = await fetch(u, { method: 'HEAD', redirect: 'follow' });
      if (r.status === 405 || r.status === 501) r = await fetch(u, { headers: { Range: 'bytes=0-0' }, redirect: 'follow' });
      return r.status;
    } catch (e) { return 'ERR ' + (e.cause?.code || e.message); }
  })();
  urlCache.set(u, p);
  return p;
}
// «Access to fetch at 'https://otro-dominio/...' from origin 'http://localhost:8099' has been blocked by CORS»:
// el destino es externo; el origen local solo aparece como contexto. Cuenta como externo, no como fallo local.
const isExternalAccessError = t => { const m = /^Access to (?:fetch|XMLHttpRequest|font|image|script|CSS stylesheet) at '([^']+)'/.exec(t || ''); return !!m && !sameOrigin(m[1]); };
const bad = s => typeof s === 'string' || s >= 400;

// url() de una hoja de estilo local (texto) -> lista de URLs absolutas
const cssCache = new Map();
async function cssUrls(sheetUrl) {
  sheetUrl = sheetUrl.split('#')[0];
  if (cssCache.has(sheetUrl)) return cssCache.get(sheetUrl);
  const p = (async () => {
    let txt;
    try { const r = await fetch(sheetUrl); if (!r.ok) return []; txt = await r.text(); } catch { return []; }
    txt = txt.replace(/\/\*[\s\S]*?\*\//g, '');
    const out = new Set();
    for (const m of txt.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
      const raw = m[2].trim();
      if (!raw || raw.startsWith('data:') || raw.startsWith('#') || raw.startsWith('about:')) continue;
      try { out.add(new URL(raw, sheetUrl).href); } catch { /* ignorar */ }
    }
    return [...out];
  })();
  cssCache.set(sheetUrl, p);
  return p;
}

// ---------- Chrome / CDP ----------
const port = 9300 + Math.floor(Math.random() * 600);
const prof = mkdtempSync(join(tmpdir(), 'checksite-'));
const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--mute-audio',
  `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });

let ws, nextId = 0; const pending = new Map(), listeners = new Set();
function send(method, params = {}, sessionId) {
  return new Promise((res, rej) => {
    const id = ++nextId; pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function connect() {
  for (let i = 0; i < 80; i++) {
    await sleep(150);
    try {
      const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      ws = new WebSocket(v.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = m => {
        const d = JSON.parse(m.data);
        if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
        else if (d.method) for (const l of listeners) l(d);
      };
      return;
    } catch { /* aun no */ }
  }
  throw new Error('Chrome no arranco');
}

// Una carga: contexto limpio (localStorage aislado), una pestana, viewport w x h.
async function visit(file, { w, h = 900, night = false, capture = null, doChecks = true }) {
  const url = new URL(file, BASE).href;
  const { browserContextId } = await send('Target.createBrowserContext');
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  const R = { url, w, night, exceptions: [], consoleErrors: [], ignoredExternal: 0, netFailures: [], loadOk: true };
  const reqs = new Map(); let inflight = 0, lastNet = Date.now();
  const onEv = d => {
    if (d.sessionId !== sessionId) return;
    const p = d.params;
    if (d.method === 'Runtime.exceptionThrown') R.exceptions.push((p.exceptionDetails.exception?.description || p.exceptionDetails.text || '?').split('\n')[0]);
    else if (d.method === 'Runtime.consoleAPICalled' && p.type === 'error') {
      const t = p.args.map(x => x.value ?? x.description ?? '').join(' ');
      if (isExternalAccessError(t)) R.ignoredExternal++; else R.consoleErrors.push(t.slice(0, 300));
    } else if (d.method === 'Log.entryAdded' && p.entry.level === 'error') {
      const e = p.entry, u = e.url || '';
      if (/\/favicon\.ico$/.test(u)) { /* Chrome lo pide solo: no es un fallo de la web */ }
      else if (e.source === 'network' && u && !sameOrigin(u)) R.ignoredExternal++;
      else if (isExternalAccessError(e.text)) R.ignoredExternal++;
      else R.consoleErrors.push(`[${e.source}] ${e.text}${u ? ' ' + u : ''}`.slice(0, 300));
    } else if (d.method === 'Network.requestWillBeSent') { reqs.set(p.requestId, p.request.url); inflight++; lastNet = Date.now(); }
    else if (d.method === 'Network.loadingFinished') { inflight = Math.max(0, inflight - 1); lastNet = Date.now(); }
    else if (d.method === 'Network.loadingFailed') {
      inflight = Math.max(0, inflight - 1); lastNet = Date.now();
      const u = reqs.get(p.requestId) || '';
      if (p.canceled || !u || u.startsWith('data:') || u.startsWith('blob:')) return;
      if (sameOrigin(u)) R.netFailures.push(u + ' (' + p.errorText + ')'); else R.ignoredExternal++;
    } else if (d.method === 'Network.responseReceived') {
      const u = p.response.url;
      if (p.response.status >= 400 && sameOrigin(u) && !/\/favicon\.ico$/.test(u)) R.netFailures.push(u + ' (HTTP ' + p.response.status + ')');
      else if (p.response.status >= 400) R.ignoredExternal++;
    }
  };
  listeners.add(onEv);
  let loaded = false;
  const onLoad = d => { if (d.sessionId === sessionId && d.method === 'Page.loadEventFired') loaded = true; };
  listeners.add(onLoad);
  try {
    await S('Page.enable'); await S('Runtime.enable'); await S('Log.enable'); await S('Network.enable');
    await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 });
    if (night) await S('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('night-vision','enabled')}catch(e){}" });
    await S('Page.navigate', { url });
    for (let t = 0; t < 300 && !loaded; t++) await sleep(100);   // hasta 30 s
    const ev = async js => { const r = await S('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? null : r.result.value; };
    if (!loaded) {
      // el evento load espera a TODOS los recursos, tambien los externos lentos (webcam, mapas...): si el DOM ya esta
      // listo (readyState interactive/complete) se sigue y se anota «carga lenta»; solo es fallo si ni el DOM llego.
      const rs = await ev('document.readyState');
      if (rs === 'interactive' || rs === 'complete') R.slowLoad = true; else R.loadOk = false;
    }
    await sleep(SETTLE);
    // imagenes perezosas -> inmediatas, y espera a que la red se calme (max 8 s)
    await ev("document.querySelectorAll('img[loading=lazy]').forEach(i=>{i.loading='eager'})");
    for (let t = 0; t < 80 && (inflight > 0 || Date.now() - lastNet < 500); t++) await sleep(100);

    if (doChecks) {
      R.dom = await ev(`(()=>{
        const abs = (u)=>{try{return new URL(u, document.baseURI).href}catch(e){return null}};
        const res = new Set(), links = new Set(), sheets = new Set();
        document.querySelectorAll('script[src],img[src],source[src],video[src],audio[src],track[src],iframe[src],embed[src]').forEach(e=>{const u=abs(e.getAttribute('src'));if(u)res.add(u)});
        document.querySelectorAll('img[srcset],source[srcset]').forEach(e=>e.getAttribute('srcset').split(',').forEach(s=>{const u=abs(s.trim().split(/\\s+/)[0]);if(u)res.add(u)}));
        document.querySelectorAll('video[poster]').forEach(e=>{const u=abs(e.getAttribute('poster'));if(u)res.add(u)});
        document.querySelectorAll('link[href]').forEach(e=>{
          const r=(e.getAttribute('rel')||'').toLowerCase(); const u=abs(e.getAttribute('href')); if(!u) return;
          if(r.includes('stylesheet')){res.add(u);sheets.add(u)}
          else if(/icon|preload|modulepreload|manifest/.test(r)) res.add(u);
        });
        document.querySelectorAll('a[href]').forEach(e=>{const h=e.getAttribute('href'); if(!h||/^(#|mailto:|tel:|javascript:|data:|blob:)/i.test(h))return; const u=abs(h); if(u) links.add(u)});
        const brokenImgs=[...document.images].filter(i=>i.complete&&i.naturalWidth===0&&i.getAttribute('src')&&!i.getAttribute('src').startsWith('data:')).map(i=>abs(i.getAttribute('src')));
        return {res:[...res],links:[...links],sheets:[...sheets],brokenImgs};
      })()`);
      // desborde horizontal
      R.overflow = await ev(`(()=>{
        const de=document.documentElement, iw=${w}, sw=Math.max(de.scrollWidth, document.body?document.body.scrollWidth:0);
        let culprit=null;
        if(sw>iw){ let best=0; document.querySelectorAll('body *').forEach(e=>{const r=e.getBoundingClientRect(); if(r.width>0&&r.right>iw+1&&r.right>best){best=r.right;culprit=(e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(e.className&&typeof e.className==='string'?'.'+e.className.trim().split(/\\s+/).slice(0,2).join('.'):'')).slice(0,80)+' right='+Math.round(r.right)}}); }
        return {iw,sw,culprit};
      })()`);
    }

    if (capture) {
      const hgt = Math.min(16000, await ev('Math.max(document.documentElement.scrollHeight, document.body?document.body.scrollHeight:0)') || h);
      // se agranda el viewport a la pagina (no se captura mas alla del viewport: calcula mal las unidades vw)
      await S('Emulation.setDeviceMetricsOverride', { width: w, height: hgt, deviceScaleFactor: 1, mobile: w < 700 });
      await sleep(700);
      const shot = await S('Page.captureScreenshot', { format: 'png' });
      writeFileSync(capture, Buffer.from(shot.data, 'base64'));
      R.captureHeight = hgt;
    }
  } catch (e) { R.loadOk = false; R.error = e.message; }
  finally {
    listeners.delete(onEv); listeners.delete(onLoad);
    try { await send('Target.closeTarget', { targetId }); } catch { }
    try { await send('Target.disposeBrowserContext', { browserContextId }); } catch { }
  }
  return R;
}

// ---------- una pagina completa ----------
async function checkPage(file) {
  const out = { page: file, redirect: redirects.has(file), failures: [], ignoredExternal: 0, overflow: {} };
  const fail = (kind, key, detail) => out.failures.push({ page: file, kind, key, detail: detail || key });
  const rel = u => sameOrigin(u) ? u.slice(BASE.origin.length) : u;

  if (out.redirect) {
    const txt = readFileSync(join(ROOT, file), 'utf8');
    const m = txt.match(/http-equiv=["']?refresh[^>]*content=["'][^"']*url=([^"'>\s]+)/i);
    out.redirectTo = m ? m[1] : null;
    if (!m) fail('recurso', 'redirect-sin-destino', 'meta refresh sin url');
    else { const s = await urlStatus(new URL(m[1], new URL(file, BASE)).href); if (bad(s)) fail('recurso', rel(new URL(m[1], new URL(file, BASE)).href), 'destino de la redireccion: ' + s); }
    return out;
  }

  const caps = opt.captures && opt.captures !== true ? resolve(opt.captures) : null;
  if (caps) mkdirSync(caps, { recursive: true });
  const s = stem(file);
  const r1440 = await visit(file, { w: 1440, capture: caps && join(caps, `${s}-1440.png`) });
  const r390 = await visit(file, { w: 390, h: 844, capture: caps && join(caps, `${s}-390.png`) });
  if (caps) {
    const rn = await visit(file, { w: 1440, night: true, doChecks: false, capture: join(caps, `${s}-noche-1440.png`) });
    out.nightCaptureOk = rn.loadOk;
  }
  out.captureHeights = { 1440: r1440.captureHeight, 390: r390.captureHeight };
  out.slowLoad = !!(r1440.slowLoad || r390.slowLoad);

  // (b) JS y consola (se unen las dos cargas; claves sin numeros de linea/columna volatiles)
  const norm = t => t.replace(/https?:\/\/[^\s)]+/g, u => sameOrigin(u) ? rel(u) : u).replace(/:\d+:\d+/g, '').slice(0, 200);
  for (const r of [r1440, r390]) {
    if (!r.loadOk) fail('carga', `carga-${r.w}`, `la pagina no termino de cargar a ${r.w} px ${r.error || ''}`);
    out.ignoredExternal += r.ignoredExternal;
  }
  const exc = new Set(), con = new Set();
  [r1440, r390].forEach(r => { r.exceptions.forEach(e => exc.add(norm(e))); r.consoleErrors.forEach(e => con.add(norm(e))); });
  for (const e of exc) fail('js', e);
  for (const e of con) fail('consola', e);

  // (a) recursos locales rotos: los vistos por la red + los del DOM + url() de las hojas + enlaces
  const broken = new Map();   // url -> motivo
  for (const r of [r1440, r390]) for (const f of r.netFailures) { const m = f.match(/^(\S+) \((.*)\)$/); broken.set(m ? m[1] : f, m ? m[2] : '?'); }
  const dom = r1440.dom, dom2 = r390.dom;
  const resUrls = new Set([...(dom?.res || []), ...(dom2?.res || [])]);
  const linkUrls = new Set([...(dom?.links || []), ...(dom2?.links || [])]);
  const sheets = new Set([...(dom?.sheets || []), ...(dom2?.sheets || [])]);
  for (const sh of sheets) if (sameOrigin(sh)) for (const u of await cssUrls(sh)) resUrls.add(u);
  for (const u of resUrls) if (sameOrigin(u)) { const st = await urlStatus(u); if (bad(st)) broken.set(u, 'HTTP ' + st); }
  for (const u of [...(dom?.brokenImgs || []), ...(dom2?.brokenImgs || [])]) if (u && sameOrigin(u) && !broken.has(u)) broken.set(u, 'imagen no decodificable');
  for (const [u, why] of broken) if (!/\/favicon\.ico$/.test(u)) fail('recurso', rel(u).split('#')[0], `${rel(u).split('#')[0]} -> ${why}`);
  for (const u of linkUrls) if (sameOrigin(u)) { const st = await urlStatus(u); if (bad(st)) fail('enlace', rel(u).split('#')[0], `${rel(u).split('#')[0]} -> enlace interno roto: ${st}`); }

  // (c) desborde horizontal
  for (const r of [r1440, r390]) {
    if (r.overflow) { out.overflow[r.w] = r.overflow; if (r.overflow.sw > r.overflow.iw) fail('desborde', `desborde@${r.w}`, `scrollWidth ${r.overflow.sw} > ${r.overflow.iw}${r.overflow.culprit ? ' (' + r.overflow.culprit + ')' : ''}`); }
  }
  return out;
}

// ---------- principal ----------
async function main() {
  try { const r = await fetch(BASE.href); if (!r.ok && r.status !== 404 && r.status !== 403) throw new Error('HTTP ' + r.status); }
  catch (e) { console.error(`No hay servidor en ${BASE.href} (${e.message})`); process.exitCode = 2; return; }
  await connect();
  const t0 = Date.now(), results = [], queue = [...pages];
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (queue.length) {
      const f = queue.shift();
      try { results.push(await checkPage(f)); }
      catch (e) { results.push({ page: f, failures: [{ page: f, kind: 'carga', key: 'error-del-comprobador', detail: e.message }], overflow: {}, ignoredExternal: 0 }); }
      process.stderr.write(`\r${results.length}/${pages.length} ${f}                    `);
    }
  }));
  process.stderr.write('\n');
  results.sort((a, b) => a.page.localeCompare(b.page));

  // linea base
  let known = new Set(), baselineLoaded = false;
  if (opt.baseline && opt.baseline !== true) {
    const b = JSON.parse(readFileSync(resolve(opt.baseline), 'utf8'));
    for (const r of b.results) for (const f of r.failures) known.add(`${f.page}|${f.kind}|${f.key}`);
    baselineLoaded = true;
  }
  let nNew = 0, nKnown = 0;
  for (const r of results) for (const f of r.failures) { f.known = known.has(`${f.page}|${f.kind}|${f.key}`); f.known ? nKnown++ : nNew++; }
  const stillKnown = new Set(results.flatMap(r => r.failures.map(f => `${f.page}|${f.kind}|${f.key}`)));
  const fixed = [...known].filter(k => !stillKnown.has(k));

  // tabla
  const cnt = (r, k) => r.failures.filter(f => f.kind === k).length;
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('pagina', 44) + pad('recurs', 7) + pad('enlace', 7) + pad('js', 4) + pad('consol', 7) + pad('ovf1440', 8) + pad('ovf390', 7) + 'nota');
  for (const r of results) {
    const o = k => r.redirect ? '-' : (r.failures.some(f => f.kind === 'desborde' && f.key === 'desborde@' + k) ? 'SI' : 'ok');
    const nota = r.redirect ? `redireccion -> ${r.redirectTo} (no se captura)` : (r.failures.some(f => f.kind === 'carga') ? 'CARGA INCOMPLETA' : (r.slowLoad ? 'carga lenta (el evento load tardo mas de 30 s; DOM listo)' : ''));
    console.log(pad(r.page, 44) + pad(cnt(r, 'recurso'), 7) + pad(cnt(r, 'enlace'), 7) + pad(cnt(r, 'js'), 4) + pad(cnt(r, 'consola'), 7) + pad(o(1440), 8) + pad(o(390), 7) + nota);
  }
  console.log('\nDetalle de fallos:');
  for (const r of results) for (const f of r.failures) console.log(`  [${f.known ? 'conocido' : 'NUEVO   '}] ${f.page} · ${f.kind} · ${f.detail}`);
  if (fixed.length) { console.log('\nPresentes en la linea base y ya no aparecen:'); fixed.forEach(k => console.log('  ' + k)); }
  const ext = results.reduce((a, r) => a + (r.ignoredExternal || 0), 0);
  console.log(`\n${results.length} paginas (${results.filter(r => r.redirect).length} redirecciones) · fallos: ${nNew + nKnown} (${nNew} nuevos, ${nKnown} conocidos${baselineLoaded ? '' : '; sin linea base: todos cuentan'}) · URLs locales comprobadas: ${[...urlCache.keys()].filter(sameOrigin).length} · errores de dominios externos ignorados: ${ext} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);

  if (opt.json && opt.json !== true) {
    writeFileSync(resolve(opt.json), JSON.stringify({ generated: new Date().toISOString(), base: BASE.href, results }, null, 1));
    console.log('JSON: ' + resolve(opt.json));
  }
  process.exitCode = nNew ? 1 : 0;
}
main().catch(e => { console.error('FALLO del comprobador:', e); process.exitCode = 2; })
  .finally(() => { try { ws?.close(); } catch { } proc.kill(); setTimeout(() => { try { rmSync(prof, { recursive: true, force: true }); } catch { } process.exit(process.exitCode ?? 0); }, 300); });
