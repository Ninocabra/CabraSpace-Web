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
      cardinales: ['N', 'E', 'S', 'O'],
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
      cardinales: ['N', 'E', 'S', 'W'],
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
  // Proyección polar: el cenit en el centro, el horizonte en el borde. No
  // calcula posiciones -- las trazas y la Luna vienen ya resueltas del motor.
  function dibujarCupula(canvas, cupula, objeto, indice, t) {
    var ctx = canvas.getContext('2d');
    var escala = window.devicePixelRatio || 1;
    var lado = canvas.clientWidth || 320;
    canvas.width = lado * escala;
    canvas.height = lado * escala;
    ctx.setTransform(escala, 0, 0, escala, 0, 0);
    ctx.clearRect(0, 0, lado, lado);

    var cx = lado / 2, cy = lado / 2, R = lado / 2 - 14;
    var marco = (cupula && cupula.marcos && cupula.marcos[indice]) || null;

    function punto(alt, az) {
      var r = (90 - Math.max(0, Math.min(90, alt))) / 90 * R;
      var a = (az - 90) * Math.PI / 180;      // N arriba, E a la derecha
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    }

    // Fondo del cielo: más claro cuanto más brillante lo dé el modelo.
    var mag = marco && typeof marco.cielo_mag === 'number' ? marco.cielo_mag : 21.5;
    var brillo = Math.max(0, Math.min(1, (21.8 - mag) / 5));
    var fondo = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    fondo.addColorStop(0, 'rgba(30,38,58,' + (0.35 + brillo * 0.5) + ')');
    fondo.addColorStop(1, 'rgba(10,12,20,0.95)');
    ctx.fillStyle = fondo;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.fill();

    // Anillos de altura: 30 y 60 grados.
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    [30, 60].forEach(function (alt) {
      ctx.beginPath();
      ctx.arc(cx, cy, (90 - alt) / 90 * R, 0, 6.2832);
      ctx.stroke();
    });
    ctx.strokeStyle = 'rgba(207,171,74,0.28)';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.stroke();

    // Nubes del modelo: manchas difusas, nunca objetos nítidos. El modelo
    // resuelve 9-25 km y dibujarlas con borde sería mentir sobre su precisión.
    (marco && marco.nubes ? marco.nubes : []).forEach(function (n) {
      var p = punto(n.alt, n.az);
      var radio = Math.max(8, (n.span || 20) / 90 * R * 0.7);
      var g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], radio);
      var opacidad = Math.min(0.55, (n.cover || 0) / 100 * 0.6);
      g.addColorStop(0, 'rgba(190,200,215,' + opacidad + ')');
      g.addColorStop(1, 'rgba(190,200,215,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p[0], p[1], radio, 0, 6.2832); ctx.fill();
    });

    // La Luna y su halo.
    if (marco && typeof marco.luna_alt === 'number' && marco.luna_alt > -2) {
      var pl = punto(marco.luna_alt, marco.luna_az);
      var ilum = (cupula.luna && cupula.luna.illumination) || 0;
      var halo = ctx.createRadialGradient(pl[0], pl[1], 0, pl[0], pl[1], R * 0.42);
      halo.addColorStop(0, 'rgba(240,235,205,' + (0.10 + ilum * 0.22) + ')');
      halo.addColorStop(1, 'rgba(240,235,205,0)');
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(pl[0], pl[1], R * 0.42, 0, 6.2832); ctx.fill();
      ctx.fillStyle = 'rgba(245,240,215,0.92)';
      ctx.beginPath(); ctx.arc(pl[0], pl[1], 5, 0, 6.2832); ctx.fill();
    }

    // Puntos cardinales.
    ctx.fillStyle = 'rgba(255,255,255,0.38)';
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    [[0, t.cardinales[0]], [90, t.cardinales[1]],
     [180, t.cardinales[2]], [270, t.cardinales[3]]].forEach(function (par) {
      var p = punto(-2.5, par[0]);
      ctx.fillText(par[1], p[0], p[1]);
    });

    // El recorrido del objeto y donde esta AHORA. La traza viene alineada
    // uno a uno con los marcos de la cupula, asi que el punto del instante es
    // `alt[indice]` y no hay que buscarlo por tiempo: antes se buscaba el mas
    // cercano dentro de una traza recortada, y el marcador se quedaba clavado
    // media noche mientras solo se movia la Luna.
    var alt = (objeto && objeto.alt) || [];
    var az = (objeto && objeto.az) || [];
    if (alt.length) {
      ctx.strokeStyle = 'rgba(207,171,74,0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      var dibujando = false;
      for (var i = 0; i < alt.length; i++) {
        if (alt[i] < 0) { dibujando = false; continue; }   // bajo el horizonte
        var p = punto(alt[i], az[i]);
        if (!dibujando) { ctx.moveTo(p[0], p[1]); dibujando = true; }
        else { ctx.lineTo(p[0], p[1]); }
      }
      ctx.stroke();

      // Salida y puesta, que es lo que se quiere planificar.
      var vivos = [];
      for (var j = 0; j < alt.length; j++) { if (alt[j] >= 0) { vivos.push(j); } }
      ctx.fillStyle = 'rgba(207,171,74,0.35)';
      vivos.slice(0, 1).concat(vivos.slice(-1)).forEach(function (k) {
        var q = punto(alt[k], az[k]);
        ctx.beginPath(); ctx.arc(q[0], q[1], 3, 0, 6.2832); ctx.fill();
      });

      if (alt[indice] >= 0) {
        var pm = punto(alt[indice], az[indice]);
        ctx.fillStyle = '#cfab4a';
        ctx.beginPath(); ctx.arc(pm[0], pm[1], 6.5, 0, 6.2832); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
      } else {
        // Decirlo, en vez de dejar el marcador en un sitio que es mentira.
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '600 11px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(t.bajoHorizonte, cx, cy + R * 0.72);
        ctx.textAlign = 'left';
      }
    }
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

  function bloqueElegir(t) {
    return '<div class="aw-pick"><h3>' + esc(t.elegir) + '</h3>' +
      '<div class="aw-search">' +
      '<input type="search" id="aw-q" autocomplete="off" placeholder="' + esc(t.buscar) + '">' +
      '<div class="aw-results" id="aw-res" hidden></div></div>' +
      '<div id="aw-chosen"><div class="aw-hint">' + esc(t.pista) + '</div></div></div>';
  }

  // ------------------------------------------------------------ MONTAJE ----
  function montarBuscador(caja, datos, t, lang) {
    var noche = datos.noches[0];
    var objetos = noche.objetos || [];
    var entrada = caja.querySelector('#aw-q');
    var lista = caja.querySelector('#aw-res');
    var destino = caja.querySelector('#aw-chosen');
    if (!entrada) { return; }

    function pintarResultados() {
      var q = entrada.value.trim().toLowerCase();
      if (!q) { lista.hidden = true; return; }
      // Se busca por el nombre Y por los alias: el catálogo está en
      // castellano y quien lee la página en inglés escribe "Veil", no "Velo".
      var hits = objetos.filter(function (o) {
        if (o.nombre.toLowerCase().indexOf(q) !== -1) { return true; }
        return (o.alias || []).some(function (a) {
          return a.toLowerCase().indexOf(q) !== -1;
        });
      }).slice(0, 12);
      lista.innerHTML = hits.length
        ? hits.map(function (o, i) {
            return '<button type="button" data-i="' + objetos.indexOf(o) + '">' +
              '<span class="n">' + esc(o.nombre) + '</span>' +
              '<span class="h">' + num(o.horas_si_despeja) + ' ' + t.horas + '</span></button>';
          }).join('')
        : '<div class="none">' + esc(t.sinResultados) + '</div>';
      lista.hidden = false;
    }

    function elegir(objeto) {
      lista.hidden = true;
      entrada.value = objeto.nombre;
      var marcos = (datos.cupula && datos.cupula.marcos) || [];
      // Se abre en el mejor momento del objeto, que es lo que se quiere ver.
      var indice = 0;
      if (objeto.mejor_hora && marcos.length) {
        var objetivo = new Date(objeto.mejor_hora).getTime(), dist = Infinity;
        marcos.forEach(function (m, i) {
          var d = Math.abs(new Date(m.t).getTime() - objetivo);
          if (d < dist) { dist = d; indice = i; }
        });
      }
      destino.innerHTML =
        '<div class="aw-chosen">' +
          '<div class="aw-dome-wrap">' +
            '<canvas class="aw-dome" id="aw-canvas"></canvas>' +
            (marcos.length
              ? '<div class="aw-time"><span>' + esc(t.horaCupula) + '</span>' +
                '<input type="range" id="aw-t" min="0" max="' + (marcos.length - 1) +
                '" value="' + indice + '">' +
                '<span class="now" id="aw-t-lab">' + esc(marcos[indice].etiqueta) + '</span></div>'
              : '') +
          '</div>' +
          '<div class="aw-obj">' +
            '<h4>' + esc(objeto.nombre) + '</h4>' +
            '<div class="sub">' + esc(objeto.tipo) + ' · ' + esc(objeto.clase) +
              ' · <span class="aw-tag ' + clase(objeto.veredicto) + '">' +
              esc(t.veredicto[objeto.veredicto] || objeto.veredicto) + '</span></div>' +
            '<p class="why">' + esc(objeto.porque) +
              (objeto.nota ? ' — ' + esc(objeto.nota) : '') + '</p>' +
            '<div class="aw-obj-facts">' +
              '<div class="f"><span class="k">' + esc(t.siDespeja) + '</span>' +
                '<span class="v">' + num(objeto.horas_si_despeja) + '</span></div>' +
              '<div class="f"><span class="k">' + esc(t.esperadas) + '</span>' +
                '<span class="v">' + num(objeto.horas_esperadas) + '</span></div>' +
              '<div class="f"><span class="k">' + esc(t.maxAlt) + '</span>' +
                '<span class="v">' + num(objeto.altura_maxima, 0) + '°</span></div>' +
              '<div class="f"><span class="k">' + esc(t.sepLuna) + '</span>' +
                '<span class="v">' + num(objeto.separacion_luna, 0) + '°</span></div>' +
              '<div class="f"><span class="k">' + esc(t.sobreMin) + '</span>' +
                '<span class="v">' + num(objeto.horas_sobre_minimo) + '</span></div>' +
              (objeto.mejor_hora
                ? '<div class="f"><span class="k">' + esc(t.mejorHora) + '</span>' +
                  '<span class="v">' + esc(hora(objeto.mejor_hora)) + '</span></div>'
                : '') +
            '</div>' +
          '</div>' +
        '</div>' +
        // El perfil va DEBAJO de la cúpula y a todo el ancho: la cúpula dice
        // hacia dónde mirar y el perfil dice cuándo, y son dos preguntas.
        '<div class="aw-profile-wrap"><span class="lbl" style="display:block;' +
          'font-size:.68rem;letter-spacing:.06em;text-transform:uppercase;' +
          'color:var(--text-muted,#777);margin:18px 0 6px">' + esc(t.perfil) +
          '</span>' + perfilSvg(objeto, marcos) +
          '<div class="aw-detail" id="aw-det">' + esc(t.pulsaPerfil) + '</div></div>';

      var canvas = destino.querySelector('#aw-canvas');
      var deslizador = destino.querySelector('#aw-t');
      var etiqueta = destino.querySelector('#aw-t-lab');
      var cursor = destino.querySelector('#aw-p-cursor');
      var detalle = destino.querySelector('#aw-det');

      function contar(i) {
        var m = marcos[i];
        if (!m) { return ''; }
        var a = objeto.alt[i], codigo = (objeto.limita || '').charAt(i) || '-';
        if (a === undefined) { return ''; }
        // Ocho grados NO es "bajo el horizonte": es visible e inservible, y
        // decirlo mal hace dudar de todo lo demas.
        if (a < 0) {
          return '<b>' + esc(t.aEsaHora) + ' ' + esc(m.etiqueta) + '</b> ' +
            esc(t.bajoHorizonte) + ' (' + num(a, 0) + '°).';
        }
        if (codigo === '-') {
          return '<b>' + esc(t.aEsaHora) + ' ' + esc(m.etiqueta) + '</b> ' +
            num(a, 0) + '°: ' + esc(t.bajoMinimo) + '.';
        }
        return '<b>' + esc(t.aEsaHora) + ' ' + esc(m.etiqueta) + '</b> ' +
          esc(t.altura) + ' ' + num(a, 0) + '°, ' + esc(t.rinde) + ' ' +
          num((objeto.rend[i] || 0) * 100, 0) + ' %, ' + esc(t.limitaPor) + ' ' +
          esc((t.limita && t.limita[codigo]) || codigo) +
          (m.cielo_mag !== undefined && m.cielo_mag !== null
            ? ' · ' + esc(t.cieloAhora) + ' ' + num(m.cielo_mag, 1)
            : '') + '.';
      }

      function repintar() {
        var i = deslizador ? parseInt(deslizador.value, 10) : indice;
        if (etiqueta && marcos[i]) { etiqueta.textContent = marcos[i].etiqueta; }
        if (cursor) {
          var xx = 4 + i * (100 - 8) / Math.max(1, (objeto.alt || []).length - 1);
          cursor.setAttribute('x1', xx); cursor.setAttribute('x2', xx);
        }
        if (detalle) { detalle.innerHTML = contar(i); }
        dibujarCupula(canvas, datos.cupula, objeto, i, t);
      }

      if (deslizador) { deslizador.addEventListener('input', repintar); }
      // Pinchar en el perfil mueve la cúpula: son la misma noche vista de dos
      // maneras, y moverlas por separado seria mentir sobre eso.
      destino.addEventListener('click', function (e) {
        var celda = e.target.closest('rect.hit');
        if (!celda) { return; }
        if (deslizador) { deslizador.value = celda.getAttribute('data-i'); }
        repintar();
      });
      window.addEventListener('resize', repintar);
      repintar();
    }

    entrada.addEventListener('input', pintarResultados);
    entrada.addEventListener('focus', pintarResultados);
    lista.addEventListener('click', function (e) {
      var boton = e.target.closest('button[data-i]');
      if (boton) { elegir(objetos[parseInt(boton.getAttribute('data-i'), 10)]); }
    });
    document.addEventListener('click', function (e) {
      if (!caja.querySelector('.aw-search').contains(e.target)) { lista.hidden = true; }
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
