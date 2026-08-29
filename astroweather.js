/* AstroWeather -- la noche de Nerpio, leida del repo publico del motor.
 *
 * El motor (CabraSpace-AstroWeather) es privado; lo que predice es publico y
 * se reescribe cada 6 h en una URL fija. Aqui no se calcula NADA: si un numero
 * no viene en el JSON, no se pinta. Es a proposito -- una pagina que recalcula
 * lo que ilustra acaba discrepando del motor que la alimenta.
 *
 * La regla de la casa que este fichero tiene que respetar: nada se publica sin
 * su incertidumbre. Los avisos de `confianza.avisos` se pintan SIEMPRE, y el
 * seeing sale en terciles, nunca en arcosegundos sueltos.
 */
(function () {
  'use strict';

  var URL_NOCHE = 'https://raw.githubusercontent.com/Ninocabra/CabraSpace-AstroWeather-Data/main/noche.json';
  var REPO = 'https://github.com/Ninocabra/CabraSpace-AstroWeather-Data';

  var PIE_ES = 'Previsión del motor propio de CabraSpace, calculada para AstroCamp. Cada número viaja con su procedencia dentro del ' +
    '<a href="' + URL_NOCHE + '" target="_blank" rel="noopener">JSON público</a> (' +
    '<a href="' + REPO + '" target="_blank" rel="noopener">repositorio</a>), que se reescribe cada 6 h. ' +
    'Proyecto personal en desarrollo, no un servicio meteorológico: <strong>no lo uses para decisiones de seguridad</strong>.';

  var PIE_EN = 'Forecast from the CabraSpace engine, computed for AstroCamp. Every number carries its provenance inside the ' +
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
      noche: 'Noche del',
      luna: 'Luna',
      oscuridad: 'Oscuridad astronómica',
      cielo: 'Cielo más oscuro',
      seeing: 'Seeing',
      transparencia: 'Transparencia',
      iluminada: 'iluminada',
      sinCalibrar: 'estimación sin calibrar',
      horas: 'h',
      magArc: 'mag/arcsec²',
      objetos: 'Qué merece la pena apuntar',
      siDespeja: 'si despeja',
      esperadas: 'esperadas',
      sinObjetos: 'Ninguno del catálogo sale rentable esta noche.',
      avisos: 'Lo que hoy no cuadra',
      manana: 'Mañana',
      pie: PIE_ES,
      generado: 'Generado',
      tercil: { favorable: 'favorable', normal: 'normal', desfavorable: 'desfavorable' },
      veredicto: {
        recomendado: 'recomendado',
        posible: 'posible',
        'poco rentable': 'poco rentable',
        'no observable': 'no observable'
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
      noche: 'Night of',
      luna: 'Moon',
      oscuridad: 'Astronomical darkness',
      cielo: 'Darkest sky',
      seeing: 'Seeing',
      transparencia: 'Transparency',
      iluminada: 'illuminated',
      sinCalibrar: 'uncalibrated estimate',
      horas: 'h',
      magArc: 'mag/arcsec²',
      objetos: 'What is worth pointing at',
      siDespeja: 'if it clears',
      esperadas: 'expected',
      sinObjetos: 'Nothing in the catalogue pays off tonight.',
      avisos: 'What does not add up today',
      manana: 'Tomorrow',
      pie: PIE_EN,
      generado: 'Generated',
      tercil: { favorable: 'favourable', normal: 'typical', desfavorable: 'poor' },
      veredicto: {
        recomendado: 'recommended',
        posible: 'possible',
        'poco rentable': 'low yield',
        'no observable': 'not observable'
      },
      // El veredicto de transparencia es prosa que compone el motor. Se traduce
      // por prefijo y, si aparece uno nuevo, se deja tal cual en vez de
      // inventarselo: mejor en castellano que traducido a ojo.
      transp: [
        ['noche transparente', 'clear night'],
        ['transparencia media', 'medium transparency: fine for narrowband, not for deep broadband'],
        ['transparencia pobre', 'poor transparency'],
        ['calima', 'dust haze: milky sky, the Moon hurts more and faint targets do not build up']
      ]
    }
  };

  var ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return ESCAPES[c]; });
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

  function traducirTransparencia(texto, t) {
    if (!t.transp || !texto) { return texto; }
    for (var i = 0; i < t.transp.length; i++) {
      if (texto.indexOf(t.transp[i][0]) === 0) { return t.transp[i][1]; }
    }
    return texto;                       // desconocido: se deja como viene
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

  function render(datos, t, lang) {
    var noche = datos.noches && datos.noches[0];
    if (!noche) { return '<div class="aw-state">' + esc(t.error) + '</div>'; }

    var p = noche.probabilidad_de_abrir;
    var cielo = noche.cielo || {};
    var seeing = cielo.seeing || {};
    var transp = cielo.transparencia || {};
    var html = '';

    html += '<div class="aw-head"><h2>' + t.titulo + '</h2>' +
      '<span class="aw-site">' + esc(t.sitio) + '</span></div><div class="aw-body">';

    html += '<div class="aw-headline">';
    if (typeof p === 'number') {
      html += '<div class="aw-prob">' + Math.round(p * 100) + '%</div>' +
        '<div class="aw-prob-label">' + esc(t.probLabel) + '</div>';
    }
    html += '<div class="aw-when">' + esc(t.noche) + ' <strong>' + fecha(noche.noche, lang) + '</strong>';
    if (num(noche.horas_utilizables_esperadas) !== null) {
      html += '<br>' + num(noche.horas_utilizables_esperadas) + ' ' + esc(t.horasUtiles);
    }
    html += '</div></div>';

    html += '<div class="aw-grid">';
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
      // En terciles, nunca en arcosegundos sueltos: el modelo no esta calibrado.
      html += celda(t.seeing, esc(t.tercil[seeing.tercil] || seeing.tercil),
        seeing.calibrado === false ? t.sinCalibrar : null);
    }
    if (transp.veredicto) {
      html += celda(t.transparencia, esc(traducirTransparencia(transp.veredicto, t)),
        transp.origen ? 'AOD ' + num(transp.aod, 3) + ' · ' + transp.origen : null);
    }
    html += '</div>';

    var objetos = noche.recomendaciones || [];
    html += '<div class="aw-targets"><h3>' + esc(t.objetos) + '</h3>';
    if (!objetos.length) {
      html += '<div class="aw-target"><span class="name">' + esc(t.sinObjetos) + '</span></div>';
    }
    objetos.forEach(function (o) {
      html += '<div class="aw-target">' +
        '<span class="name">' + esc(o.objeto) + '</span>' +
        '<span class="hours"><b>' + num(o.horas_si_despeja) + ' ' + t.horas + '</b> ' + esc(t.siDespeja) +
        ' · ' + num(o.horas_esperadas) + ' ' + t.horas + ' ' + esc(t.esperadas) + '</span>' +
        '<span class="aw-tag ' + clase(o.veredicto) + '">' +
        esc(t.veredicto[o.veredicto] || o.veredicto) + '</span></div>';
    });
    html += '</div>';

    var siguiente = datos.noches[1];
    if (siguiente && typeof siguiente.probabilidad_de_abrir === 'number') {
      html += '<div class="aw-next"><span class="d">' + esc(t.manana) + '</span>' +
        '<b>' + Math.round(siguiente.probabilidad_de_abrir * 100) + '%</b>' +
        '<span class="d">' + fecha(siguiente.noche, lang) + '</span></div>';
    }

    // Los avisos no son decorativos y no se ocultan nunca: si el calibrador se
    // esta aplicando a un modelo distinto del que se entreno, la probabilidad
    // de arriba vale menos de lo que dice su BSS, y quien la lea debe saberlo.
    var avisos = (datos.confianza && datos.confianza.avisos) || [];
    if (avisos.length) {
      html += '<div class="aw-warnings"><h3>' + esc(t.avisos) + '</h3><ul>';
      avisos.forEach(function (a) { html += '<li>' + esc(a) + '</li>'; });
      html += '</ul></div>';
    }

    html += '<div class="aw-foot">' + t.pie;
    if (datos.generado_utc) {
      html += '<br>' + esc(t.generado) + ': ' +
        esc(String(datos.generado_utc).replace('T', ' ').slice(0, 16)) + ' UTC.';
    }
    html += '</div></div>';
    return html;
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
      .then(function (datos) { caja.innerHTML = render(datos, t, lang); })
      .catch(function (e) {
        // Fallar en silencio seria peor: la pagina diria que no hay noche.
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
