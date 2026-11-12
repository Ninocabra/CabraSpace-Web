# Atlas II en el repo (F1 de la migración)

Desde el 12-11-2026 la copia del repo es la FUENTE del sistema. El prototipo `CabraSpace/propuestas-estetica/v2/`
(y `project/p1,p3,p5`) queda como referencia congelada: no se sigue editando allí.
Nada de esto lo carga todavía ninguna página real. Se ve en `atlas/atlas2-muestra.html` (`noindex`, en `atlas/`
a propósito: `sync_nav.py` y `seo_inject.py` solo recorren los `*.html` de la raíz).

## Qué es cada cosa

| Fichero | Qué es |
|---|---|
| `atlas/atlas2.css` | Hoja del sistema (tokens, hoja con orla, cabecera, láminas, grabados, noche…). La sección 1b es propia del repo: define las variables viejas (`--gold-primary`, `--bg-card`…) y las cortas de Atlas I con el valor del sistema nuevo. Cada valor lleva su origen en el comentario. |
| `atlas/atlas2.js` | Orla graduada, modo noche (`localStorage 'night-vision'`), menú móvil, sección activa. |
| `atlas/armilar.js` | Esfera armilar animada. **Generado** por `tools/atlas2/armilar/build_armilar.py`: no se edita. |
| `atlas/capricornus2.js` | Capricornio animada (el `capricornus.js` del prototipo; el «2» evita confundirlo con `tools/capricornus.py`). Su bloque `DATA-BEGIN/END` lo reescribe `carta_capricornio.py`. |
| `atlas/img/*.svg` | Grabados-máscara nuevos (armilar, astrolabio, octante, refractor, cúpula, horizonte, taller, archivo, las tres capas de la carta y `rosa.svg`). Los que ya existían idénticos (observatorio, factorias, pizarra, histograma, placa) no se duplican. |
| `atlas/atlas2-muestra.html` | Página de humo: el muestrario del prototipo con la carta de Capricornio y la esfera armilar montadas. |
| `tools/atlas2/carta_capricornio.py` + `datos/` | Carta (3 SVG), bloque de datos de `capricornus2.js` y el SVG animado de la página (entre `CAP-SVG-BEGIN/END`). Necesita `matplotlib` y `fonttools`. |
| `tools/atlas2/armilar/` | `armilar.src.js` (fuente del motor) + `build_armilar.py` (escribe `atlas/armilar.js`) + `static-data.json` (salida intermedia) + `test-continuity.js` (prueba de saltos entre fotogramas, se carga desde la consola). |
| `tools/atlas2/p1/` | `instrumentos.py` (armilar, astrolabio, octante, refractor) y su `grabado.py`. |
| `tools/atlas2/p3/laminas.py` | Cúpula en corte (por defecto solo `cupula.svg`; `--todo` escribe también telescopio y despiece, que no se usan). |
| `tools/atlas2/p5/` | `horizonte.py`, `taller.py`, `archivo.py` y su `grabado.py` (distinto del de `p1/`). |

## Regenerar (desde la raíz del repo)

```
python tools/atlas2/p1/instrumentos.py
python tools/atlas2/p3/laminas.py
python tools/atlas2/p5/horizonte.py ; python tools/atlas2/p5/taller.py ; python tools/atlas2/p5/archivo.py
python tools/atlas2/armilar/build_armilar.py
python tools/atlas2/carta_capricornio.py            # --check solo mide el registro, no escribe
```

Escriben en `atlas/img/`, `atlas/armilar.js`, `atlas/capricornus2.js` y `atlas/atlas2-muestra.html`. Para probar sin pisar
nada: `ATLAS_IMG_OUT`, `ATLAS_ARMILAR_OUT`, `ATLAS_JS_OUT`, `ATLAS_HTML_OUT` (carpeta o fichero de salida).
Medido el 12-11-2026: los 11 SVG y `armilar.js` salen idénticos byte a byte (SHA-256) a los del prototipo.

## Lo que falta / límites

- `rosa.svg` viene de `propuestas-estetica/project/p2/atlas_celeste.py`; ese generador NO se ha copiado (no estaba en el encargo).
- `armilar.js` conserva en su cabecera rutas del prototipo (`v2/...`): es salida generada, y cambiar el comentario en
  `armilar.src.js` rompería la igualdad byte a byte con el prototipo. Se corrige en la primera edición real del motor.
- La latitud de `p1/instrumentos.py` (38,15°, AstroCamp) está marcada allí «NOT VERIFIED».
- Comprobador de la web: `node tools/check_site.mjs` (ver cabecera del fichero); línea base en `tools/check_site_baseline.json`.
