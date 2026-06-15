# Fuentes del scraper de equipamiento

El scraper (`scraper_equipment.py`) prioriza **canales oficiales de fabricantes** sobre reviewers/foros.
Las fuentes oficiales viven en **`fabricantes_fuentes.json`** y los reviewers de YouTube en `creadores.json`.

## Añadir un fabricante (canal oficial)

Edita `fabricantes_fuentes.json` y añade una entrada. Cada marca puede tener `rss`, `youtube_channel_id`, o ambos:

```json
{ "name": "Askar", "rss": "https://www.askarlens.com/blogs/news.atom", "youtube_channel_id": "UCxxxxxxxxxxxxxxxxxxxxxx" }
```

- **`rss`**: URL del feed del blog. Muchas tiendas usan Shopify → prueba `https://DOMINIO/blogs/news.atom`. Si da 404, busca el enlace "RSS" en el blog del fabricante. Es opcional.
- **`youtube_channel_id`**: el ID del canal (empieza por `UC`, 24 caracteres). Opcional.

No inventes IDs: un ID incorrecto produce un feed vacío silencioso. Verifica siempre.

## Cómo obtener el `youtube_channel_id`

El feed RSS de YouTube **solo** funciona con el ID `UC...`, no con el `@handle`. Para obtenerlo:

1. Abre el canal en tu navegador (ya tienes las cookies aceptadas, sin muro de consentimiento).
2. `Ctrl+U` (ver código fuente) → busca (`Ctrl+F`) `"channelId"` o `externalId`. El valor `UC...` es el ID.
3. Pega ese ID en el JSON y comprueba que `https://www.youtube.com/feeds/videos.xml?channel_id=UC...` devuelve XML con vídeos.

## Marcas prioritarias sugeridas (pendientes de añadir)

Fabricantes relevantes que aún **no** tienen canal oficial vigilado (complétalos con el método de arriba):

- Vaonis (Vespera / Stellina)
- Dwarflab (Dwarf 3)
- iOptron (monturas)
- Askar (canal propio, además del de Sharpstar)
- Baader Planetarium
- Antlia Filters
- Optolong Filters
- Bresser / Omegon
- Rainbow Astro (monturas strain-wave)
- Astro-Physics
- Sky-Watcher Global (además del USA)

## Cómo se prioriza (lógica del motor)

- Los oficiales se procesan **antes** que los terceros; dentro de oficiales, los **blogs/releases** van antes que el **YouTube oficial** (centrado en engagement).
- Ventana de antigüedad: **45 días** solo para **blogs/releases oficiales** (`MFG_BLOG_MAX_AGE_DAYS`; publican poco y un anuncio no caduca en 2 semanas), **3 días** para todo lo demás incluido el YouTube oficial, reviewers y foros. La deduplicación por URL evita re-añadir el backfill inicial.
- Filtro de ruido (`is_engagement_noise`): descarta de **cualquier** fuente el contenido de engagement (eventos, webcasts, "what's up", historias personales, "blue moon", giveaways…) antes de gastar IA. Los canales oficiales de YouTube publican mucho de esto.
- Cuota: máximo **5** items de terceros por ejecución (`MAX_OTHER_ITEMS`), reservando el resto a oficiales.
- Deduplicación por origen: un anuncio **oficial** puede entrar aunque un reviewer ya hubiera cubierto ese modelo; un reviewer se descarta si el modelo ya está cubierto. Cada entrada guarda `source_type` (`official`/`reviewer`).
