/* Astro Forecast AstroCamp -- la noche de Nerpio, leida del repo publico del motor.
 *
 * El motor (CabraSpace-AstroWeather) es privado; lo que predice es publico y
 * se reescribe cada 6 h en una URL fija. Aqui no se calcula NADA de fisica: si
 * un numero no viene en el JSON, no se pinta. Una pagina que recalcula lo que
 * ilustra acaba discrepando del motor que la alimenta -- incluida la cupula,
 * que dibuja trazas ya calculadas en el servidor, no efemerides propias.
 */
(function () {
  'use strict';

  var URL_NOCHE = 'https://raw.githubusercontent.com/Ninocabra/CabraSpace-AstroWeather-Data/main/noche.json';
  var REPO = 'https://github.com/Ninocabra/CabraSpace-AstroWeather-Data';

  var PIE_ES = 'Previsión del motor propio de CabraSpace, calculada para AstroCamp (Nerpio). Cada número viaja con su procedencia dentro del ' +
    '<a href="' + URL_NOCHE + '" target="_blank" rel="noopener">JSON público</a> (' +
    '<a href="' + REPO + '" target="_blank" rel="noopener">repositorio</a>), que se reescribe cada 6 h. ' +
    'Proyecto personal en desarrollo, no un servicio meteorológico: <strong>no lo uses para decisiones de seguridad</strong>. ' +
    'Catálogo de objetos derivado de <a href="https://github.com/mattiaverga/OpenNGC" target="_blank" rel="noopener">OpenNGC</a> (Mattia Verga), CC BY-SA 4.0.';

  var PIE_EN = 'Forecast from the CabraSpace engine, computed for AstroCamp (Nerpio, Spain). Every number carries its provenance inside the ' +
    '<a href="' + URL_NOCHE + '" target="_blank" rel="noopener">public JSON</a> (' +
    '<a href="' + REPO + '" target="_blank" rel="noopener">repository</a>), rewritten every 6 h. ' +
    'A personal project under development, not a weather service: <strong>do not use it for safety decisions</strong>. ' +
    'Object catalogue derived from <a href="https://github.com/mattiaverga/OpenNGC" target="_blank" rel="noopener">OpenNGC</a> (Mattia Verga), CC BY-SA 4.0.';

  var T = {
    es: {
      cargando: 'Consultando la previsión…',
      error: 'No se ha podido leer la previsión ahora mismo. Se actualiza cada 6 horas; vuelve a intentarlo en un rato.',
      titulo: 'Nerpio, <span>esta noche</span>',
      sitio: 'AstroCamp · Nerpio (Albacete) · 1.650 m · MPC I79',
      probLabel: 'de probabilidad de que haya condiciones para abrir',
      probTitulo: 'Condiciones, no comportamiento',
      abierto: 'Abierto', cerrado: 'Cerrado',
      veredictoTitulo: 'De dónde sale esta palabra',
      horasUtiles: 'h utilizables esperadas',
      horasUtilesOscuras: 'de ellas en oscuridad astronómica',
      horasTitulo: 'Por qué son dos números',
      horasExplica: 'La primera cuenta toda la ventana del producto, del ocaso menos una hora al orto más una, así que incluye el crepúsculo: por eso puede pasar de las horas de oscuridad astronómica. En crepúsculo se hace planetaria y objetos brillantes, no cielo profundo. La segunda es la parte que cae dentro de la oscuridad de verdad, y es la que cuenta para campo profundo.',
      noche: 'Noche del', luna: 'Luna', oscuridad: 'Oscuridad astronómica',
      cielo: 'Cielo más oscuro', seeing: 'Seeing', transparencia: 'Transparencia',
      iluminada: 'iluminada', sinCalibrar: 'estimación sin calibrar',
      horas: 'h', magArc: 'mag/arcsec²',
      consejos: 'Qué hacer esta noche',
      adquisicion: 'Por filtro y técnica', familias: 'Por familia de objeto',
      otros: 'Y además',
      referencias: 'De dónde sale cada consejo',
      perfil: 'Altura sobre el horizonte durante la noche',
      pulsaPerfil: 'Pulsa en el gráfico para ver qué pasa a esa hora.',
      aEsaHora: 'A las', altura: 'altura', rinde: 'rendimiento',
      limitaPor: 'limita', bajoHorizonte: 'bajo el horizonte',
      bajoMinimo: 'demasiado bajo para observar', cieloAhora: 'cielo',
      esDeDia: 'todavía es de día', solA: 'Sol a',
      yAdemas: 'y además el objeto está a', yTampocoNoche: 'y tampoco es noche cerrada',
      limita: { c: 'el cielo', l: 'la Luna', f: 'el fondo', a: 'la altura',
                n: 'nada', '-': 'la altura', x: 'sin puntuar' },
      sensores: 'Ahora mismo en Nerpio',
      sinSensores: 'Los sensores del sitio no responden en este momento.',
      fotometro: 'Cielo medido', calibrado: 'calibrado',
      temp: 'Temperatura', humedad: 'Humedad', rocio: 'Margen de rocío',
      viento: 'Viento', presion: 'Presión', cieloIR: 'Cielo (IR)',
      indice: 'Índice de nubes', techos: 'Techos abiertos', seguridad: 'Estado',
      medidoHace: 'Medido hace', minutos: 'min', viejo: 'lectura antigua',
      delArchivo: 'Completado desde nuestro archivo:',
      campos: { temperatura: 'temperatura', humedad: 'humedad', viento_ms: 'viento',
                presion: 'presión', punto_rocio: 'punto de rocío',
                cielo_ir: 'cielo IR', cielo_indice: 'índice de nubes' },
      elegir: 'Qué quieres apuntar',
      recoTitulo: 'Recomendados para esta noche', evaluados: 'evaluados', alt: 'alt',
      clases: { narrowband: 'Banda estrecha', normal: 'Banda ancha normal',
                bajo_contraste: 'Bajo contraste', extremo_contraste: 'Contraste extremo',
                compacto_resolucion: 'Compactos, manda el seeing' },
      buscar: 'Busca un objeto: M31, Velo, NGC 7000…',
      sinResultados: 'Ningún objeto del catálogo coincide.',
      pista: 'Escribe el nombre de un objeto para ver su recorrido sobre la cúpula de esta noche y qué condiciones le tocan.',
      recorrido: 'Recorrido sobre la cúpula',
      horaCupula: 'Hora', maxAlt: 'Altura máxima', sepLuna: 'Separación a la Luna',
      mejorHora: 'Mejor momento', sobreMin: 'Horas sobre el mínimo',
      siDespeja: 'h si despeja', esperadas: 'h esperadas',
      manana: 'Mañana', pie: PIE_ES, generado: 'Generado',
      notaViento: 'La puerta de viento no está calibrada y el modelo se queda corto: trata el veredicto de abrir como optimista en viento.',
      notaVientoTitulo: 'La puerta de viento',
      tercil: { favorable: 'favorable', normal: 'normal', desfavorable: 'desfavorable' },
      veredicto: { recomendado: 'recomendado', posible: 'posible',
                   'poco rentable': 'poco rentable', 'no observable': 'no observable' },
      severidad: { evitar: 'evitar', aprovecha: 'aprovecha', cuidado: 'cuidado' },
      reproducir: 'Reproducir la noche', pausar: 'Pausar',
      quitar: 'Quitar', siDespejaCorto: 'si despeja',
      meridiano: 'meridiano', maxCorto: 'máx', minCorto: 'mín',
      minimo: 'de la Luna, mínimo', lunaCerca: 'la Luna manda en el encuadre',
      lunaAbajo: 'Luna bajo el horizonte',
      buscarFuera: 'Buscar «%s» en SIMBAD', resolviendo: 'Resolviendo…',
      noResuelto: 'SIMBAD no conoce ese nombre.',
      porCoordenadas: 'O escribe coordenadas: «10 45 03 -59 41 04» o «161.26 -59.68»',
      coordsMal: 'No entiendo esas coordenadas.',
      sinPuntuar: 'Objeto externo: la altura es geometría y sale del mismo tiempo sidéreo que la cúpula, pero el motor NO lo ha puntuado — no hay horas de SNR ni veredicto para él.',
      sinTrazaTitulo: 'De dónde sale esta curva',
      sinTraza: 'El motor lo puntúa, pero su recorrido no viaja en el fichero: solo los mejores de la noche lo llevan. La curva de altura y la separación a la Luna se calculan aquí, con el mismo tiempo sidéreo que la cúpula. Por eso el detalle de cada instante dice a qué altura está y qué cielo hay, pero no cuánto rinde ni qué lo limita.',
      horasQueTitulo: 'Qué son estas horas',
      horasQueSon: 'No son las horas que el objeto pasa sobre el horizonte: son las que RINDEN. Cada instante vale entre 0 y 1 según lo que le dejan el fondo de cielo, la altura y el seeing, y luego se suman — dos horas malas pueden valer menos que una buena, y lo que sale son horas equivalentes a una hora de referencia de este sitio. «Si despeja» significa dando el cielo por despejado, sin descontar la probabilidad de nubes: es el techo de la noche para este objeto. Un cero no es un fallo de la cuenta — es que ni despejando del todo cuaja, y la frase de debajo dice qué lo impide.',
      coordenadas: 'coordenadas',
      clave: 'Qué color es qué cielo',
      claveTitulo: 'Cómo se lee la bóveda',
      claveNota: 'El negro es el cielo más oscuro que da este sitio; encima solo se pinta lo que estorba, y su color dice qué es: azul la Luna, gris las nubes, rojo la calima, amarillo el día. En las nubes, cuanto más claras más tapan. El número es la magnitud por segundo de arco al cuadrado, y en la nube espesa engaña a propósito: sin ciudad debajo la nube OSCURECE el cielo — se traga el airglow en vez de reflejar farolas, medido aquí sobre 4.690 horas — así que sale oscurísimo y a la vez inservible.',
      muestras: {
        oscura: 'Lo más oscuro que da', lunaCerca: 'Luna llena, a 10°',
        lunaLejos: 'Luna llena, a 97°', nubeFina: 'Cirro fino (30 %)',
        nubeEspesa: 'Estrato espeso (90 %)', calima: 'Calima', dia: 'Día'
      },
      cupula: {
        luna: 'Luna',
        fueraModelo: 'DE DÍA — FUERA DEL MODELO',
        fueraModeloNota: 'el ajuste de crepúsculo llega hasta −8° de altura solar',
        cardinales: [[0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'],
                     [180, 'S'], [225, 'SO'], [270, 'O'], [315, 'NO']]
      },
      transp: null
    },
    en: {
      cargando: 'Fetching the forecast…',
      error: 'The forecast could not be read right now. It refreshes every 6 hours; try again shortly.',
      titulo: 'Nerpio, <span>tonight</span>',
      sitio: 'AstroCamp · Nerpio (Albacete, Spain) · 1,650 m · MPC I79',
      probLabel: 'chance there will be CONDITIONS to open',
      probTitulo: 'Conditions, not behaviour',
      abierto: 'Open', cerrado: 'Closed',
      veredictoTitulo: 'Where this word comes from',
      horasUtiles: 'h of expected usable time',
      horasUtilesOscuras: 'of them in astronomical darkness',
      horasTitulo: 'Why there are two numbers',
      horasExplica: 'The first counts the whole product window, from one hour before sunset to one hour after sunrise, so it includes twilight: that is why it can exceed the hours of astronomical darkness. Twilight is for planetary and bright targets, not deep sky. The second is the part that falls inside real darkness, and that is the one that counts for deep sky.',
      noche: 'Night of', luna: 'Moon', oscuridad: 'Astronomical darkness',
      cielo: 'Darkest sky', seeing: 'Seeing', transparencia: 'Transparency',
      iluminada: 'illuminated', sinCalibrar: 'uncalibrated estimate',
      horas: 'h', magArc: 'mag/arcsec²',
      consejos: 'What to do tonight',
      adquisicion: 'By filter and technique', familias: 'By object family',
      otros: 'And also',
      referencias: 'Where each piece of advice comes from',
      perfil: 'Altitude above the horizon through the night',
      pulsaPerfil: 'Click the chart to see what happens at that hour.',
      aEsaHora: 'At', altura: 'altitude', rinde: 'yield',
      limitaPor: 'limited by', bajoHorizonte: 'below the horizon',
      bajoMinimo: 'too low to observe', cieloAhora: 'sky',
      esDeDia: 'still daytime', solA: 'Sun at',
      yAdemas: 'and the target is at', yTampocoNoche: 'and it is not full night either',
      limita: { c: 'the sky', l: 'the Moon', f: 'the background', a: 'altitude',
                n: 'nothing', '-': 'altitude', x: 'not scored' },
      sensores: 'Right now at Nerpio',
      sinSensores: 'The site sensors are not responding at the moment.',
      fotometro: 'Measured sky', calibrado: 'calibrated',
      temp: 'Temperature', humedad: 'Humidity', rocio: 'Dew margin',
      viento: 'Wind', presion: 'Pressure', cieloIR: 'Sky (IR)',
      indice: 'Cloud index', techos: 'Roofs open', seguridad: 'Status',
      medidoHace: 'Measured', minutos: 'min ago', viejo: 'stale reading',
      delArchivo: 'Filled in from our archive:',
      campos: { temperatura: 'temperature', humedad: 'humidity', viento_ms: 'wind',
                presion: 'pressure', punto_rocio: 'dew point',
                cielo_ir: 'sky IR', cielo_indice: 'cloud index' },
      elegir: 'What do you want to shoot',
      recoTitulo: 'Recommended for tonight', evaluados: 'scored', alt: 'alt',
      clases: { narrowband: 'Narrowband', normal: 'Plain broadband',
                bajo_contraste: 'Low contrast', extremo_contraste: 'Extreme contrast',
                compacto_resolucion: 'Compact, seeing rules' },
      buscar: 'Search an object: M31, Veil, NGC 7000…',
      sinResultados: 'No catalogue object matches.',
      pista: 'Type an object name to see its path across tonight’s dome and the conditions it gets.',
      recorrido: 'Path across the dome',
      horaCupula: 'Time', maxAlt: 'Peak altitude', sepLuna: 'Moon separation',
      mejorHora: 'Best moment', sobreMin: 'Hours above minimum',
      siDespeja: 'h if it clears', esperadas: 'h expected',
      manana: 'Tomorrow', pie: PIE_EN, generado: 'Generated',
      notaViento: 'The wind gate is uncalibrated and the model runs low: treat the open/close verdict as optimistic on wind.',
      notaVientoTitulo: 'The wind gate',
      tercil: { favorable: 'favourable', normal: 'typical', desfavorable: 'poor' },
      veredicto: { recomendado: 'recommended', posible: 'possible',
                   'poco rentable': 'low yield', 'no observable': 'not observable' },
      severidad: { evitar: 'avoid', aprovecha: 'make the most of it', cuidado: 'watch out' },
      reproducir: 'Play the night', pausar: 'Pause',
      quitar: 'Remove', siDespejaCorto: 'if it clears',
      meridiano: 'meridian', maxCorto: 'max', minCorto: 'min',
      minimo: 'from the Moon, minimum', lunaCerca: 'the Moon owns the frame',
      lunaAbajo: 'Moon below the horizon',
      buscarFuera: 'Look up “%s” in SIMBAD', resolviendo: 'Resolving…',
      noResuelto: 'SIMBAD does not know that name.',
      porCoordenadas: 'Or type coordinates: “10 45 03 -59 41 04” or “161.26 -59.68”',
      coordsMal: 'I cannot read those coordinates.',
      sinPuntuar: 'External target: the altitude is geometry, from the same sidereal time as the dome, but the engine has NOT scored it — no SNR hours and no verdict.',
      sinTrazaTitulo: 'Where this curve comes from',
      sinTraza: 'The engine does score it, but its track does not travel in the file: only the best of the night carry one. The altitude curve and the Moon separation are computed here, from the same sidereal time as the dome. That is why the per-moment detail gives altitude and sky but no yield and no limiting factor.',
      horasQueTitulo: 'What these hours are',
      horasQueSon: 'Not the hours the target spends above the horizon: the hours it YIELDS. Every moment is worth between 0 and 1 depending on what the sky background, the altitude and the seeing allow, and those are then added up — two poor hours can be worth less than one good one, and the result is hours equivalent to one reference hour at this site. “If it clears” means taking the sky as clear, without discounting the chance of cloud: it is the ceiling of the night for this target. A zero is not a broken sum — it means it does not come through even under a fully clear sky, and the line below says what stops it.',
      coordenadas: 'coordinates',
      clave: 'Which colour is which sky',
      claveTitulo: 'How to read the dome',
      claveNota: 'Black is the darkest sky this site gives; on top of it only what gets in the way is painted, and its colour says which: blue the Moon, grey the cloud, red the dust haze, yellow the daylight. For cloud, the paler the more it blocks. The number is the magnitude per square arcsecond, and on thick cloud it misleads on purpose: with no city below, cloud DARKENS the sky — it swallows the airglow instead of reflecting streetlights, measured here over 4,690 hours — so it reads very dark and is useless all the same.',
      muestras: {
        oscura: 'The darkest it gets', lunaCerca: 'Full Moon, 10° away',
        lunaLejos: 'Full Moon, 97° away', nubeFina: 'Thin cirrus (30%)',
        nubeEspesa: 'Thick stratus (90%)', calima: 'Dust haze', dia: 'Daytime'
      },
      cupula: {
        luna: 'Moon',
        fueraModelo: 'DAYTIME — OUTSIDE THE MODEL',
        fueraModeloNota: 'the twilight fit only reaches −8° of solar altitude',
        cardinales: [[0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'],
                     [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']]
      },
      transp: [
        ['noche transparente', 'clear night'],
        ['transparencia media', 'medium transparency: fine for narrowband, not for deep broadband'],
        ['transparencia pobre', 'poor transparency'],
        ['calima', 'dust haze: milky sky, the Moon hurts more and faint targets do not build up']
      ]
    }
  };

  var ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ESCAPES[c]; }); }

  /* «M 31», «M31», «m  31» y «Messier 31» son el mismo objeto para quien
     escribe, y «ngc7000» tambien. Sin normalizar habia que acertar con la
     forma exacta del alias publicado, que es pedirle al visitante que adivine
     como lo escribimos nosotros. */
  function normaliza(texto) {
    return String(texto).toLowerCase().replace(/\s+/g, '').replace(/^messier/, 'm');
  }

  function num(v, d) {
    return (typeof v === 'number' && isFinite(v)) ? v.toFixed(d === undefined ? 1 : d) : null;
  }

  function fecha(iso, lang) {
    var d = new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso);
    if (isNaN(d.getTime())) { return esc(iso); }
    return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES',
      { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function hora(iso) {
    // 24 h siempre. El navegador puede estar en una configuracion que devuelva
    // "09:39 PM" y aqui la hora es la del observatorio, no la del visitante:
    // mezclar formatos en la misma tarjeta se lee como un error.
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '--:--'
      : d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function traducirTransparencia(texto, t) {
    if (!t.transp || !texto) { return texto; }
    for (var i = 0; i < t.transp.length; i++) {
      if (texto.indexOf(t.transp[i][0]) === 0) { return t.transp[i][1]; }
    }
    return texto;
  }

  function clase(veredicto) {
    if (veredicto === 'recomendado') { return 'ok'; }
    if (veredicto === 'posible') { return 'mid'; }
    return 'low';
  }

  function celda(clave, valor, nota, limitante) {
    if (valor === null || valor === undefined) { return ''; }
    return '<div class="aw-cell' + (limitante ? ' limita' : '') + '">' +
      '<span class="k">' + esc(clave) + '</span>' +
      '<span class="v">' + valor + '</span>' +
      (nota ? '<span class="n">' + esc(nota) + '</span>' : '') + '</div>';
  }

  function sensor(clave, valor, unidad, estado, cuando) {
    if (valor === null || valor === undefined) { return ''; }
    // La hora va en la casilla y entera en el title: quien quiera saber de
    // cuando es la medida la ve, y quien no, no se come una fecha completa.
    return '<div class="aw-sensor ' + (estado || '') + '"' +
      (cuando ? ' title="' + esc(String(cuando).replace('T', ' ').slice(0, 16)) + ' UTC"' : '') +
      '><span class="k">' + esc(clave) + '</span>' +
      '<span class="v">' + esc(valor) +
        (unidad ? ' <span class="u">' + esc(unidad) + '</span>' : '') + '</span>' +
      (cuando ? '<span class="cuando">' + esc(String(cuando).slice(11, 16)) + '</span>' : '') +
      '</div>';
  }

  // -------------------------------------------------------- LA CÚPULA ------
  // El render vive en astroweather-dome.js: es el port del mockup del motor,
  // con su física. Aquí solo se le dan los datos y los textos.
  function pintarCupula(destino, datos, objetos, indice, t) {
    var cielo = destino.querySelector('#aw-sky');
    var encima = destino.querySelector('#aw-over');
    if (!cielo || !encima || !window.AWDome) { return; }
    window.AWDome.pintar(cielo, encima, datos.cupula, objetos, indice, t.cupula);
  }

  // ------------------------------------------------------------ BLOQUES ----  // ------------------------------------------------------------ BLOQUES ----
  function bloqueResumen(noche, t, lang) {
    // Cual de las casillas es la que hoy estropea la noche. Lo decide el motor
    // -- la misma funcion que pinta los semaforos -- para que la casilla roja y
    // el semaforo rojo no puedan discrepar.
    var limita = (noche.consejos && noche.consejos.limitante) || null;
    var p = noche.probabilidad_de_abrir;
    var cielo = noche.cielo || {};
    var seeing = cielo.seeing || {};
    var transp = cielo.transparencia || {};
    var html = '<div class="aw-headline">';
    if (typeof p === 'number') {
      // La palabra manda y el porcentaje va debajo. Un 47 % obliga a poner el
      // umbral en la cabeza de quien lee, y cada uno lo pone donde quiere.
      //
      // El corte lo decide el MOTOR y viaja en el JSON: si la palabra se
      // decidiera aquí, el día que el motor cambiara de umbral la página
      // seguiría diciendo lo contrario con el mismo número al lado. Sin
      // `veredicto_abrir` no se inventa ninguna: se enseña la cifra sola, que
      // es lo que había antes.
      var vd = noche.veredicto_abrir;
      var explica = '<span class="aw-info izq abajo" tabindex="0">?<span class="aw-pop">' +
        '<b>' + esc(vd ? t.veredictoTitulo : t.probTitulo) + '</b>' +
        (vd && vd.regla ? esc(vd.regla) + ' ' : '') +
        esc(noche.probabilidad_definicion || '') + '</span></span>';
      html += '<div class="aw-verdict' + (vd ? (vd.abierto ? ' abierto' : ' cerrado') : '') + '">' +
        (vd ? '<div class="palabra">' + esc(vd.abierto ? t.abierto : t.cerrado) + '</div>'
            : '<div class="palabra num">' + Math.round(p * 100) + '%</div>') +
        '<div class="prob">' + (vd ? '<b>' + Math.round(p * 100) + '%</b> ' : '') +
          esc(t.probLabel) + explica + '</div></div>';
    }
    html += '<div class="aw-when">' + esc(t.noche) + ' <strong>' + fecha(noche.noche, lang) + '</strong>';
    if (num(noche.horas_utilizables_esperadas) !== null) {
      // Las dos cuentas juntas y con su diferencia dicha: la grande incluye
      // crepúsculo y por eso puede pasar de la oscuridad astronómica, y la que
      // vale para cielo profundo es la pequeña.
      var oscuras = num(noche.horas_utilizables_oscuras);
      html += '<br>' + num(noche.horas_utilizables_esperadas) + ' ' + esc(t.horasUtiles) +
        (oscuras !== null ? ', ' + oscuras + ' ' + esc(t.horasUtilesOscuras) : '') +
        '<span class="aw-info abajo" tabindex="0">?<span class="aw-pop">' +
        '<b>' + esc(t.horasTitulo) + '</b>' + esc(t.horasExplica) + '</span></span>';
    }
    html += '</div></div><div class="aw-grid">';
    if (typeof noche.luna_iluminacion === 'number') {
      html += celda(t.luna, Math.round(noche.luna_iluminacion * 100) + '%',
        t.iluminada, limita === 'luna');
    }
    if (num(noche.oscuridad_astronomica_h) !== null) {
      // La duración sola no sirve para planificar: lo que se planifica es a
      // qué hora empieza y a qué hora se acaba.
      var cr = noche.crepusculo || {};
      var ventana = (cr.astronomico_desde && cr.astronomico_hasta)
        ? hora(cr.astronomico_desde) + ' – ' + hora(cr.astronomico_hasta)
        : null;
      html += celda(t.oscuridad, num(noche.oscuridad_astronomica_h) + ' ' + t.horas,
        ventana, limita === 'oscuridad');
    }
    if (num(cielo.mag_cenit_mas_oscuro, 2) !== null) {
      // Se ensena el CORREGIDO contra el fotometro, con el crudo detras: el
      // fotometro es medida y el modelo es estimacion, asi que manda el primero.
      var corregido = num(cielo.mag_cenit_corregido, 2);
      var cal = cielo.calibracion_fotometro || {};
      var nota = t.magArc + (corregido !== null ? ' · ' + t.calibrado : '');
      html += celda(t.cielo, corregido !== null ? corregido
                                                : num(cielo.mag_cenit_mas_oscuro, 2),
        nota, limita === 'cielo');
    }
    if (seeing.tercil) {
      html += celda(t.seeing, esc(t.tercil[seeing.tercil] || seeing.tercil),
        seeing.calibrado === false ? t.sinCalibrar : null, limita === 'seeing');
    }
    if (transp.veredicto) {
      html += celda(t.transparencia, esc(traducirTransparencia(transp.veredicto, t)),
        transp.origen ? 'AOD ' + num(transp.aod, 3) + ' · ' + transp.origen : null,
        limita === 'transparencia');
    }
    return html + '</div>';
  }

  function semaforo(fila) {
    return '<span class="aw-light ' + esc(fila.luz) + '" tabindex="0">' +
      '<span class="dot"></span>' +
      '<span class="name">' + esc(fila.etiqueta) + '</span>' +
      '<span class="short">' + esc(fila.resumen) + '</span>' +
      '<span class="aw-pop"><b>' + esc(fila.etiqueta) + '</b>' +
      esc(fila.detalle) + '</span></span>';
  }

  function filaSemaforos(etiqueta, filas, plegable) {
    if (!filas || !filas.length) { return ''; }
    var cuenta = { verde: 0, ambar: 0, rojo: 0 };
    filas.forEach(function (f) { cuenta[f.luz] = (cuenta[f.luz] || 0) + 1; });
    var luces = '<div class="aw-lights">' + filas.map(semaforo).join('') + '</div>';
    if (!plegable) {
      return '<div class="aw-lane-row"><span class="lbl">' + esc(etiqueta) +
        '</span>' + luces + '</div>';
    }
    // Plegada de entrada. El titular de arriba ya dice lo que se puede hacer;
    // esto es el detalle, y el detalle se abre cuando se quiere.
    return '<details class="aw-lane-row fold"><summary>' +
      '<span class="lbl">' + esc(etiqueta) + '</span>' +
      '<span class="cuenta">' +
        '<i class="verde"></i>' + cuenta.verde +
        '<i class="ambar"></i>' + cuenta.ambar +
        '<i class="rojo"></i>' + cuenta.rojo +
      '</span></summary>' + luces + '</details>';
  }

  // De dónde sale cada correlación. Va dentro del JSON y se enseña aquí por la
  // misma razón que la procedencia de cada número: se le está diciendo a
  // alguien que cambie lo que iba a hacer esta noche.
  function bloqueReferencias(refs, t) {
    if (!refs || !refs.length) { return ''; }
    return '<details class="aw-refs"><summary>' + esc(t.referencias) + '</summary>' +
      refs.map(function (r) {
        return '<div class="ref"><b>' + esc(r.tema) + '</b> ' + esc(r.dice) + '</div>';
      }).join('') + '</details>';
  }

  function bloqueConsejos(noche, t) {
    var c = noche.consejos;
    if (!c || !c.adquisicion) { return ''; }
    return '<div class="aw-plan"><h3>' + esc(t.consejos) + '</h3>' +
      (c.resumen ? '<p class="aw-headline-tip">' + esc(c.resumen) + '</p>' : '') +
      filaSemaforos(t.adquisicion, c.adquisicion, true) +
      filaSemaforos(t.familias, c.objetos, true) +
      filaSemaforos(t.otros, c.avisos, false) +
      bloqueReferencias(c.referencias, t) + '</div>';
  }

  function bloqueSensores(datos, t) {
    var s = datos.sensores;
    // La advertencia de la puerta de viento vive en el "?" del titulo. Estaba
    // como un parrafo al pie del bloque, y un aviso permanente que no cambia
    // nunca deja de leerse a los dos dias: ocupa el sitio de lo que si cambia.
    // Sigue estando y sigue siendo de seguridad, pero a un clic.
    var html = '<div class="aw-sensors"><h3>' + esc(t.sensores) +
      '<span class="aw-info izq" tabindex="0">?<span class="aw-pop"><b>' +
      esc(t.notaVientoTitulo) + '</b>' + esc(t.notaViento) + '</span></span></h3>';
    if (!s) { return html + '<div class="aw-stale">' + esc(t.sinSensores) + '</div></div>'; }

    html += '<div class="aw-sensor-grid">';
    // El fotometro primero: es la unica medida DIRECTA del fondo de cielo que
    // hay en esta pagina, y todo lo demas del cielo es estimacion.
    html += sensor(t.fotometro, num(s.cielo_mag_medido, 2), t.magArc, 'good',
      s.cielo_mag_medido_utc);
    html += sensor(t.temp, num(s.temperatura), '°C', '', s.medido_utc);
    html += sensor(t.humedad, num(s.humedad, 0), '%', s.humedad > 85 ? 'alert' : '', s.medido_utc);
    html += sensor(t.rocio, num(s.margen_rocio), '°C',
      s.riesgo_rocio === 'crítico' ? 'alert' : (s.riesgo_rocio === 'bajo' ? 'good' : ''),
      s.medido_utc);
    html += sensor(t.viento, num(s.viento_ms * 3.6, 0), 'km/h', s.viento_ms >= 5.5 ? 'alert' : '', s.medido_utc);
    html += sensor(t.presion, num(s.presion, 0), 'hPa', '', s.medido_utc);
    // El IR crudo del CloudWatcher se retira: es la ENTRADA de la que el
    // fabricante deriva el índice de nubes que va al lado, y el índice es
    // además el que consume el motor. Dos números para lo mismo, y el crudo
    // necesita una escala que la página no da.
    html += sensor(t.indice, num(s.cielo_indice), '',
      s.cielo_despejado === true ? 'good' : '', s.medido_utc);
    // 0/0 no es "ningún techo abierto", es "no vino el bloque". El motor
    // publica null para los dos casos distintos y aquí simplemente no se pinta.
    if (s.techos_total) {
      html += sensor(t.techos, s.techos_abiertos + '/' + s.techos_total, '',
        s.techos_abiertos > 0 ? 'good' : '', s.medido_utc);
    }
    if (s.estado_seguridad) {
      html += sensor(t.seguridad, s.estado_seguridad, '',
        s.estado_seguridad === 'Safe' ? 'good' : 'alert', s.medido_utc);
    }
    html += '</div>';

    if (s.antiguedad_min !== null && s.antiguedad_min !== undefined) {
      html += '<div class="aw-stale">' + esc(t.medidoHace) + ' ' +
        num(s.antiguedad_min, 0) + ' ' + esc(t.minutos) +
        (s.fresco === false ? ' · ' + esc(t.viejo) : '') + '.</div>';
    }
    // La página de AstroCamp vuelve incompleta a ratos, y callarlo era lo peor
    // que se podía hacer: el panel se quedaba en dos casillas y quien lo miraba
    // no tenía forma de saber si eso era el sitio o era la descarga.
    var completados = Object.keys(s.del_archivo || {});
    if (completados.length) {
      html += '<div class="aw-stale">' + esc(t.delArchivo) + ' ' +
        completados.map(function (k) { return esc(t.campos[k] || k); }).join(', ') +
        '.</div>';
    }
    if (s.incompleto) {
      html += '<div class="aw-stale incompleta">' + esc(s.incompleto) + '.</div>';
    }
    return html + '</div>';
  }

  // Los colores de las trazas. Son los del mockup del motor: elegidos para
  // distinguirse entre sí sobre un cielo azul o naranja, que es lo que hay
  // debajo.
  var COLORES = ['#5fcf95', '#e8ad52', '#7fb0ef', '#c79ada', '#f0705a',
                 '#79cfc2', '#b9c473', '#e08aa6', '#6fc3dd', '#d0a86b'];
  var MAX_OBJETOS = 6;

  function bloqueElegir(t) {
    return '<div class="aw-pick"><h3>' + esc(t.elegir) + '</h3>' +
      '<div class="aw-buscador">' +
        '<div class="aw-search">' +
        '<input type="search" id="aw-q" autocomplete="off" placeholder="' + esc(t.buscar) + '">' +
        '<div class="aw-results" id="aw-res" hidden></div></div>' +
        '<select id="aw-reco" class="aw-reco"></select>' +
      '</div>' +
      '<div id="aw-chosen"><div class="aw-hint">' + esc(t.pista) + '</div></div></div>';
  }

  // ------------------------------------------------ CLAVE DE COLOR --------
  function bloqueClave(cupula, t) {
    if (!window.AWDome || !window.AWDome.muestras) { return ''; }
    var filas;
    try { filas = window.AWDome.muestras(cupula); } catch (e) { return ''; }
    return '<div class="aw-key"><span class="lbl">' + esc(t.clave) +
      ' · ' + window.AWDome.muestraAltitud + '°' +
      '<span class="aw-info abajo" tabindex="0">?<span class="aw-pop"><b>' +
      esc(t.claveTitulo) + '</b>' + esc(t.claveNota) + '</span></span></span>' +
      filas.map(function (f) {
        return '<div class="sw">' +
          '<i style="background:rgb(' + f.rgb.join(',') + ')"></i>' +
          '<span>' + esc(t.muestras[f.clave] || f.clave) + '</span>' +
          '<b>' + f.mag.toFixed(1) + '</b></div>';
      }).join('') + '</div>';
  }

  /* LA VENTANA QUE SE PINTA, y la pintan los dos: la línea de tiempo y los
     perfiles. No es que se hayan cuadrado a mano, es que miden lo mismo — por
     eso el cursor de arriba cae en la misma vertical que el de abajo.

     Va de una hora antes de la oscuridad astronómica a una hora después. NO es
     la ventana del producto, que va de una hora antes de la puesta a una hora
     después de la salida: esa es la correcta para contar horas utilizables —
     el crepúsculo sirve para planetaria — pero pintada ocupa media gráfica con
     un cielo en el que no se hace cielo profundo, y aplasta la noche de verdad
     contra el centro. */
  var MARGEN_VENTANA_MS = 3600 * 1000;

  function ventanaNoche(marcos) {
    var n = marcos.length;
    if (!n) { return { desde: 0, hasta: 0 }; }
    var completa = { desde: 0, hasta: n - 1 };
    var primero = -1, ultimo = -1;
    marcos.forEach(function (m, i) {
      if (m.dark) { if (primero < 0) { primero = i; } ultimo = i; }
    });
    if (primero < 0) { return completa; }
    var ms = marcos.map(function (m) { return new Date(m.t).getTime(); });
    if (!isFinite(ms[primero]) || !isFinite(ms[ultimo])) { return completa; }
    var v = { desde: 0, hasta: n - 1 };
    for (var i = 0; i < n; i++) {
      if (ms[i] <= ms[primero] - MARGEN_VENTANA_MS) { v.desde = i; }
    }
    for (var j = n - 1; j >= 0; j--) {
      if (ms[j] >= ms[ultimo] + MARGEN_VENTANA_MS) { v.hasta = j; }
    }
    return (v.hasta - v.desde >= 2) ? v : completa;
  }

  /* EL EJE DE TIEMPO, y hasta hoy no era de tiempo: era lineal en INDICE DE
     MARCO mientras la rejilla del motor es ADAPTATIVA -- 30 minutos en el
     crepusculo y 10 en la noche cerrada (`night.adaptive_hours(10, 30)`). Cada
     paso de media hora se dibujaba con el mismo ancho que uno de diez, o sea
     que el crepusculo salia estirado al triple y la noche aplastada, y la
     curva de altura -- que es suave, es geometria -- llegaba con un CODO en
     cada cambio de rejilla, a las 22:07 y a las 06:57.

     No era la interpolacion, era el eje: la curva estaba bien y el sitio donde
     se pintaba cada punto, mal. Ahora la posicion sale del instante, asi que
     una hora de reloj mide lo mismo en toda la grafica, la linea de tiempo de
     arriba y los perfiles de abajo siguen midiendo lo mismo (que es lo que
     mantiene los dos cursores en la misma vertical) y los codos desaparecen
     solos. */
  function escalaTiempo(marcos, v) {
    var ms = marcos.map(function (m) { return new Date(m.t).getTime(); });
    var t0 = ms[v.desde], t1 = ms[v.hasta];
    var ancho = t1 - t0;
    if (!isFinite(ancho) || ancho <= 0) {
      // Sin instantes utilizables se cae al indice, que es lo que habia: peor
      // reparto, pero nunca una division por cero ni una curva sin dibujar.
      var n = Math.max(1, v.hasta - v.desde);
      return function (j) { return Math.max(0, Math.min(1, (j - v.desde) / n)); };
    }
    return function (j) { return Math.max(0, Math.min(1, (ms[j] - t0) / ancho)); };
  }

  // Sitio para respirar arriba y abajo de la curva, en unidades del viewBox.
  // Estan aqui fuera porque el eje de alturas, que se dibuja en HTML, tiene que
  // usar exactamente los mismos numeros o las etiquetas no caen en sus rayas.
  var PERFIL_TOP = 6, PERFIL_BOT = 4;

  function perfilY(a) {
    return PERFIL_TOP + (90 - Math.max(0, Math.min(90, a))) / 90 *
      (100 - PERFIL_TOP - PERFIL_BOT);
  }

  /* Suavizado monotono de Fritsch-Carlson, y la diferencia con una spline
     cualquiera importa: una Catmull-Rom se pasa de largo en los picos e INVENTA
     alturas que el objeto nunca alcanza, justo encima del maximo, que es el
     punto que la gente lee. Esta no puede — entre dos muestras se queda acotada
     por ellas. Suave y sin mentir. */
  function curvaSuave(pts) {
    var n = pts.length;
    if (n < 2) { return n ? 'M' + pts[0][0].toFixed(2) + ' ' + pts[0][1].toFixed(2) : ''; }
    var dx = [], m = [], i;
    for (i = 0; i < n - 1; i++) {
      dx.push(pts[i + 1][0] - pts[i][0]);
      m.push((pts[i + 1][1] - pts[i][1]) / (dx[i] || 1e-6));
    }
    var tg = [m[0]];
    for (i = 1; i < n - 1; i++) {
      if (m[i - 1] * m[i] <= 0) { tg.push(0); }
      else {
        var w1 = 2 * dx[i] + dx[i - 1], w2 = dx[i] + 2 * dx[i - 1];
        tg.push((w1 + w2) / (w1 / m[i - 1] + w2 / m[i]));
      }
    }
    tg.push(m[n - 2]);
    var d = 'M' + pts[0][0].toFixed(2) + ' ' + pts[0][1].toFixed(2);
    for (i = 0; i < n - 1; i++) {
      var h = dx[i] / 3;
      d += ' C' + (pts[i][0] + h).toFixed(2) + ' ' + (pts[i][1] + tg[i] * h).toFixed(2) +
           ' ' + (pts[i + 1][0] - h).toFixed(2) + ' ' + (pts[i + 1][1] - tg[i + 1] * h).toFixed(2) +
           ' ' + pts[i + 1][0].toFixed(2) + ' ' + pts[i + 1][1].toFixed(2);
    }
    return d;
  }

  // -------------------------------------------------- LÍNEA DE TIEMPO -----
  // Una barra con la oscuridad astronómica marcada, no un control deslizante
  // pelado: lo que se quiere ver de un vistazo es CUÁNTO de la noche es noche
  // de verdad y dónde estás dentro de ella.
  function bloqueTiempo(marcos, indice, t, v) {
    var n = v.hasta - v.desde;
    if (n < 1) { return ''; }
    var frac = escalaTiempo(marcos, v);
    var pos = function (i) { return frac(i) * 100; };
    var partes = [];
    // Tres regímenes, no dos: día, crepúsculo y noche cerrada. Antes solo se
    // pintaba la noche y los dos extremos quedaban en negro, que es justo el
    // color de lo contrario de lo que son.
    function banda(clase2, desde, hasta) {
      if (hasta <= desde) { return; }
      partes.push('<div class="' + clase2 + '" style="left:' + pos(desde) +
        '%;width:' + (pos(hasta) - pos(desde)) + '%"></div>');
    }
    var regimen = function (f) {
      // `sky_mag_trustworthy` es falso donde el ajuste de crepúsculo ya no
      // llega (Sol por encima de −8°): eso es de día a todos los efectos.
      if (f.sky_mag_trustworthy === false) { return 'dia'; }
      return f.dark ? 'noche' : 'crepusculo';
    };
    var actual = regimen(marcos[v.desde]), desde = v.desde;
    for (var k = v.desde + 1; k <= v.hasta + 1; k++) {
      var r = (k <= v.hasta) ? regimen(marcos[k]) : null;
      if (r !== actual) {
        banda(actual, desde, k - 1);
        actual = r; desde = k - 1;
      }
    }
    // Marcas cada hora de reloj, no cada cuatro muestras: con el eje en tiempo
    // real "cada cuatro" reparte las etiquetas a distancias distintas segun la
    // rejilla, y una escala que no es regular se lee como si el tiempo tampoco
    // lo fuera. La etiqueta sigue siendo la del motor -- hora del sitio -- y
    // no una que calcule aqui con la zona horaria del visitante.
    var HORA = 3600000;
    var cuando = marcos.map(function (m) { return new Date(m.t).getTime(); });
    var salto = (cuando[v.hasta] - cuando[v.desde]) > 10 * HORA ? 2 * HORA : HORA;
    var ultima = -Infinity;
    for (var i = v.desde; i <= v.hasta; i++) {
      if (cuando[i] - ultima < salto) { continue; }
      ultima = cuando[i];
      partes.push('<div class="tick" style="left:' + pos(i) + '%"></div>');
      partes.push('<span class="lbl" style="left:' + pos(i) + '%">' +
        esc(marcos[i].label) + '</span>');
    }
    partes.push('<div class="cur" id="aw-cur" style="left:' + pos(indice) + '%"></div>');
    // Los mandos van ENCIMA y la pista sola en su línea, a lo ancho. Estaban
    // los tres en fila, así que la pista era más estrecha que las gráficas de
    // los objetos por lo que ocupaban el botón y la hora, y los dos cursores
    // no caían en la misma vertical aunque midieran lo mismo.
    return '<div class="aw-timeline">' +
      '<div class="mandos">' +
        '<button type="button" class="aw-play" id="aw-play" aria-label="' +
          esc(t.reproducir) + '" title="' + esc(t.reproducir) + '">▶</button>' +
        '<span class="now" id="aw-t-lab">' + esc(marcos[indice].label) + '</span>' +
      '</div>' +
      '<div class="track" id="aw-track" role="slider" tabindex="0" ' +
        'aria-valuemin="' + v.desde + '" aria-valuemax="' + v.hasta +
        '" aria-valuenow="' + indice + '" aria-label="' + esc(t.horaCupula) + '">' +
        partes.join('') + '</div></div>';
  }

  /* Etiquetas que no se pisan. Cuántas horas caben depende del ancho REAL, y
     eso no se sabe cuando se arma el HTML: en el móvil las diez horas de la
     noche salían una encima de otra, «07 22:07 23:07 00:07». Se pintan todas y
     después se apaga la que solape con la anterior, MEDIDO. Las marcas se
     quedan: son de un píxel y no estorban, y sin ellas la escala pierde el
     detalle que la etiqueta ya no da. */
  function aclararEtiquetas(pista) {
    if (!pista) { return; }
    var limites = pista.getBoundingClientRect();
    var primera = pista.querySelector('.lbl');
    // Si la pista no da ni para una etiqueta es que todavía no está pintada, o
    // está dentro de algo oculto: TODAS caen en el mismo punto y esta función
    // las apagaría todas menos una, para siempre, porque nadie la vuelve a
    // llamar. Medir ahí no es medir. El observador de tamaño la repite en
    // cuanto hay ancho de verdad.
    if (!primera || limites.width < primera.getBoundingClientRect().width) { return; }
    var derecha = -Infinity;
    [].slice.call(pista.querySelectorAll('.lbl')).forEach(function (el) {
      el.style.display = '';
      // Centrada sobre su marca, salvo en los extremos: la primera va pegada
      // al borde de la pista, así que centrada se sale por la izquierda y se
      // leía «07» donde ponía 21:07.
      el.style.transform = 'translateX(-50%)';
      var caja = el.getBoundingClientRect();
      if (!caja.width) { return; }
      if (caja.left < limites.left) { el.style.transform = 'translateX(0)'; }
      else if (caja.right > limites.right) { el.style.transform = 'translateX(-100%)'; }
      caja = el.getBoundingClientRect();
      if (caja.left < derecha + 7) { el.style.display = 'none'; }
      else { derecha = caja.right; }
    });
  }

  // ------------------------------------------------- PERFIL POR OBJETO ----
  // Los tonos de "qué lo limita". Bajados de saturación respecto a los de
  // antes: aquí son un fondo, no un aviso, y el aviso ya lo da el veredicto de
  // la cabecera.
  var TINTE_LIMITA = { c: '#c2666b', l: '#c9a052', f: '#c9a052', a: '#8b909e',
                       n: '#5fb478', '-': 'rgba(255,255,255,0.05)' };

  // Cada SVG necesita ids propios para sus degradados: dos objetos en la misma
  // página compartirían la definición y el segundo saldría del color del
  // primero.
  var perfilSeq = 0;

  function perfilSvg(objeto, color, t, v, minAlt, marcos) {
    var alt = objeto.alt || [];
    var desde = v.desde, hasta = Math.min(v.hasta, alt.length - 1);
    if (hasta - desde < 1) { return ''; }
    var W = 100, H = 100, base = perfilY(0);
    // La escala es la de la VENTANA ENTERA, la misma que la línea de tiempo, y
    // no la del tramo que este objeto tenga serie: los dos cursores tienen que
    // caer en la misma vertical. Si la serie se queda corta, la curva termina
    // antes, que es lo honesto; lo que no puede es reescalarse para llenar.
    var frac = escalaTiempo(marcos, v);
    var x = function (i) { return frac(i) * W; };
    // El trozo de eje que representa cada muestra va de la mitad del hueco
    // anterior a la mitad del siguiente. Con la rejilla adaptativa NO son
    // todos iguales: una muestra de crepúsculo vale media hora y una de noche
    // cerrada diez minutos.
    var izq = function (j) { return j <= desde ? x(desde) : (x(j - 1) + x(j)) / 2; };
    var der = function (j) { return j >= hasta ? x(hasta) : (x(j) + x(j + 1)) / 2; };
    var id = 'awp' + (++perfilSeq);

    var puntos = [];
    for (var i = desde; i <= hasta; i++) { puntos.push([x(i), perfilY(alt[i])]); }
    var curva = curvaSuave(puntos);
    // El área bajo la curva, cerrada por el horizonte. Sirve de recorte: los
    // colores de "qué lo limita" van DENTRO, así que el borde de arriba es la
    // curva y no la escalera de barras que había.
    var area = curva + ' L' + x(hasta).toFixed(2) + ' ' + base.toFixed(2) +
               ' L' + x(desde).toFixed(2) + ' ' + base.toFixed(2) + ' Z';

    var franjas = '';
    for (var j = desde; j <= hasta; j++) {
      var codigo = (objeto.limita || '').charAt(j) || '-';
      // Se solapan un pelin. Pegadas justas, el borde compartido cae en un pixel
      // fraccionario y el antialias deja una raya mas clara en cada junta: el
      // relleno salia con una empalizada de lineas verticales de arriba abajo.
      var a = izq(j) - 0.04, b = der(j) + 0.04;
      franjas += '<rect x="' + a.toFixed(2) + '" y="0" width="' +
        (b - a).toFixed(2) + '" height="' + H + '" fill="' +
        TINTE_LIMITA[codigo] + '"/>';
    }

    function hito(i) {
      if (i === null || i === undefined || i < desde || i > hasta) { return ''; }
      return '<line class="hito max" x1="' + x(i).toFixed(2) + '" x2="' + x(i).toFixed(2) +
        '" y1="' + PERFIL_TOP + '" y2="' + base.toFixed(2) +
        '" vector-effect="non-scaling-stroke"/>';
    }

    var rayas = [90, 60, 30, 0].map(function (a) {
      return '<line class="grid" x1="0" x2="' + W + '" y1="' + perfilY(a).toFixed(2) +
        '" y2="' + perfilY(a).toFixed(2) + '"/>';
    }).join('');
    var minimo = (typeof minAlt === 'number')
      ? '<line class="min" x1="0" x2="' + W + '" y1="' + perfilY(minAlt).toFixed(2) +
        '" y2="' + perfilY(minAlt).toFixed(2) + '"/>' : '';

    var hits = '';
    for (var k = desde; k <= hasta; k++) {
      hits += '<rect class="hit" data-i="' + k + '" x="' + izq(k).toFixed(2) +
        '" y="0" width="' + (der(k) - izq(k)).toFixed(2) + '" height="' + H + '"/>';
    }

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img">' +
      '<defs>' +
        '<clipPath id="' + id + 'a" clipPathUnits="userSpaceOnUse">' +
          '<path d="' + area + '"/></clipPath>' +
        // El desvanecido: el color de lo que limita pesa abajo y se disuelve
        // hacia arriba, para que la curva se lea por encima de su propio fondo.
        '<linearGradient id="' + id + 'f" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#fff" stop-opacity="0.07"/>' +
          '<stop offset="1" stop-color="#fff" stop-opacity="0.62"/></linearGradient>' +
        '<mask id="' + id + 'm" maskUnits="userSpaceOnUse" x="0" y="0" width="' + W +
          '" height="' + H + '">' +
          '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="url(#' + id + 'f)"/>' +
        '</mask>' +
        // Y el color del objeto tiñe el área entera, muy flojo, para que cada
        // carril se distinga del de al lado sin depender solo de la línea.
        '<linearGradient id="' + id + 'c" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="' + color + '" stop-opacity="0.22"/>' +
          '<stop offset="1" stop-color="' + color + '" stop-opacity="0.01"/></linearGradient>' +
      '</defs>' +
      rayas + minimo +
      '<g clip-path="url(#' + id + 'a)" mask="url(#' + id + 'm)">' + franjas + '</g>' +
      '<path d="' + area + '" fill="url(#' + id + 'c)"/>' +
      hito(objeto.i_max) +
      '<path d="' + curva + '" fill="none" stroke="' + color +
        '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"' +
        ' vector-effect="non-scaling-stroke"/>' +
      '<line class="cursor" x1="0" x2="0" y1="' + PERFIL_TOP + '" y2="' + base.toFixed(2) +
        '" vector-effect="non-scaling-stroke"/>' + hits + '</svg>';
  }

  /* El eje de alturas va en HTML y no dentro del SVG, y no por gusto: el SVG se
     estira con `preserveAspectRatio="none"` — que es justo lo que le permite
     ocupar el mismo ancho exacto que la línea de tiempo — y ahí dentro
     cualquier texto se estira con él y sale deformado. */
  function ejeHtml() {
    return '<div class="aw-eje" aria-hidden="true">' +
      [90, 60, 30, 0].map(function (a) {
        return '<span style="top:' + perfilY(a).toFixed(2) + '%">' + a + '°</span>';
      }).join('') + '</div>';
  }

  // La etiqueta va FUERA del SVG, en HTML: dentro se estira con
  // `preserveAspectRatio="none"` y el texto sale deformado. Y va ENCIMA de la
  // curva, que es donde no pisa nada.
  function hitosHtml(objeto, marcos, t, v) {
    var i = objeto.i_max;
    if (i === null || i === undefined || i < v.desde || i > v.hasta || !marcos[i]) {
      return '';
    }
    return '<div class="aw-hitos"><span class="hito max" style="left:' +
      (escalaTiempo(marcos, v)(i) * 100).toFixed(2) + '%">' +
      num(objeto.alt[i], 0) + '° · ' + esc(marcos[i].label) + '</span></div>';
  }

  /* Ascension recta y declinacion en el formato que se teclea en una montura:
     horas la primera, grados la segunda. Los decimales van en el `title`, que
     es lo que hace falta para pegar en un plate solve. */
  function sexagesimal(grados, esHora) {
    if (typeof grados !== 'number' || !isFinite(grados)) { return ''; }
    var v = esHora ? ((grados % 360) + 360) % 360 / 15 : Math.abs(grados);
    var a = Math.floor(v);
    var m = Math.floor((v - a) * 60);
    var sg = Math.round((((v - a) * 60) - m) * 60);
    if (sg === 60) { sg = 0; m += 1; }
    if (m === 60) { m = 0; a += 1; }
    var dd = function (x) { return (x < 10 ? '0' : '') + x; };
    return esHora
      ? a + 'h ' + dd(m) + 'm ' + dd(sg) + 's'
      : (grados < 0 ? '−' : '+') + a + '° ' + dd(m) + '′ ' + dd(sg) + '″';
  }

  function coordenadasHtml(objeto, t) {
    if (typeof objeto.ra !== 'number' || typeof objeto.dec !== 'number') { return ''; }
    return '<span class="q coord" title="' + esc(t.coordenadas) + ': ' +
      num(objeto.ra, 4) + '° / ' + num(objeto.dec, 4) + '° (J2000)">' +
      esc(sexagesimal(objeto.ra, true)) + ' · ' +
      esc(sexagesimal(objeto.dec, false)) + '</span>';
  }

  function minimoLuna(objeto) {
    var serie = objeto.sep_luna || [];
    var vivos = serie.filter(function (v) { return typeof v === 'number'; });
    if (!vivos.length) {
      return typeof objeto.separacion_luna === 'number' ? objeto.separacion_luna : null;
    }
    return Math.min.apply(null, vivos);
  }

  function carril(objeto, color, t, marcos, v, minAlt) {
    return '<div class="aw-lane" data-obj="' + esc(objeto.nombre) + '">' +
      '<div class="head">' +
        '<i class="dot" style="background:' + color + '"></i>' +
        '<span class="n">' + esc(objeto.nombre) +
          // La procedencia de la curva, al lado del nombre y plegada: era un
          // párrafo de tres líneas explicando un detalle de fontanería nuestro
          // que al que mira el gráfico no le cambia nada de lo que va a hacer.
          (objeto.sinTraza
            ? '<span class="aw-info izq abajo" tabindex="0">?<span class="aw-pop"><b>' +
              esc(t.sinTrazaTitulo) + '</b>' + esc(t.sinTraza) + '</span></span>'
            : '') + '</span>' +
        // Las coordenadas, para TODOS y no solo para los de fuera: es lo
        // primero que hace falta para apuntar, y tenerlas solo en los que el
        // motor no conoce era justo al reves de lo util.
        coordenadasHtml(objeto, t) +
        // Y qué son esas horas, a un clic. «0,0 h si despeja» sin explicar no
        // dice nada: no son horas de reloj, son horas EQUIVALENTES de una hora
        // de referencia, y el cero es una respuesta y no una casilla vacía.
        (objeto.externo ? ''
          : '<span class="q">' + num(objeto.horas_si_despeja) + ' ' + t.horas + ' ' +
              esc(t.siDespejaCorto) +
              '<span class="aw-info izq abajo" tabindex="0">?<span class="aw-pop"><b>' +
              esc(t.horasQueTitulo) + '</b>' + esc(t.horasQueSon) + '</span></span></span>' +
            '<span class="aw-tag ' + clase(objeto.veredicto) + '">' +
              esc(t.veredicto[objeto.veredicto] || objeto.veredicto) + '</span>') +
        // La separación mínima a la Luna en toda la noche: es la que decide si
        // el objeto es viable con esta fase, y por debajo de 40° el halo manda
        // sobre el encuadre entero en banda ancha.
        (minimoLuna(objeto) !== null
          ? '<span class="q luna' + (minimoLuna(objeto) < 40 ? ' cerca' : '') + '">☾ ' +
            num(minimoLuna(objeto), 0) + '° ' + esc(t.minimo) + '</span>'
          : '') +
        '<button type="button" class="quitar" data-quitar="' + esc(objeto.nombre) +
          '" aria-label="' + esc(t.quitar) + ' ' + esc(objeto.nombre) + '" title="' +
          esc(t.quitar) + '">×</button>' +
      '</div>' +
      hitosHtml(objeto, marcos, t, v) +
      '<div class="aw-profile">' + perfilSvg(objeto, color, t, v, minAlt, marcos) +
        ejeHtml() + '</div>' +
      (objeto.externo ? '<p class="aw-externo">' + esc(t.sinPuntuar) + '</p>' : '') +
      // El porqué del veredicto, que es lo que se ha venido a leer cuando el
      // veredicto es malo: «el cielo no baja de 20.0 mag/arcsec2 esta noche».
      (objeto.porque ? '<p class="aw-porque">' + esc(objeto.porque) + '</p>' : '') +
      '<div class="aw-detail" data-detalle="' + esc(objeto.nombre) + '"></div>' +
    '</div>';
  }

  // ------------------------------------------- OBJETOS DE FUERA -----------
  // El catálogo del motor son 44 objetos curados. Para todo lo demás se
  // resuelve el nombre contra SIMBAD (servicio Sesame del CDS, que admite CORS)
  // o se aceptan coordenadas a mano.
  var SESAME = 'https://cds.unistra.fr/cgi-bin/nph-sesame/-oI/SNV?';

  function resolverNombre(nombre) {
    return fetch(SESAME + encodeURIComponent(nombre))
      .then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); })
      .then(function (txt) {
        // Sesame devuelve texto con una linea "%J <ra> <dec> ..." en grados.
        var m = txt.match(/%J\s+([-+]?\d+\.?\d*)\s+([-+]?\d+\.?\d*)/);
        if (!m) { return null; }
        var oficial = txt.match(/%I\.0\s+(.+)/);
        return { ra: parseFloat(m[1]), dec: parseFloat(m[2]),
                 nombre: (oficial ? oficial[1].trim() : nombre) };
      });
  }

  function leerCoordenadas(texto) {
    var limpio = texto.replace(/[,;]/g, ' ').replace(/[hdms'"°]/gi, ' ').trim();
    var n = limpio.split(/\s+/).map(parseFloat);
    if (n.some(isNaN)) { return null; }
    if (n.length === 2) {                       // grados decimales
      return dentro(n[0], n[1]);
    }
    if (n.length === 6) {                       // sexagesimal: h m s  g m s
      var ra = (Math.abs(n[0]) + n[1] / 60 + n[2] / 3600) * 15;
      var signo = (texto.trim().split(/\s+/)[3] || '').indexOf('-') === 0 ? -1 : 1;
      var dec = signo * (Math.abs(n[3]) + n[4] / 60 + n[5] / 3600);
      return dentro(ra, dec);
    }
    return null;
  }

  function dentro(ra, dec) {
    if (!isFinite(ra) || !isFinite(dec)) { return null; }
    if (dec < -90 || dec > 90) { return null; }
    return { ra: ((ra % 360) + 360) % 360, dec: dec };
  }

  /* Un objeto que el motor no ha puntuado: se le calcula DÓNDE está, que es
     geometría del mismo tiempo sidéreo que ya viaja en el JSON, y nada más. No
     hay horas de SNR ni veredicto, y la ficha lo dice: inventarlos aquí sería
     exactamente lo que esta página no hace. */
  function objetoExterno(nombre, ra, dec, cupula) {
    var alt = [], az = [];
    (cupula.lst || []).forEach(function (lst) {
      var h = window.AWDome.aHorizonte(ra, dec, lst, cupula.site.lat);
      alt.push(Math.round(h[0] * 10) / 10);
      az.push(Math.round(h[1] * 10) / 10);
    });
    var iMax = 0, iMin = null;
    alt.forEach(function (a, i) {
      if (a > alt[iMax]) { iMax = i; }
      // El minimo util es el mas BAJO estando arriba: marcar -4 grados no
      // ayuda a planificar nada, solo dice que el objeto se ha puesto.
      if (a > 0 && (iMin === null || a < alt[iMin])) { iMin = i; }
    });
    var iMer = iMax;
    for (var j = 1; j < az.length; j++) {
      var antes = (az[j - 1] - 180 + 180) % 360 - 180;
      var ahora = (az[j] - 180 + 180) % 360 - 180;
      if (((antes <= 0 && ahora > 0) || (ahora <= 0 && antes > 0))
          && Math.abs(antes) < 90 && Math.abs(ahora) < 90) {
        iMer = Math.abs(ahora) < Math.abs(antes) ? j : j - 1;
        break;
      }
    }
    // Y su separación a la Luna, que es geometría igual que la altura.
    var sep = [];
    (cupula.frames || []).forEach(function (f, i) {
      sep.push(f.moon_alt !== undefined && window.AWDome.separacion
        ? Math.round(window.AWDome.separacion(alt[i], az[i], f.moon_alt, f.moon_az) * 10) / 10
        : null);
    });
    return { nombre: nombre, ra: ra, dec: dec, externo: true, sep_luna: sep,
             tipo: 'externo', clase: 'sin puntuar', alias: [], nota: '',
             alt: alt, az: az, rend: alt.map(function () { return 0; }),
             limita: alt.map(function () { return 'x'; }).join(''),
             horas_si_despeja: null, horas_esperadas: null,
             altura_maxima: alt[iMax], separacion_luna: null,
             mejor_hora: null, veredicto: null, porque: '',
             i_max: iMax, i_min: iMin, i_meridiano: iMer };
  }

  /* Un objeto que el motor SI ha puntuado pero que no viaja con su traza hora
     a hora: los ~940 que quedan por debajo de los 40 mejores. La geometria se
     calcula aqui igual que la de un objeto de fuera -- mismo tiempo sidereo,
     misma cupula -- y encima se le pegan los numeros del motor, que existen.

     La diferencia con `objetoExterno` no es cosmetica: aquel dice "no hay
     veredicto" y este lo tiene. Meterlos a todos por el mismo sitio era
     publicar como desconocido algo que el motor habia calculado y que estaba
     en el mismo fichero. */
  function objetoPuntuado(ficha, cupula) {
    var o = objetoExterno(ficha.nombre, ficha.ra, ficha.dec, cupula);
    o.externo = false;
    o.sinTraza = true;
    o.tipo = ficha.tipo || o.tipo;
    o.clase = ficha.clase || o.clase;
    o.alias = ficha.alias || [];
    o.horas_si_despeja = ficha.horas_si_despeja;
    o.horas_esperadas = ficha.horas_esperadas;
    o.veredicto = ficha.veredicto || null;
    o.porque = ficha.porque || '';
    return o;
  }

  // ------------------------------------------------------------ MONTAJE ---
  function montarBuscador(caja, datos, t, lang) {
    var noche = datos.noches[0];
    var catalogo = noche.objetos || [];
    /* EL UNIVERSO QUE SE PUEDE BUSCAR, y hasta hoy no era el catálogo: era la
       lista de recomendaciones. El motor puntúa ~1.000 objetos cada noche y
       publicaba solo los que sacaban horas, así que un objeto se caía del
       buscador EXACTAMENTE cuando la respuesta era interesante — M31 con Luna
       llena no aparecía, se iba a SIMBAD, y volvía pintado como «el motor NO lo
       ha puntuado». Lo había puntuado: cero, y con el motivo escrito.
       Ahora el JSON trae los ~1.000 con su veredicto y su porqué. */
    var universo = noche.catalogo || noche.ranking || [];
    var marcos = (datos.cupula && datos.cupula.frames) || [];
    var entrada = caja.querySelector('#aw-q');
    var lista = caja.querySelector('#aw-res');
    var destino = caja.querySelector('#aw-chosen');
    if (!entrada) { return; }

    var elegidos = [];          // los objetos en pantalla, en orden de llegada
    var indice = 0;             // el instante que mira la cúpula
    var reproduciendo = null;

    function color(i) { return COLORES[i % COLORES.length]; }

    function pintarResultados() {
      var q = entrada.value.trim().toLowerCase();
      if (!q) { lista.hidden = true; return; }
      var qs = normaliza(q);
      var puestos = elegidos.map(function (o) { return o.nombre; });
      function nombresDe(o) { return [o.nombre].concat(o.alias || []); }
      function coincide(o) {
        if (puestos.indexOf(o.nombre) !== -1) { return false; }
        return nombresDe(o).some(function (a) {
          return String(a).toLowerCase().indexOf(q) !== -1 ||
                 normaliza(a).indexOf(qs) !== -1;
        });
      }
      // Primero los que llevan traza; detras, el resto de lo evaluado.
      var hits = catalogo.filter(coincide);
      var vistos = hits.map(function (o) { return o.nombre; });
      universo.forEach(function (r) {
        if (vistos.indexOf(r.nombre) === -1 && coincide(r)) { hits.push(r); }
      });
      // Con mil objetos detras, quien teclea el nombre EXACTO tiene que verlo
      // el primero: si no, «M31» sale por debajo de cualquier cosa mejor
      // puntuada que lleve «m31» dentro. Empate resuelto por el orden de
      // llegada, que ya viene ordenado por lo que rinde esta noche.
      function precision(o) {
        var nombres = nombresDe(o).map(normaliza);
        if (nombres.indexOf(qs) !== -1) { return 0; }
        if (nombres.some(function (x) { return x.indexOf(qs) === 0; })) { return 1; }
        return 2;
      }
      hits = hits.map(function (o, i) { return [precision(o), i, o]; })
        .sort(function (a, b) { return (a[0] - b[0]) || (a[1] - b[1]); })
        .map(function (par) { return par[2]; })
        .slice(0, 12);
      var html = hits.map(function (o) {
        // Las horas y el veredicto juntos: «0,0 h» a secas se lee como un fallo
        // del buscador, y es una respuesta.
        return '<button type="button" data-n="' + esc(o.nombre) + '">' +
          '<span class="n">' + esc(o.nombre) + '</span>' +
          '<span class="h">' + num(o.horas_si_despeja) + ' ' + t.horas +
          (o.veredicto ? ' <i class="' + clase(o.veredicto) + '">' +
            esc(t.veredicto[o.veredicto] || o.veredicto) + '</i>' : '') +
          '</span></button>';
      }).join('');
      if (!hits.length) { html += '<div class="none">' + esc(t.sinResultados) + '</div>'; }
      // Siempre, no solo cuando no hay resultados: el catálogo son 44 objetos
      // curados y quien busca «Barnard 33» o una supernova de ayer tiene que
      // poder salir fuera sin adivinar que existe la opción.
      html += '<button type="button" class="fuera" data-fuera="1">' +
        esc(t.buscarFuera.replace('%s', entrada.value.trim())) + '</button>' +
        '<div class="pista">' + esc(t.porCoordenadas) + '</div>';
      lista.innerHTML = html;
      lista.hidden = false;
    }

    // La separación a la Luna EN ESE INSTANTE, que es la que cambia: la Luna
    // se mueve y el objeto también. Y con la Luna bajo el horizonte se dice,
    // porque entonces el número es geometría sin consecuencias.
    function sepTexto(objeto, m, i, t) {
      var s2 = (objeto.sep_luna || [])[i];
      if (typeof s2 !== 'number') { return ''; }
      if (!(m.moon_alt > 0)) {
        return ' · ' + esc(t.lunaAbajo);
      }
      return ' · ☾ ' + num(s2, 0) + '°' +
        (s2 < 40 ? ' (' + esc(t.lunaCerca) + ')' : '');
    }

    function detalleDe(objeto, i) {
      var m = marcos[i];
      if (!m) { return ''; }
      var a = (objeto.alt || [])[i], codigo = (objeto.limita || '').charAt(i) || '-';
      if (a === undefined) { return ''; }
      if (a < 0) {
        return '<b>' + esc(m.label) + '</b> ' + esc(t.bajoHorizonte) +
          ' (' + num(a, 0) + '°).';
      }
      if (codigo === '-') {
        // Dos causas distintas que decian lo mismo. A las 21:09 el objeto
        // estaba a 12 grados Y todavia no era de noche, y el mensaje solo
        // hablaba de la altura: quien lo leia no podia saber si esperando
        // mejoraba o no.
        var deDia = m.sky_mag_trustworthy === false;
        var claro = !m.dark;
        if (deDia) {
          return '<b>' + esc(m.label) + '</b> ' + esc(t.esDeDia) +
            ' (' + esc(t.solA) + ' ' + num(m.sun_alt, 0) + '°), ' +
            esc(t.yAdemas) + ' ' + num(a, 0) + '°.';
        }
        if (claro) {
          return '<b>' + esc(m.label) + '</b> ' + num(a, 0) + '°: ' +
            esc(t.bajoMinimo) + ', ' + esc(t.yTampocoNoche) +
            ' (' + esc(t.solA) + ' ' + num(m.sun_alt, 0) + '°).';
        }
        return '<b>' + esc(m.label) + '</b> ' + num(a, 0) + '°: ' +
          esc(t.bajoMinimo) + '.';
      }
      var cielo = (m.sky_mag !== undefined && m.sky_mag !== null)
        ? ' · ' + esc(t.cieloAhora) + ' ' + num(m.sky_mag, 1) : '';
      // Sin traza no hay rendimiento por instante NI que lo limita, y decir
      // "rinde 0 %, limita sin puntuar" era rellenar el hueco con un cero
      // inventado: el motor no ha calculado ese numero para este objeto.
      if (codigo === 'x') {
        return '<b>' + esc(m.label) + '</b> ' + esc(t.altura) + ' ' + num(a, 0) + '°' +
          cielo + sepTexto(objeto, m, i, t) + '.';
      }
      return '<b>' + esc(m.label) + '</b> ' + esc(t.altura) + ' ' + num(a, 0) + '°, ' +
        esc(t.rinde) + ' ' + num(((objeto.rend || [])[i] || 0) * 100, 0) + ' %, ' +
        esc(t.limitaPor) + ' ' + esc((t.limita && t.limita[codigo]) || codigo) +
        cielo + sepTexto(objeto, m, i, t) + '.';
    }

    var ventana = ventanaNoche(marcos);
    var fraccion = escalaTiempo(marcos, ventana);
    indice = Math.max(ventana.desde, Math.min(ventana.hasta, indice));

    // Solo mueve el cursor y repinta: no reconstruye el HTML, que es lo que
    // haría perder el foco y el scroll cada vez que corre la animación.
    function irA(i) {
      // Se clava a la ventana pintada. Fuera de ella el cursor se salia del
      // dibujo y seguia moviendose sin que se viera, que es peor que no
      // moverse.
      indice = Math.max(ventana.desde, Math.min(ventana.hasta, i));
      var etiqueta = destino.querySelector('#aw-t-lab');
      var cursor = destino.querySelector('#aw-cur');
      var pista = destino.querySelector('#aw-track');
      if (etiqueta && marcos[indice]) { etiqueta.textContent = marcos[indice].label; }
      var pct = fraccion(indice) * 100;
      if (cursor) { cursor.style.left = pct + '%'; }
      if (pista) { pista.setAttribute('aria-valuenow', indice); }
      destino.querySelectorAll('.aw-profile .cursor').forEach(function (linea) {
        // La MISMA fraccion que el cursor de arriba. Antes llevaba un margen de
        // 4 unidades que el SVG habia dejado de tener, asi que el cursor del
        // perfil no caia sobre su propia curva: se iba un 4 % a la derecha al
        // principio de la noche y convergia hacia el final.
        var xx = pct;
        linea.setAttribute('x1', xx); linea.setAttribute('x2', xx);
      });
      elegidos.forEach(function (o) {
        var caja2 = destino.querySelector('[data-detalle="' + o.nombre.replace(/"/g, '') + '"]');
        if (caja2) { caja2.innerHTML = detalleDe(o, indice); }
      });
      pintarCupula(destino, datos, elegidos, indice, t);
    }

    function repintarTodo() {
      if (!elegidos.length) {
        destino.innerHTML = '<div class="aw-hint">' + esc(t.pista) + '</div>';
        return;
      }
      destino.innerHTML =
        '<div class="aw-chosen">' +
          '<div class="aw-dome-wrap">' +
            '<div class="aw-dome-stack">' +
              '<canvas class="aw-dome" id="aw-sky"></canvas>' +
              '<canvas class="aw-dome" id="aw-over"></canvas>' +
            '</div>' +
          '</div>' +
          '<div class="aw-side">' + bloqueClave(datos.cupula, t) + '</div>' +
        '</div>' +
        bloqueTiempo(marcos, indice, t, ventana) +
        '<div class="aw-lanes">' +
          elegidos.map(function (o, i) {
            return carril(o, color(i), t, marcos, ventana,
                          datos.cupula && datos.cupula.min_altitude);
          }).join('') +
        '</div>';

      var pila = destino.querySelector('.aw-dome-stack');
      if (window.ResizeObserver && pila) {
        new ResizeObserver(function () {
          if (pila.clientWidth > 0) {
            irA(indice);
            aclararEtiquetas(destino.querySelector('#aw-track'));
          }
        }).observe(pila);
      }
      setTimeout(function () {
        irA(indice);
        aclararEtiquetas(destino.querySelector('#aw-track'));
      }, 60);
      if (window.AWDome && !window.AWDome.listaViaLactea()) {
        window.AWDome.pendiente.push(function () { irA(indice); });
      }
    }

    // Un nombre puede venir de tres sitios: de los 40 con traza, del catálogo de
    // la noche (que lleva coordenadas y veredicto, pero no traza) o de fuera.
    // Se resuelve aqui una vez en vez de en cada sitio que anade.
    function anadirPorNombre(nombre) {
      var conTraza = catalogo.filter(function (o) { return o.nombre === nombre; })[0];
      if (conTraza) { return anadir(conTraza); }
      var puntuado = universo.filter(function (r) { return r.nombre === nombre; })[0];
      if (puntuado) { return anadir(objetoPuntuado(puntuado, datos.cupula)); }
    }

    function anadir(objeto) {
      if (elegidos.length >= MAX_OBJETOS) { elegidos.shift(); }
      elegidos.push(objeto);
      // Se abre en el mejor momento del PRIMER objeto que entra; después no se
      // mueve solo, que sería quitarle el sitio a quien estaba mirando algo.
      if (elegidos.length === 1 && objeto.mejor_hora && marcos.length) {
        var objetivo = new Date(objeto.mejor_hora).getTime(), dist = Infinity;
        marcos.forEach(function (m, i) {
          var d = Math.abs(new Date(m.t).getTime() - objetivo);
          if (d < dist) { dist = d; indice = i; }
        });
      }
      entrada.value = '';
      lista.hidden = true;
      repintarTodo();
    }

    function quitar(nombre) {
      elegidos = elegidos.filter(function (o) { return o.nombre !== nombre; });
      repintarTodo();
    }

    // El desplegable: lo que el motor ha puntuado como mejor ESTA NOCHE sobre el
    // catalogo entero, no una lista de favoritos. Agrupado por clase, que es lo
    // que decide con que se saca.
    // El desplegable sigue siendo de RECOMENDADOS: el catálogo entero incluye
    // ahora lo que puntúa cero, y una lista de mil con ochocientos ceros no
    // recomienda nada. Lo que puntúa cero se encuentra buscándolo, que es
    // cuando alguien pregunta por él.
    var ranking = universo.filter(function (r) {
      return r.horas_si_despeja > 0;
    }).slice(0, 150);
    var reco = caja.querySelector('#aw-reco');
    if (reco) {
      var grupos = {};
      ranking.forEach(function (r) { (grupos[r.clase] = grupos[r.clase] || []).push(r); });
      var html = '<option value="">' + esc(t.recoTitulo) +
        (noche.catalogo_evaluado
          ? ' (' + noche.catalogo_evaluado + ' ' + esc(t.evaluados) + ')' : '') +
        '</option>';
      Object.keys(grupos).forEach(function (clase) {
        html += '<optgroup label="' + esc(t.clases[clase] || clase) + '">';
        grupos[clase].forEach(function (r) {
          html += '<option value="' + esc(r.nombre) + '">' + esc(r.nombre) +
            ' \u2014 ' + num(r.horas_si_despeja) + ' ' + t.horas + ' \u00b7 ' +
            esc(t.alt) + ' ' + num(r.altura_maxima, 0) + '\u00b0 \u00b7 \u263e ' +
            num(r.separacion_luna, 0) + '\u00b0</option>';
        });
        html += '</optgroup>';
      });
      reco.innerHTML = html;
      reco.addEventListener('change', function () {
        var elegido = ranking.filter(function (r) { return r.nombre === reco.value; })[0];
        reco.value = '';
        if (elegido) { anadirPorNombre(elegido.nombre); }
      });
    }

    entrada.addEventListener('input', pintarResultados);
    entrada.addEventListener('focus', pintarResultados);
    function avisoEnLista(texto) {
      lista.innerHTML = '<div class="none">' + esc(texto) + '</div>';
      lista.hidden = false;
    }

    function buscarFuera() {
      var texto = entrada.value.trim();
      if (!texto) { return; }
      // Primero coordenadas: si lo que hay escrito ya ES una posición, no hace
      // falta molestar a SIMBAD ni depender de que responda.
      var coords = leerCoordenadas(texto);
      if (coords) {
        return anadir(objetoExterno(texto, coords.ra, coords.dec, datos.cupula));
      }
      avisoEnLista(t.resolviendo);
      resolverNombre(texto).then(function (r) {
        if (!r) { return avisoEnLista(t.noResuelto); }
        anadir(objetoExterno(r.nombre, r.ra, r.dec, datos.cupula));
      }).catch(function () { avisoEnLista(t.noResuelto); });
    }

    lista.addEventListener('click', function (e) {
      var boton = e.target.closest('button[data-n]');
      if (boton) { return anadirPorNombre(boton.getAttribute('data-n')); }
      if (e.target.closest('button[data-fuera]')) { buscarFuera(); }
    });
    entrada.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') { return; }
      e.preventDefault();
      var primero = lista.querySelector('button[data-n]');
      if (primero) { anadirPorNombre(primero.getAttribute('data-n')); }
      else { buscarFuera(); }
    });
    document.addEventListener('click', function (e) {
      if (!caja.querySelector('.aw-search').contains(e.target)) { lista.hidden = true; }
    });

    destino.addEventListener('click', function (e) {
      var fuera = e.target.closest('button[data-quitar]');
      if (fuera) { return quitar(fuera.getAttribute('data-quitar')); }
      var celda = e.target.closest('rect.hit');
      if (celda) { return irA(parseInt(celda.getAttribute('data-i'), 10)); }
      var boton = e.target.closest('#aw-play');
      if (boton) {
        if (reproduciendo) {
          clearInterval(reproduciendo); reproduciendo = null;
          boton.textContent = '▶'; boton.title = t.reproducir;
        } else {
          boton.textContent = '❚❚'; boton.title = t.pausar;
          reproduciendo = setInterval(function () {
            irA(indice >= ventana.hasta ? ventana.desde : indice + 1);
          }, 550);
        }
        return;
      }
      var pista = e.target.closest('#aw-track');
      if (pista) {
        // De donde se ha pinchado al marco MAS CERCANO en la misma escala en
        // que esta pintado. Con la regla vieja -- repartir por indice -- un
        // clic en mitad de la noche caia en otra hora distinta de la que
        // marcaba el dedo, y cuanto mas adaptativa la rejilla, mas lejos.
        var caja2 = pista.getBoundingClientRect();
        var objetivo = (e.clientX - caja2.left) / caja2.width;
        var cerca = ventana.desde, dist = Infinity;
        for (var q2 = ventana.desde; q2 <= ventana.hasta; q2++) {
          var d2 = Math.abs(fraccion(q2) - objetivo);
          if (d2 < dist) { dist = d2; cerca = q2; }
        }
        irA(cerca);
      }
    });
    destino.addEventListener('keydown', function (e) {
      if (!e.target.closest('#aw-track')) { return; }
      if (e.key === 'ArrowRight') { irA(indice + 1); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { irA(indice - 1); e.preventDefault(); }
    });
  }

  function render(datos, t, lang) {
    var noche = datos.noches && datos.noches[0];
    if (!noche) { return '<div class="aw-state">' + esc(t.error) + '</div>'; }

    // Mañana va en la cabecera, pequeño y a la derecha: es contexto de la
    // decisión de hoy -- si hoy no sale, ¿espero a mañana? -- y al final de la
    // página llegaba cuando ya la habías tomado.
    var siguiente = datos.noches[1];
    var manana = '';
    if (siguiente && typeof siguiente.probabilidad_de_abrir === 'number') {
      // Mismo trato que hoy: primero la palabra, y el porcentaje debajo en
      // pequeño. Que la de mañana se lea igual que la de hoy es la mitad de su
      // utilidad: se está comparando una con otra.
      var vm = siguiente.veredicto_abrir;
      var pm = Math.round(siguiente.probabilidad_de_abrir * 100);
      manana = '<span class="aw-manana"><span class="d">' + esc(t.manana) + '</span>' +
        '<span class="v">' +
          '<b' + (vm ? ' class="' + (vm.abierto ? 'abierto' : 'cerrado') + '"' : '') + '>' +
            (vm ? esc(vm.abierto ? t.abierto : t.cerrado) : pm + '%') + '</b>' +
          '<span class="p">' + (vm ? pm + '% · ' : '') +
            fecha(siguiente.noche, lang) + '</span>' +
        '</span></span>';
    }
    var html = '<div class="aw-head"><h2>' + t.titulo + '</h2>' +
      '<span class="aw-site">' + esc(t.sitio) + manana + '</span></div>' +
      '<div class="aw-body">';
    // El orden importa: primero como esta la noche, luego lo que dicen los
    // sensores AHORA -- que es lo que confirma o desmiente la prevision -- y
    // solo despues el plan, que se decide con las dos cosas delante.
    html += bloqueResumen(noche, t, lang);
    html += bloqueSensores(datos, t);
    html += bloqueConsejos(noche, t);
    html += bloqueElegir(t);

    html += '<div class="aw-foot">' + t.pie;
    if (datos.generado_utc) {
      html += '<br>' + esc(t.generado) + ': ' +
        esc(String(datos.generado_utc).replace('T', ' ').slice(0, 16)) + ' UTC.';
    }
    return html + '</div></div>';
  }

  function arrancar() {
    var caja = document.getElementById('astroweather');
    if (!caja) { return; }
    // La panorámica de la Vía Láctea (ESO / Serge Brunier, CC BY 4.0) tarda en
    // decodificarse. Hasta que llega, la cúpula dibuja el perfil medido liso,
    // que es exactamente lo que dibujaba antes de tenerla.
    if (window.AWDome && !window.AWDome.listaViaLactea()) {
      window.AWDome.cargarViaLactea('img/astroweather-milkyway.png');
    }
    var lang = caja.getAttribute('data-lang') === 'en' ? 'en' : 'es';
    var t = T[lang];
    caja.innerHTML = '<div class="aw-state">' + esc(t.cargando) + '</div>';

    // Marca de tiempo redondeada a cinco minutos: la URL se mantiene estable
    // dentro de esa ventana -- así sigue siendo cacheable y no se castiga al
    // CDN -- y pasada la ventana el visitante no puede quedarse con una
    // previsión vieja pegada en su navegador. `cache: 'no-cache'` solo no
    // bastaba: revalida contra un borde que a su vez tiene su propia copia.
    fetch(URL_NOCHE + '?t=' + Math.floor(Date.now() / 300000), { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) { throw new Error('HTTP ' + r.status); }
        return r.json();
      })
      .then(function (datos) {
        caja.innerHTML = render(datos, t, lang);
        if (datos.noches && datos.noches[0]) { montarBuscador(caja, datos, t, lang); }
      })
      .catch(function (e) {
        caja.innerHTML = '<div class="aw-state">' + esc(t.error) + '</div>';
        if (window.console) { console.warn('[astroweather]', e); }
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arrancar);
  } else {
    arrancar();
  }
})();
