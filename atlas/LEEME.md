# Estilo Atlas de la web — cómo está hecho y cómo se mantiene

## Qué hay aquí

| Fichero | Qué es |
|---|---|
| `atlas/atlas2-marco.css` | **Desde F2 (12-11-2026): el marco de las 54 páginas** — tokens, variables heredadas, hoja con orla, cabecera con su cajón móvil, pie y modo noche (penumbra). Se carga la ÚLTIMA. Ver «Convivencia de hojas» abajo. |
| `atlas/atlas2.js` | **Desde F2: el único script de cabecera** — orla, filtro de noche, modo noche (clave `night-vision` de siempre) y cajón móvil. Sustituye a `atlas/atlas.js` en todas las páginas. |
| `atlas/atlas2.css` | Componentes del INTERIOR de Atlas II (láminas, herramientas, bitácora…). **Lo cargan las 30 páginas generadas** (F3 portada e índices, F4 las 20 láminas), después del marco; **desde F5a también las 10 páginas de las 5 herramientas** (ES y EN); **desde F5b también los 5 catálogos** (ES y EN). |
| `atlas/atlas.css` | Capa de Atlas I. Sigue cargada en las 22 páginas sin interior nuevo (contadas el 12-11-2026: las 20 a mano más `cabrascripts` ES/EN; desde F5a/F5b las 20 a mano llevan la cabecera nueva pero conservan esta hoja; las 2 redirecciones `pi-workflow` no cargan ninguna hoja): su interior (`.a3 …`, `--gx`, `.card`, `.plate`…) depende de ella. Las 30 generadas ya no la cargan. (F5a: las 10 de las herramientas la siguen cargando, ver «F5a».) Sus reglas de cabecera/cajón/pie (`.ah`, `.ad`, `.af`) ya no casan con nada (F6 las borra). |
| `atlas/capricornus2.js` · `atlas/armilar.js` | (F3) Capricornio animada y esfera armilar de la portada. La figura SVG la escribe `build_atlas.py` con `tools/atlas2/carta_capricornio.py` (ver `tools/atlas2/LEEME.md`). |
| `atlas/atlas.js` | Script de cabecera de Atlas I. **Ya no lo carga ninguna página** (F2); se borra en F6. No cargarlo junto a `atlas2.js`: los dos alternarían el modo noche y un clic se anularía. |
| `atlas/astroforecast.css` | Paneles Atlas de Astro Forecast (desde F5a la cabecera es la de `atlas2.css`; se carga después de `atlas2.css`). |
| `atlas/tools-base.css` | (F5a, F5b) Convivencia de las 5 herramientas **y de los 5 catálogos** con `atlas2.css`: devuelve al interior lo que la base de `atlas2.css` le cambiaba; al final, las reglas propias de los catálogos. Ver «F5a» y «F5b». |
| `atlas/img/` | Logo dorado, grano, retícula, anillo y capturas usadas en varias páginas. |
| `obs/observaciones.json` | Tu trabajo: una entrada por observación. `facts` guarda cada dato con su fuente (fichero y línea del informe); `facts_display` es lo que se ve en la ficha. |
| `obs/<slug>/` | Imágenes, curvas y vídeos de cada observación. |

## Los tres comandos (desde la raíz del repo, siempre en este orden)

```
python tools/build_atlas.py    # portada, Observaciones, Herramientas, Programas, Bitácora y fichas (ES y EN)
python tools/sync_nav.py       # marco (hoja, cabecera con cajón, pie) en TODAS las páginas
python tools/seo_inject.py     # canonical, hreflang, Open Graph y sitemap.xml
```

Las páginas generadas llevan la marca `ATLAS-PAGE`: no se editan a mano, se edita
`tools/build_atlas.py` (textos en `T("español", "english")`) y se vuelve a generar.

## Añadir una observación

1. Copia sus ficheros web a `obs/<slug>/` (JPG de ≈2400 px para la imagen completa, recorte 1600×1200
   y miniatura 800×600; curvas PNG de ≈1600 px; vídeos MP4 de menos de 30 MB).
