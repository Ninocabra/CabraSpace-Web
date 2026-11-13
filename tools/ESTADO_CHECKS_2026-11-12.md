# Estado de los chequeos antes de la migración (12-11-2026, rama `atlas2` recién creada desde `main`)

Foto del «antes»: lo que ya estaba en rojo NO es atribuible a la migración. Medido con el árbol de `main` (4ae8ab7) sin
ningún cambio visible, antes de tocar nada de F2.

## `npm run check:i18n` → ROJO (código de salida 2)
`python tools/build_workflow_en.py --check`
`ERROR: 20 traducciones NO aplicaron (el ES cambió; actualiza el JSON)`. Lo que imprime el comprobador (10 bloques, 13 líneas) son fragmentos del marcado de la
cabecera/menú de `cabraspace-imaging-workflow.html` (enlace del logo, botón hamburguesa, `nav-link` de Inicio,
desplegables Novedades / Astrofotografía / Recursos PixInsight y sus `dropdown-item`) que el ES ya no tiene tal cual
(no se ha verificado cuáles son exactamente las 20 entradas del JSON):
la cabecera la reescribió `sync_nav.py` y `tools/i18n_workflow_en.json` quedó atrás. Importa a F2/F5: al tocar la
cabecera de CabraSpace Web habrá que poner al día ese JSON.

## `npm run check:piw` → ROJO (código de salida 1)
`python tools/build_piw.py --check`
`DESFASE: pi-workflow.js no coincide con los fragmentos de src/piw/. Ejecuta tools/build_piw.py.`
El `pi-workflow.js` publicado no es lo que sale de `src/piw/`. No se ha regenerado (no es de este trabajo).

## Comprobador nuevo (`tools/check_site.mjs`) sobre la web actual → VERDE (0 fallos)
Línea base: `tools/check_site_baseline.json` (generada 12-11-2026, servidor local http://localhost:8099/).
- 54 páginas `.html` de la raíz (52 se cargan y capturan; `pi-workflow.html` y `pi-workflow-en.html` son redirecciones
  y solo se comprueba que su destino existe).
- 0 recursos locales rotos, 0 enlaces internos rotos, 0 excepciones JS, 0 errores de consola locales, 0 desborde horizontal
  a 1440 y a 390 px. 140 URLs locales distintas comprobadas.
- Ignorados por ser de dominios externos (no cuentan para el veredicto): 46-47 errores por pasada (no desglosados salvo el CORS del feed de Acast en las dos páginas de Coffee Break cuando se sirve desde localhost).
- Matices: Astro Forecast (ES y EN) a veces no dispara el evento `load` en 30 s (espera recursos externos lentos): se anota
  «carga lenta», no es fallo; el contenido en vivo sí cargó en las capturas. Las capturas de página completa se cortan a
  16000 px de alto (medido: `equipamiento` y `equipamiento-en` a 390 y 1440, y `novedades` y `novedades-en` a 390, salen truncadas).
- Control positivo: `tools/check_site_control/` (ver su salida.txt: marca imagen rota, enlace roto, `url()` roto, excepción JS,
  error de consola y desborde de 3000 px, incluido un desborde tapado por `body{overflow-x:hidden}` como el de las páginas reales).
