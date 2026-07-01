/* =========================================================================
 * io.js — E/S de archivos de imagen astronomica (window.ImgIO).
 *
 * Loaders movidos desde autoghs.js (donde nacieron como demo standalone):
 *   loadFromFile(file) -> Promise<{ch,w,h,nc,isColor}>  (PNG/JPEG/TIFF/FITS/XISF)
 *   parseFITS(buffer) / parseXISF(buffer) / loadViaTIFF(buffer) / loadViaCanvas(bmp)
 *
 * Este modulo es el hogar natural de la E/S: aqui se anadiran los WRITERS
 * (TIFF 16-bit / FITS) de la mejora U1. TIFF 16/32 bits requiere UTIF global.
 * ========================================================================= */
(function (root) {
  "use strict";

  // Normaliza por el maximo global (preserva ratios de color; robusto a 8/16/32 bits).
  function normalizeByMax(ch, n, nc) {
    var mx = 0;
    for (var c = 0; c < nc; ++c) { var a = ch[c]; for (var i = 0; i < n; ++i) if (a[i] > mx) mx = a[i]; }
    if (mx <= 0) mx = 1;
    var inv = 1 / mx;
    for (var c2 = 0; c2 < nc; ++c2) { var a2 = ch[c2]; for (var i2 = 0; i2 < n; ++i2) a2[i2] *= inv; }
  }

  // PNG/JPEG/WebP/BMP (8 bits) vía canvas.
  function loadViaCanvas(imgBitmap) {
    var w = imgBitmap.width, h = imgBitmap.height, n = w * h;
    var tmp = document.createElement("canvas"); tmp.width = w; tmp.height = h;
    var tctx = tmp.getContext("2d"); tctx.drawImage(imgBitmap, 0, 0);
    var d = tctx.getImageData(0, 0, w, h).data;
    var r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
    for (var i = 0, p = 0; i < n; ++i, p += 4) { r[i] = d[p]; g[i] = d[p+1]; b[i] = d[p+2]; }
    var ch = [r, g, b];
    normalizeByMax(ch, n, 3);
    return { ch: ch, w: w, h: h, nc: 3, isColor: true };
  }

  // TIFF 8/16/32 bits vía UTIF (recomendado para datos lineales).
  function loadViaTIFF(buffer) {
    if (typeof UTIF === "undefined")
      throw new Error("Decodificador TIFF no disponible (incluye UTIF.js). Usa PNG/JPEG o FITS.");
    var ifds = UTIF.decode(buffer);
    UTIF.decodeImage(buffer, ifds[0], ifds);
    var ifd = ifds[0];
    var w = ifd.width, h = ifd.height, n = w * h;
    var spp = (ifd.t277 && ifd.t277[0]) || 1;     // samples/pixel
    var bps = (ifd.t258 && ifd.t258[0]) || 8;     // bits/sample
    var fmt = (ifd.t339 && ifd.t339[0]) || 1;     // 1=uint 2=int 3=float
    var raw = ifd.data;                            // Uint8Array
    var samp;
    if (bps === 16)      samp = new Uint16Array(raw.buffer, raw.byteOffset, (raw.byteLength >> 1));
    else if (bps === 32) samp = (fmt === 3) ? new Float32Array(raw.buffer, raw.byteOffset, (raw.byteLength >> 2))
                                            : new Uint32Array(raw.buffer, raw.byteOffset, (raw.byteLength >> 2));
    else                 samp = raw;
    var isColor = spp >= 3;
    var nc = isColor ? 3 : 1;
    var ch = []; for (var c = 0; c < nc; ++c) ch[c] = new Float32Array(n);
    for (var i = 0; i < n; ++i) for (var c2 = 0; c2 < nc; ++c2) ch[c2][i] = samp[i * spp + c2];
    normalizeByMax(ch, n, nc);
    return { ch: ch, w: w, h: h, nc: nc, isColor: isColor };
  }

  // FITS (BITPIX 8/16/32/-32/-64, mono NAXIS=2 o cubo RGB NAXIS=3, plano-secuencial,
  // big-endian). Aplica BZERO/BSCALE y voltea verticalmente (FITS es bottom-up).
  function parseFITS(buffer) {
    var bytes = new Uint8Array(buffer);
    var CARD = 80, BLOCK = 2880;

    function cardText(off) {
      var s = "";
      for (var i = 0; i < CARD; ++i) s += String.fromCharCode(bytes[off + i]);
      return s;
    }
    var hdr = {};
    var dataStart = -1;
    for (var off = 0; off + CARD <= bytes.length; off += CARD) {
      var card = cardText(off);
      var key = card.substring(0, 8).replace(/\s+$/g, "");
      if (key === "END") { dataStart = (Math.floor(off / BLOCK) + 1) * BLOCK; break; }
      if (card.charAt(8) === "=") {
        var rhs = card.substring(9);
        var slash = rhs.indexOf("/");
        if (slash >= 0) rhs = rhs.substring(0, slash);
        hdr[key] = rhs.trim().replace(/^'(.*)'$/, "$1").trim();
      }
    }
    if (dataStart < 0) throw new Error("FITS: cabecera sin END.");

    var BITPIX = parseInt(hdr.BITPIX, 10);
    var NAXIS  = parseInt(hdr.NAXIS, 10);
    var w = parseInt(hdr.NAXIS1, 10);
    var h = parseInt(hdr.NAXIS2, 10);
    var planes = (NAXIS >= 3 && hdr.NAXIS3) ? parseInt(hdr.NAXIS3, 10) : 1;
    var BZERO  = hdr.BZERO  !== undefined ? parseFloat(hdr.BZERO)  : 0;
    var BSCALE = hdr.BSCALE !== undefined ? parseFloat(hdr.BSCALE) : 1;
    if (!(w > 0) || !(h > 0)) throw new Error("FITS: dimensiones inválidas.");

    var n = w * h;
    var bytesPer = Math.abs(BITPIX) / 8;
    var dv = new DataView(buffer, dataStart);
    function readSample(idx) {
      var o = idx * bytesPer;
      switch (BITPIX) {
        case 8:   return dv.getUint8(o);
        case 16:  return dv.getInt16(o, false);     // big-endian con signo
        case 32:  return dv.getInt32(o, false);
        case -32: return dv.getFloat32(o, false);
        case -64: return dv.getFloat64(o, false);
        default:  throw new Error("FITS: BITPIX " + BITPIX + " no soportado.");
      }
    }

    var nc = planes >= 3 ? 3 : 1;
    var isColor = nc >= 3;
    var ch = []; for (var c = 0; c < nc; ++c) ch[c] = new Float32Array(n);
    for (var c2 = 0; c2 < nc; ++c2) {
      var base = c2 * n;                 // planos secuenciales (todo R, luego G, luego B)
      var dst = ch[c2];
      for (var y = 0; y < h; ++y) {
        var sy = h - 1 - y;              // FITS bottom-up -> top-down
        var srow = base + sy * w, drow = y * w;
        for (var x = 0; x < w; ++x) dst[drow + x] = BZERO + BSCALE * readSample(srow + x);
      }
    }
    normalizeByMax(ch, n, nc);
    return { ch: ch, w: w, h: h, nc: nc, isColor: isColor };
  }

  // XISF (Extensible Image Serialization Format) parser para archivos monolíticos
  // sin comprimir (Float32/Float64/UInt16/UInt32/UInt8, planar o normal).
  function parseXISF(buffer) {
    var bytes = new Uint8Array(buffer);
    if (bytes.length < 16) throw new Error("Archivo XISF demasiado pequeño o corrupto.");

    // 1. Verificar firma de 8 bytes
    var signature = "";
    for (var i = 0; i < 8; ++i) signature += String.fromCharCode(bytes[i]);
    if (signature !== "XISF0100") {
      throw new Error("No es un archivo XISF válido (firma incorrecta).");
    }

    // 2. Leer longitud de cabecera XML (uint32, little-endian en offset 8)
    var dv = new DataView(buffer);
    var xmlLength = dv.getUint32(8, true);

    if (16 + xmlLength > bytes.length) {
      throw new Error("Archivo XISF corrupto: la cabecera XML excede el tamaño del archivo.");
    }

    // 3. Decodificar la cabecera XML como UTF-8
    var xmlBytes = new Uint8Array(buffer, 16, xmlLength);
    var xmlText = new TextDecoder("utf-8").decode(xmlBytes);
    var parser = new DOMParser();
    var xmlDoc = parser.parseFromString(xmlText, "text/xml");
    
    var parseError = xmlDoc.getElementsByTagName("parsererror")[0];
    if (parseError) {
      throw new Error("Error al analizar la cabecera XML del archivo XISF: " + parseError.textContent);
    }

    // 4. Buscar el primer elemento <Image>
    var imageEl = null;
    var images = xmlDoc.getElementsByTagName("Image");
    if (images.length > 0) {
      imageEl = images[0];
    } else {
      images = xmlDoc.getElementsByTagNameNS("http://www.pixinsight.com/xisf", "Image");
      if (images.length > 0) {
        imageEl = images[0];
      } else {
        var allElems = xmlDoc.getElementsByTagName("*");
        for (var idx = 0; idx < allElems.length; ++idx) {
          var nodeName = allElems[idx].nodeName;
          if (nodeName === "Image" || nodeName.indexOf(":Image") !== -1 || (allElems[idx].localName && allElems[idx].localName === "Image")) {
            imageEl = allElems[idx];
            break;
          }
        }
      }
    }
    
    if (!imageEl) {
      throw new Error("No se encontró ningún elemento de imagen en la cabecera XISF.");
    }

    // 5. Validar compresión (no la soportamos en cliente por rendimiento y tamaño de librerías)
    var compression = imageEl.getAttribute("compression");
    if (compression && compression.trim().length > 0) {
      throw new Error("El archivo XISF está comprimido (" + compression + "). Por favor, guarda el archivo en PixInsight desmarcando la opción 'Compression' al guardar para poder cargarlo aquí.");
    }

    // 6. Leer geometría (width:height:channels)
    var geometryStr = imageEl.getAttribute("geometry");
    if (!geometryStr) throw new Error("Geometría de la imagen no especificada en XISF.");
    var geom = geometryStr.split(":");
    var w = parseInt(geom[0], 10);
    var h = parseInt(geom[1], 10);
    var nc = parseInt(geom[2], 10) || 1;
    if (!(w > 0) || !(h > 0)) throw new Error("Dimensiones de imagen inválidas en XISF.");

    // 7. Leer formato de muestras y ubicación
    var sampleFormat = imageEl.getAttribute("sampleFormat");
    if (!sampleFormat) throw new Error("Formato de muestra (sampleFormat) no especificado en XISF.");

    var locationStr = imageEl.getAttribute("location");
    if (!locationStr) throw new Error("Ubicación de los datos (location) no especificada en XISF.");
    var loc = locationStr.split(":");
    if (loc[0] !== "attachment") {
      throw new Error("Ubicación de datos '" + loc[0] + "' no soportada. Solo se admiten archivos monolíticos adjuntos.");
    }
    var dataOffset = parseInt(loc[1], 10);
    var dataSize = parseInt(loc[2], 10);

    if (dataOffset + dataSize > buffer.byteLength) {
      throw new Error("El bloque de datos de la imagen está fuera de los límites del archivo.");
    }

    // 8. Leer atributos de formato
    var byteOrder = imageEl.getAttribute("byteOrder") || "little-endian";
    byteOrder = byteOrder.toLowerCase();
    var isLittleEndian = (byteOrder === "little-endian");
    if (byteOrder !== "little-endian" && byteOrder !== "big-endian") {
      throw new Error("Orden de bytes '" + byteOrder + "' no soportado.");
    }

    var pixelStorage = imageEl.getAttribute("pixelStorage") || "planar";
    pixelStorage = pixelStorage.toLowerCase();
    if (pixelStorage !== "planar" && pixelStorage !== "normal") {
      throw new Error("Formato de almacenamiento de píxeles '" + pixelStorage + "' no soportado.");
    }

    // 9. Determinar bytes por muestra
    var bytesPer = 4;
    switch (sampleFormat) {
      case "UInt8":   bytesPer = 1; break;
      case "Int8":    bytesPer = 1; break;
      case "UInt16":  bytesPer = 2; break;
      case "Int16":   bytesPer = 2; break;
      case "UInt32":  bytesPer = 4; break;
      case "Int32":   bytesPer = 4; break;
      case "Float32": bytesPer = 4; break;
      case "Float64": bytesPer = 8; break;
      default:
        throw new Error("Formato de muestra '" + sampleFormat + "' no soportado.");
    }

    var n = w * h;
    var expectedSize = n * nc * bytesPer;
    if (dataSize < expectedSize) {
      throw new Error("El tamaño del bloque de datos (" + dataSize + " bytes) es menor al esperado (" + expectedSize + " bytes).");
    }

    var dvData = new DataView(buffer, dataOffset, dataSize);

    function readSample(idx) {
      var bytePos = idx * bytesPer;
      switch (sampleFormat) {
        case "UInt8":   return dvData.getUint8(bytePos);
        case "Int8":    return dvData.getInt8(bytePos);
        case "UInt16":  return dvData.getUint16(bytePos, isLittleEndian);
        case "Int16":   return dvData.getInt16(bytePos, isLittleEndian);
        case "UInt32":  return dvData.getUint32(bytePos, isLittleEndian);
        case "Int32":   return dvData.getInt32(bytePos, isLittleEndian);
        case "Float32": return dvData.getFloat32(bytePos, isLittleEndian);
        case "Float64": return dvData.getFloat64(bytePos, isLittleEndian);
      }
    }

    var isColor = nc >= 3;
    var readNc = isColor ? 3 : 1;
    var ch = [];
    for (var c = 0; c < readNc; ++c) {
      ch[c] = new Float32Array(n);
    }

    for (var c2 = 0; c2 < readNc; ++c2) {
      var dst = ch[c2];
      for (var y = 0; y < h; ++y) {
        var rowStart = y * w;
        for (var x = 0; x < w; ++x) {
          var pixelIndex = rowStart + x;
          var sampleIndex;
          if (pixelStorage === "planar") {
            sampleIndex = c2 * n + pixelIndex;
          } else {
            sampleIndex = pixelIndex * nc + c2;
          }
          dst[pixelIndex] = readSample(sampleIndex);
        }
      }
    }

    normalizeByMax(ch, n, readNc);
    return { ch: ch, w: w, h: h, nc: readNc, isColor: isColor };
  }

  function isFitsName(name) { return /\.(fits?|fts)$/i.test(name || ""); }
  function isXisfName(name) { return /\.xisf$/i.test(name || ""); }
  function isTiffName(name) { return /\.tiff?$/i.test(name || ""); }

  // Detección por extensión: FITS / XISF / TIFF / (resto vía canvas).
  function loadFromFile(file) {
    var name = file.name || "";
    if (isFitsName(name))
      return file.arrayBuffer().then(function (buf) { return parseFITS(buf); });
    if (isXisfName(name))
      return file.arrayBuffer().then(function (buf) { return parseXISF(buf); });
    if (isTiffName(name))
      return file.arrayBuffer().then(function (buf) { return loadViaTIFF(buf); });
    return createImageBitmap(file).then(function (bmp) { return loadViaCanvas(bmp); });
  }

  root.ImgIO = {
    loadFromFile: loadFromFile,
    parseFITS: parseFITS,
    parseXISF: parseXISF,
    loadViaTIFF: loadViaTIFF,
    loadViaCanvas: loadViaCanvas
  };
})(typeof window !== "undefined" ? window : this);
