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
    'Proyecto personal en desarrollo, no un servicio meteorológico: <strong>no lo uses para decisiones de seguridad</strong>.';

  var PIE_EN = 'Forecast from the CabraSpace engine, computed for AstroCamp (Nerpio, Spain). Every number carries its provenance inside the ' +
    '<a href="' + URL_NOCHE + '" target="_blank" rel="noopener">public JSON</a> (' +
    '<a href="' + REPO + '" target="_blank" rel="noopener">repository</a>), rewritten every 6 h. ' +
    'A personal project under development, not a weather service: <strong>do not use it for safety decisions</strong>.';

  var T = {
    es: {
      cargando: 'Consultando la previsión…',
      error: 'No se ha podido leer la previsión ahora mismo. Se actualiza cada 6 horas; vuelve a intentarlo en un rato.',
      titulo: 'Nerpio, <span>esta noche</span>',
      sitio: 'AstroCamp · Nerpio (Albacete) · 1.650 m · MPC I79',
      probLabel: 'de probabilidad de que la noche sea utilizable',
      horasUtiles: 'horas utilizables esperadas',
      noche: 'Noche del', luna: 'Luna', oscuridad: 'Oscuridad astronómica',
      cielo: 'Cielo más oscuro', seeing: 'Seeing', transparencia: 'Transparencia',
      iluminada: 'iluminada', sinCalibrar: 'estimación sin calibrar',
      horas: 'h', magArc: 'mag/arcsec²',
      consejos: 'Qué hacer esta noche',
      adquisicion: 'Por filtro y técnica', familias: 'Por familia de objeto',
      otros: 'Y además',
      perfil: 'Altura sobre el horizonte durante la noche',
      pulsaPerfil: 'Pulsa en el gráfico para ver qué pasa a esa hora.',
      aEsaHora: 'A las', altura: 'altura', rinde: 'rendimiento',
      limitaPor: 'limita', bajoHorizonte: 'bajo el horizonte',
      bajoMinimo: 'demasiado bajo para observar', cieloAhora: 'cielo',
      limita: { c: 'el cielo', l: 'la Luna', f: 'el fondo', a: 'la altura',
                n: 'nada', '-': 'la altura' },
      sensores: 'Ahora mismo en Nerpio',
      sinSensores: 'Los sensores del sitio no responden en este momento.',
      temp: 'Temperatura', humedad: 'Humedad', rocio: 'Margen de rocío',
      viento: 'Viento', presion: 'Presión', cieloIR: 'Cielo (IR)',
      indice: 'Índice de nubes', techos: 'Techos abiertos', seguridad: 'Estado',
      medidoHace: 'Medido hace', minutos: 'min', viejo: 'lectura antigua',
      elegir: 'Qué quieres apuntar',
      buscar: 'Busca un objeto: M31, Velo, NGC 7000…',
      sinResultados: 'Ningún objeto del catálogo coincide.',
      pista: 'Escribe el nombre de un objeto para ver su recorrido sobre la cúpula de esta noche y qué condiciones le tocan.',
      recorrido: 'Recorrido sobre la cúpula',
      horaCupula: 'Hora', maxAlt: 'Altura máxima', sepLuna: 'Separación a la Luna',
      mejorHora: 'Mejor momento', sobreMin: 'Horas sobre el mínimo',
      siDespeja: 'h si despeja', esperadas: 'h esperadas',
      manana: 'Mañana', pie: PIE_ES, generado: 'Generado',
      notaViento: 'La puerta de viento no está calibrada y el modelo se queda corto: trata el veredicto de abrir como optimista en viento.',
      tercil: { favorable: 'favorable', normal: 'normal', desfavorable: 'desfavorable' },
      veredicto: { recomendado: 'recomendado', posible: 'posible',
                   'poco rentable': 'poco rentable', 'no observable': 'no observable' },
      severidad: { evitar: 'evitar', aprovecha: 'aprovecha', cuidado: 'cuidado' },
      reproducir: 'Reproducir la noche', pausar: 'Pausar',
      quitar: 'Quitar', siDespejaCorto: 'si despeja',
      clave: 'Qué color es qué cielo',
      claveNota: 'Sin ciudad debajo, la nube OSCURECE: se traga el airglow en vez de reflejar farolas. Por eso las tres muestras sin Luna se parecen tanto — medido aquí sobre 4.690 horas. El número es la magnitud por segundo de arco al cuadrado.',
      muestras: {
        sinLunaDespejado: 'Sin Luna, despejado', sinLunaMedia: 'Sin Luna, media nube',
        sinLunaCubierto: 'Sin Luna, cubierto', llenaDespejado: 'Luna llena, despejado',
        llenaMedia: 'Luna llena, media nube', llenaCubierto: 'Luna llena, cubierto',
        calima: 'Calima, sin Luna', crepusculo: 'Crepúsculo náutico'
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
      probLabel: 'probability that the night will be usable',
      horasUtiles: 'expected usable hours',
      noche: 'Night of', luna: 'Moon', oscuridad: 'Astronomical darkness',
      cielo: 'Darkest sky', seeing: 'Seeing', transparencia: 'Transparency',
      iluminada: 'illuminated', sinCalibrar: 'uncalibrated estimate',
      horas: 'h', magArc: 'mag/arcsec²',
      consejos: 'What to do tonight',
      adquisicion: 'By filter and technique', familias: 'By object family',
      otros: 'And also',
      perfil: 'Altitude above the horizon through the night',
      pulsaPerfil: 'Click the chart to see what happens at that hour.',
      aEsaHora: 'At', altura: 'altitude', rinde: 'yield',
      limitaPor: 'limited by', bajoHorizonte: 'below the horizon',
      bajoMinimo: 'too low to observe', cieloAhora: 'sky',
      limita: { c: 'the sky', l: 'the Moon', f: 'the background', a: 'altitude',
                n: 'nothing', '-': 'altitude' },
      sensores: 'Right now at Nerpio',
      sinSensores: 'The site sensors are not responding at the moment.',
      temp: 'Temperature', humedad: 'Humidity', rocio: 'Dew margin',
      viento: 'Wind', presion: 'Pressure', cieloIR: 'Sky (IR)',
      indice: 'Cloud index', techos: 'Roofs open', seguridad: 'Status',
      medidoHace: 'Measured', minutos: 'min ago', viejo: 'stale reading',
      elegir: 'What do you want to shoot',
      buscar: 'Search an object: M31, Veil, NGC 7000…',
      sinResultados: 'No catalogue object matches.',
      pista: 'Type an object name to see its path across tonight’s dome and the conditions it gets.',
      recorrido: 'Path across the dome',
      horaCupula: 'Time', maxAlt: 'Peak altitude', sepLuna: 'Moon separation',
      mejorHora: 'Best moment', sobreMin: 'Hours above minimum',
      siDespeja: 'h if it clears', esperadas: 'h expected',
      manana: 'Tomorrow', pie: PIE_EN, generado: 'Generated',
      notaViento: 'The wind gate is uncalibrated and the model runs low: treat the open/close verdict as optimistic on wind.',
      tercil: { favorable: 'favourable', normal: 'typical', desfavorable: 'poor' },
      veredicto: { recomendado: 'recommended', posible: 'possible',
                   'poco rentable': 'low yield', 'no observable': 'not observable' },
      severidad: { evitar: 'avoid', aprovecha: 'make the most of it', cuidado: 'watch out' },
      reproducir: 'Play the night', pausar: 'Pause',
      quitar: 'Remove', siDespejaCorto: 'if it clears',
      clave: 'Which colour is which sky',
      claveNota: 'With no city below, cloud DARKENS the sky: it swallows the airglow instead of reflecting streetlights. That is why the three moonless swatches look so alike — measured here over 4,690 hours. The number is the magnitude per square arcsecond.',
      muestras: {
        sinLunaDespejado: 'No Moon, clear', sinLunaMedia: 'No Moon, half cloud',
        sinLunaCubierto: 'No Moon, overcast', llenaDespejado: 'Full Moon, clear',
        llenaMedia: 'Full Moon, half cloud', llenaCubierto: 'Full Moon, overcast',
        calima: 'Dust haze, no Moon', crepusculo: 'Nautical twilight'
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

  function celda(clave, valor, nota) {
    if (valor === null || valor === undefined) { return ''; }
    return '<div class="aw-cell"><span class="k">' + esc(clave) + '</span>' +
      '<span class="v">' + valor + '</span>' +
      (nota ? '<span class="n">' + esc(nota) + '</span>' : '') + '</div>';
  }

  function sensor(clave, valor, unidad, estado) {
    if (valor === null || valor === undefined) { return ''; }
    return '<div class="aw-sensor ' + (estado || '') + '"><span class="k">' + esc(clave) +
      '</span><span class="v">' + esc(valor) + (unidad ? ' ' + esc(unidad) : '') + '</span></div>';
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

  // ------------------------------------------- PERFIL DE ALTURA -----------
  // El grafico por objeto: la altura durante toda la noche, coloreada por lo
  // que la limita en cada momento. Es la vista que responde "cuando lo
  // apunto", que la cupula sola no contesta.
  function perfilSvg(objeto, marcos) {
    var alt = objeto.alt || [], n = alt.length;
    if (!n) { return ''; }
    var W = 100, H = 100, pad = 4;
    var x = function (i) { return pad + i * (W - 2 * pad) / Math.max(1, n - 1); };
    var y = function (a) { return H - pad - Math.max(0, Math.min(90, a)) / 90 * (H - 2 * pad); };
    var color = { c: '#d15f5f', l: '#d8a53c', f: '#d8a53c', a: '#8a8a92',
                  n: '#6ec177', '-': 'rgba(255,255,255,0.12)' };

    var barras = '';
    for (var i = 0; i < n; i++) {
      var codigo = (objeto.limita || '').charAt(i) || '-';
      var ancho = (W - 2 * pad) / n;
      if (alt[i] > 0) {
        barras += '<rect x="' + (x(i) - ancho / 2).toFixed(2) + '" y="' + y(alt[i]).toFixed(2) +
          '" width="' + ancho.toFixed(2) + '" height="' + (H - pad - y(alt[i])).toFixed(2) +
          '" fill="' + color[codigo] + '" opacity="' +
          (codigo === 'n' ? 0.5 : 0.28) + '"/>';
      }
    }
    var linea = alt.map(function (a, i) {
      return (i ? 'L' : 'M') + x(i).toFixed(2) + ' ' + y(a).toFixed(2);
    }).join(' ');

    return '<div class="aw-profile"><svg viewBox="0 0 ' + W + ' ' + H +
      '" preserveAspectRatio="none" role="img">' +
      '<line class="grid" x1="' + pad + '" x2="' + (W - pad) + '" y1="' + y(0) + '" y2="' + y(0) + '"/>' +
      '<line class="min" x1="' + pad + '" x2="' + (W - pad) + '" y1="' + y(30) + '" y2="' + y(30) + '"/>' +
      '<line class="grid" x1="' + pad + '" x2="' + (W - pad) + '" y1="' + y(60) + '" y2="' + y(60) + '"/>' +
      barras +
      '<path d="' + linea + '" fill="none" stroke="#cfab4a" stroke-width="1.2" vector-effect="non-scaling-stroke"/>' +
      '<line class="cursor" id="aw-p-cursor" x1="0" x2="0" y1="' + pad + '" y2="' + (H - pad) + '" vector-effect="non-scaling-stroke"/>' +
      alt.map(function (a, i) {
        return '<rect class="hit" data-i="' + i + '" x="' + (x(i) - (W - 2 * pad) / n / 2).toFixed(2) +
          '" y="0" width="' + ((W - 2 * pad) / n).toFixed(2) + '" height="' + H + '"/>';
      }).join('') +
      '</svg></div>';
  }

  // ------------------------------------------------------------ BLOQUES ----  // ------------------------------------------------------------ BLOQUES ----
  function bloqueResumen(noche, t, lang) {
    var p = noche.probabilidad_de_abrir;
    var cielo = noche.cielo || {};
    var seeing = cielo.seeing || {};
    var transp = cielo.transparencia || {};
    var html = '<div class="aw-headline">';
    if (typeof p === 'number') {
      html += '<div class="aw-prob">' + Math.round(p * 100) + '%</div>' +
        '<div class="aw-prob-label">' + esc(t.probLabel) + '</div>';
    }
    html += '<div class="aw-when">' + esc(t.noche) + ' <strong>' + fecha(noche.noche, lang) + '</strong>';
    if (num(noche.horas_utilizables_esperadas) !== null) {
      html += '<br>' + num(noche.horas_utilizables_esperadas) + ' ' + esc(t.horasUtiles);
    }
    html += '</div></div><div class="aw-grid">';
    if (typeof noche.luna_iluminacion === 'number') {
      html += celda(t.luna, Math.round(noche.luna_iluminacion * 100) + '%', t.iluminada);
    }
    if (num(noche.oscuridad_astronomica_h) !== null) {
      html += celda(t.oscuridad, num(noche.oscuridad_astronomica_h) + ' ' + t.horas);
    }
    if (num(cielo.mag_cenit_mas_oscuro, 2) !== null) {
      html += celda(t.cielo, num(cielo.mag_cenit_mas_oscuro, 2), t.magArc);
    }
    if (seeing.tercil) {
      html += celda(t.seeing, esc(t.tercil[seeing.tercil] || seeing.tercil),
        seeing.calibrado === false ? t.sinCalibrar : null);
    }
    if (transp.veredicto) {
      html += celda(t.transparencia, esc(traducirTransparencia(transp.veredicto, t)),
        transp.origen ? 'AOD ' + num(transp.aod, 3) + ' · ' + transp.origen : null);
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

  function filaSemaforos(etiqueta, filas) {
    if (!filas || !filas.length) { return ''; }
    return '<div class="aw-lane-row"><span class="lbl">' + esc(etiqueta) + '</span>' +
      '<div class="aw-lights">' + filas.map(semaforo).join('') + '</div></div>';
  }

  function bloqueConsejos(noche, t) {
    var c = noche.consejos;
    if (!c || !c.adquisicion) { return ''; }
    return '<div class="aw-plan"><h3>' + esc(t.consejos) + '</h3>' +
      (c.resumen ? '<p class="aw-headline-tip">' + esc(c.resumen) + '</p>' : '') +
      filaSemaforos(t.adquisicion, c.adquisicion) +
      filaSemaforos(t.familias, c.objetos) +
      filaSemaforos(t.otros, c.avisos) + '</div>';
  }

  function bloqueSensores(datos, t) {
    var s = datos.sensores;
    var html = '<div class="aw-sensors"><h3>' + esc(t.sensores) + '</h3>';
    if (!s) { return html + '<div class="aw-stale">' + esc(t.sinSensores) + '</div></div>'; }

    html += '<div class="aw-sensor-grid">';
    html += sensor(t.temp, num(s.temperatura), '°C');
    html += sensor(t.humedad, num(s.humedad, 0), '%', s.humedad > 85 ? 'alert' : '');
    html += sensor(t.rocio, num(s.margen_rocio), '°C',
      s.riesgo_rocio === 'crítico' ? 'alert' : (s.riesgo_rocio === 'bajo' ? 'good' : ''));
    html += sensor(t.viento, num(s.viento_ms * 3.6, 0), 'km/h', s.viento_ms >= 5.5 ? 'alert' : '');
    html += sensor(t.presion, num(s.presion, 0), 'hPa');
    html += sensor(t.cieloIR, num(s.cielo_ir), '°C', s.cielo_despejado === true ? 'good' : '');
    html += sensor(t.indice, num(s.cielo_indice));
    if (s.techos_total) {
      html += sensor(t.techos, s.techos_abiertos + '/' + s.techos_total, '',
        s.techos_abiertos > 0 ? 'good' : '');
    }
    html += sensor(t.seguridad, s.estado_seguridad, '', s.estado_seguridad === 'Safe' ? 'good' : 'alert');
    html += '</div>';

    if (s.antiguedad_min !== null && s.antiguedad_min !== undefined) {
      html += '<div class="aw-stale">' + esc(t.medidoHace) + ' ' +
        num(s.antiguedad_min, 0) + ' ' + esc(t.minutos) +
        (s.fresco === false ? ' · ' + esc(t.viejo) : '') + '.</div>';
    }
    // La puerta de viento se ha medido optimista y eso alimenta una decisión
    // de seguridad: baja aquí, junto al viento, en vez de desaparecer.
    html += '<div class="aw-warnings" style="margin-top:12px"><li style="list-style:none;margin-left:0">' +
      esc(t.notaViento) + '</li></div>';
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
      '<div class="aw-search">' +
      '<input type="search" id="aw-q" autocomplete="off" placeholder="' + esc(t.buscar) + '">' +
      '<div class="aw-results" id="aw-res" hidden></div></div>' +
      '<div id="aw-chosen"><div class="aw-hint">' + esc(t.pista) + '</div></div></div>';
  }

  // ------------------------------------------------ CLAVE DE COLOR --------
  function bloqueClave(cupula, t) {
    if (!window.AWDome || !window.AWDome.muestras) { return ''; }
    var filas;
    try { filas = window.AWDome.muestras(cupula); } catch (e) { return ''; }
    return '<div class="aw-key"><span class="lbl">' + esc(t.clave) +
      ' · ' + window.AWDome.muestraAltitud + '°</span>' +
      filas.map(function (f) {
        return '<div class="sw">' +
          '<i style="background:rgb(' + f.rgb.join(',') + ')"></i>' +
          '<span>' + esc(t.muestras[f.clave] || f.clave) + '</span>' +
          '<b>' + f.mag.toFixed(1) + '</b></div>';
      }).join('') +
      '<p class="nota">' + esc(t.claveNota) + '</p></div>';
  }

  // -------------------------------------------------- LÍNEA DE TIEMPO -----
  // Una barra con la oscuridad astronómica marcada, no un control deslizante
  // pelado: lo que se quiere ver de un vistazo es CUÁNTO de la noche es noche
  // de verdad y dónde estás dentro de ella.
  function bloqueTiempo(marcos, indice, t) {
    var n = marcos.length;
    if (!n) { return ''; }
    var partes = [], inicio = null;
    marcos.forEach(function (f, i) {
      if (f.dark && inicio === null) { inicio = i; }
      if ((!f.dark || i === n - 1) && inicio !== null) {
        var fin = f.dark ? i : i - 1;
        partes.push('<div class="dark" style="left:' + (inicio / (n - 1) * 100) +
          '%;width:' + ((fin - inicio) / (n - 1) * 100) + '%"></div>');
        inicio = null;
      }
    });
    marcos.forEach(function (f, i) {
      if (i % 6) { return; }
      partes.push('<div class="tick" style="left:' + (i / (n - 1) * 100) + '%"></div>');
      partes.push('<span class="lbl" style="left:' + (i / (n - 1) * 100) + '%">' +
        esc(f.label) + '</span>');
    });
    partes.push('<div class="cur" id="aw-cur" style="left:' +
      (indice / (n - 1) * 100) + '%"></div>');
    return '<div class="aw-timeline">' +
      '<button type="button" class="aw-play" id="aw-play" aria-label="' +
        esc(t.reproducir) + '" title="' + esc(t.reproducir) + '">▶</button>' +
      '<div class="track" id="aw-track" role="slider" tabindex="0" ' +
        'aria-valuemin="0" aria-valuemax="' + (n - 1) + '" aria-valuenow="' + indice +
        '" aria-label="' + esc(t.horaCupula) + '">' + partes.join('') + '</div>' +
      '<span class="now" id="aw-t-lab">' + esc(marcos[indice].label) + '</span></div>';
  }

  // ------------------------------------------------- PERFIL POR OBJETO ----
  function perfilSvg(objeto, color) {
    var alt = objeto.alt || [], n = alt.length;
    if (!n) { return ''; }
    var W = 100, H = 100, pad = 4;
    var x = function (i) { return pad + i * (W - 2 * pad) / Math.max(1, n - 1); };
    var y = function (a) { return H - pad - Math.max(0, Math.min(90, a)) / 90 * (H - 2 * pad); };
    var tinte = { c: '#d15f5f', l: '#d8a53c', f: '#d8a53c', a: '#8a8a92',
                  n: '#6ec177', '-': 'rgba(255,255,255,0.10)' };
    var barras = '', ancho = (W - 2 * pad) / n;
    for (var i = 0; i < n; i++) {
      var codigo = (objeto.limita || '').charAt(i) || '-';
      if (alt[i] > 0) {
        barras += '<rect x="' + (x(i) - ancho / 2).toFixed(2) + '" y="' + y(alt[i]).toFixed(2) +
          '" width="' + ancho.toFixed(2) + '" height="' + (H - pad - y(alt[i])).toFixed(2) +
          '" fill="' + tinte[codigo] + '" opacity="' + (codigo === 'n' ? 0.5 : 0.26) + '"/>';
      }
    }
    var linea = alt.map(function (a, i) {
      return (i ? 'L' : 'M') + x(i).toFixed(2) + ' ' + y(a).toFixed(2);
    }).join(' ');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img">' +
      '<line class="grid" x1="' + pad + '" x2="' + (W - pad) + '" y1="' + y(0) + '" y2="' + y(0) + '"/>' +
      '<line class="min" x1="' + pad + '" x2="' + (W - pad) + '" y1="' + y(25) + '" y2="' + y(25) + '"/>' +
      '<line class="grid" x1="' + pad + '" x2="' + (W - pad) + '" y1="' + y(60) + '" y2="' + y(60) + '"/>' +
      barras +
      '<path d="' + linea + '" fill="none" stroke="' + color +
        '" stroke-width="1.4" vector-effect="non-scaling-stroke"/>' +
      '<line class="cursor" x1="0" x2="0" y1="' + pad + '" y2="' + (H - pad) +
        '" vector-effect="non-scaling-stroke"/>' +
      alt.map(function (a, i) {
        return '<rect class="hit" data-i="' + i + '" x="' + (x(i) - ancho / 2).toFixed(2) +
          '" y="0" width="' + ancho.toFixed(2) + '" height="' + H + '"/>';
      }).join('') + '</svg>';
  }

  function carril(objeto, color, t) {
    return '<div class="aw-lane" data-obj="' + esc(objeto.nombre) + '">' +
      '<div class="head">' +
        '<i class="dot" style="background:' + color + '"></i>' +
        '<span class="n">' + esc(objeto.nombre) + '</span>' +
        '<span class="q">' + num(objeto.horas_si_despeja) + ' ' + t.horas + ' ' +
          esc(t.siDespejaCorto) + '</span>' +
        '<span class="aw-tag ' + clase(objeto.veredicto) + '">' +
          esc(t.veredicto[objeto.veredicto] || objeto.veredicto) + '</span>' +
        '<button type="button" class="quitar" data-quitar="' + esc(objeto.nombre) +
          '" aria-label="' + esc(t.quitar) + ' ' + esc(objeto.nombre) + '" title="' +
          esc(t.quitar) + '">×</button>' +
      '</div>' +
      '<div class="aw-profile">' + perfilSvg(objeto, color) + '</div>' +
      '<div class="aw-detail" data-detalle="' + esc(objeto.nombre) + '"></div>' +
    '</div>';
  }

  // ------------------------------------------------------------ MONTAJE ---
  function montarBuscador(caja, datos, t, lang) {
    var noche = datos.noches[0];
    var catalogo = noche.objetos || [];
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
      var puestos = elegidos.map(function (o) { return o.nombre; });
      var hits = catalogo.filter(function (o) {
        if (puestos.indexOf(o.nombre) !== -1) { return false; }
        if (o.nombre.toLowerCase().indexOf(q) !== -1) { return true; }
        return (o.alias || []).some(function (a) {
          return a.toLowerCase().indexOf(q) !== -1;
        });
      }).slice(0, 12);
      lista.innerHTML = hits.length
        ? hits.map(function (o) {
            return '<button type="button" data-i="' + catalogo.indexOf(o) + '">' +
              '<span class="n">' + esc(o.nombre) + '</span>' +
              '<span class="h">' + num(o.horas_si_despeja) + ' ' + t.horas + '</span></button>';
          }).join('')
        : '<div class="none">' + esc(t.sinResultados) + '</div>';
      lista.hidden = false;
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
        return '<b>' + esc(m.label) + '</b> ' + num(a, 0) + '°: ' +
          esc(t.bajoMinimo) + '.';
      }
      return '<b>' + esc(m.label) + '</b> ' + esc(t.altura) + ' ' + num(a, 0) + '°, ' +
        esc(t.rinde) + ' ' + num(((objeto.rend || [])[i] || 0) * 100, 0) + ' %, ' +
        esc(t.limitaPor) + ' ' + esc((t.limita && t.limita[codigo]) || codigo) +
        (m.sky_mag !== undefined && m.sky_mag !== null
          ? ' · ' + esc(t.cieloAhora) + ' ' + num(m.sky_mag, 1) : '') + '.';
    }

    // Solo mueve el cursor y repinta: no reconstruye el HTML, que es lo que
    // haría perder el foco y el scroll cada vez que corre la animación.
    function irA(i) {
      indice = Math.max(0, Math.min(marcos.length - 1, i));
      var etiqueta = destino.querySelector('#aw-t-lab');
      var cursor = destino.querySelector('#aw-cur');
      var pista = destino.querySelector('#aw-track');
      if (etiqueta && marcos[indice]) { etiqueta.textContent = marcos[indice].label; }
      var pct = indice / Math.max(1, marcos.length - 1) * 100;
      if (cursor) { cursor.style.left = pct + '%'; }
      if (pista) { pista.setAttribute('aria-valuenow', indice); }
      destino.querySelectorAll('.aw-profile .cursor').forEach(function (linea) {
        var xx = 4 + indice * (100 - 8) / Math.max(1, marcos.length - 1);
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
            bloqueTiempo(marcos, indice, t) +
          '</div>' +
          '<div class="aw-side">' + bloqueClave(datos.cupula, t) + '</div>' +
        '</div>' +
        '<div class="aw-lanes">' +
          elegidos.map(function (o, i) { return carril(o, color(i), t); }).join('') +
        '</div>';

      var pila = destino.querySelector('.aw-dome-stack');
      if (window.ResizeObserver && pila) {
        new ResizeObserver(function () {
          if (pila.clientWidth > 0) { irA(indice); }
        }).observe(pila);
      }
      setTimeout(function () { irA(indice); }, 60);
      if (window.AWDome && !window.AWDome.listaViaLactea()) {
        window.AWDome.pendiente.push(function () { irA(indice); });
      }
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

    entrada.addEventListener('input', pintarResultados);
    entrada.addEventListener('focus', pintarResultados);
    lista.addEventListener('click', function (e) {
      var boton = e.target.closest('button[data-i]');
      if (boton) { anadir(catalogo[parseInt(boton.getAttribute('data-i'), 10)]); }
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
            irA((indice + 1) % marcos.length);
          }, 550);
        }
        return;
      }
      var pista = e.target.closest('#aw-track');
      if (pista) {
        var caja2 = pista.getBoundingClientRect();
        irA(Math.round((e.clientX - caja2.left) / caja2.width * (marcos.length - 1)));
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

    var html = '<div class="aw-head"><h2>' + t.titulo + '</h2>' +
      '<span class="aw-site">' + esc(t.sitio) + '</span></div><div class="aw-body">';
    // El orden importa: primero como esta la noche, luego lo que dicen los
    // sensores AHORA -- que es lo que confirma o desmiente la prevision -- y
    // solo despues el plan, que se decide con las dos cosas delante.
    html += bloqueResumen(noche, t, lang);
    html += bloqueSensores(datos, t);
    html += bloqueConsejos(noche, t);
    html += bloqueElegir(t);

    var siguiente = datos.noches[1];
    if (siguiente && typeof siguiente.probabilidad_de_abrir === 'number') {
      html += '<div class="aw-next"><span class="d">' + esc(t.manana) + '</span>' +
        '<b>' + Math.round(siguiente.probabilidad_de_abrir * 100) + '%</b>' +
        '<span class="d">' + fecha(siguiente.noche, lang) + '</span></div>';
    }

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

    fetch(URL_NOCHE, { cache: 'no-cache' })
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