2. Añade su entrada a `obs/observaciones.json` copiando una del mismo tipo (`deep-sky`, `transit` o
   `eclipse`) y cambiando slug, fechas, `title`, `media` y `facts_display`. El relato (`story`) es opcional:
   sin él la lámina sale igual, sin hueco (ver «F4» abajo).
3. Si es un tránsito: `python tools/miniaturas.py` (escribe `curva-m.webp`, la miniatura ligera de las rejillas;
   sin ella las rejillas cargan el PNG de 700 KB, que funciona pero pesa diez veces más).
4. Ejecuta los tres comandos. La portada, Observaciones y el «lámina anterior / siguiente» de las láminas vecinas
   se actualizan solos. (Desde F2 el menú ya no lleva «Lo último»: una observación nueva no reescribe la cabecera
   de todas las páginas.)

### O por el buzón (lo que usan los programas)

Tránsitos: `python tools/paquete_web.py <carpeta analisis>` en el repo de CabraTransit.
Un programa deja `inbox/<slug>/` con `ficha.json` (una entrada como las de `observaciones.json`,
con los ficheros **sin ruta**: `"curva.png"`) y sus ficheros. Luego:

```
python tools/publish_from_inbox.py --comprobar   # solo valida
python tools/publish_from_inbox.py               # valida, copia, regenera y SE PARA
python tools/publish_from_inbox.py --subir       # commit + push, tras revisar en local
```

Rechaza (a `inbox/_rechazados/`, con `MOTIVO.txt`) lo que no cuadra: un dato con valor sin
`source`, ficheros que faltan o sobran, fechas imposibles, textos sin ES o EN, imágenes de más de
8 MB o vídeos de más de 30 MB, y un slug que ya existe sin `"_publicador": {"reemplazar": true}`.
Exige el repo limpio para no mezclar cambios, y `--subir` solo sube `obs/`, páginas y sitemap.
Una observación nueva cambia las páginas generadas que la listan (portada, Observaciones, los «Más en…»),
ya no las 54: desde F2 la cabecera no la lleva. `inbox/` no se sube (está en `.gitignore`).

## Reglas del estilo

Fuente única de colores y tipografías: `CabraBase/estilo/tokens.json`. Bermellón solo para la
eclíptica y los errores. Una palabra en cursiva dorada por titular. Números romanos para secciones
(I., Nº I, Lám. I) y fechas en titulares (15 · IX).

## Láminas del siglo XIX en las cabeceras de las herramientas

Cada herramienta lleva un dibujo de grabado (líneas claras sobre fondo oscuro) generado por un script:
observatorio (`tools/observatorio.py`, Astro Forecast), pizarra (`tools/pizarra.py`, PixelMath-teca),
histograma con el punto de simetría (`tools/histograma.py`, AutoGHS), placa de la Carte du Ciel
(`tools/placa.py`, CabraSpace Web) y fábricas con humo (`tools/factorias.py`, Contaminación).
Cada uno escribe su SVG en `atlas/img/`. El SVG es negro sobre transparente y la página lo usa como
**máscara** pintada con `var(--gold)`, así el modo noche lo vuelve rojo sin tocarlo. Dentro de un SVG
usado como imagen no cargan las fuentes web: los textos van en fuentes del sistema (Times).
Desde F5a las cabeceras son `.pag-cab` de `atlas2.css` y el grabado va en `.pag-grab > .grab.grab-<nombre>` (las capas `.tl-top` / `.tl-art` / `.aw-obs` de Atlas I se retiraron de `tools.css` y `astroforecast.css`).

CabraSpace Web es un cockpit sin scroll: su franja es compacta (88 px bajo la barra) y la rejilla se
encoge esa misma altura. Si cambias la franja, mide que la rejilla sigue acabando dentro de la pantalla.

## Convivencia de hojas (F2, 12-11-2026) — cómo queda hasta F5

