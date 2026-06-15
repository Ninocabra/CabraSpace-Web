# Proxy CORS para Astrometry.net — Vercel

Proxy que permite al PI Workflow Web (servido estático en GitHub Pages) hablar con la API de
**Astrometry.net** sin que el navegador bloquee las peticiones por CORS.

- Función: [api/[...path].js](api/[...path].js) (Vercel **Edge Function**, catch-all de `/api/*`).
- CORS restringido a `https://ninocabra.github.io` y `localhost`.
- Inyección **opcional** de la API key vía variable de entorno (oculta la key del cliente).
- Lógica equivalente al worker de Cloudflare; test local: `node scratch/test_vercel_proxy.mjs` (4/4).

## 🚀 Despliegue (Vercel CLI — sin tocar la web de Vercel)

Desde **este** directorio (`vercel-proxy/`):

```bash
cd vercel-proxy
npx vercel login        # abre el navegador para autenticarte (una vez)
npx vercel --prod       # primer deploy: te hará unas preguntas (ver abajo)
```

Respuestas en el primer `vercel --prod`:
- **Set up and deploy?** → `y`
- **Which scope?** → tu cuenta
- **Link to existing project?** → `N` (créalo nuevo)
- **Project name?** → `astrometry-proxy`  *(así el dominio queda `astrometry-proxy.vercel.app`)*
- **In which directory is your code?** → `./`
- **Modify settings?** → `N`

Al terminar imprime la **Production URL** (p. ej. `https://astrometry-proxy.vercel.app`).

## 🔐 (Opcional) Ocultar tu API key

Para que la key no viaje en el JS público, fíjala como variable de entorno del proyecto y quítala del
cliente:

```bash
npx vercel env add ASTROMETRY_API_KEY production
# pega tu key cuando lo pida; luego redeploy:
npx vercel --prod
```

(Si la fijas aquí, en `pi-workflow.js` puedes mandar una key vacía/placeholder: el proxy la sobrescribe.)

## 🔗 Vincular con el proyecto

En [pi-workflow.js](../pi-workflow.js), sección Plate Solving:

```javascript
// CF-WORKER-BEGIN
let ASTROMETRY_PROXY_URL = "https://astrometry-proxy.vercel.app";  // <- tu Production URL
// CF-WORKER-END
```

Guarda, commitea y publica. El plate solve en producción usará el proxy.
