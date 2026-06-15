# Cloudflare Worker Proxy para Astrometry.net

Este directorio contiene el proxy CORS para **Astrometry.net** en producción. Dado que PixInsight Workflow se sirve de forma estática en GitHub Pages, los navegadores bloquean las peticiones directas de red hacia la API de Astrometry.net por políticas de CORS. Este Worker soluciona ese problema.

## 🛠️ Instrucciones de Despliegue (para Nino)

Puedes desplegar este Worker de dos formas:

---

### Opción A: Desde el Panel de Control de Cloudflare (Recomendado/Sin Terminal)

1. Inicia sesión en tu panel de **Cloudflare**.
2. Ve a **Workers & Pages** > **Create application** > **Create Worker**.
3. Dale un nombre al Worker (ej. `astrometry-proxy`) y haz clic en **Deploy**.
4. Haz clic en **Edit code** para abrir el editor online.
5. Borra todo el código autogenerado y pega el contenido del archivo [astrometry-proxy.js](astrometry-proxy.js).
6. Haz clic en **Save and deploy**.
7. Copia la URL pública generada (ej. `https://astrometry-proxy.ninocabra.workers.dev`).
8. **(Opcional - Seguridad)**: Para ocultar tu API Key de Astrometry.net del código cliente:
   - En la pestaña del Worker en Cloudflare, ve a **Settings** > **Variables** > **Environment Variables**.
   - Haz clic en **Add variable**.
   - Nombre: `ASTROMETRY_API_KEY`.
   - Valor: Tu API key de Astrometry.net (`coqpscljnloiluyi` u otra).
   - Haz clic en **Save and deploy**.

---

### Opción B: Usando Wrangler (Línea de comandos)

Si tienes Wrangler configurado en tu máquina local:

1. Crea un archivo `wrangler.toml` en este directorio con el siguiente contenido:
   ```toml
   name = "astrometry-proxy"
   main = "astrometry-proxy.js"
   compatibility_date = "2026-06-14"
   ```
2. Ejecuta en tu terminal:
   ```bash
   npx wrangler deploy
   ```
3. Guarda la URL pública obtenida en la consola.
4. **(Opcional - Seguridad)**: Define la API Key como secreto remoto:
   ```bash
   npx wrangler secret put ASTROMETRY_API_KEY
   ```
   (Introduce tu API key cuando te lo solicite).

---

## 🔗 Vinculación con el Proyecto

Una vez que tengas la URL de tu Worker (por ejemplo, `https://astrometry-proxy.ninocabra.workers.dev`):

1. Abre el archivo [pi-workflow.js](../pi-workflow.js).
2. Localiza la línea cerca del inicio de la sección de Plate Solving:
   ```javascript
   // CF-WORKER-BEGIN
   let ASTROMETRY_PROXY_URL = "";
   // CF-WORKER-END
   ```
3. Pega la URL de tu Worker:
   ```javascript
   // CF-WORKER-BEGIN
   let ASTROMETRY_PROXY_URL = "https://astrometry-proxy.ninocabra.workers.dev";
   // CF-WORKER-END
   ```
4. Guarda el archivo. ¡Listo! El Plate Solving usará ahora el proxy CORS en producción.
