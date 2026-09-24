# Fuentes -> ficheros generados

Todas las rutas de origen son de solo lectura, bajo `E:\ASTRO Sin Procesar\...`.
Nada se movio ni se borro alli. Los ficheros de salida estan bajo
`C:\Users\ninoc\Documents\PixInsight\CabraSpace\web-atlas\obs\`.

## M82 (obs/m82/)

- Origen: `E:\ASTRO Sin Procesar\Observatorio Nerpio\Imagenes\M82\WBPP2\Images\M82_Final_4.tif` (5378x3440 RGB)
  -> `m82/full.jpg` (2400 px lado largo), `m82/crop.jpg` (1600x1200, centrado por blur+argmax, verificado visualmente), `m82/thumb.jpg` (800x600)
- Nombres de fichero de la carpeta `Images/` (Color_Nebulae.tif, HA_Nebulae.tif, OIII_Nebulae.tif, SII_Nebulae.tif, L_MAS.tif, O_Stars_.tif, RGB_stars_GHS.tif, RGB_stars_SST.tif, M82_Final_1..4.tif) -> campo `facts.filtros_paletas` en `observaciones.json`

## PK 164+31.1 (obs/pk164/)

- Origen: `E:\ASTRO Sin Procesar\Observatorio Nerpio\Imagenes\PK 164+31.1\PM2\PiMagic-PK_164_31_1-2026-04-24-14-54-53\PiMagic\Previews\Final_Preview_PK_164_31_1_HOO.jpg` (6131x4049 RGB)
  -> `pk164/full.jpg`, `pk164/crop.jpg` (centrado verificado visualmente), `pk164/thumb.jpg`
- Nombres de fichero de la carpeta `Previews/` (Final_Preview_PK_164_31_1_{HOO,Ha,L,OIII,RGB,SHO,SII}.jpg, Annotated_Preview_PK_164_31_1_RGB.jpg) -> campo `facts.filtros_paletas`
- No se uso el fichero `_RGB.jpg` para el recorte (se eligio HOO como imagen principal); ambos estan mencionados en el encargo.

## TrES-3 b combinado (obs/tres3b-2026/)

- `E:\...\TrES-3b\combinado\TrES-3-b_combinado_2026-08-29_2026-09-15.png` -> `curva.png` (1600 px ancho)
- `E:\...\TrES-3b\combinado\TrES-3-b_combinado_2026-08-29_2026-09-15_informe.txt` y `.json` -> hechos de `observaciones.json` (Rp/Rs conjunto y por noche, T_mid, O-C, filtro, exposiciones)
- `E:\...\2026-09-15\analisis\TrES-3-b_2026-09-15_campo.png` -> `campo.jpg` (1400 px ancho) y `poster.jpg` (copia de campo.jpg)
- `E:\...\2026-09-15\analisis\TrES-3-b_2026-09-15_video.mp4` -> `video.mp4` (sin modificar, 30-09-15; noche de TrES-3-b, la mas reciente de las 2)
- `E:\...\TrES-3b\2026-08-29\analisis\TrES-3-b_2026-08-29_informe.txt` y `E:\...\2026-09-15\analisis\TrES-3-b_2026-09-15_informe.txt` -> veredicto por noche, telescopio, sitio, ganancia

## WASP-52 b combinado (obs/wasp52b-2026/)

- `E:\...\WASP-52-b_combinado_2026-08-31_2026-09-21.png` -> `curva.png`
- `E:\...\WASP-52-b_combinado_2026-08-31_2026-09-21_informe.txt` y `.json` -> hechos combinados
- `E:\...\2026-09-21\analisis\WASP-52-b_2026-09-21_campo.png` -> `campo.jpg` y `poster.jpg`
- `E:\...\2026-09-21\analisis\WASP-52-b_2026-09-21_video.mp4` -> `video.mp4`
- `E:\...\2026-09-21\analisis\WASP-52-b_2026-09-21_informe.txt` -> veredicto de la noche 2026-09-21, telescopio, sitio
- DUDA: el informe individual de la noche 2026-08-31 (`WASP-52 b\2026-08-31\analisis\...`) NO existe en disco (solo el combinado lo referencia); su veredicto individual se deja en null.

## Qatar-1 b (obs/qatar1b-2026-09-22/)

- `E:\...\2026-09-22\analisis\Qatar-1-b_2026-09-22_curva_de_luz.png` -> `curva.png`
- `E:\...\2026-09-22\analisis\Qatar-1-b_2026-09-22_campo.png` -> `campo.jpg` y `poster.jpg`
- `E:\...\2026-09-22\analisis\Qatar-1-b_2026-09-22_video.mp4` -> `video.mp4`
- `E:\...\2026-09-22\analisis\Qatar-1-b_2026-09-22_informe.txt` -> Rp/Rs, T_mid, O-C, T14, telescopio (Celestron C9.25), ganancia, software (CabraTransit v1.0 ejecutable compilado 2026-09-23)
- Este informe no tiene seccion "VEREDICTO DE USO" (formato mas corto que los demas); `facts.verdict` = null con nota.

## TrES-2 b (obs/tres2b-2026-09-06/) -- transito parcial, sin video

- `E:\...\2026-09-06\analisis\TrES-2-b_2026-09-06_curva_de_luz.png` -> `curva.png`
- `E:\...\2026-09-06\analisis\TrES-2-b_2026-09-06_campo.png` -> `campo.jpg`
- `E:\...\2026-09-06\analisis\TrES-2-b_2026-09-06_informe.txt` -> Rp/Rs, profundidad, T_mid, O-C, veredicto "PARCIALMENTE USABLE" (falta el ingreso), telescopio, sitio

## Qatar-3 b (obs/qatar3b-2026-09-13/) -- parcial, sin video

- `E:\...\2026-09-13\analisis\Qatar-3-b_2026-09-13_curva_de_luz.png` -> `curva.png`
- `E:\...\2026-09-13\analisis\Qatar-3-b_2026-09-13_campo.png` -> `campo.jpg`
- `E:\...\2026-09-13\analisis\Qatar-3-b_2026-09-13_informe.txt` -> Rp/Rs, profundidad, T_mid, O-C, veredicto "PARCIALMENTE USABLE" (volteo dentro del transito)

## WASP-59 b (obs/wasp59b-2026-09-03/) -- sin video

- `E:\...\WASP-59 b\2026-09-03\analisis\WASP-59-b_2026-09-03_curva_de_luz.png` -> `curva.png`
- `E:\...\WASP-59 b\2026-09-03\analisis\WASP-59-b_2026-09-03_campo.png` -> `campo.jpg`
- `E:\...\WASP-59 b\2026-09-03\analisis\WASP-59-b_2026-09-03_informe.txt` -> Rp/Rs, profundidad, T_mid, O-C, veredicto, telescopio (linea `diametro_cm = 23.5 cm [fabricante (Celestron C9.25...)]`)

## Eclipse solar 12-08-2026 (obs/eclipse-2026/)

- `E:\ASTRO Sin Procesar\Vespera PRO\Imagenes\Eclipse Agosto 2026\video\eclipse_1920x1080.mp4` -> `video.mp4` (sin modificar; es la v4, version final segun `video\LEEME.md`)
- `E:\...\video\LEEME.md` -> duracion/fps del video (60 s a 25 fps), version v4, equipo "Vaonis Vespera Pro" (nombre de carpeta)
- `E:\...\02-observation\01-images\` (2193 JPEG, nombres con timestamp UTC 17:37:38 -> 18:58:25) -> eleccion de `poster.jpg` y `fase-1..7.jpg`:
  - Se midio el area de pixeles brillantes (`umbral>40` sobre escala de grises) en muestras a lo largo de toda la ventana con un script Python (PIL+numpy) para seguir la evolucion del creciente.
  - **CORRECCIÓN (24-09, verificado contando fotogramas):** los «huecos» de abajo NO son falta de datos ni una obstrucción: hay 22-29 fotogramas por minuto de forma continua entre 18:20 y 18:50 UTC. Son los fotogramas de la ocultación, en los que el Sol vale 5-10 DN (video/LEEME.md) y el medidor de área por umbral no lo detecta. El creciente que reaparece «más alto» es el del otro lado, tras la fase central. Texto original del análisis:
  - El area decrece de forma CONTINUA y monotona desde 17:37 (disco practicamente completo, primer contacto) hasta aprox. 18:27 UTC; a partir de ahi aparecen huecos de varios minutos sin senal (18:28-18:38 y 18:41-18:47), compatibles con el Sol pasando detras de una obstruccion del horizonte (no con progresion normal del eclipse, porque el area REAPARECE mas alta tras cada hueco en vez de seguir bajando). Despues de 18:52 UTC ya no hay disco identificable (ruido de cielo unicamente): el Sol se pierde por el horizonte.
  - NINGUN fotograma de los 2193 muestra corona ni totalidad. El fichero `LEEME.md` tampoco declara un instante de totalidad ni un C1-C4. Por eso `facts.totalidad` queda en null en `observaciones.json`, con la evidencia anotada en el propio campo.
  - `poster.jpg` = `2026-08-12_18-26-07_1453.jpeg`, el creciente mas fino con buena señal ANTES del primer hueco de datos.
  - `fase-1..7.jpg`: 6 instantes repartidos entre 17:37 y 18:26 (progresion continua) mas un septimo (`fase-7`) tomado tras el ultimo hueco (18:48 UTC) para mostrar el creciente ya muy bajo, rojizo, cerca del horizonte, antes de perderse definitivamente.
  - Los 7 recortes se centraron con un script propio: mascara de pixeles brillantes (umbral>40), centro = centro de la caja delimitadora (mas robusto que el centroide de brillo para un creciente fino, que tira el centroide hacia el limbo iluminado).
- Los ficheros `AAA_2026-08-09_09-21-47_1264.jpeg` y `AAA_2026-08-09_09-24-17_1337.jpeg` (sueltos en la carpeta `Eclipse Agosto 2026/`) son del 9 de agosto, NO del eclipse del 12 de agosto: se descartaron y no se usaron para nada, tal como pedia el encargo.