Orden en el `<head>` de cada página (lo escribe `tools/sync_nav.py`):
`index.css` · [`support.css`, `astroweather.css`…] · `atlas/atlas.css` · [capa `EXTRA_CSS`: `tools.css` /
`astroforecast.css`] · fuente IM Fell English · **`atlas/atlas2-marco.css` (la última)**.

- `atlas2-marco.css` solo tiene selectores del marco (`.hoja`, `.orla`, `.esq`, `#navbar.cab`, `.cab-*`,
  `#atlas-drawer`, `footer.pie`, `.pie-*`) más tokens. Ninguna regla de elemento suelto: no cambia el interior.
  Anula a propósito el `header{position:fixed…}` y el `footer{…}` de `index.css`.
- Tokens de día = los de `atlas.css` (nada cambia). **No redefine `--gx`**: el interior conserva sus 80/40/18 px.
- **`--ah` pasa a 0**: la cabecera ya no es fija, ocupa su sitio. Los `padding-top: calc(var(--ah) + X)` del
  interior (`.a3.page`, `.tl-top`, `.aw-top`) dejan de reservar los 81 px de antes. **`--marco-top`** = alto de
  hoja + orla + cabecera (123 px a 1440, 83 a 390): lo usa la rejilla de CabraSpace Web en `tools.css`.
- Sección 7 de `atlas2-marco.css`, «compatibilidad»: `padding-top:150px` de 4 catálogos → 69 px; `sticky top:100px`
  → 24 px; padding de PixelMath-teca en móvil. Se borra al migrar esas páginas (F5).
- `.hoja-in` usa `overflow: clip` (no `hidden`), para no apagar los `position: sticky` del interior.
- Modo noche: tokens en penumbra (D5) y fotos con el filtro SVG `#cb-noche` (va en la cabecera). Los `<canvas>`
  de las herramientas no se filtran (como antes de F2). Medidas en el comentario de `atlas2-marco.css`.
- `atlas2.css` (interior nuevo) no se carga en las páginas sin migrar: su base pisa `body`, `h1`, `a`, `img`, `.wrap`, `.btn`…
  (desde F3 la cargan solo las 10 de portada e índices; ver la sección siguiente).

Qué falta para F3–F5: cargar `atlas2.css` página a página al migrar su `<main>` (F3 portada e índices, F4 láminas,
F5 herramientas y catálogos), quitar al migrar cada una su parte de la sección 7, y en F6 retirar `atlas.css`,
`atlas.js` y lo muerto de `index.css`. Numeración D2 (I Herramientas · II Observaciones · III Bitácora · IV
Programas): el marco ya la usa; el interior aún no (ver `tools/atlas2/LEEME.md`).

## Convivencia desde F3 (12-11-2026): las 10 páginas con interior Atlas II

Portada (`index.html`/`en.html`), Observaciones, Herramientas, Programas y Bitácora, en ES y EN. Las genera
`build_atlas.py` con `page(..., interior="a2")`. Orden en su `<head>`:
fuentes web (Bodoni Moda, Figtree, IBM Plex Mono; las ponía antes el `@import` de `index.css`) · IM Fell English ·
**`atlas/atlas2-marco.css`** · **`atlas/atlas2.css`** (el interior, después del marco).

- **NO cargan `index.css` ni `atlas.css`.** Comprobado antes de quitarlas: el marco no depende de ellas
  (`atlas2-marco.css` trae sus tokens, su reset acotado a `.cab`/`.pie` y anula lo de `index.css` que ya no hace
  falta anular), `atlas2.js` no usa nada suyo, y los scripts en línea de la portada y de Bitácora solo pintan clases
  de `atlas2.css`. Ganancia: sin el filtro sepia que `index.css` aplica en noche a todo `<svg>`, y sin el `--gx` de
  80 px de `atlas.css`: estas páginas usan el `--gx: clamp(16px, 3vw, 44px)` de `atlas2.css`. Las láminas y las
  páginas a mano no cargan `atlas2.css`, así que su `--gx` (80/40/18) no cambia.
