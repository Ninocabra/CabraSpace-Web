// Proxy CORS para Astrometry.net — Vercel Edge Function (función única).
// El routing lo hace vercel.json con un rewrite /api/:path* -> /api/proxy?__upstreamPath=:path*
// (el catch-all dinámico [...path].js no captura rutas multi-segmento en runtime edge).
// El cliente (pi-workflow.js) reescribe SOLO el dominio nova.astrometry.net -> ASTROMETRY_PROXY_URL,
// conservando el path; aquí reconstruimos el upstream a partir de __upstreamPath.

export const config = { runtime: "edge" };

const UPSTREAM = "https://nova.astrometry.net";

function resolveAllowedOrigin(origin) {
  if (!origin) return "*";
  const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const isAllowedHost =
    origin === "https://ninocabra.github.io" ||
    origin === "https://cabraspace.com" ||
    origin === "https://www.cabraspace.com";
  return (isLocalhost || isAllowedHost) ? origin : "*";
}

export default async function handler(request) {
  const url = new URL(request.url);

  // Ruta upstream inyectada por el rewrite de vercel.json (p. ej. "submissions/123").
  const upstreamPath = url.searchParams.get("__upstreamPath") || "";
  // Resto de query params originales (sin el reservado) por si los hubiera.
  const passthrough = new URLSearchParams(url.search);
  passthrough.delete("__upstreamPath");
  const qs = passthrough.toString();
  const targetUrl = `${UPSTREAM}/api/${upstreamPath}` + (qs ? `?${qs}` : "");

  const origin = request.headers.get("Origin");
  const allowedOrigin = resolveAllowedOrigin(origin);

  // Preflight CORS
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers":
          request.headers.get("Access-Control-Request-Headers") ||
          "Content-Type, Authorization, X-Requested-With",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  const headers = new Headers(request.headers);
  headers.set("host", "nova.astrometry.net");

  // Cuerpo bufferizado (evita problemas de streaming/duplex en edge).
  let outBody = null;
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  if (hasBody) {
    const secretApiKey =
      (typeof process !== "undefined" && process.env)
        ? process.env.ASTROMETRY_API_KEY
        : undefined;
    const contentType = request.headers.get("content-type") || "";
    const isLogin = upstreamPath === "login" && request.method === "POST";

    if (isLogin && secretApiKey && contentType.includes("application/x-www-form-urlencoded")) {
      // Hardening opcional: inyectar la API key desde el secreto del entorno.
      try {
        const text = await request.text();
        const params = new URLSearchParams(text);
        const reqJsonStr = params.get("request-json");
        if (reqJsonStr) {
          const reqJson = JSON.parse(reqJsonStr);
          reqJson.apikey = secretApiKey;
          params.set("request-json", JSON.stringify(reqJson));
          outBody = params.toString();
          headers.delete("content-length");
        } else {
          outBody = text;
        }
      } catch (e) {
        outBody = await request.arrayBuffer();
      }
    } else {
      outBody = await request.arrayBuffer();
    }
  }

  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: outBody,
      redirect: "manual",
    });

    const corsHeaders = new Headers(response.headers);
    corsHeaders.set("Access-Control-Allow-Origin", allowedOrigin);
    corsHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    corsHeaders.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": allowedOrigin,
      },
    });
  }
}
