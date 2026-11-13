# Atlas II en el repo (F1 de la migración)

Desde el 12-11-2026 la copia del repo es la FUENTE del sistema. El prototipo `CabraSpace/propuestas-estetica/v2/`
(y `project/p1,p3,p5`) queda como referencia congelada: no se sigue editando allí.
**F2 (12-11-2026):** el MARCO ya está en las 54 páginas: `atlas/atlas2-marco.css` + `atlas/atlas2.js`, con el marcado
que escribe `tools/sync_nav.py`. **F3 (12-11-2026):** el interior nuevo (`atlas/atlas2.css`) lo cargan ya las 10 páginas
de portada e índices (ver «F3» abajo); **F4 (12-11-2026):** también las 20 láminas de observación (ver «F4»); quedan las
20 páginas a mano (F5). El muestrario se ve en
`atlas/atlas2-muestra.html` (`noindex`, en `atlas/` a propósito: `sync_nav.py` y `seo_inject.py` solo recorren los
`*.html` de la raíz). La convivencia con `index.css` / `atlas.css` está explicada en `atlas/LEEME.md`.

## Qué es cada cosa

| Fichero | Qué es |
|---|---|
| `atlas/atlas2-marco.css` | (F2) El marco, extraído de `atlas2.css`: tokens (con la noche en penumbra, D5), variables heredadas (`--gold-primary`, `--bg-card`…, antes sección 1b), hoja con orla, cabecera con cajón móvil, pie, modo noche y una sección de compatibilidad temporal. Lo cargan las 54 páginas, la última hoja. |
| `atlas/atlas2.css` | Interior del sistema (base, botones, cartelas, héroe, grabados, herramientas, láminas, bitácora, composición, frisos, página secundaria). Necesita `atlas2-marco.css` antes. El margen de la hoja ya no es un `padding` del `body` (lo da `.hoja`). |
| `atlas/atlas2.js` | (F2) Único script de cabecera de las 54 páginas: orla graduada, filtro `#cb-noche` de respaldo, modo noche (`localStorage 'night-vision'`), cajón móvil `#atlas-drawer`. La sección actual ya no la marca el JS: la escribe `sync_nav.py`. |
| `atlas/armilar.js` | Esfera armilar animada. **Generado** por `tools/atlas2/armilar/build_armilar.py`: no se edita. |
| `atlas/capricornus2.js` | Capricornio animada (el `capricornus.js` del prototipo; el «2» evita confundirlo con `tools/capricornus.py`). Su bloque `DATA-BEGIN/END` lo reescribe `carta_capricornio.py`. |
| `atlas/img/*.svg` | Grabados-máscara nuevos (armilar, astrolabio, octante, refractor, cúpula, horizonte, taller, archivo, las tres capas de la carta y `rosa.svg`). Los que ya existían idénticos (observatorio, factorias, pizarra, histograma, placa) no se duplican. |
| `atlas/atlas2-muestra.html` | Página de humo: el muestrario del prototipo con la carta de Capricornio y la esfera armilar montadas. |
| `tools/atlas2/carta_capricornio.py` + `datos/` | Carta (3 SVG), bloque de datos de `capricornus2.js` y el SVG animado de la página (entre `CAP-SVG-BEGIN/END`). Necesita `matplotlib` y `fonttools`. |
| `tools/atlas2/armilar/` | `armilar.src.js` (fuente del motor) + `build_armilar.py` (escribe `atlas/armilar.js`) + `static-data.json` (salida intermedia) + `test-continuity.js` (prueba de saltos entre fotogramas, se carga desde la consola). |
| `tools/atlas2/p1/` | `instrumentos.py` (armilar, astrolabio, octante, refractor) y su `grabado.py`. |
| `tools/atlas2/d3/` | (F3) `techo.py`: observatorio de techo corredizo en corte (D3, versión 2) → `atlas/img/techo-corredizo.svg`; `llamadas.json`, posiciones de las letras a–f (las lee `build_atlas.py`). |
| `tools/atlas2/p3/laminas.py` | Cúpula en corte (por defecto solo `cupula.svg`; `--todo` escribe también telescopio y despiece, que no se usan). |
| `tools/atlas2/p5/` | `horizonte.py`, `taller.py`, `archivo.py` y su `grabado.py` (distinto del de `p1/`). |

