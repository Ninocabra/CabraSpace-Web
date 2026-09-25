# Estilo Atlas de la web — cómo está hecho y cómo se mantiene

## Qué hay aquí

| Fichero | Qué es |
|---|---|
| `atlas/atlas.css` | Capa común. Se carga después de `index.css`: pasa todas las páginas a la paleta Atlas (carbón cálido, oro, Bodoni + Figtree) y da estilo a la cabecera, el cajón móvil, el pie y los componentes de las páginas nuevas. |
| `atlas/atlas.js` | Cajón móvil, sección activa del menú, modo noche (misma clave `night-vision` de siempre) y fondo de la cabecera al hacer scroll. Sustituye a `mobile-menu.js`. |
| `atlas/astroforecast.css` | Titular y paneles Atlas de Astro Forecast. |
| `atlas/img/` | Logo dorado, grano, retícula, anillo y capturas usadas en varias páginas. |
| `obs/observaciones.json` | Tu trabajo: una entrada por observación. `facts` guarda cada dato con su fuente (fichero y línea del informe); `facts_display` es lo que se ve en la ficha. |
| `obs/<slug>/` | Imágenes, curvas y vídeos de cada observación. |

## Los tres comandos (desde la raíz del repo, siempre en este orden)

```
python tools/build_atlas.py    # portada, Observaciones, Herramientas, Programas, Bitácora y fichas (ES y EN)
python tools/sync_nav.py       # cabecera, cajón y pie en TODAS las páginas
python tools/seo_inject.py     # canonical, hreflang, Open Graph y sitemap.xml
```

Las páginas generadas llevan la marca `ATLAS-PAGE`: no se editan a mano, se edita
`tools/build_atlas.py` (textos en `T("español", "english")`) y se vuelve a generar.

## Añadir una observación

1. Copia sus ficheros web a `obs/<slug>/` (JPG de ≈2400 px para la imagen completa, recorte 1600×1200
   y miniatura 800×600; curvas PNG de ≈1600 px; vídeos MP4 de menos de 30 MB).
2. Añade su entrada a `obs/observaciones.json` copiando una del mismo tipo (`deep-sky`, `transit` o
   `eclipse`) y cambiando slug, fechas, `title`, `media` y `facts_display`.
3. Ejecuta los tres comandos. La portada, el menú («Lo último»), Observaciones y los «Más en…» se
   actualizan solos.

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

## Versión de las hojas de estilo

`tools/sync_nav.py` pone `?v=VERSION` a `atlas.css`, `atlas.js` y a las capas de `EXTRA_CSS`. Si
cambias un CSS, **sube `VERSION` en sync_nav.py y re-ejecútalo**: si subes el `?v=` a mano en las
páginas, la siguiente ejecución lo devuelve al valor viejo y los navegadores siguen con la copia antigua.

## Fases del eclipse

`tools/fases_eclipse.py` rehace `obs/eclipse-2026/fase-*.jpg` desde los fotogramas de la Vespera (disco
E:) con los centros medidos por el pipeline del timelapse (`centros2.csv`, solo `cal >= 0.8`), y la
totalidad desde la corona de CabraEclipse. Imprime la lista de fases para `observaciones.json`.
