/* La cúpula de Nerpio: el cielo pintado píxel a píxel.
 *
 * Port del renderizador de `docs/mockups/night.html` del motor AstroWeather.
 * Es la MISMA física y los mismos números que la vista interna: se porta en vez
 * de reescribirse a propósito, porque una segunda versión "parecida" acaba
 * discrepando de la que explica.
 *
 * Y conviene tener claro qué se calcula aquí y qué no. Aquí solo se RENDERIZA:
 * el fondo natural, la Vía Láctea, la dispersión lunar, el crepúsculo y la nube
 * iluminada se componen a partir de los números que ya vienen resueltos en el
 * JSON — extinción, aerosol, fase, altura del Sol y de la Luna, cobertura por
 * capa. Ninguna previsión se recalcula en el navegador.
 *
 * Cada contribución se acumula como luminancia en nanolambert con su propio
 * tono, la suma se comprime logarítmicamente como hace el ojo, y el tono que
 * sobrevive es el del proceso que domina. Por eso una noche con calima y Luna
 * sale naranja y una limpia sale azul: no es una paleta, es el resultado.
 */
(function (global) {
  'use strict';

  var D2R = Math.PI / 180;
  var NGP_RA = 192.859, NGP_DEC = 27.128;      // polo norte galáctico
  var GC_RA = 266.405, GC_DEC = -28.936;       // centro galáctico, l = 0, b = 0

  // Tonos de cada proceso. No son decorativos: deciden de qué color sale el
  // cielo cuando ese proceso manda.
  var C_NATURAL = [0.09, 0.12, 0.25];
  var C_GALAXY = [0.93, 0.89, 0.76];
  var C_MOON = [0.34, 0.52, 0.98];
  var C_HAZE = [0.30, 0.44, 0.80];
  var C_DUST = [0.93, 0.50, 0.22];
  var C_TWILIGHT = [0.99, 0.58, 0.26];
  var LAYER_RGB = { low: [107, 114, 128], mid: [156, 163, 175], high: [207, 212, 221] };

  // Parte del fondo natural que es airglow: la que obedece a van Rhijn en vez
  // de extinguirse. Sale de la literatura — el fotómetro solo mira arriba, así
  // que este sitio no la puede comprobar.
  var AIRGLOW_FRACTION = 0.6;
  var NATURAL_FLOOR_MAG = 21.71;

  var nl = function (m) { return 34.08 * Math.exp(20.7233 - 0.92104 * m); };
  var LOG_LO = Math.log10(10), LOG_SPAN = Math.log10(260000) - LOG_LO;

  /* Los dos mandos del color, separados del calculo y con nombre propio.
   *
   * La FISICA de arriba no se toca: las luminancias, sus tonos y la compresion
   * logaritmica son las medidas. Estos dos solo deciden como se traduce el
   * resultado a pantalla, y estan subidos a proposito respecto al mockup
   * interno (SAT 1.18, GAMMA 0.60). Alli el domo se mira sabiendo lo que se
   * busca; aqui lo abre alguien que quiere ver DE UN VISTAZO si esta noche se
   * parece a la de ayer, y con la version fiel casi todas salian del mismo
   * azul. Estirar el contraste no cambia ningun numero -- la magnitud que
   * acompana a cada muestra de la clave se sigue reconstruyendo de la
   * luminancia, no del pixel -- pero hace legible la diferencia. */
  var SAT = 2.05;      // separacion de tono entre procesos
  var GAMMA = 0.52;    // pendiente de la rampa de brillo

  // El búfer del cielo. Lo bastante grande para que salga liso; el borde
  // circular se recorta aparte a resolución de pantalla, así que el círculo es
  // un círculo de verdad y no una escalera.
  var BUF = 560;
  var MARGEN = 30;                    // sitio para la rosa de los vientos

  // ---------------------------------------------------- VÍA LÁCTEA --------
  // El mapa se decodifica una vez a un array de floats para que el bucle por
  // píxel no toque el DOM. Hasta que llega, mwShape() devuelve 1 y la cúpula
  // dibuja el perfil medido liso, que es exactamente lo que dibujaba antes.
  var MW_W = 512, MW_H = 256, MW_SCALE = 4.0;
  var MW_SHAPE = null, MW_PENDIENTE = [];

  function cargarViaLactea(url) {
    var img = new Image();
    img.onload = function () {
      var c = document.createElement('canvas');
      c.width = MW_W; c.height = MW_H;
      var cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      var d = cx.getImageData(0, 0, MW_W, MW_H).data;
      var out = new Float32Array(MW_W * MW_H);
      for (var i = 0; i < out.length; i++) { out[i] = d[i * 4] / 255 * MW_SCALE; }
      MW_SHAPE = out;
      MW_PENDIENTE.splice(0).forEach(function (fn) { fn(); });
    };
    img.onerror = function () { MW_PENDIENTE.length = 0; };   // sin foto, perfil liso
    img.src = url;
  }

  /* Forma de la Vía Láctea en una posición galáctica. Bilineal, envolviendo en
     longitud (l = +180 en x = 0, decreciendo a la derecha) y recortada en
     latitud. */
  function mwShape(l, b) {
    if (!MW_SHAPE) { return 1; }
    var fx = (((180 - l) / 360 * MW_W) % MW_W + MW_W) % MW_W;
    var fy = Math.min(MW_H - 1.001, Math.max(0, (90 - b) / 180 * MW_H - 0.5));
    var x0 = Math.floor(fx), y0 = Math.floor(fy);
    var tx = fx - x0, ty = fy - y0;
    var x1 = (x0 + 1) % MW_W, y1 = Math.min(MW_H - 1, y0 + 1);
    var r0 = y0 * MW_W, r1 = y1 * MW_W;
    return (MW_SHAPE[r0 + x0] * (1 - tx) + MW_SHAPE[r0 + x1] * tx) * (1 - ty)
         + (MW_SHAPE[r1 + x0] * (1 - tx) + MW_SHAPE[r1 + x1] * tx) * ty;
  }

  // ------------------------------------------------------ GEOMETRÍA -------
  // Espejo de astroweather/skyobjects.py.
  function toHorizon(ra, dec, lst, lat) {
    var H = ((lst - ra + 360) % 360) * D2R, d = dec * D2R, p = lat * D2R;
    var alt = Math.asin(Math.sin(d) * Math.sin(p) + Math.cos(d) * Math.cos(p) * Math.cos(H));
    var az = Math.atan2(-Math.cos(d) * Math.cos(p) * Math.sin(H),
                        Math.sin(d) - Math.sin(p) * Math.sin(alt));
    return [alt / D2R, ((az / D2R) % 360 + 360) % 360];
  }

  function project(alt, az, cx, cy, R) {
    var r = (90 - alt) / 90 * R, a = az * D2R;
    return [cx - r * Math.sin(a), cy - r * Math.cos(a)];
  }

  function unitVec(alt, az) {
    var a = alt * D2R, z = az * D2R;
    return [Math.cos(a) * Math.cos(z), Math.cos(a) * Math.sin(z), Math.sin(a)];
  }

  /* La terna galáctica expresada en coordenadas horizontales, para que el bucle
     por píxel obtenga (l, b) con tres productos escalares y sin aritmética de
     tiempo sidéreo. e2 = e1 x e3 y NO e3 x e1: la terna del horizonte (N, E,
     arriba) refleja la quiralidad del cielo, y con el orden cambiado la
     longitud sale reflejada. */
  function galacticFrame(lst, lat) {
    var e3 = unitVec.apply(null, toHorizon(NGP_RA, NGP_DEC, lst, lat));
    var g = unitVec.apply(null, toHorizon(GC_RA, GC_DEC, lst, lat));
    var d = g[0] * e3[0] + g[1] * e3[1] + g[2] * e3[2];
    var e1 = [g[0] - d * e3[0], g[1] - d * e3[1], g[2] - d * e3[2]];
    var n = Math.sqrt(e1[0] * e1[0] + e1[1] * e1[1] + e1[2] * e1[2]);
    e1[0] /= n; e1[1] /= n; e1[2] /= n;
    var e2 = [e1[1] * e3[2] - e1[2] * e3[1],
              e1[2] * e3[0] - e1[0] * e3[2],
              e1[0] * e3[1] - e1[1] * e3[0]];
    return { e1: e1, e2: e2, e3: e3 };
  }

  function separation(a1, z1, a2, z2) {
    return Math.acos(Math.max(-1, Math.min(1,
      Math.sin(a1 * D2R) * Math.sin(a2 * D2R)
      + Math.cos(a1 * D2R) * Math.cos(a2 * D2R) * Math.cos((z1 - z2) * D2R)))) / D2R;
  }

  // Krisciunas & Schaefer: la dispersión lunar que usa el motor.
  function moonNl(sep, moonAlt, targetAlt, phase, k) {
    if (moonAlt <= 0) { return 0; }
    var a = Math.abs(phase);
    var iStar = Math.pow(10, -0.4 * (3.84 + 0.026 * a + 4e-9 * Math.pow(a, 4)));
    var rho = Math.max(sep, 0.5);
    var fRho = Math.pow(10, 5.36) * (1.06 + Math.pow(Math.cos(rho * D2R), 2))
             + Math.pow(10, 6.15 - rho / 40);
    var X = function (z) {
      return Math.min(5, 1 / Math.sqrt(1 - 0.96 * Math.pow(Math.sin((90 - z) * D2R), 2)));
    };
    return fRho * iStar * Math.pow(10, -0.4 * k * X(moonAlt))
         * (1 - Math.pow(10, -0.4 * k * X(targetAlt)));
  }

  // ------------------------------------------------- COLOR DEL CIELO ------
  function skyAt(alt, az, env, out) {
    var airmass = Math.min(5, 1 / Math.max(Math.sin(Math.max(alt, 2) * D2R), 0.05));
    var ext = Math.pow(10, -0.4 * env.k * airmass);
    var vanRhijn = 1 / Math.sqrt(Math.max(0.02,
        1 - Math.pow(6378 / 6468, 2) * Math.pow(Math.cos(alt * D2R), 2)));
    var r = 0, g = 0, b = 0, total = 0;
    function add(L, c) { total += L; r += L * c[0]; g += L * c[1]; b += L * c[2]; }

    add(env.floor * AIRGLOW_FRACTION * vanRhijn, C_NATURAL);
    add(env.floor * (1 - AIRGLOW_FRACTION) * ext, C_NATURAL);

    // La Vía Láctea: NUESTRO nivel, la forma de ESO. La amplitud y su caída con
    // la latitud galáctica son las medidas aquí (0,39 mag en el plano sobre
    // 50.412 muestras); la panorámica solo dice cómo se reparte esa luz a lo
    // largo de cada paralelo, y sus filas promedian 1, así que no puede cambiar
    // el total.
    if (env.gal) {
      var v = unitVec(alt, az), G = env.gal;
      var z = v[0] * G.e3[0] + v[1] * G.e3[1] + v[2] * G.e3[2];
      var galB = Math.asin(Math.max(-1, Math.min(1, z))) / D2R;
      var galL = ((Math.atan2(v[0] * G.e2[0] + v[1] * G.e2[1] + v[2] * G.e2[2],
                              v[0] * G.e1[0] + v[1] * G.e1[1] + v[2] * G.e1[2])
                   / D2R) % 360 + 360) % 360;
      add(env.floor * (Math.pow(10, 0.4 * 0.39 * Math.exp(-Math.abs(galB) / 26.5)) - 1)
          * mwShape(galL, galB) * ext, C_GALAXY);
    }
    add(env.floor * (airmass - 1) * env.aod * 1.2, env.dusty ? C_DUST : C_HAZE);
    if (env.moonAlt > 0) {
      add(moonNl(separation(alt, az, env.moonAlt, env.moonAz), env.moonAlt, alt,
                 env.phase, env.k), C_MOON);
    }
    if (env.sunAlt > -18) {
      var t = Math.min(1, Math.max(0, (env.sunAlt + 18) / 18));
      add(nl(13.5) * Math.pow(t, 2.2) * (0.25 + Math.max(0, 1 - alt / 50)), C_TWILIGHT);
    }
    // Cubierto: el manto tapa el cielo y, bajo la Luna, brilla el solo. Sin
    // ciudad debajo la nube OSCURECE -- se traga el airglow en vez de reflejar
    // farolas -- y eso esta medido aqui sobre 4.690 horas.
    if (env.cloud > 0) {
      var cover = env.cloud / 100;
      total *= (1 - cover * 0.75); r *= (1 - cover * 0.75);
      g *= (1 - cover * 0.75); b *= (1 - cover * 0.75);
      add(env.floor * cover * (0.05 + (env.moonGlow || 0) * 9), [0.62, 0.65, 0.70]);
    }

    var v2 = (Math.log10(Math.max(total, 1)) - LOG_LO) / LOG_SPAN;
    v2 = Math.max(0.02, Math.min(1, v2));
    var mean = (r + g + b) / 3 || 1, scale = v2 / total;
    // El recorte por ABAJO no es cosmetico: con SAT alto, el canal mas debil de
    // una mezcla muy saturada -- el azul del crepusculo -- se va negativo, y
    // `Math.pow(negativo, 0.52)` es NaN. En el canvas un NaN se escribe como
    // cero sin avisar, asi que el fallo no aparece como error: aparece como un
    // color raro que nadie sabe de donde sale.
    function canal(x) {
      return Math.min(255, Math.pow(Math.max(0, Math.min(1, x * scale)), GAMMA) * 255);
    }
    out[0] = canal(mean + (r - mean) * SAT);
    out[1] = canal(mean + (g - mean) * SAT);
    out[2] = canal(mean + (b - mean) * SAT);
    return out;
  }

  function frameEnv(cupula, f, indice) {
    return {
      k: cupula.transparency.k, aod: cupula.transparency.aod_site,
      dusty: cupula.transparency.dust_alert, floor: nl(NATURAL_FLOOR_MAG),
      gal: galacticFrame(cupula.lst[indice], cupula.site.lat),
      moonAlt: f.moon_alt, moonAz: f.moon_az,
      phase: cupula.moon.phase_angle,
      sunAlt: f.sun_alt,
      moonGlow: f.moon_alt > 0 ? cupula.moon.illumination : 0,
      cloud: 0
    };
  }

  // ------------------------------------------------------- PINTADO -------
  var buf = null, bctx = null;

  function pintarFueraDelModelo(canvas, lado, dpr, textos) {
    canvas.width = canvas.height = lado * dpr;
    var c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, lado, lado);
    var R = lado / 2 - MARGEN;
    c.fillStyle = 'rgba(120,132,158,.09)';
    c.beginPath(); c.arc(lado / 2, lado / 2, R, 0, 6.2832); c.fill();
    c.strokeStyle = 'rgba(120,132,158,.3)'; c.setLineDash([6, 7]); c.lineWidth = 1.5;
    c.beginPath(); c.arc(lado / 2, lado / 2, R, 0, 6.2832); c.stroke(); c.setLineDash([]);
    c.fillStyle = 'rgba(165,175,198,.6)'; c.textAlign = 'center';
    c.font = '600 13px Sora, Inter, sans-serif';
    c.fillText(textos.fueraModelo, lado / 2, lado / 2 - 4);
    c.font = '11px Barlow, Inter, sans-serif';
    c.fillText(textos.fueraModeloNota, lado / 2, lado / 2 + 16);
  }

  function pintarCielo(canvas, cupula, indice, lado, dpr, textos) {
    var f = cupula.frames[indice];
    if (!f.sky_mag_trustworthy) {
      return pintarFueraDelModelo(canvas, lado, dpr, textos);
    }
    if (!buf) { buf = document.createElement('canvas'); bctx = buf.getContext('2d'); }
    buf.width = buf.height = BUF;
    var img = bctx.createImageData(BUF, BUF), px = img.data;
    var R = BUF / 2, cx = R, cy = R;
    var env = frameEnv(cupula, f, indice), rgb = [0, 0, 0];

    for (var y = 0; y < BUF; y++) {
      for (var x = 0; x < BUF; x++) {
        var i = (y * BUF + x) * 4;
        var dx = x - cx, dy = y - cy, rr = Math.sqrt(dx * dx + dy * dy);
        if (rr > R + 1) { px[i + 3] = 0; continue; }
        var alt = 90 - Math.min(rr, R) / R * 90;
        var az = ((Math.atan2(-dx, -dy) / D2R) % 360 + 360) % 360;
        skyAt(alt, az, env, rgb);
        px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = 255;
        if (f.moon_alt > 0 && separation(alt, az, f.moon_alt, f.moon_az) < 0.9) {
          px[i] = 253; px[i + 1] = 248; px[i + 2] = 232;
        }
      }
    }
    bctx.putImageData(img, 0, 0);

    canvas.width = canvas.height = lado * dpr;
    var c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, lado, lado);
    c.save();
    c.beginPath(); c.arc(lado / 2, lado / 2, lado / 2 - MARGEN, 0, 6.2832); c.clip();
    c.imageSmoothingEnabled = true;
    c.drawImage(buf, MARGEN, MARGEN, lado - 2 * MARGEN, lado - 2 * MARGEN);
    c.restore();
  }

  // ------------------------------------------------------ ENCIMA ---------
  function dibujarEstrellas(o, cupula, cx, cy, R, lst, lat, vis) {
    (cupula.stars || []).forEach(function (s) {
      var p = toHorizon(s.ra, s.dec, lst, lat);
      if (p[0] <= 1) { return; }
      var xy = project(p[0], p[1], cx, cy, R);
      var size = Math.max(0.9, 2.7 - s.mag * 0.55);
      // Las débiles se ahogan primero: eso es lo que hace un cielo brillante.
      var a = Math.max(0.16, Math.min(1, (1 - s.mag * 0.19) * (0.45 + vis * 0.55)));
      o.fillStyle = 'rgba(236,241,252,' + a.toFixed(2) + ')';
      o.beginPath(); o.arc(xy[0], xy[1], size, 0, 6.2832); o.fill();
      // Un punto sin nombre no dice nada. Se etiqueta todo hasta segunda
      // magnitud; el resto está para que las constelaciones se sostengan.
      if (s.mag < 2.15 && p[0] > 8) {
        o.fillStyle = 'rgba(226,233,248,' + (a * 0.55).toFixed(2) + ')';
        o.font = '10px "IBM Plex Mono", ui-monospace, monospace';
        o.textAlign = 'left';
        o.fillText(s.name, xy[0] + 6, xy[1] + 3);
      }
    });
  }

  function dibujarPlanetas(o, cupula, cx, cy, R, lst, lat) {
    (cupula.planets || []).forEach(function (p) {
      var h = toHorizon(p.ra, p.dec, lst, lat);
      if (h[0] <= 1) { return; }
      var xy = project(h[0], h[1], cx, cy, R);
      o.fillStyle = '#f6e6b8';
      o.beginPath(); o.arc(xy[0], xy[1], 3.2, 0, 6.2832); o.fill();
      o.strokeStyle = 'rgba(246,230,184,.3)'; o.lineWidth = 1;
      o.beginPath(); o.arc(xy[0], xy[1], 6.5, 0, 6.2832); o.stroke();
      o.fillStyle = 'rgba(246,230,184,.75)';
      o.font = '10px "IBM Plex Mono", ui-monospace, monospace';
      o.textAlign = 'left';
      o.fillText(p.name, xy[0] + 8, xy[1] + 3);
    });
  }

  var capaNube = null;
  function dibujarNubes(o, cupula, f, cx, cy, R) {
    // La nube iluminada por arriba dispersa hacia ti, así que con Luna es MÁS
    // brillante que el cielo de alrededor. Pero echar noventa parches
    // superpuestos directamente sobre la cúpula la satura a blanco, así que se
    // componen antes en su propia capa — donde el apilamiento está acotado por
    // el color de la nube — y esa capa terminada se suma una sola vez.
    if (!f.clouds || !f.clouds.length) { return; }
    if (!capaNube) { capaNube = document.createElement('canvas'); }
    var size = Math.round(2 * R) + 24;
    capaNube.width = capaNube.height = size;
    var cc = capaNube.getContext('2d');
    cc.clearRect(0, 0, size, size);
    var lit = f.moon_alt > 0 ? cupula.moon.illumination : 0;
    var ox = size / 2, oy = size / 2;
    f.clouds.forEach(function (c) {
      if (c.alt <= 0) { return; }
      var xy = project(c.alt, c.az, ox, oy, R);
      var radius = Math.max(20, c.span / 90 * R * (c.overhead ? 0.85 : 1.0));
      var base = LAYER_RGB[c.layer] || LAYER_RGB.mid;
      var w = 0.30 + lit * 0.55;
      var rr = Math.round(base[0] + (255 - base[0]) * w);
      var gg = Math.round(base[1] + (255 - base[1]) * w);
      var bb = Math.round(base[2] + (250 - base[2]) * w * 0.9);
      // Opacidad: mismo criterio que SAT y GAMMA. La cobertura sigue siendo el
      // numero -- se publica en el JSON y se lee en el panel por horas -- y esto
      // solo decide como de visible sale en pantalla. Con el 0,42 del mockup, un
      // 46 % de nube alta quedaba en alfa 0,14 sobre fondo oscuro: estaba
      // dibujada y no se veia, que para un aviso de nubes es lo mismo que no
      // estar. El suelo de 0,10 hace que una nube tenue se note como tenue en
      // vez de desaparecer.
      var a = Math.min(0.72, 0.10 + c.cover / 100 * 0.75);
      var grad = cc.createRadialGradient(xy[0], xy[1], 0, xy[0], xy[1], radius);
      grad.addColorStop(0, 'rgba(' + rr + ',' + gg + ',' + bb + ',' + a + ')');
      grad.addColorStop(0.5, 'rgba(' + rr + ',' + gg + ',' + bb + ',' + a * 0.45 + ')');
      grad.addColorStop(1, 'rgba(' + rr + ',' + gg + ',' + bb + ',0)');
      cc.fillStyle = grad;
      cc.beginPath(); cc.arc(xy[0], xy[1], radius, 0, 6.2832); cc.fill();
    });
    o.save();
    o.globalCompositeOperation = 'lighter';
    o.globalAlpha = 0.88;
    o.drawImage(capaNube, cx - ox, cy - oy);
    o.restore();
  }

  function dibujarRejilla(o, cupula, cx, cy, R) {
    o.strokeStyle = 'rgba(150,164,192,.13)'; o.lineWidth = 1;
    [25, 50, 75].forEach(function (alt) {
      o.beginPath(); o.arc(cx, cy, (90 - alt) / 90 * R, 0, 6.2832); o.stroke();
    });
    for (var az = 0; az < 360; az += 45) {
      var xy = project(0, az, cx, cy, R);
      o.beginPath(); o.moveTo(cx, cy); o.lineTo(xy[0], xy[1]); o.stroke();
    }
    o.strokeStyle = 'rgba(240,112,90,.32)'; o.setLineDash([3, 5]);
    o.beginPath(); o.arc(cx, cy, (90 - cupula.min_altitude) / 90 * R, 0, 6.2832);
    o.stroke(); o.setLineDash([]);
  }

  function dibujarTraza(o, objeto, color, indice, cx, cy, R, textos) {
    var alt = objeto.alt || [], az = objeto.az || [];
    if (!alt.length) { return; }
    var vivo = (objeto.horas_si_despeja || 0) > 0.05;
    o.strokeStyle = color + (vivo ? 'd0' : '55');
    o.lineWidth = vivo ? 2 : 1.2;
    o.setLineDash(vivo ? [] : [4, 4]);
    o.beginPath();
    var empezado = false;
    for (var i = 0; i < alt.length; i++) {
      if (alt[i] <= 0) { empezado = false; continue; }
      var xy = project(alt[i], az[i], cx, cy, R);
      if (empezado) { o.lineTo(xy[0], xy[1]); }
      else { o.moveTo(xy[0], xy[1]); empezado = true; }
    }
    o.stroke(); o.setLineDash([]);

    if (alt[indice] === undefined || alt[indice] <= 0) { return; }
    var abierto = (objeto.limita || '').charAt(indice) !== '-'
                  && (objeto.rend || [])[indice] > 0;
    var p = project(alt[indice], az[indice], cx, cy, R);
    o.fillStyle = color;
    o.beginPath(); o.arc(p[0], p[1], abierto ? 5.5 : 3.4, 0, 6.2832); o.fill();
    if (!abierto) {
      o.strokeStyle = color; o.lineWidth = 1.2;
      o.beginPath(); o.arc(p[0], p[1], 8.5, 0, 6.2832); o.stroke();
    }
    o.font = '600 12px Sora, Inter, sans-serif'; o.textAlign = 'left';
    o.fillStyle = 'rgba(0,0,0,.75)'; o.fillText(objeto.nombre, p[0] + 10, p[1] - 6);
    o.fillStyle = color; o.fillText(objeto.nombre, p[0] + 9, p[1] - 7);
  }

  function dibujarLuna(o, cupula, f, cx, cy, R, textos) {
    if (f.moon_alt <= 0) { return; }
    var xy = project(f.moon_alt, f.moon_az, cx, cy, R);
    o.fillStyle = '#f7efd8';
    o.beginPath(); o.arc(xy[0], xy[1], 5.5, 0, 6.2832); o.fill();
    o.strokeStyle = 'rgba(127,176,239,.5)'; o.lineWidth = 1.4;
    o.beginPath(); o.arc(xy[0], xy[1], 11, 0, 6.2832); o.stroke();
    o.fillStyle = 'rgba(247,239,216,.85)';
    o.font = '10px "IBM Plex Mono", ui-monospace, monospace'; o.textAlign = 'left';
    o.fillText(textos.luna + ' ' + (cupula.moon.illumination * 100).toFixed(0) + '%',
               xy[0] + 13, xy[1] + 3);
  }

  function dibujarRosa(o, cx, cy, R, cardinales) {
    // La escala de rumbos va SOBRE el instrumento, no en un pie de foto.
    o.save();
    o.translate(cx, cy);
    o.strokeStyle = 'rgba(205,214,232,.30)';
    for (var az = 0; az < 360; az += 5) {
      var mayor = az % 45 === 0, medio = az % 15 === 0;
      if (!medio && !mayor) { continue; }
      var len = mayor ? 9 : 5, a = az * D2R;
      o.lineWidth = mayor ? 1.4 : 1;
      o.beginPath();
      o.moveTo(-R * Math.sin(a), -R * Math.cos(a));
      o.lineTo(-(R + len) * Math.sin(a), -(R + len) * Math.cos(a));
      o.stroke();
    }
    o.strokeStyle = 'rgba(240,112,90,.5)'; o.lineWidth = 1.5;
    o.beginPath(); o.arc(0, 0, R, 0, 6.2832); o.stroke();
    cardinales.forEach(function (par) {
      var a = par[0] * D2R, rr = R + 18;
      o.font = (par[0] % 90 === 0 ? '600 12px' : '500 10px') + ' Sora, Inter, sans-serif';
      o.fillStyle = par[0] % 90 === 0 ? 'rgba(226,233,248,.92)' : 'rgba(180,190,212,.7)';
      o.textAlign = 'center'; o.textBaseline = 'middle';
      o.fillText(par[1], -rr * Math.sin(a), -rr * Math.cos(a));
    });
    o.restore();
  }

  // Los mismos colores que los carriles de abajo: si la traza verde de arriba
  // no es el carril verde de abajo, la vista no vale para nada.
  var TRAZAS = ['#5fcf95', '#e8ad52', '#7fb0ef', '#c79ada', '#f0705a',
                '#79cfc2', '#b9c473', '#e08aa6', '#6fc3dd', '#d0a86b'];

  function pintarEncima(canvas, cupula, objetos, indice, lado, dpr, textos) {
    // Acepta uno o varios. La firma cambio a lista el 29-08-2026 y un temporizador
    // que hubiera quedado vivo de la version anterior seguiria llamando con un
    // objeto suelto: normalizar aqui cuesta una linea y evita que la cupula se
    // caiga por un resto de la pagina anterior.
    if (objetos && !Array.isArray(objetos)) { objetos = [objetos]; }
    canvas.width = canvas.height = lado * dpr;
    var o = canvas.getContext('2d');
    o.setTransform(dpr, 0, 0, dpr, 0, 0);
    o.clearRect(0, 0, lado, lado);
    var R = lado / 2 - MARGEN, cx = lado / 2, cy = lado / 2;
    var f = cupula.frames[indice];
    var lst = cupula.lst[indice], lat = cupula.site.lat;
    var dia = !f.sky_mag_trustworthy;

    // Nada va fuera de la cúpula: un parche de nube es un trozo de cielo, y un
    // trozo de cielo que se derrama pasado el horizonte se lee como una farola.
    o.save();
    o.beginPath(); o.arc(cx, cy, R, 0, 6.2832); o.clip();
    // Cuánto de la galaxia se ve de verdad con el fondo de esta noche.
    var galVis = dia ? 0 : Math.max(0, Math.min(1, (f.sky_mag - 19.2) / 2.2));
    if (!dia) {
      dibujarEstrellas(o, cupula, cx, cy, R, lst, lat, galVis);
      dibujarPlanetas(o, cupula, cx, cy, R, lst, lat);
    }
    dibujarNubes(o, cupula, f, cx, cy, R);
    dibujarRejilla(o, cupula, cx, cy, R);
    (objetos || []).forEach(function (obj, i) {
      dibujarTraza(o, obj, TRAZAS[i % TRAZAS.length], indice, cx, cy, R, textos);
    });
    if (!dia) { dibujarLuna(o, cupula, f, cx, cy, R, textos); }
    o.restore();
    dibujarRosa(o, cx, cy, R, textos.cardinales);
  }

  /* Cielos reales, pintados por el codigo de arriba. Una clave dibujada por
     una segunda rutina "parecida" acaba discrepando del dibujo que explica. */
  var MUESTRAS = [
    ['sinLunaDespejado', { moonAlt: -20, cloud: 0 }],
    ['sinLunaMedia', { moonAlt: -20, cloud: 50 }],
    ['sinLunaCubierto', { moonAlt: -20, cloud: 100 }],
    ['llenaDespejado', { moonAlt: 55, cloud: 0, illum: 1 }],
    ['llenaMedia', { moonAlt: 55, cloud: 50, illum: 1 }],
    ['llenaCubierto', { moonAlt: 55, cloud: 100, illum: 1 }],
    // La calima, SIN Luna. Con Luna llena la muestra salia identica a la de
    // cielo limpio -- y no por un fallo: a 30 grados el termino de aerosol vale
    // 0,42 veces el suelo natural y la Luna aporta mil veces mas, asi que se lo
    // traga. Cierto, y por eso mismo inutil como muestra: lo que la calima le
    // hace al color solo se ve cuando no hay algo mas grande encima.
    ['calima', { moonAlt: -20, cloud: 0, dusty: true, aod: 0.35, k: 0.35 }],
    // Etiquetada 'Dia' porque es el color de los dos extremos de la linea de
    // tiempo, que es donde la gente la va a reconocer. Se calcula a -10 grados
    // de altura solar, que es crepusculo nautico: mas arriba el ajuste de
    // crepusculo del motor ya no llega y el domo lo dice en vez de pintarlo.
    ['dia', { moonAlt: -20, cloud: 0, sunAlt: -10 }]
  ];

  // A 70 grados la masa de aire es 1,06 y el termino de aerosol vale casi
  // cero: la muestra de calima salia identica a la de Luna llena limpia. A 30
  // la masa de aire es 2 y la calima se ve, que es de lo que va la muestra.
  var MUESTRA_ALT = 30;

  function muestras(cupula) {
    var base = { k: cupula.transparency.k, aod: cupula.transparency.aod_site,
                 dusty: false, floor: nl(NATURAL_FLOOR_MAG), gal: null,
                 moonAz: 180, phase: 0, sunAlt: -40, cloud: 0 };
    var rgb = [0, 0, 0];
    return MUESTRAS.map(function (par) {
      var env = {};
      Object.keys(base).forEach(function (k) { env[k] = base[k]; });
      Object.keys(par[1]).forEach(function (k) { env[k] = par[1][k]; });
      env.moonGlow = par[1].moonAlt > 0 ? (par[1].illum || 0) : 0;
      skyAt(MUESTRA_ALT, 180, env, rgb);
      // Se reconstruye la magnitud que representa la muestra, para que la clave
      // lleve un NUMERO y no solo un color -- y se reconstruye de la
      // luminancia, no del pixel, asi que el estiramiento de contraste no la
      // toca.
      var v = (Math.pow(rgb[0] / 255, 1 / GAMMA) + Math.pow(rgb[1] / 255, 1 / GAMMA)
             + Math.pow(rgb[2] / 255, 1 / GAMMA)) / 3;
      var nlv = Math.pow(10, v * LOG_SPAN + LOG_LO);
      return { clave: par[0],
               rgb: [Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2])],
               mag: 22.4 - Math.log(nlv / 34.08) / 0.92104 };
    });
  }

  global.AWDome = {
    // Se expone porque la pagina la necesita para situar un objeto que el motor
    // no conoce. Es GEOMETRIA -- el mismo tiempo sidereo que ya viaja en el
    // JSON -- y no una prevision: nada de lo que decide el producto se
    // recalcula aqui.
    aHorizonte: toHorizon,
    // Separacion angular entre dos puntos del cielo. La usa la pagina para
    // los objetos de fuera, a los que el motor no les ha calculado nada.
    separacion: separation,
    muestras: muestras,
    muestraAltitud: MUESTRA_ALT,
    cargarViaLactea: cargarViaLactea,
    pendiente: MW_PENDIENTE,
    listaViaLactea: function () { return MW_SHAPE !== null; },
    pintar: function (skyCanvas, overCanvas, cupula, objetos, indice, textos) {
      if (!cupula || !cupula.frames || !cupula.frames[indice]) { return; }
      var lado = skyCanvas.clientWidth || 320;
      var dpr = Math.min(global.devicePixelRatio || 1, 2);
      pintarCielo(skyCanvas, cupula, indice, lado, dpr, textos);
      pintarEncima(overCanvas, cupula, objetos, indice, lado, dpr, textos);
    }
  };
})(window);