- `sync_nav.py` reconoce el enlace a `atlas/atlas2.css` y en esas páginas no añade `atlas.css`, pone fuente y marco
  delante de `atlas2.css` y le añade `?v=VERSION`. En las demás hace exactamente lo de F2 (re-ejecutado: 0 cambios).
- Modo noche: el interior hereda los tokens de penumbra del marco; `atlas2.css` no redefine rojos.
- Sección 7 de compatibilidad de `atlas2-marco.css`: nada era de estas páginas (catálogos y PixelMath-teca).
- «Desde dónde se observa» (Observaciones) usa el grabado del techo corredizo (D3, `atlas/img/techo-corredizo.svg`,
  generador en `tools/atlas2/d3/`). `atlas/img/cupula.svg` queda en el repo sin usar (F6).

## F4 (12-11-2026): las 20 láminas de observación con el interior nuevo y su relato

Las 10 observaciones × ES/EN (`transito-*`, `cielo-m82`, `cielo-pk164`, `eclipse-2026`) las escribe `build_obs_page()`
con `interior="a2"` (como las 10 de F3: `atlas2-marco.css` + `atlas2.css`, sin `index.css` ni `atlas.css`, sin `style=""`).
Ya no queda ninguna página generada con Atlas I; `page()` solo escribe Atlas II.

- **Diseño** (el de `propuestas-estetica/v2/transito-qatar1b.html`): miga de dos pasos con el ancla que entienden los
  filtros (`observaciones.html#exoplanetas`…), cartela «Lám. N · subtítulo», título, entradilla (la `description`); la
  figura principal a su proporción natural (abre el original); debajo, a la izquierda el relato, las notas, «Hecho con»
  y el vídeo; a la derecha la ficha técnica (fija al bajar); las referencias bajo el texto; al final, lámina anterior y
  siguiente por número de lámina (calculado de los datos). Sin grabado. Desaparece el bloque «Más en…» (el prototipo
  no lo tiene; la miga ya lleva a la lista filtrada).
- **Tránsitos**: el campo (`campo.jpg`) y el póster del vídeo son el mismo fichero (comprobado byte a byte): van en una
  sola figura, «El campo… Al reproducirlo, la noche entera en vídeo», como el prototipo. Si algún día no coinciden,
  salen como dos figuras.
- **Cielo profundo**: la fotografía protagonista (`.lam-natural--foto`, hasta 1100 px) y, como antes, pulsar abre la
  versión completa (`full`).
- **Eclipse**: la corona (abre la de 4K), la serie de fases (`.panel.fases`, cada disco abre su imagen), el vídeo
  (`preload="none"`, caja 16:9), notas, ficha y relato. `downloads` se pinta en la ficha si una entrada lo trae.
- **Relato** (`story` en `observaciones.json`, campo nuevo, opcional): `{source, es: [párrafos], en: [párrafos],
  links?, refs: [{n, authors, year, title, venue, url, status} | {n, text: {es, en}, url, status} | {n, own: true}]}`.
  El español sale TAL CUAL de `propuestas-estetica/d4-investigacion/RELATOS.md` (con sus llamadas `[n]` e `[inf.]`); lo
  pasa `propuestas-estetica/d4-investigacion/relatos_a_json.py`, que también escribe `RELATOS-EN.md` (el inglés, para
  revisar). Las llamadas salen como superíndices enlazados a su referencia; `[inf.]` como «inf.» con una nota al pie
  de la lista (inferencia o cuenta propia, no publicada). **Fidelidad: `python tools/check_relatos.py`** (texto ES
  idéntico a RELATOS.md sin llamadas, mismas llamadas, mismas referencias y enlaces; EN con la misma estructura).
  Si cambia RELATOS.md: `relatos_a_json.py`, la cadena de tres comandos y `check_relatos.py`.
