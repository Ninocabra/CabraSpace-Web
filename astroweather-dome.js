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
 * Cada contribución se calcula como luminancia en nanolambert, igual que en el
 * motor, pero se pinta como EXCESO SOBRE EL SUELO NATURAL: la noche más oscura
 * posible — sin Luna, sin nubes, sin calima — es NEGRA, y en ella solo se ve la
 * Vía Láctea. Todo lo demás se dibuja encima con su color, y su color dice qué
 * lo está estropeando:
 *
 *     azul   la Luna       gris   las nubes
 *     rojo   la calima     amarillo  el día
 *
 * Ese es el cambio respecto a la primera versión, y no es cosmético. Antes se
 * sumaba todo junto y se comprimía el total, lo cual era fiel y era ilegible:
 * el suelo natural son 70 nL y la compresión los dejaba en RGB 110, así que el
 * cielo MÁS OSCURO POSIBLE ya salía azul medio. Sobre ese suelo azul cualquier
 * Luna lo teñía todo por igual y dos noches distintas salían del mismo color.
 * Midiendo contra el suelo en vez de sumar sobre él, lo que se ve es solo lo
 * que sobra — que es a lo que se viene a mirar esta página.
 */
(function (global) {
  'use strict';

  var D2R = Math.PI / 180;
  var NGP_RA = 192.859, NGP_DEC = 27.128;      // polo norte galáctico
  var GC_RA = 266.405, GC_DEC = -28.936;       // centro galáctico, l = 0, b = 0

  // Una tinta por estorbo, y solo cuatro. El suelo natural NO tiene tinta: es
  // el negro del que se parte, y por eso no aparece en esta lista.
  var C_GALAXY = [0.88, 0.86, 0.80];   // lo unico que se ve en la noche perfecta
  var C_MOON = [0.32, 0.55, 1.00];     // azul
  var C_DUST = [1.00, 0.30, 0.18];     // rojo
  var C_DAY = [1.00, 0.80, 0.22];      // amarillo
  var C_CLOUD = [0.86, 0.88, 0.92];    // gris, casi neutro: lo que habla es cuanto

  // Cuanto exceso sobre el suelo satura una tinta. 1.400 veces el suelo es una
  // Luna llena a diez grados: el cielo mas brillante que da este sitio de
  // noche. Fijar el techo en el maximo real y no en el de cada noche es lo que
  // hace COMPARABLES dos noches distintas -- si la escala se reajustara sola,
  // una noche mala y una buena saldrian del mismo azul, que es exactamente el
  // defecto que se viene a corregir.
  var EXCESO_MAX = 1400;
  var LOG_EXCESO = Math.log10(1 + EXCESO_MAX);

  // La Via Lactea no puede compartir esa escala. Su exceso sobre el suelo son
  // 0,43 veces -- las 0,39 mag medidas aqui en el plano -- y en la escala de la
  // Luna eso son cuatro niveles de gris sobre negro, o sea nada. Lleva la suya,
  // ajustada para que el plano galactico se lea sin competir con un estorbo.
  var GANANCIA_VIA = 0.30;
  var VIA_MAX = 0.20;

  // La calima tambien lleva la suya, y esto conviene decirlo claro: el aerosol
  // aporta MUY POCO brillo de fondo, asi que pintado a tamaño real no se ve. Es
  // una ganancia de legibilidad sobre una cantidad real y pequeña, del mismo
  // tipo que el suelo de opacidad de las nubes. El numero que manda en el
  // veredicto sigue siendo el AOD publicado, no este pixel.
  var GANANCIA_CALIMA = 3.5;

  // Y la tinta roja mide la ANOMALIA de aerosol, no el aerosol. Siempre hay
  // algo -- este sitio esta en 0,064 en una noche transparente -- y pintar eso
  // de rojo dejaba la muestra "noche mas oscura" en un marron flojo en vez de
  // en negro. El rojo tiene que querer decir "hay calima", no "hay atmosfera".
  // La LUMINANCIA sigue llevando el aerosol entero: es luz real y cuenta para
  // la magnitud. Lo que mide la anomalia es solo el color.
  var AOD_LIMPIO = 0.07;

  // Cuanto estorba cada capa de verdad. Una nube baja es opaca; un cirro alto
  // resta contraste y deja pasar. No es una escala inventada: es el orden con
  // el que las tres capas entran en el indice de nubes del sitio.
  var LAYER_WEIGHT = { low: 1.0, mid: 0.78, high: 0.5 };

  // Parte del fondo natural que es airglow: la que obedece a van Rhijn en vez
  // de extinguirse. Sale de la literatura — el fotómetro solo mira arriba, así
  // que este sitio no la puede comprobar.
  var AIRGLOW_FRACTION = 0.6;
  var NATURAL_FLOOR_MAG = 21.71;

  var nl = function (m) { return 34.08 * Math.exp(20.7233 - 0.92104 * m); };

  /* El unico mando del color que queda.
   *
   * Antes habia dos, y el otro era un estirador de saturacion (SAT 2,05) que
   * hacia falta para separar tonos dentro de una mezcla. Ya no hay mezcla que
   * separar: cada estorbo entra con su tinta y se suma, asi que la saturacion
   * sale sola de que haya un estorbo o dos. Fuera.
   *
   * GAMMA solo reparte el brillo por la rampa. No toca ningun numero: la
   * magnitud que acompana a cada muestra de la clave se reconstruye de la
   * luminancia, no del pixel. */
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

  /* ==================== LAS DOS VISTAS DEL MISMO CIELO ================
     La boveda de siempre es una proyeccion CENITAL: se mira hacia arriba, el
     cenit en el centro y el horizonte en el borde del circulo. La cupula 3D es
     la misma hemisfera vista en PERSPECTIVA desde el suelo, como quien esta
     plantado en Nerpio mirando al sur: el horizonte es una linea y el cenit
     queda arriba.

     Y AQUI ESTA LO QUE IMPORTA: no son dos dibujos, es un dibujo y dos
     proyecciones. Todo -- el color del cielo pixel a pixel, la Via Lactea, la
     Luna, los parches de nube, las estrellas, las trazas -- pasa por `project`
     y por su inversa. Cambiando SOLO ese par de funciones las dos vistas son
     identicas por construccion y no pueden discrepar nunca. Es exactamente la
     leccion de [[el-mismo-concepto-calculado-dos-veces]]: la forma de que dos
     vistas no se contradigan no es cuidarlas, es que compartan la cuenta.

     `project` devuelve [x, y, visible]. El tercer elemento solo importa en
     perspectiva -- media esfera queda A LA ESPALDA de la camara -- y los sitios
     que dibujan lineas o simbolos lo consultan. Los que no, siguen leyendo
     xy[0] y xy[1] como siempre. */
  /* LA ELEVACION DE ARRANQUE, 45 GRADOS, ES UNA CUENTA Y NO UN GUSTO. En una
     camara estenopeica el horizonte cae por debajo del centro una fraccion
     tan(elevacion)/tan(fov/2) de la media altura. Con 28 grados salia
     0,532/1,664 = 0,32, o sea el horizonte al 66 % de la imagen: un tercio del
     dibujo era suelo. Con 45 sale 1,000/1,664 = 0,60 y el horizonte se va al
     80 %, que deja el cielo -- que es lo que se viene a ver -- ocupando cuatro
     quintos. */
  var VISTA = { modo: 'boveda', az: 180, alt: 45, fov: 140 };
  var ALT_MIN = -25, ALT_MAX = 87;   // mas arriba la camara degenera en el cenit
  var FOV_MIN = 35, FOV_MAX = 160;

  function camara() {
    var f = unitVec(VISTA.alt, VISTA.az);
    // r = w x f con w = (0,0,1): sale (-sin az, cos az, 0), o sea el Este a la
    // DERECHA mirando al Norte, que es como se ve estando de pie. La boveda usa
    // la convencion contraria porque alli se mira hacia arriba y el cielo sale
    // reflejado.
    var az = VISTA.az * D2R;
    var r = [-Math.sin(az), Math.cos(az), 0];
    var u = [f[1] * r[2] - f[2] * r[1],
             f[2] * r[0] - f[0] * r[2],
             f[0] * r[1] - f[1] * r[0]];
    return { f: f, r: r, u: u };
  }

  /* LA PROYECCION ES ESTEREOGRAFICA Y NO RECTILINEA, y esto es lo que permite
     abrir el campo hasta dar sensacion de cupula. Una camara normal (r = k
     tan t) deja de servir mucho antes de donde hace falta: a 140 grados de
     campo el borde va a tan(70) = 2,75 contra tan(35) = 0,70 del medio, o sea
     las esquinas estiradas casi CUATRO veces, y el horizonte sale como una
     recta rigida que no se parece a estar debajo de un cielo.

     La estereografica (r = 2k tan(t/2)) es conforme -- conserva las formas en
     pequenio, asi que las constelaciones siguen siendo ellas -- aguanta campos
     enormes sin reventar y curva el horizonte, que es justo lo que se lee como
     boveda. Es la que usan los planetarios, y por este motivo.

     k se fija para que el semicampo caiga en el borde: R = 2k tan(fov/4). */
  function escalaPersp(R) {
    return R / (2 * Math.tan(VISTA.fov / 4 * D2R));
  }

  function projectPersp(alt, az, cx, cy, R) {
    var v = unitVec(alt, az), c = camara();
    var zc = v[0] * c.f[0] + v[1] * c.f[1] + v[2] * c.f[2];
    var xc = v[0] * c.r[0] + v[1] * c.r[1] + v[2] * c.r[2];
    var yc = v[0] * c.u[0] + v[1] * c.u[1] + v[2] * c.u[2];
    var rho = Math.sqrt(xc * xc + yc * yc);
    var th = Math.atan2(rho, zc);
    // Cerca de 180 grados la estereografica manda el punto al infinito. Se
    // corta antes: 150 grados ya es mas de lo que ningun encuadre ensena.
    if (th > 2.618) { return [-9999, -9999, false]; }
    if (rho < 1e-9) { return [cx, cy, true]; }
    var rp = 2 * escalaPersp(R) * Math.tan(th / 2);
    return [cx + xc / rho * rp, cy - yc / rho * rp, true];
  }

  function project(alt, az, cx, cy, R) {
    if (VISTA.modo === 'cupula') { return projectPersp(alt, az, cx, cy, R); }
    var r = (90 - alt) / 90 * R, a = az * D2R;
    return [cx - r * Math.sin(a), cy - r * Math.cos(a), true];
  }

  // La inversa: de pixel a direccion del cielo. Devuelve null fuera del dibujo
  // (la boveda es un circulo) y alt < 0 es suelo, no cielo.
  function unproject(x, y, cx, cy, R) {
    if (VISTA.modo === 'cupula') {
      var k = escalaPersp(R), c = camara();
      var xn = (x - cx) / k, yn = -(y - cy) / k;
      var rp = Math.sqrt(xn * xn + yn * yn);
      var th = 2 * Math.atan(rp / 2);          // la inversa de r = 2k tan(t/2)
      var ct = Math.cos(th), st = rp < 1e-9 ? 0 : Math.sin(th) / rp;
      var d = [ct * c.f[0] + st * (xn * c.r[0] + yn * c.u[0]),
               ct * c.f[1] + st * (xn * c.r[1] + yn * c.u[1]),
               ct * c.f[2] + st * (xn * c.r[2] + yn * c.u[2])];
      var n = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
      d[0] /= n; d[1] /= n; d[2] /= n;
      return [Math.asin(d[2]) / D2R,
              ((Math.atan2(d[1], d[0]) / D2R) % 360 + 360) % 360];
    }
    var dx = x - cx, dy = y - cy, rr = Math.sqrt(dx * dx + dy * dy);
    if (rr > R + 1) { return null; }
    return [90 - Math.min(rr, R) / R * 90,
            ((Math.atan2(-dx, -dy) / D2R) % 360 + 360) % 360];
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

  /* La dispersión lunar MEDIDA en este sitio (astroweather/moonscatter.py), no
     la de Mauna Kea.
   *
   * Esto era un fallo de verdad, no un ajuste: el domo pintaba Krisciunas &
   * Schaefer mientras el motor puntúa con la ley ajustada aquí sobre 18.834
   * muestras de 1.246 noches. Y las dos no se parecen — la de aquí cae como
   * 10^(−θ/48,55°), un factor 10 cada 48,5 grados, mientras la de K&S es casi
   * plana con la Luna alta. Por eso el domo se volvía azul entero al salir la
   * Luna: no era saturación de la paleta, era la función equivocada.
   *
   * Con la de aquí, a 10° de la Luna el fondo es ~57 veces el que hay a 130°,
   * así que el halo sale intenso alrededor del disco y decae de verdad.
   *
   * La rama de aureola (ρ < 10°) sí se importa tal cual: un fotómetro cenital
   * no puede medirla. Y el suelo por encima de ~83° también, porque este sitio
   * tiene más aire y más polvo que Mauna Kea y no puede dispersar menos. */
  var SCATTER_AMPLITUDE = 1.3612e7;
  var SCATTER_SCALE_DEG = 48.55;
  var SMALL_SEPARATION_DEG = 10.0;

  function maunaKea(rho) {
    return Math.pow(10, 5.36) * (1.06 + Math.pow(Math.cos(rho * D2R), 2))
         + Math.pow(10, 6.15 - rho / 40);
  }

  function scattering(sep) {
    if (sep < SMALL_SEPARATION_DEG) {
      var union = SCATTER_AMPLITUDE * Math.pow(10, -SMALL_SEPARATION_DEG / SCATTER_SCALE_DEG);
      return union * Math.pow(SMALL_SEPARATION_DEG / Math.max(sep, 0.25), 2);
    }
    return Math.max(SCATTER_AMPLITUDE * Math.pow(10, -sep / SCATTER_SCALE_DEG),
                    maunaKea(sep));
  }

  function moonNl(sep, moonAlt, targetAlt, phase, k) {
    if (moonAlt <= 0) { return 0; }
    // El brillo del disco segun su fase: es lo que hace que una Luna al 30 %
    // dibuje un halo mucho mas debil que una llena, con la misma geometria.
    var a = Math.abs(phase);
    var iStar = Math.pow(10, -0.4 * (3.84 + 0.026 * a + 4e-9 * Math.pow(a, 4)));
    var X = function (z) {
      return Math.min(5, 1 / Math.sqrt(1 - 0.96 * Math.pow(Math.sin((90 - z) * D2R), 2)));
    };
    return scattering(Math.max(sep, 0.25)) * iStar
         * Math.pow(10, -0.4 * k * X(moonAlt))
         * (1 - Math.pow(10, -0.4 * k * X(targetAlt)));
  }

  // ------------------------------------------------- COLOR DEL CIELO ------
  // De exceso sobre el suelo a intensidad de tinta. Cero exceso, cero tinta:
  // eso es lo que pone el fondo en negro.
  function tinta(exceso) {
    if (!(exceso > 0)) { return 0; }
    return Math.min(1, Math.log10(1 + exceso) / LOG_EXCESO);
  }

  /* Devuelve el color en `out` y la luminancia TOTAL en nanolambert.
   *
   * Las dos cosas a la vez y a proposito: el color es para mirarlo y la
   * luminancia es para la magnitud que acompana a cada muestra de la clave.
   * Reconstruir la segunda a partir del primero -- que es lo que se hacia --
   * ata el numero publicado a la rampa de pantalla, y entonces cualquier
   * retoque de GAMMA mueve una magnitud. */
  function skyAt(alt, az, env, out) {
    var airmass = Math.min(5, 1 / Math.max(Math.sin(Math.max(alt, 2) * D2R), 0.05));
    var ext = Math.pow(10, -0.4 * env.k * airmass);
    var vanRhijn = 1 / Math.sqrt(Math.max(0.02,
        1 - Math.pow(6378 / 6468, 2) * Math.pow(Math.cos(alt * D2R), 2)));

    // El suelo natural: se calcula porque es la VARA DE MEDIR de todo lo demas
    // y porque entra en la luminancia total, pero no pinta. Su color es el
    // negro del lienzo.
    var suelo = env.floor * (AIRGLOW_FRACTION * vanRhijn + (1 - AIRGLOW_FRACTION) * ext);
    var total = suelo;
    var col = [0, 0, 0];
    function echar(u, c) {
      if (u <= 0) { return; }
      col[0] += u * c[0]; col[1] += u * c[1]; col[2] += u * c[2];
    }

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
      var via = env.floor * (Math.pow(10, 0.4 * 0.39 * Math.exp(-Math.abs(galB) / 26.5)) - 1)
              * mwShape(galL, galB) * ext;
      total += via;
      echar(Math.min(VIA_MAX, via / env.floor * GANANCIA_VIA), C_GALAXY);
    }

    // La calima. Es direccional de verdad, aunque no en el sentido que parece:
    // crece con la masa de aire, o sea con lo BAJO que mires, y en el cenit
    // vale cero. Lo que no tiene es estructura por acimut ni cambio a lo largo
    // de la noche, porque el JSON trae un solo AOD para el sitio -- si algun
    // dia CAMS da el campo, entra aqui sin tocar nada mas.
    var polvo = env.floor * (airmass - 1) * env.aod * 1.2;
    total += polvo;
    var anomalia = env.floor * (airmass - 1) * Math.max(0, env.aod - AOD_LIMPIO) * 1.2;
    echar(tinta(anomalia / env.floor) * GANANCIA_CALIMA, C_DUST);

    // La Luna. El halo intenso pegado al disco que decae hacia fuera, y su
    // intensidad de la fase: las dos cosas salen de moonNl, que es la ley
    // medida en este sitio.
    if (env.moonAlt > 0) {
      var luna = moonNl(separation(alt, az, env.moonAlt, env.moonAz), env.moonAlt, alt,
                        env.phase, env.k);
      total += luna;
      echar(tinta(luna / env.floor), C_MOON);
    }

    // El día, entrando por el borde. Amarillo: es la unica tinta que no avisa
    // de un estorbo del cielo sino de que todavia no es de noche.
    if (env.sunAlt > -18) {
      var t = Math.min(1, Math.max(0, (env.sunAlt + 18) / 18));
      var dia = nl(13.5) * Math.pow(t, 2.2) * (0.25 + Math.max(0, 1 - alt / 50));
      total += dia;
      echar(tinta(dia / env.floor), C_DAY);
    }

    // Las nubes. Aqui solo para las muestras de la clave: en la boveda se
    // pintan encima, una a una y en su sitio, porque son direccionales.
    //
    // Gris, y cuanto MAS estorban mas claras. Es al reves de como estaba -- las
    // bajas salian gris oscuro y los cirros casi blancos -- y la version de
    // antes decia justo lo contrario de lo que pasa: un circulo oscuro tiene
    // que ser un cielo que se deja ver.
    if (env.cloud > 0) {
      var estorbo = env.cloud / 100 * (LAYER_WEIGHT[env.layer] || 1);
      var tapa = Math.min(0.92, estorbo);
      total = total * (1 - tapa * 0.75) + env.floor * estorbo * 0.05;
      col[0] = col[0] * (1 - tapa); col[1] = col[1] * (1 - tapa); col[2] = col[2] * (1 - tapa);
      echar(tapa * (0.18 + estorbo * 0.82), C_CLOUD);
    }

    // El recorte por ABAJO no es cosmetico: un canal negativo entra en
    // `Math.pow` y sale NaN, y en el canvas un NaN se escribe como cero sin
    // avisar. El fallo no aparece como error: aparece como un color raro que
    // nadie sabe de donde sale.
    out[0] = Math.pow(Math.max(0, Math.min(1, col[0])), GAMMA) * 255;
    out[1] = Math.pow(Math.max(0, Math.min(1, col[1])), GAMMA) * 255;
    out[2] = Math.pow(Math.max(0, Math.min(1, col[2])), GAMMA) * 255;
    return total;
  }

  function frameEnv(cupula, f, indice) {
    return {
      k: cupula.transparency.k, aod: cupula.transparency.aod_site,
      floor: nl(NATURAL_FLOOR_MAG),
      gal: galacticFrame(cupula.lst[indice], cupula.site.lat),
      moonAlt: f.moon_alt, moonAz: f.moon_az,
      phase: cupula.moon.phase_angle,
      sunAlt: f.sun_alt,
      cloud: 0, layer: 'mid'
    };
  }

  // ------------------------------------------------------- PINTADO -------
  var buf = null, bctx = null;

  /* El recorte de cada vista. La boveda es un circulo porque el circulo ES el
     horizonte; la cupula es un rectangulo porque lo que la acota es el encuadre
     de la camara, no el cielo. */
  /* EL MARGEN NO ES EL MISMO EN LAS DOS VISTAS, y no es un capricho: los 30 px
     de la boveda son el sitio de la ROSA DE LOS VIENTOS, que en perspectiva no
     existe. Dejarlos alli se comia un tercio de un lienzo de 163 px. Lo calcula
     una sola funcion porque lo consultan tres -- el cielo al escalar el bufer,
     la capa de encima al fijar su radio y el recorte -- y si se separan, el
     dibujo y sus adornos dejan de caer en el mismo sitio. */
  function margen() { return VISTA.modo === 'cupula' ? 6 : MARGEN; }

  function recortar(c, lado) {
    c.beginPath();
    if (VISTA.modo === 'cupula') {
      var m = margen(), w = lado - 2 * m, rad = 10;
      c.moveTo(m + rad, m);
      c.arcTo(m + w, m, m + w, m + w, rad);
      c.arcTo(m + w, m + w, m, m + w, rad);
      c.arcTo(m, m + w, m, m, rad);
      c.arcTo(m, m, m + w, m, rad);
    } else {
      c.arc(lado / 2, lado / 2, lado / 2 - MARGEN, 0, 6.2832);
    }
    c.clip();
  }

  function pintarFueraDelModelo(canvas, lado, dpr, textos) {
    canvas.width = canvas.height = lado * dpr;
    var c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, lado, lado);
    var R = lado / 2 - margen();
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
        var d = unproject(x, y, cx, cy, R);
        if (!d) { px[i + 3] = 0; continue; }
        var alt = d[0], az = d[1];
        // Bajo el horizonte no hay cielo que estimar: en la vista en
        // perspectiva eso es SUELO, y pintarlo es lo que hace que se lea donde
        // acaba el mundo. En la cenital no ocurre nunca -- el borde del circulo
        // ES el horizonte -- asi que esta rama solo vive en la cupula.
        if (alt < 0) {
          px[i] = 13; px[i + 1] = 14; px[i + 2] = 17; px[i + 3] = 255;
          continue;
        }
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
    recortar(c, lado);
    c.imageSmoothingEnabled = true;
    var m = margen();
    c.drawImage(buf, m, m, lado - 2 * m, lado - 2 * m);
    c.restore();
  }

  // ------------------------------------------------------ ENCIMA ---------
  function dibujarEstrellas(o, cupula, cx, cy, R, lst, lat, vis) {
    (cupula.stars || []).forEach(function (s) {
      var p = toHorizon(s.ra, s.dec, lst, lat);
      if (p[0] <= 1) { return; }
      var xy = project(p[0], p[1], cx, cy, R);
      if (!xy[2]) { return; }
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
      if (!xy[2]) { return; }
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

  /* ================= LAS NUBES, COMO CAMPO Y NO COMO DISCOS =============
     QUE ERA EL PROBLEMA. Cada celda de la rejilla se pintaba como un disco con
     gradiente radial, asi que la cupula salia con bolas separadas. Nino
     pregunto si eso significaba algo, y la respuesta honesta era: la POSICION
     si -- la elevacion sale de atan2(altura de la capa, distancia) y el azimut
     es el rumbo real -- y el TAMANIO tambien, pero la forma redonda y los
     huecos entre bolas no. Eran artefactos del muestreo: 8 rumbos x 6 anillos
     de un campo que es continuo. Un hueco entre dos discos no era "ahi hay
     claro", era "ahi no hay muestra", y se leia como lo primero.

     QUE SE HACE AHORA. El mismo dato, interpolado. Cada muestra aporta con un
     nucleo gaussiano de anchura SU PROPIO TAMANIO ANGULAR -- que es
     exactamente lo que la muestra representa: una celda de ~15 km vista desde
     aqui, 60 grados a 2 km y 9,5 a 90 -- y el campo es la suma normalizada.
     No se inventa resolucion: se deja de fingir que el borde del disco es el
     borde de una nube.

     EL PRIOR DE CERO es lo que hace que esto no manche el cielo entero. El
     motor descarta las celdas por debajo del 5 %, asi que una muestra ausente
     NO es "no se": es "casi nada". Un peso constante en el denominador
     representa ese cero, y sin el una nube suelta se extenderia sin decaer
     hasta el borde de la cupula.

     LAS TRES CAPAS SE COMBINAN COMO OPACIDADES INDEPENDIENTES, 1 - prod(1-o),
     que es lo que hacen de verdad: un cirro por encima de un estrato tapa lo
     que deja pasar el estrato. Antes se apilaban dibujando uno encima de otro
     y el resultado dependia del ORDEN en que llegaran los parches. */

  var capaNube = null;
  // Lado del bufer de nubes. Bajo a proposito: el campo de nubes es de baja
  // frecuencia -- la muestra mas fina abarca 9,5 grados -- asi que 160 px
  // sobran y el lienzo los escala suave. A tamanio completo esto serian 1,3
  // millones de pixeles por cada movimiento del cursor de tiempo.
  var NUBE_BUF = 160;
  var PRIOR_CERO = 0.16;

  function dibujarNubes(o, cupula, f, cx, cy, R) {
    if (!f.clouds || !f.clouds.length) { return; }

    // Las muestras, ya en vectores: comparar direcciones con un producto
    // escalar es mucho mas barato que con senos y cosenos, y esto corre una vez
    // por pixel y por muestra.
    var capas = { low: [], mid: [], high: [] };
    var hay = false;
    f.clouds.forEach(function (c) {
      if (c.alt <= 0 || !(c.cover > 0)) { return; }
      var lista = capas[c.layer] || capas.mid;
      // La anchura del nucleo es el radio angular de la celda. El 0,6 lo
      // estrecha un poco: con el span entero las celdas vecinas se funden tanto
      // que el campo pierde la estructura que SI trae el dato.
      var sigma = Math.max(5, c.span) * D2R * 0.6;
      // El COSENO limite, precalculado. El nucleo cae por debajo de 0,004 a
      // partir de 3,35 sigma, asi que mas alla la muestra no aporta -- y
      // descartarla por el coseno, que ya se tiene, evita el `acos`. Eso es lo
      // caro: sin este corte, cada pixel llamaba a acos por cada una de las
      // hasta 117 muestras y el repintado costaba 100 ms.
      lista.push({ v: unitVec(c.alt, c.az), cover: c.cover / 100,
                   inv2: 1 / (2 * sigma * sigma),
                   cosLim: Math.cos(Math.min(Math.PI, 3.35 * sigma)) });
      hay = true;
    });
    if (!hay) { return; }

    if (!capaNube) { capaNube = document.createElement('canvas'); }
    capaNube.width = capaNube.height = NUBE_BUF;
    var cc = capaNube.getContext('2d');
    var img = cc.createImageData(NUBE_BUF, NUBE_BUF), px = img.data;
    var paso = 2 * R / NUBE_BUF;
    var ordenCapas = ["low", "mid", "high"];

    for (var y = 0; y < NUBE_BUF; y++) {
      for (var x = 0; x < NUBE_BUF; x++) {
        var i = (y * NUBE_BUF + x) * 4;
        // El MISMO par proyeccion/inversa que el resto de la cupula, asi que
        // las nubes caen donde caen las estrellas en las dos vistas.
        var d = unproject(cx - R + (x + 0.5) * paso,
                          cy - R + (y + 0.5) * paso, cx, cy, R);
        if (!d || d[0] < 0) { px[i + 3] = 0; continue; }
        var v = unitVec(d[0], d[1]);
        var transp = 1;
        for (var k = 0; k < 3; k++) {
          var lista = capas[ordenCapas[k]];
          if (!lista.length) { continue; }
          var suma = 0, peso = PRIOR_CERO;
          for (var m = 0; m < lista.length; m++) {
            var s = lista[m];
            var cosang = v[0] * s.v[0] + v[1] * s.v[1] + v[2] * s.v[2];
            // Fuera de su alcance, y decidido con el coseno que ya se tiene:
            // el `acos` solo se paga por las muestras que van a contar.
            if (cosang < s.cosLim) { continue; }
            var ang = Math.acos(Math.min(1, cosang));
            var w = Math.exp(-ang * ang * s.inv2);
            suma += w * s.cover; peso += w;
          }
          var cobertura = suma / peso;
          transp *= 1 - Math.min(1, cobertura * (LAYER_WEIGHT[ordenCapas[k]] || 0.8));
        }
        var estorbo = 1 - transp;
        if (estorbo < 0.02) { px[i + 3] = 0; continue; }
        // Oscuro lo que deja ver, blanco lo que tapa. El tono sale de lo que
        // ESTORBA y no de la altura de la capa: un cirro al 90 % no es peor
        // que un estrato al 90 %, y pintarlo mas claro decia lo contrario.
        var tono = Math.round(58 + estorbo * 197);
        px[i] = tono; px[i + 1] = tono; px[i + 2] = tono;
        px[i + 3] = Math.round(255 * Math.min(0.92, 0.12 + estorbo * 0.80));
      }
    }
    cc.putImageData(img, 0, 0);

    // Se dibuja ENCIMA, no se suma. Una nube tapa lo que hay detras: ese es su
    // efecto y ese tiene que ser su dibujo. Con 'lighter' la nube ACLARABA el
    // cielo, asi que sobre un cielo con Luna sumaba brillo en vez de comerse la
    // vista, y era imposible distinguir una noche cubierta de una despejada con
    // Luna: las dos salian claras.
    o.save();
    o.imageSmoothingEnabled = true;
    o.globalAlpha = 0.95;
    o.drawImage(capaNube, cx - R, cy - R, 2 * R, 2 * R);
    o.restore();
  }

  /* La rejilla deja de dibujarse con `arc` y pasa a MUESTREARSE en azimut.
     Un circulo concentrico solo es un paralelo de altura en la proyeccion
     cenital; en perspectiva es una curva. Muestreando cada 3 grados y uniendo
     con rectas sale bien en las dos, y el codigo deja de saber en cual esta. */
  function paralelo(o, alt, cx, cy, R) {
    o.beginPath();
    var empezado = false;
    for (var az = 0; az <= 360; az += 3) {
      var xy = project(alt, az, cx, cy, R);
      if (!xy[2]) { empezado = false; continue; }
      if (empezado) { o.lineTo(xy[0], xy[1]); }
      else { o.moveTo(xy[0], xy[1]); empezado = true; }
    }
    o.stroke();
  }

  function dibujarRejilla(o, cupula, cx, cy, R) {
    o.strokeStyle = 'rgba(150,164,192,.13)'; o.lineWidth = 1;
    [25, 50, 75].forEach(function (alt) { paralelo(o, alt, cx, cy, R); });
    // Los meridianos: del horizonte al cenit, y no del borde al centro, que eso
    // era otra vez geometria de la vista metida en el dibujo.
    for (var az = 0; az < 360; az += 45) {
      o.beginPath();
      var empezado = false;
      for (var a = 0; a <= 90; a += 3) {
        var xy = project(a, az, cx, cy, R);
        if (!xy[2]) { empezado = false; continue; }
        if (empezado) { o.lineTo(xy[0], xy[1]); }
        else { o.moveTo(xy[0], xy[1]); empezado = true; }
      }
      o.stroke();
    }
    o.strokeStyle = 'rgba(240,112,90,.32)'; o.setLineDash([3, 5]);
    paralelo(o, cupula.min_altitude, cx, cy, R);
    o.setLineDash([]);
    // Y en perspectiva, el HORIZONTE: en la boveda es el borde del circulo y no
    // hace falta dibujarlo, aqui es la linea que separa cielo de suelo.
    if (VISTA.modo === 'cupula') {
      o.strokeStyle = 'rgba(150,164,192,.35)';
      paralelo(o, 0, cx, cy, R);
    }
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
      // A la espalda de la camara la traza se CORTA. Uniendo los dos lados se
      // dibujaria una recta atravesando la pantalla por donde el objeto no ha
      // pasado nunca.
      if (!xy[2]) { empezado = false; continue; }
      if (empezado) { o.lineTo(xy[0], xy[1]); }
      else { o.moveTo(xy[0], xy[1]); empezado = true; }
    }
    o.stroke(); o.setLineDash([]);

    if (alt[indice] === undefined || alt[indice] <= 0) { return; }
    var abierto = (objeto.limita || '').charAt(indice) !== '-'
                  && (objeto.rend || [])[indice] > 0;
    var p = project(alt[indice], az[indice], cx, cy, R);
    if (!p[2]) { return; }
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
    if (!xy[2]) { return; }
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
    /* En perspectiva no hay rosa que valga: una corona de rumbos alrededor del
       centro solo significa algo si el centro es el cenit. Aqui los rumbos son
       sitios del HORIZONTE, asi que se escriben donde caen -- y de paso eso es
       lo que te dice hacia donde estas mirando. */
    if (VISTA.modo === 'cupula') {
      var nombres = cardinales || ['N', 'E', 'S', 'O'];
      [[0, nombres[0]], [45, ''], [90, nombres[1]], [135, ''],
       [180, nombres[2]], [225, ''], [270, nombres[3]], [315, '']]
        .forEach(function (par) {
          var xy = project(0, par[0], cx, cy, R);
          if (!xy[2]) { return; }
          o.strokeStyle = 'rgba(205,214,232,.35)'; o.lineWidth = par[1] ? 1.4 : 1;
          o.beginPath(); o.moveTo(xy[0], xy[1] - 6); o.lineTo(xy[0], xy[1] + 6); o.stroke();
          if (!par[1]) { return; }
          o.fillStyle = 'rgba(226,233,248,.75)';
          o.font = '600 12px Sora, Inter, sans-serif';
          o.textAlign = 'center';
          o.fillText(par[1], xy[0], xy[1] + 21);
        });
      return;
    }
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
    var R = lado / 2 - margen(), cx = lado / 2, cy = lado / 2;
    var f = cupula.frames[indice];
    var lst = cupula.lst[indice], lat = cupula.site.lat;
    var dia = !f.sky_mag_trustworthy;

    // Nada va fuera de la cúpula: un parche de nube es un trozo de cielo, y un
    // trozo de cielo que se derrama pasado el horizonte se lee como una farola.
    o.save();
    recortar(o, lado);
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
     una segunda rutina "parecida" acaba discrepando del dibujo que explica.

     La lista es la escala entera y por eso empieza por el negro: si la primera
     muestra no es la noche perfecta, no se ve contra QUE se estan midiendo las
     demas. */
  var MUESTRAS = [
    // El punto de partida: sin Luna, sin nubes, sin calima. Negro.
    ['oscura', {}],
    // La Luna, cerca y lejos. Son la MISMA Luna llena: lo unico que cambia es
    // la separacion, y ese es justo el efecto que antes no se veia.
    ['lunaCerca', { moonAlt: 40, moonAz: 180, phase: 0 }],
    ['lunaLejos', { moonAlt: 30, moonAz: 300, phase: 0 }],
    // Las nubes, por lo que tapan. La fina es un cirro; la espesa, un estrato.
    ['nubeFina', { cloud: 30, layer: 'high' }],
    ['nubeEspesa', { cloud: 90, layer: 'low' }],
    // La calima, SIN Luna. Con Luna llena la muestra salia identica a la de
    // cielo limpio -- y no por un fallo: a 30 grados el termino de aerosol vale
    // 0,42 veces el suelo natural y la Luna aporta mil veces mas, asi que se lo
    // traga. Cierto, y por eso mismo inutil como muestra: lo que la calima le
    // hace al color solo se ve cuando no hay algo mas grande encima.
    ['calima', { aod: 0.35, k: 0.35 }],
    // Etiquetada 'Dia' porque es el color de los dos extremos de la linea de
    // tiempo, que es donde la gente la va a reconocer. Se calcula a -10 grados
    // de altura solar, que es crepusculo nautico: mas arriba el ajuste de
    // crepusculo del motor ya no llega y el domo lo dice en vez de pintarlo.
    ['dia', { sunAlt: -10 }]
  ];

  // A 70 grados la masa de aire es 1,06 y el termino de aerosol vale casi
  // cero: la muestra de calima salia identica a la de Luna llena limpia. A 30
  // la masa de aire es 2 y la calima se ve, que es de lo que va la muestra.
  var MUESTRA_ALT = 30;

  function muestras(cupula) {
    var base = { k: cupula.transparency.k, aod: cupula.transparency.aod_site,
                 floor: nl(NATURAL_FLOOR_MAG), gal: null, moonAlt: -20,
                 moonAz: 180, phase: 0, sunAlt: -40, cloud: 0, layer: 'mid' };
    var rgb = [0, 0, 0];
    return MUESTRAS.map(function (par) {
      var env = {};
      Object.keys(base).forEach(function (k) { env[k] = base[k]; });
      Object.keys(par[1]).forEach(function (k) { env[k] = par[1][k]; });
      // La magnitud sale de la LUMINANCIA que devuelve skyAt, no del pixel.
      // Reconstruirla del pixel ataba el numero publicado a la rampa de
      // pantalla: cualquier retoque de GAMMA movia una magnitud, que es lo
      // ultimo que se quiere que dependa de una decision de color.
      var nlv = skyAt(MUESTRA_ALT, 180, env, rgb);
      return { clave: par[0],
               rgb: [Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2])],
               mag: (20.7233 - Math.log(nlv / 34.08)) / 0.92104 };
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
    /* LA PALETA, PUBLICADA. La usa tambien la franja de la noche del panel, y
       lo que NO puede pasar es que alli la Luna sea dorada y aqui azul: seria
       otra vez el mismo concepto con dos reglas. Se exporta desde donde vive en
       vez de copiarse. En 0-255 porque quien la consume pinta CSS. */
    paleta: {
      galaxia: C_GALAXY.map(function (v) { return Math.round(v * 255); }),
      luna: C_MOON.map(function (v) { return Math.round(v * 255); }),
      polvo: C_DUST.map(function (v) { return Math.round(v * 255); }),
      dia: C_DAY.map(function (v) { return Math.round(v * 255); }),
      nube: C_CLOUD.map(function (v) { return Math.round(v * 255); })
    },
    // El modo de vista y hacia donde mira la camara. Vive en el modulo y no en
    // la llamada porque lo consultan tanto `project` como su inversa, y el
    // sitio donde un dato lo leen dos funciones es el modulo.
    vista: VISTA,
    fijarVista: function (modo, az, alt, fov) {
      VISTA.modo = modo === 'cupula' ? 'cupula' : 'boveda';
      if (typeof az === 'number') { VISTA.az = ((az % 360) + 360) % 360; }
      // La elevacion se ACOTA y el azimut no: girar sobre uno mismo da la
      // vuelta entera y es continuo, pero mirar mas alla del cenit no es mirar
      // mas arriba, es quedar cabeza abajo. La camara no tiene alabeo, asi que
      // pasado el cenit el mundo se invertiria sin que nadie lo haya pedido.
      if (typeof alt === 'number') {
        VISTA.alt = Math.max(ALT_MIN, Math.min(ALT_MAX, alt));
      }
      if (typeof fov === 'number') {
        VISTA.fov = Math.max(FOV_MIN, Math.min(FOV_MAX, fov));
      }
      return VISTA;
    },
    pintar: function (skyCanvas, overCanvas, cupula, objetos, indice, textos) {
      if (!cupula || !cupula.frames || !cupula.frames[indice]) { return; }
      var lado = skyCanvas.clientWidth || 320;
      var dpr = Math.min(global.devicePixelRatio || 1, 2);
      pintarCielo(skyCanvas, cupula, indice, lado, dpr, textos);
      pintarEncima(overCanvas, cupula, objetos, indice, lado, dpr, textos);
    }
  };
})(window);
