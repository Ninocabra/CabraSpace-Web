# Estilo Atlas de la web — cómo está hecho y cómo se mantiene

## Qué hay aquí

| Fichero | Qué es |
|---|---|
| `atlas/atlas2-marco.css` | **Desde F2 (12-11-2026): el marco de las 54 páginas** — tokens, variables heredadas, hoja con orla, cabecera con su cajón móvil, pie y modo noche (penumbra). Se carga la ÚLTIMA. Ver «Convivencia de hojas» abajo. |
| `atlas/atlas2.js` | **Desde F2: el único script de cabecera** — orla, filtro de noche, modo noche (clave `night-vision` de siempre) y cajón móvil. Sustituye a `atlas/atlas.js` en todas las páginas. |
| `atlas/atlas2.css` | Componentes del INTERIOR de Atlas II (láminas, herramientas, bitácora…). **Lo cargan las 30 páginas generadas** (F3 portada e índices, F4 las 20 láminas), después del marco; **desde F5a también las 10 páginas de las 5 herramientas** (ES y EN); **desde F5b también los 5 catálogos** (ES y EN). |
| `atlas/atlas.css` | **RETIRADA el 14-11-2026 (rama `limpieza-1114`; ver «Limpieza 14-11-2026» al final): `git rm`, sus reglas vivas están al final de `index.css`.** Texto histórico: capa de Atlas I. Seguía cargada en las 22 páginas sin interior nuevo (contadas el 12-11-2026: las 20 a mano más `cabrascripts` ES/EN; desde F5a/F5b las 20 a mano llevan la cabecera nueva pero conservan esta hoja; las 2 redirecciones `pi-workflow` no cargan ninguna hoja): su interior (`.a3 …`, `--gx`, `.card`, `.plate`…) depende de ella. Las 30 generadas ya no la cargan. (F5a: las 10 de las herramientas la siguen cargando, ver «F5a».) Sus reglas de cabecera/cajón/pie (`.ah`, `.ad`, `.af`) ya no casan con nada (siguen en la hoja: F6 NO la retira, ver «F6»). |
| `atlas/capricornus2.js` · `atlas/armilar.js` | (F3) Capricornio animada y esfera armilar de la portada. La figura SVG la escribe `build_atlas.py` con `tools/atlas2/carta_capricornio.py` (ver `tools/atlas2/LEEME.md`). |
| `atlas/atlas.js` | **Borrado en F6** (`git rm`; sigue en el historial). Era el script de cabecera de Atlas I; ninguna página lo cargaba desde F2. Si algún día vuelve: no cargarlo junto a `atlas2.js`, los dos alternarían el modo noche. |
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
  generador en `tools/atlas2/d3/`). `atlas/img/cupula.svg` ya no lo usa ninguna página del sitio, pero SÍ el muestrario `atlas/atlas2-muestra.html` (`.grab-cupula`): F6 lo conserva.

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
Solo cambia la cabecera: miga «Herramientas web», cartela «Tabula I · Nº N · tema» (desde F5c; en F5a era «Nº N · tema»), título, entradilla y su grabado (`.pag-cab`,
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
- **CabraSpace Web (cockpit sin scroll)**: cabecera compacta `.pag-cab--cockpit` de `--cockpit-cab` = 78 px desde F5c (96 en F5a; +4 del filete), una sola
  fila (cartela · título · entradilla · grabado). La rejilla mide `100vh - 38px - --cockpit-cab - 4px - --marco-top`: es la misma
  cuenta de antes con la franja de 88 px cambiada por la cabecera nueva. Por debajo de 1180 px (1100 hasta F5c) se ocultan entradilla y grabado.
- Las reglas de PixelMath-teca de la sección 7 de `atlas2-marco.css` (sticky del simulador y su padding en móvil) pasaron a `tools.css`.
  (F5b: la sección 7 ha quedado vacía, ver «F5b».)
- La versión inglesa de CabraSpace Web se genera: la cabecera está en `tools/i18n_workflow_en.json` (entrada nueva) y se quitaron
  las 20 traducciones obsoletas (18 del menú antiguo + consola y pie viejos; la consola ganó su entrada nueva).
  `python tools/build_workflow_en.py --check` sigue marcando DESFASE, pero solo en cabecera y pie, que reescribe `sync_nav.py`.

## F5c (13-11-2026): decisiones G, H, D, J, I tras revisar las cabeceras nuevas

- **G.** Errata de la entradilla de `equipamiento.html`: «utilízala».
- **H. CabraSpace Web, franja compacta con su miga.** Antes la miga «← Herramientas web» estaba en el marcado pero `tools.css` la
  ocultaba (`display:none`) por encima de 768 px. Ahora se ve **dentro de la franja**: `.pag-tx` pasa a rejilla de tres columnas
  (miga sobre cartela · título · entradilla), sin tocar el marcado. La franja **baja** de 96 a **78 px** (`--cockpit-cab`): la miga y la
  cartela apiladas miden 58 px. El motivo no es estético: el `aside.piw-card` lateral (overflow:auto, contenido de 654 px a 1440) tenía
  unos 5 px de scroll interno ya en F4 (franja de 88) y la franja de 96 + 4 lo subió a 17 px (la rejilla perdió 12 px). Con 78 + 4 la
  rejilla mide lo que el contenido del lateral (655 px a 1440×900) y no hay scroll interno ahí; sigue habiendo scroll interno a 1280×800
  (lateral de 555 px frente a 654 de contenido), como en F4: es el comportamiento de un lateral que no cabe, no un fallo de la franja.
- **J. Numeración de las cartelas**: **«Tabula» numera la SECCIÓN** (I Herramientas · II Observaciones · III Bitácora · IV Programas) y
  **«Nº» numera la pieza dentro de su sección** (en las láminas, «Lám.» / «Pl.»). Siempre se escribe la Tabula primero:
  | Página | Cartela |
  |---|---|
  | Portada (3 secciones) | `Tabula I`, `Tabula II`, `Tabula III` |
  | Herramientas · Observaciones · Bitácora · Programas | `Tabula I · Sin instalar nada` · `Tabula II · Fotografía y medidas` · `Tabula III · Registro` · `Tabula IV · Para instalar` (y, en Programas, `Tabula IV · En el taller`) |
  | Las 5 herramientas | `Tabula I · Nº I · Procesado` (CabraSpace Web) · `Nº II · AstroCamp` · `Nº III · Estirado` · `Nº IV · Brillo del cielo` · `Nº V · Fórmulas` |
  | Guías de Contaminación | `Tabula I · Guías` / `Tabula I · Guides` |
  | Catálogos (Equipamiento, Novedades, Cursos, Coffee Break) | `Tabula III · <tema>` |
  | Láminas de observación (20) | `Tabula II · Lám. N · <subtítulo>` / `Tabula II · Pl. N · <subtitle>` |
  Las cartelas largas usan el mecanismo de siempre (`.cartela-l` y las clases `.cartela--l26`, `--larga`, `--l40`, `--l52`, `--l64` de
  `atlas2.css` §17, que ponen `cartela()` en `build_atlas.py` y, a mano, las 10 herramientas; el rótulo se oculta por debajo de un ancho
  y queda el número). Con la Tabula delante todas crecen, así que se añadieron dos escalones medidos con un barrido de 1920 a 360 px:
  `--l26` (más de 26 caracteres: sin rótulo por debajo de 410 px; un móvil de 360 px admite 26) y `--l64` (más de 64: por debajo de
  1100 px; la lámina del eclipse, 77, se salía a 1024). Las cartelas de las herramientas llevan siempre el **tema** en `.cartela-l`:
  en un móvil estrecho queda «Tabula I · Nº IV».
  `build_atlas.py` `cartela()` ya cuenta el largo sin las etiquetas `<i>`; la lámina pasa «Tabula II <i>·</i> Lám. N» como número.
- **D. Las guías de Contaminación pasan de Bitácora a Herramientas**, junto al mapa (que sigue siendo la herramienta Nº IV; no hay
  Nº VI): `SECTIONS` de `sync_nav.py` (menú y cajón marcan «Herramientas web»), miga «Herramientas web» / «Web tools» (enlaza a
  `herramientas.html`), cartela `Tabula I · Guías`. Salen de la lista «Catálogos completos» de `bitacora.html` y entran en
  `herramientas.html` como una segunda línea de cierre («Guías y vídeos sobre contaminación lumínica → Guías») y en el mapa como un
  enlace bajo sus dos tarjetas (`.cm-guias`). Las guías ya enlazaban al mapa (botón «Abrir Mapa Interactivo»).
- **I. Cabeceras de las 20 páginas a mano iguales entre sí** (excepto la franja del cockpit): `atlas2.css` §14, regla
  `.pag-wrap:not(.pag-wrap--cockpit) .pag-grab`: caja de grabado de proporción fija 7:6 (280×240 a 1440; 170×146 en móvil, donde ya iba
  encima del texto) con el dibujo **contenido y centrado** (`.grab` absoluto a toda la caja, `aspect-ratio:auto`; la máscara ya era
  `contain`). La caja es más baja que el texto más corto (258 px: miga + cartela + título + 2 líneas de entradilla), así que **nunca
  empuja la cabecera**: el alto lo da el texto y la miga cae siempre a la misma altura. Los dibujos que traen su marco dentro del SVG
  (el histograma de AutoGHS) llenan la caja; los demás flotan dentro de ella: el marco es del dibujo, no de la caja (no se han tocado
  los SVG). `.pag-wrap` solo lo llevan estas 20 páginas: Programas (`.prog-cab`) y los frisos no cambian.

## F5b (13-11-2026): cabecera Atlas II en los 5 catálogos (ES y EN)

Equipamiento, Novedades, Cursos YouTube, Coffee Break y las guías de Contaminación (`contaminacion.html`; el mapa es la herramienta Nº IV).
Todos cuelgan de **III Bitácora** en el menú (`SECTIONS` de `sync_nav.py`) y la Bitácora los lista, así que llevan la cartela
«Tabula III · <nombre>» y la miga «Bitácora» (ES) / «Logbook» (EN). **Desde F5c las guías de Contaminación ya no** (cuelgan de Herramientas: «Tabula I · Guías», miga «Herramientas web»; ver «F5c»). El resto de la cabecera es la de F5a: `.pag-cab` con título
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

## F6 (13-11-2026): limpieza acotada y rama lista para publicar

**Qué se hizo** (sin commit: queda en el árbol de `atlas2` para revisar y confirmar):

- **Versión de caché**: `VERSION` de `tools/sync_nav.py` y `A2_ASSET_V` de `tools/build_atlas.py` pasan a `20261113a`. Comprobado en las 54
  páginas: los 8 CSS/JS propios que cambian respecto a `main` (`atlas2-marco.css`, `atlas2.css`, `atlas2.js`, `tools-base.css`, `tools.css`,
  `astroforecast.css`, `armilar.js`, `capricornus2.js`) se enlazan SIEMPRE con `?v=20261113a`. Sin `?v=` quedan `support.css` (20 páginas),
  `index.js` (4) y `autoghs.js` (2), pero NO han cambiado desde `main` (su caché es la correcta). `index.css?v=1.4` no se sube a mano: el
  único cambio de F6 en él es borrar una regla que nadie usaba (sin efecto visible).
- **Sitemap y hreflang** regenerados con la cadena: idénticos a los de la rama (el sitemap no guarda secciones; `contaminacion.html` y `-en`
  siguen emparejados es/en/x-default). Las 2 redirecciones `pi-workflow` siguen con su `meta refresh` y su `canonical` al destino y fuera del
  sitemap (igual que `cabrascripts`, que ya estaba fuera en la rama).
- **Cabeceras «a la par»** (`.pag-cab--par`, Herramientas y Bitácora, ES y EN): `atlas2.css` §14 pasa a UNA columna por debajo de 1040 px.
  Antes la cartela se salía de su columna entre 1000 y 880 px (hasta +123 px en `herramientas-en` a 880); ahora 0 desbordes en el barrido de
  1920 a 360 px (24 anchos × 4 páginas). A 1060 px y más no cambia nada.
- **Borrado** (`git rm`; siguen en el historial): `atlas/atlas.js`, `tools/capricornus.py`; y la regla `.dashboard-section` de `index.css`.
  Con `grep` previo de cada uno (ninguna página, hoja, script, generador ni workflow de `.github/` los usa). Los workflows de los robots solo
  escriben JSON/`.md` y no dependen de nada borrado.
- **NO borrado a propósito**: `atlas/img/cupula.svg` (lo usa `atlas/atlas2-muestra.html`, `.grab-cupula`); `atlas.css`, `index.css`, `tools.css`
  (las herramientas aún dependen de ellas).

**Qué queda** (inventario escrito en F6; **superado por «Limpieza 14-11-2026» al final**: `atlas.css` y `support.css` ya no existen y `index.css` está purgada; por coincidencia estática de nombres de clase, no medida):

| Hoja | Páginas que la cargan | Clases que casan con alguna de esas páginas |
|---|---|---|
| `index.css` | 22 (las 20 a mano + `cabrascripts` ES/EN) | 27 de 84 |
| `support.css` | 20 (las 20 a mano) | 3 de 25 |
| `atlas/atlas.css` | 22 (las mismas que `index.css`) | 45 de 116; sin uso: la familia `.ah*`, `.ad*`, `.af*`, `.cap-*`, `.mega*`, `.acc`, `.kv`, `.hero-title`, `.sec-title`… |
| `atlas/tools.css` | 8 (AutoGHS, CabraSpace Web, mapa de Contaminación, PixelMath-teca; ES y EN) | 65 de 65 |
| `atlas/tools-base.css` | 20 (las 20 a mano) | 11 de 11 |
| `atlas/astroforecast.css` | 2 (Astro Forecast) | 16 de 20 |

Antes de retirar `atlas.css`: sus clases en uso (`.a3`, `.card`, `.btn`, `.ghost`, `.plate`, `.chip`, `.tile`, `.grid-overlay`, `.radial-glow`…)
hay que mover o rehacer en cada interior de herramienta (decisión D6). `.dashboard-grid` y `.dashboard-col` de `index.css` tampoco las usa
ningún HTML (`index.js` solo usa `.dashboard-item`, `-meta` y `-loading`): candidatas para el siguiente barrido. Otros ficheros sin
referencias (no tocados, no son de Atlas II): `atlas/img/ring.svg`, `tools/optimize_images.py`, `cors_proxy.js`, `vercel-proxy/`.

**Publicar** (fusionar `atlas2` en `main`; `main` es producción y los robots empujan a ella cada pocas horas). PowerShell, desde la carpeta
del repo:

```powershell
cd "C:\Users\ninoc\Documents\PixInsight\CabraSpace\Pagina Web"
git status                                  # revisar los cambios de F6 y, si valen, confirmarlos en atlas2
git add -A
git commit -m "Atlas II, F6: version de cache, cabeceras a la par, limpieza"
git fetch origin
git checkout main
git pull --ff-only origin main              # trae lo que hayan empujado los robots
git merge --no-ff atlas2 -m "Atlas II: fusion de atlas2 en main"
python -X utf8 tools\build_atlas.py
python -X utf8 tools\sync_nav.py
python -X utf8 tools\seo_inject.py
git status --short                          # debe salir vacio: la cadena es idempotente
node tools\check_site.mjs --baseline tools\check_site_baseline.json   # con el servidor local encendido: 0 fallos nuevos
python -X utf8 tools\check_relatos.py       # 10/10
git push origin main                        # GitHub Pages publica main tal cual
```

El 13-11-2026 la fusión en seco (`git merge-tree`) salió limpia: `main` llevaba 2 commits de los robots (noticias; solo `novedades.json`,
`equipamiento.json`, `latest.json` y `catalogo_productos.md`) que `atlas2` no tiene, y ninguno toca un fichero de la rama.

**Volver atrás**: `git log --merges -1` da el commit de fusión; `git revert -m 1 <hash>` y `git push origin main`. Los robots solo tocan JSON
y no estorban. Ojo: tras revertir, para volver a fusionar `atlas2` hay que revertir antes el propio revert.

## Menores 6a-6f (14-11-2026, rama `menores-1114`)

`VERSION` de `sync_nav.py` = `20261114a` (`A2_ASSET_V` sigue en `20261113a`: `armilar.js` y `capricornus2.js` no cambiaron).
- **6a** `tools-base.css`: `.pag-wrap` toma el ancho y el padding del interior (AutoGHS y catalogos 1050/24 px, Astro Forecast 1028/24, PixelMath-teca solo padding) con `:has(+ .filete + …)`. La cabecera de CabraSpace Web (cockpit) y las del mapa de Contaminacion (interior Atlas I de 80/40/18 px) no se tocan.
- **6b** `atlas2.css` §17: la regla de `prefers-reduced-motion` ya no alcanza al interior de las herramientas (`main.container`, `.aw-section`, `.cm-maps`): sigue apagando transiciones y animaciones del marco y de las paginas de Atlas II. (Corrige lo que aqui se daba por «no neutralizable».)
- **6c** `cursos-youtube-en.html`: `relativeEn()` traduce al pintar «hace 2 a» / «Emitido hace 7 m» (`youtube_courses.json` guarda el texto de YouTube en español).
- **6d/6e** `tools-base.css`: insignias de nivel y contadores de Cursos en la paleta de penumbra; `canvas` y las barras de Astro Forecast con el filtro `#cb-noche`. Siguen en color: el verde/amarillo semantico de «Abierto/Cerrado» y los puntos de Astro Forecast, y los iframes que no se pueden estilar.
- **6f** `atlas2.js` §5 + `atlas2.css`: el rotulo de la cartela se oculta solo si no cabe en su columna (`html.fit-js`, `.cartela--corta`); los umbrales por caracteres quedan solo como respaldo sin JavaScript.

## Limpieza 14-11-2026 (rama `limpieza-1114`, desde `menores-1114`): `atlas.css` retirada, `index.css` purgada

**Estado nuevo.** Las 22 páginas que aún llevaban hojas viejas (las 20 a mano + `cabrascripts` ES/EN) ya NO cargan `atlas/atlas.css` ni `support.css`:
- `atlas/atlas.css` y `support.css`: `git rm` (siguen en el historial). `support.css` no tenía NINGUNA regla viva (ninguna clase suya aparece en el
  HTML ni en el JS de esas 20 páginas: modal de pago y tarjetas de apoyo de una versión antigua).
- `index.css` (sigue en las 22): purgada, y **lleva al final «Capa de Atlas I»**: las reglas de `atlas.css` que aún casan con algo (61 selectores de 258:
  `:root` de tokens, `body{background,color}`, `.grid-overlay/.radial-glow{display:none!important}`, `:is(.a3…) .btn/.card/.ghost/.chip/.tile…` del mapa de
  Contaminación, `footer.af`…). Va AL FINAL de `index.css` porque `atlas.css` se cargaba justo después de `index.css`: se conserva el orden de cascada y,
  como no se movió nada por detrás de `atlas2-marco.css`/`atlas2.css`, no hizo falta tocar `tools-base.css`. Sus `url(img/…)` pasaron a `url(atlas/img/…)`
  (la hoja estaba en `atlas/`; `index.css` está en la raíz y `img/` de la raíz es otra carpeta).
- `atlas/tools.css`: **0 reglas muertas** (112 selectores, todos con elemento en alguna de sus 8 páginas). No se tocó el contenido (solo un comentario).
- `tools/sync_nav.py` (`VERSION = 20261114b`): ya no escribe `atlas.css`; quita un enlace suelto; las páginas sin interior Atlas II colocan fuente y marco
  tras su última hoja local; y `index.css?v=` toma el `?v=` de `VERSION` (antes era `?v=1.4` a mano: sin esto, un visitante con la caché vieja de
  `index.css` vería la purga a medias).
- Bytes (blobs del repo, LF): `index.css` 33 989 + `atlas.css` 27 401 + `support.css` 6 198 = 67 588 → `index.css` 21 074. **−46 514 bytes (−68,8 %).**
  Selectores muertos eliminados: 152 de `index.css`, 197 de `atlas.css`, 37 de `support.css`.

**Cómo se decidió qué está muerto** (herramientas en `propuestas-estetica/limpieza-1114/instrumento/`, copiadas de la carpeta de trabajo):
1. *Etapa 1, estática.* Un selector está vivo si cada clase/id/etiqueta/atributo `data-`/`aria-` que exige aparece en el HTML de las páginas que cargan esa hoja
   (solo valores de `class="…"`, `id`, etiquetas y atributos; NO el texto visible, que hizo falta excluir: «ad», «card», «row» son palabras corrientes) o en
   alguna cadena de su JavaScript (clases que el JS crea; también `'prefijo-' + x`). `:is()/:where()` se expanden; `:not()`, `:has()` y pseudo-clases no exigen nada.
2. *Etapa 2, DOM real.* Los selectores vivos de la etapa 1 se relajan (se quitan clases/ids que el JS puede cambiar, atributos y pseudo-clases) y se buscan con
   `querySelector` en las 22 páginas cargadas en Chrome (1440 px): los que no casan con ningún elemento se tiran (11 de `atlas.css`, 4 de `index.css`:
   `.ti*`, `.dashboard-item h4`, `body.night-vision video`…).
3. Se conservan `@import` y `@font-face`, y un `@keyframes` solo si su nombre se usa. Los selectores con estado (`:hover`, `.open`, `.scrolled`…) se juzgan por su base.
Qué NO se ha hecho: quitar reglas que casan con elementos pero están pisadas por otra hoja (no se puede probar para todos los estados: hover, foco, JS); las variables
CSS sin uso de `:root` (inofensivas).

**Verificación** (rama contra `git archive menores-1114` servida aparte; 54 páginas × 375/1040/1440 px × día/noche = 324 configuraciones por lado; Chrome sin cabeza por
CDP): por elemento, hash de TODAS las propiedades calculadas (≈350 por elemento, `--*` ordenadas, px a 0,1) + su rectángulo + `::before/::after` con contenido, comparando
`querySelectorAll('*')` sin los `<link>`. Se bloquea todo lo que no es `127.0.0.1` (Google Fonts, CDN, teselas, APIs) y se llevan las animaciones finitas a su final y
las infinitas a 0, para que dos cargas iguales den lo mismo.
- **Control cero visto fallar (el instrumento no es determinista del todo):** antes contra antes (dos cargas del mismo código) da diferencias en 11 configuraciones de estilo y
  39 de píxeles (portada y `en`: el Capricornio de `capricornus2.js` está animado por JS; Contaminación: animaciones de entrada que mueven 1 px las tarjetas; Astro
  Forecast: datos en vivo bloqueados, nº de elementos variable). Una primera versión del instrumento (sin bloquear red ni esperar a `atlas2.js`) daba 47 y 97: el control
  es lo que obligó a arreglarlo.
- **Control positivo:** inyectar `letter-spacing:.3px` en `main`/`.container` cambia entre el 87 % y el 99 % de los elementos de 5 páginas: el instrumento ve cualquier
  cambio de estilo.
- **Resultado, 22 páginas tocadas × 12 configuraciones: 0 diferencias de estilo calculado** (y 0 en el resto salvo el Capricornio animado de portada y `en`, idéntico al
  control). Píxeles: el máximo está en Contaminación (≈250 000 px distintos), igual de grande entre dos cargas de la MISMA versión (A-A hasta 125 000 en ese mismo
  caso; con 5 cargas «antes» y 4 «después» hay pares A-B con 0 píxeles distintos). Montaje de las 3 páginas con más diferencia, mirado: idénticas a simple vista.
- `node tools/check_site.mjs --baseline tools/check_site_baseline.json`: 0 fallos (54 páginas, 155 URLs locales). `python tools/check_relatos.py`: 10/10.
  La cadena `build_atlas → sync_nav → seo_inject` es idempotente (mismo `git diff` al repetirla).

**Páginas que se quedan con hojas viejas:** ninguna con `atlas.css`/`support.css`. Las 22 siguen con `index.css` (purgada) y 8 con `tools.css`: se retiran al
rediseñar cada interior (D6).
**`atlas/img/cupula.svg` y `atlas2-muestra.html` se quedan:** `atlas2-muestra.html` es el muestrario del sistema (`noindex`, ningún enlace del sitio lo apunta, pero
`tools/atlas2/carta_capricornio.py` lo ESCRIBE y `atlas2.css` define `.grab-cupula` con `cupula.svg`); no es retirable sin tocar el generador.
**Publicar:** igual que en F6 (fusión en `main`, cadena, comprobadores). El `?v=20261114b` ya está en las 52 páginas con cabecera.