- **Miniaturas**: `tools/miniaturas.py` (Pillow) escribe `obs/<slug>/curva-m.webp` (800 px, WebP q85, 48–70 KB frente
  a 600–850 KB del PNG). `build_atlas.py` las usa en las rejillas (portada, Observaciones, anterior/siguiente) si
  existen; la lámina sigue con el PNG. Peso de Observaciones (todo lo que carga, medido): 5484 KiB → 1056 KiB.

## Versión de las hojas de estilo

`tools/sync_nav.py` pone `?v=VERSION` a `atlas.css`, `atlas2-marco.css`, `atlas2.css`, `atlas2.js` y a las capas de `EXTRA_CSS`
(`armilar.js` y `capricornus2.js` llevan el `A2_ASSET_V` de `build_atlas.py`). Si
cambias un CSS, **sube `VERSION` en sync_nav.py y re-ejecútalo**: si subes el `?v=` a mano en las
páginas, la siguiente ejecución lo devuelve al valor viejo y los navegadores siguen con la copia antigua.

## Fases del eclipse

`tools/fases_eclipse.py` rehace `obs/eclipse-2026/fase-*.jpg` desde los fotogramas de la Vespera (disco
E:) con los centros medidos por el pipeline del timelapse (`centros2.csv`, solo `cal >= 0.8`), y la
totalidad desde la corona de CabraEclipse. Imprime la lista de fases para `observaciones.json`.

## F5a (13-11-2026): cabecera Atlas II en las 5 herramientas (ES y EN)

CabraSpace Web (Nº I), Astro Forecast (Nº II), AutoGHS (Nº III), Contaminación (mapa, Nº IV) y PixelMath-teca (Nº V).
Solo cambia la cabecera: miga «Herramientas web», cartela con su número, título, entradilla y su grabado (`.pag-cab`,
como `v2/autoghs.html`), y el filete debajo. La interfaz y el JavaScript de cada herramienta no se tocan.

- **Orden del `<head>`** (lo ordena `tools/sync_nav.py`): `index.css` · hojas propias · `atlas.css` · fuente · `atlas2-marco.css` ·
  `atlas2.css` · **`tools-base.css`** · `tools.css` (o `astroforecast.css`). `atlas.css` SE QUEDA en estas páginas (oculta
  `.grid-overlay`/`.radial-glow` de `index.css` y da `.a3 .card/.btn/.ghost` al mapa de Contaminación); se va en F6 con el interior.
  `sync_nav.py` ya mantiene el `?v=` de `atlas.css` y de las capas `EXTRA_CSS` (lista, ahora) en estas páginas.
- **Por qué `tools-base.css`**: la base de `atlas2.css` (`body{font-size:16px}`, `button{font:inherit;color:inherit}`, `a{color:inherit;
  text-decoration:none}`, `img{display:block…}`, `.rotulo`, `.refs`, `.btn`, `--gx`) cambiaba el interior de las herramientas.
  Medido con los estilos calculados de ~12 500 elementos antes y después: con `atlas2.css` sin más, 360 cambios distintos;
  con `tools-base.css`, ninguno salvo la altura que da la cabecera nueva. Las raíces del interior son `main.container`,
  `.aw-section` y `.cm-maps`. Se borra cuando se rediseñe cada interior (D6). Una regla de `atlas2.css` NO se puede neutralizar
  desde fuera: `@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important } }`
  (§17) apaga también las animaciones CSS del interior (p. ej. el giro del «Procesando…») para quien pida reducir movimiento.
- **CabraSpace Web (cockpit sin scroll)**: cabecera compacta `.pag-cab--cockpit` de `--cockpit-cab` = 96 px (+4 del filete), una sola
  fila (cartela · título · entradilla · grabado). La rejilla mide `100vh - 38px - --cockpit-cab - 4px - --marco-top`: es la misma
  cuenta de antes con la franja de 88 px cambiada por la cabecera nueva. Por debajo de 1100 px se ocultan entradilla y grabado.
