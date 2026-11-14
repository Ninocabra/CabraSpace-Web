# Curación de la Bitácora por correo

Lo que el filtro estricto del scraper no publica pero podría interesar llega cada día en el correo como
**candidata numerada**; contestas con los números y se publican solas.

## Cómo contestar

Responde al correo del resumen (arriba del todo, no debajo de la cita) con cualquiera de estas formas:

| Escribes | Resultado |
|---|---|
| `publica 2, 5 y 7` · `2,5,7` · `2 5 7` · `publica la 2 y la 5` | se publican esas |
| `del 2 al 4` · `2-4` | se publican 2, 3 y 4 |
| `todas` · `publica todas menos la 3` | todas / todas salvo esas |
| `ninguna` · `descarta` | se descartan todas |

- **Todo lo que no nombres se rechaza** (queda anotado como rechazado, no vuelve a salir y enseña al sistema).
- El número es la posición **en ese correo**: no cambia aunque llegue otro resumen después.
- No toques el `[CB-…]` del asunto: es como se sabe a qué resumen contestas.
- Si la respuesta no se entiende (cualquier palabra que el lector no conozca, p. ej. una frase suelta),
  **no se hace nada** y puedes volver a contestar. `descarta 3` es ambiguo y tampoco actúa.
- Solo vale **la primera respuesta aplicada** a cada resumen. Hasta ~21 días después del envío.
- Tarda como mucho una hora (la revisión es horaria) más el despliegue de la web.

## Qué es una candidata (criterios relajados)

Las que pasan el filtro estricto siguen publicándose solas, sin cambios (`tools/scraper_equipment.py`).
Es candidata un item nuevo (sin duplicar URL contra la Bitácora, las pendientes o lo ya decidido) que **no
se publicó** y cumple una (`relaxed_reason`):

1. **cupo** — pasó pre-filtro y dedup estrictos pero no cupo en un tope del run.
2. **prefiltro** — prensa que el estricto descartó (exige marca + tipo de equipo o modelo) y que a) cita una
   marca conocida sin equipo ni modelo, b) habla de equipo de astrofotografía sin marca, o c) es una reseña
   editorial («REVIEW:», «Hands-on:», «First look:») sin vocabulario de misión espacial.
3. **ia** — la IA lo marcó «no relevante» pero el titular cita una marca conocida (o es del canal oficial de la marca).

**Nunca** son candidatas: relleno (`is_engagement_noise`), editores/tiendas bloqueados, foros y Reddit (salvo
«cupo»), duplicados de un modelo ya cubierto, ni nada sin marca ni equipo. Las marcas que son palabras de
astronomía (Orion, Dwarf, Pier…) no cuentan como señal (`AMBIGUOUS_BRANDS`).

## Aprendizaje (fase 1)

- Las últimas 40 decisiones (título, fuente, aceptada/rechazada) se inyectan como ejemplos en el prompt de
  Gemini que puntúa cada candidata 0-10 (`curacion.build_candidate_prompt`). ≤ 2 se descarta; el resto se ordena por puntuación.
- Fuentes con ≥ 5 decisiones en 120 días y **0 aceptadas**: se silencian (no entran). Aceptación < 25 %: −2 puntos. ≥ 60 %: +1.
- Para reabrir una fuente silenciada, borra sus líneas de `tools/decisiones.json`.
- La fase 2 (aprender reglas del filtro) **no** está hecha.

## Seguridad del lector de respuestas (`curacion.check_message`)

Un correo solo se atiende si **todo** esto se cumple; si no, se ignora y solo se cuenta:
1. `From` único y **exactamente** `RESUMEN_TO` (la misma dirección a la que se envía el resumen).
2. Es una respuesta (`In-Reply-To`/`References` o `Re:`) y **no** lleva la cabecera `X-CabraSpace-Digest` (esa es la copia del propio resumen).
3. La cabecera `Authentication-Results` **más alta** la puso Gmail (`mx.google.com`) con `dkim=pass` firmado por el dominio del dueño y `spf=pass` de ese dominio. Una cabecera falsificada por debajo no cuenta.
4. Lleva el token `CB-AAAAMMDD-xxxxxx` de un resumen que conocemos.

Un correo no se aplica dos veces (hash de su `Message-ID` en `curacion_digests.json`) ni un resumen se
resuelve dos veces. El registro de Actions solo muestra **recuentos** (repo público): nunca direcciones, contraseña ni cuerpos.
IMAP se abre en solo lectura y solo si hay algún resumen sin contestar.

## Ficheros

| Fichero | Qué es |
|---|---|
| `tools/scraper_equipment.py` (bloque `CURATION-BEGIN/END` y ganchos en `main`) | genera candidatas con los criterios relajados y las puntúa con Gemini |
| `tools/curacion.py` | lógica sin red: estado, lector de respuestas, seguridad, decisiones, aprendizaje |
| `tools/resumen_diario.py` | añade la sección «Candidatas» numerada al correo y registra qué número era cada una |
| `tools/procesar_respuestas.py` | lee las respuestas por IMAP y publica en `equipamiento.json` |
| `.github/workflows/curacion_respuestas.yml` | lo lanza cada hora (minuto 41) |
| `tools/candidatas.json` | candidatas pendientes (con el registro listo para publicar) |
| `tools/curacion_digests.json` | por resumen: lista ordenada de ids (número → candidata) y mensajes ya procesados |
| `tools/decisiones.json` | historial público: fecha, título, url, fuente, aceptada/rechazada (nada personal) |
| `tools/test_curacion.py` | pruebas: `python -m unittest discover -s tools -p "test_curacion.py" -v` (también corren antes de cada lectura del buzón) |

Los tres workflows que escriben estos JSON (scraper, resumen diario, respuestas) comparten
`concurrency: bitacora-datos` para turnarse. El resumen diario sale a las 07:17 UTC (no en :00, que GitHub retrasa o descarta).

## Probar en local sin enviar ni conectar

```powershell
python -m unittest discover -s tools -p "test_curacion.py" -v
python tools/resumen_diario.py --preview prueba.html --candidatas mis_candidatas.json
$env:CANDIDATAS_FILE = "$PWD\cand_prueba.json"; python tools/scraper_equipment.py   # sin claves = modo seco: no toca la Bitácora
```

## Límites conocidos

- Si respondes **debajo** de la cita (bottom-posting), el lector no ve tu texto: contesta arriba.
- No verificado de extremo a extremo con el Gmail real: ver el informe de la implementación (IMAP habilitado, forma real de `Authentication-Results` en correos a uno mismo).
- Los recuentos del log dicen por qué se descarta cada correo (`rechazado_from`, `rechazado_dkim`, `rechazado_spf`, `rechazado_sin_auth`, `no_entendido`…) para diagnosticar sin exponer nada.
