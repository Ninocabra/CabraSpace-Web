/* =========================================================================
 * imgworker.js — Web Worker para operaciones de imagen pesadas (fuera del hilo
 * principal, para que "Aplicar" a resolución completa no congele la UI).
 * Reutiliza EXACTAMENTE la misma matemática que el hilo principal (imgops.js).
 *
 * Mensaje de entrada:  { id, op: "colorMixer"|"detail"|"curves"|"colorBalance"|"stretch",
 *                        img:{ch,w,h,nc,isColor}, params }
 * Mensaje de salida:   { id, ch:[...] }  (canales transferidos) | { id, error }
 * ========================================================================= */
// La query (?v=BUILD) de la URL del worker se propaga a sus dependencias → cache-busting coherente.
// lut.js y autoghs.js: dependencias de curves/stretch (LUTs, AutoGHS.process/medianMAD).
var __q = (self.location && self.location.search) || "";
importScripts("imgproc.js" + __q, "lut.js" + __q, "autoghs.js" + __q, "imgops.js" + __q);

self.onmessage = function (e) {
  var msg = e.data || {};
  try {
    var img = msg.img;
    var out;
    if (msg.op === "colorMixer") out = self.ImgOps.computeColorMixer(img, msg.params);
    else if (msg.op === "detail") out = self.ImgOps.computeDetail(img, msg.params.algo, msg.params);
    else if (msg.op === "curves") out = self.ImgOps.computeCurves(img, msg.params);
    else if (msg.op === "colorBalance") out = self.ImgOps.computeColorBalance(img, msg.params);
    else if (msg.op === "stretch") out = self.ImgOps.computeStretch(img, msg.params);
    else throw new Error("Operación desconocida: " + msg.op);
    // Transferir los buffers de salida (evita copia).
    var transfer = out.ch.map(function (c) { return c.buffer; });
    self.postMessage({ id: msg.id, ch: out.ch, w: out.w, h: out.h, nc: out.nc, isColor: out.isColor }, transfer);
  } catch (err) {
    self.postMessage({ id: msg.id, error: err && err.message ? err.message : String(err) });
  }
};
