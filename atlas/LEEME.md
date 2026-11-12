# Estilo Atlas de la web — cómo está hecho y cómo se mantiene

## Qué hay aquí

| Fichero | Qué es |
|---|---|
| `atlas/atlas2-marco.css` | **Desde F2 (12-11-2026): el marco de las 54 páginas** — tokens, variables heredadas, hoja con orla, cabecera con su cajón móvil, pie y modo noche (penumbra). Se carga la ÚLTIMA. Ver «Convivencia de hojas» abajo. |
| `atlas/atlas2.js` | **Desde F2: el único script de cabecera** — orla, filtro de noche, modo noche (clave `night-vision` de siempre) y cajón móvil. Sustituye a `atlas/atlas.js` en todas las páginas. |
| `atlas/atlas2.css` | Componentes del INTERIOR de Atlas II (láminas, herramientas, bitácora…). Aún no lo carga ninguna página: lo cargarán las migradas en F3–F5, después del marco. |
| `atlas/atlas.css` | Capa de Atlas I. Sigue cargada: el interior de las páginas (`.a3 …`, `--gx`, `.card`, `.plate`…) depende de ella. Sus reglas de cabecera/cajón/pie (`.ah`, `.ad`, `.af`) ya no casan con nada (F6 las borra). |
| `atlas/atlas.js` | Script de cabecera de Atlas I. **Ya no lo carga ninguna página** (F2); se borra en F6. No cargarlo junto a `atlas2.js`: los dos alternarían el modo noche y un clic se anularía. |
| `atlas/astroforecast.css` | Titular y paneles Atlas de Astro Forecast. |
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
   `eclipse`) y cambiando slug, fechas, `title`, `media` y `facts_display`.
3. Ejecuta los tres comandos. La portada, Observaciones y los «Más en…» se actualizan solos. (Desde F2 el
   menú ya no lleva «Lo último»: una observación nueva no reescribe la cabecera de todas las páginas.)

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
Estilos: `.tl-top` / `.tl-art.art-<nombre>` en `atlas/tools.css` (Astro Forecast: `.aw-obs`).

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
- `atlas2.css` (interior nuevo) NO se carga aún: su base pisa `body`, `h1`, `a`, `img`, `.wrap`, `.btn`…

Qué falta para F3–F5: cargar `atlas2.css` página a página al migrar su `<main>` (F3 portada e índices, F4 láminas,
F5 herramientas y catálogos), quitar al migrar cada una su parte de la sección 7, y en F6 retirar `atlas.css`,
`atlas.js` y lo muerto de `index.css`. Numeración D2 (I Herramientas · II Observaciones · III Bitácora · IV
Programas): el marco ya la usa; el interior aún no (ver `tools/atlas2/LEEME.md`).

## Versión de las hojas de estilo

`tools/sync_nav.py` pone `?v=VERSION` a `atlas.css`, `atlas2-marco.css`, `atlas2.js` y a las capas de `EXTRA_CSS`. Si
cambias un CSS, **sube `VERSION` en sync_nav.py y re-ejecútalo**: si subes el `?v=` a mano en las
páginas, la siguiente ejecución lo devuelve al valor viejo y los navegadores siguen con la copia antigua.

## Fases del eclipse

`tools/fases_eclipse.py` rehace `obs/eclipse-2026/fase-*.jpg` desde los fotogramas de la Vespera (disco
E:) con los centros medidos por el pipeline del timelapse (`centros2.csv`, solo `cal >= 0.8`), y la
totalidad desde la corona de CabraEclipse. Imprime la lista de fases para `observaciones.json`.