- Las reglas de PixelMath-teca de la sección 7 de `atlas2-marco.css` (sticky del simulador y su padding en móvil) pasaron a `tools.css`.
  (F5b: la sección 7 ha quedado vacía, ver «F5b».)
- La versión inglesa de CabraSpace Web se genera: la cabecera está en `tools/i18n_workflow_en.json` (entrada nueva) y se quitaron
  las 20 traducciones obsoletas (18 del menú antiguo + consola y pie viejos; la consola ganó su entrada nueva).
  `python tools/build_workflow_en.py --check` sigue marcando DESFASE, pero solo en cabecera y pie, que reescribe `sync_nav.py`.

## F5b (13-11-2026): cabecera Atlas II en los 5 catálogos (ES y EN)

Equipamiento, Novedades, Cursos YouTube, Coffee Break y las guías de Contaminación (`contaminacion.html`; el mapa es la herramienta Nº IV).
Todos cuelgan de **III Bitácora** en el menú (`SECTIONS` de `sync_nav.py`) y la Bitácora los lista, así que llevan la cartela
«Tabula III · <nombre>» y la miga «Bitácora» (ES) / «Logbook» (EN). El resto de la cabecera es la de F5a: `.pag-cab` con título
(una palabra en cursiva dorada), la entradilla que ya tenía la página y un grabado (`.pag-grab`), seguida del filete.

- La cabecera sale de `<main>` (antes era un `<section class="database-header|courses-header|divulgacion-header|section-header">`
  dentro o justo antes) y va entre el menú y `<main>`. Sus reglas `.database-header`/`.db-title`/`.db-subtitle` (y las equivalentes) del
  `<style>` de cada página se borraron: ya nada las usaba. El `<main>` lleva `class="… cat-main"`.
- **Orden del `<head>`**: `index.css` · `support.css` · `atlas.css` · fuente · `atlas2-marco.css` · `atlas2.css` · `tools-base.css`
  (`EXTRA_CSS` de `sync_nav.py` lleva ahora los 5 catálogos; solo esa capa). Ojo al editar a mano: el enlace a `atlas2.css` debe ir justo
  después del de `atlas.css`, porque `sync_nav.py` coloca ahí fuente, marco, `atlas2.css` y capas; si se pone antes, `atlas.css` queda
  detrás del marco y pisa sus tokens.
- **Medido** (estilos calculados de todos los elementos del interior, antes con una copia servida de `HEAD` y después con el árbol de
  trabajo, 1440 y 390): con `atlas2.css` sin más, 1959 propiedades distintas en Equipamiento (fuente de los botones, alto de los chips,
  `max-width` de las imágenes, `transition`); con `tools-base.css`, ninguna salvo `text-size-adjust: auto → 100%` (inocuo con meta viewport)
  y el padding de `main.cat-main`. Una cosa más hacía falta: el botón «Abrir Mapa Interactivo» de Contaminación (`.btn.btn-primary` de
  `index.css`) lo pisaba el `.btn` de `atlas2.css` (sin borde, texto en tinta, otra transición); se devuelve en `tools-base.css`.
  Igual que en F5a, la regla `@media (prefers-reduced-motion: reduce) { * { transition:none; animation:none } }` de `atlas2.css`
  (§17) apaga transiciones y el giro del «cargando» para quien pida reducir movimiento; no se puede neutralizar desde fuera.
- La sección 7 de `atlas2-marco.css` queda vacía (solo un comentario): `padding-top:150px` de las cabeceras viejas ya no tiene a quién
  aplicarse (grep: ninguna página, hoja ni script usa ya `.section-header`, `.courses-header`, `.divulgacion-header` ni `.database-header`)
  y el `top:24px` del lateral de Coffee Break pasó a `tools-base.css` junto a las otras reglas de catálogo.
- Grabados elegidos (los de `atlas2.css`, ninguno nuevo): Equipamiento `refractor`, Novedades `octante`, Cursos `pizarra`, Coffee Break
  `armilar`, Contaminación `factorias`. El prototipo no define el grabado de cada catálogo: es una elección de ilustración por tema.