## Regenerar (desde la raíz del repo)

```
python tools/atlas2/p1/instrumentos.py
python tools/atlas2/p3/laminas.py
python tools/atlas2/p5/horizonte.py ; python tools/atlas2/p5/taller.py ; python tools/atlas2/p5/archivo.py
python tools/atlas2/armilar/build_armilar.py
python tools/atlas2/carta_capricornio.py            # --check solo mide el registro, no escribe
python tools/atlas2/d3/techo.py
```
(tras la carta o el techo, la cadena de la web: `build_atlas.py` → `sync_nav.py` → `seo_inject.py`)

Escriben en `atlas/img/`, `atlas/armilar.js`, `atlas/capricornus2.js` y `atlas/atlas2-muestra.html`. Para probar sin pisar
nada: `ATLAS_IMG_OUT`, `ATLAS_ARMILAR_OUT`, `ATLAS_JS_OUT`, `ATLAS_HTML_OUT` (carpeta o fichero de salida).
Medido el 12-11-2026: los 11 SVG y `armilar.js` salen idénticos byte a byte (SHA-256) a los del prototipo.

## Lo que falta / límites

- `rosa.svg` viene de `propuestas-estetica/project/p2/atlas_celeste.py`; ese generador NO se ha copiado (no estaba en el encargo).
- `armilar.js` conserva en su cabecera rutas del prototipo (`v2/...`): es salida generada, y cambiar el comentario en
  `armilar.src.js` rompería la igualdad byte a byte con el prototipo. Se corrige en la primera edición real del motor.
- La latitud de `p1/instrumentos.py` (38,15°, AstroCamp) está marcada allí «NOT VERIFIED».
- Comprobador de la web: `node tools/check_site.mjs` (ver cabecera del fichero); línea base en `tools/check_site_baseline.json`.
- `atlas2-muestra.html` carga ya `atlas2-marco.css` + `atlas2.css`, pero conserva la cabecera del prototipo (sin cajón):
  por debajo de 980 px su menú no se despliega. No es una página del sitio.

## F3 (12-11-2026): portada e índices con el interior nuevo

- Las 10 páginas de `tools/build_atlas.py` (portada, Observaciones, Herramientas, Programas, Bitácora; ES y EN) salen
  con el marcado del prototipo y cargan `atlas2-marco.css` + `atlas2.css`, **sin** `index.css` ni `atlas.css`
  (`page(..., interior="a2")`; `sync_nav.py` reconoce el enlace a `atlas2.css` y no les añade `atlas.css`). Las 20
  láminas siguen con `interior="a1"`, byte a byte como antes. Detalle de la convivencia: `atlas/LEEME.md`.
- **Capricornio**: la portada ya no usa `tools/capricornus.py` (gnomónica propia; queda sin uso, F6). `build_atlas.py`
  importa `carta_capricornio.figure_for_page(lang)` (solo biblioteca estándar: matplotlib/fontTools se importan
  dentro de `chart()`), así que la figura de la portada es la misma función que la de la muestra y que el bloque de
  datos de `capricornus2.js`. Tras cambiar la carta: `carta_capricornio.py` **y** la cadena build_atlas → sync_nav →
  seo_inject. Comprobado: salida idéntica por SHA-256 antes y después del cambio, `--check` 0,00 px.
- **D3**: `tools/atlas2/d3/techo.py` escribe `atlas/img/techo-corredizo.svg` (o `$ATLAS_IMG_OUT`) y
  `tools/atlas2/d3/llamadas.json` (posición de las letras a–f, que lee `build_atlas.py`). Regenera el SVG idéntico
  (SHA-256 0acc341d…) al aprobado en `propuestas-estetica/d3-techo/`. `atlas/img/cupula.svg` queda sin usar (F6).
- Piezas nuevas en `atlas2.css` (documentadas en su índice): `.grab-techo` (máscara declarada entera), `.desde`,
  `.prog-cab`, `.prog`, `.reg-mas`, `.cartela-l`/`.cartela--larga` (rótulo que se oculta en móvil si la cartela pasa
  de 32 caracteres) y el ▶ destacado de `.cap-play.paused` (D1).

## F4 (12-11-2026): las 20 láminas con el interior nuevo y su relato

- `build_obs_page()` reescrita con el diseño de `v2/transito-qatar1b.html` y sus variantes (cielo profundo, eclipse);
  detalle de qué hace cada parte en `atlas/LEEME.md` («F4»). `page()` ya solo escribe Atlas II (se quitó la rama
  `interior="a1"` y las funciones de Atlas I que solo usaban las láminas: `obs_card`, `plate_img`, `plate_ph`,
  `breadcrumb`, `kv_rows`, `neighbours`).
- Piezas nuevas en `atlas2.css` (en su índice): `.det`, `.relato`, `.cita`, `.refs` (`.ref-n`, `.ref-tx`, `.ref-est`,
  `--preprint`, `.refs-inf`), `.lam-natural--foto`, `.fases`/`.fases-l`, `.video--campo`/`.video--16x9`, la lámina
  «siguiente» espejada en `.pasa-fin`, y `.cartela--l40`/`--l52` (cartelas largas: rótulo oculto por debajo de 760 / 960
  px). Cambian dos piezas existentes, solo usadas por las láminas: `.lam-natural img` y `.video` ya no fijan proporción
  en CSS (la dan `width`/`height`, o la clase de caja del vídeo).
- `VERSION` de `sync_nav.py` **no** se ha subido (cambiaría las 54 páginas, también las 20 a mano): se sube una vez en F6.
- Herramientas nuevas: `tools/miniaturas.py` (miniaturas WebP de las curvas) y `tools/check_relatos.py` (fidelidad de los
  relatos frente a RELATOS.md; visto fallar con cuatro alteraciones a propósito).

## Pendiente para F5–F6 (notas de F4)

- `publish_from_inbox.py` no llama a `miniaturas.py` (no se tocó): un tránsito nuevo sale en las rejillas con su PNG
  original hasta que alguien ejecute `python tools/miniaturas.py`. Se puede añadir a su lista `BUILD` si Pillow está
  en la máquina que publica.
- Las cartelas de la cabecera «a la par» de Herramientas y Bitácora (F3) se salen de su columna entre 880 y 1020 px
  (medido en F4 con un barrido de anchos; no es de F4 y no se ha tocado).
- Superíndices de las llamadas: objetivo táctil pequeño (por debajo de 44 px), como en cualquier texto con notas.

## Pendiente para F4–F5 (escrito en F3; F4 ya hecho)

- **Numeración D2**: hecha en las 10 páginas de F3 (cartelas Tabula I–IV). Las cabeceras de las
  herramientas (F5a, 13-11-2026): CabraSpace Web «Nº I», Astro Forecast «Nº II», AutoGHS «Nº III», Contaminación mapa «Nº IV»,
  PixelMath-teca «Nº V» (hechas). Numeran herramientas, no secciones, igual que el bento de la portada y la lista de
  Herramientas (Nº I–V): si se mantienen, ya coinciden.
- Al migrar cada página, quitar su parte de la sección 7 «compatibilidad» de `atlas2-marco.css` (F5a: la de PixelMath-teca
  ya está fuera; quedan las de los catálogos). Detalle de F5a en `atlas/LEEME.md`.
- F4: `build_obs_page` puede reutilizar `lam_card`, `lam_meta`, `nb_title` y `thumb_alt` (ya en `build_atlas.py`) para
  sus «Más en…», y pasar a `interior="a2"`. Los «Más en exoplanetas» enlazan a `observaciones.html#exoplanetas`: el
  ancla funciona con los filtros nuevos.
- F5: las páginas a mano que pasen a `atlas2.css` solo tienen que enlazarlo en su `<head>`: `sync_nav.py` ya les quita
  `atlas.css` y ordena fuente · marco · interior.
- Los `<canvas>` de las herramientas (resultado de PixelMath-teca, visor de CabraSpace Web) no se filtran en modo noche
  (como antes de F2): siguen saliendo en color. Decidir en F5 si se filtran.
- `index.css:1395` (`.dashboard-section`, padding-top 150px) no lo usa ninguna página: F6.
