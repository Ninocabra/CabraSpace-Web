// Proxy CORS para Astrometry.net — Vercel Edge Function.
// Catch-all: cubre /api/login, /api/upload, /api/submissions/*, /api/jobs/*/info|calibration.
// El cliente (pi-workflow.js) reescribe el dominio nova.astrometry.net -> ASTROMETRY_PROXY_URL
// conservando el path, así que aquí reconstruimos el upstream con el pathname original.

export const config = { runtime: "edge" };

const UPSTREAM = "https://nova.astrometry.net";

function resolveAllowedOrigin(origin) {
  if (!origin) return "*";
  const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const isGithubPages = origin === "https://ninocabra.github.io";
  return (isLocalhost || isGithubPages) ? origin : "*";
}

export default async function handler(request) {
  const url = new URL(request.url);
  const targetUrl = UPSTREAM + url.pathname + url.search;

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

  // Cabeceras de reenvío (reescribimos host para el upstream)
  const headers = new Headers(request.headers);
  headers.set("host", "nova.astrometry.net");

  // Cuerpo: lo bufferizamos para evitar problemas de streaming/duplex en Edge.
  let outBody = null;
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  if (hasBody) {
    const secretApiKey = (typeof process !== "undefined" && process.env)
      ? process.env.ASTROMETRY_API_KEY
      : undefined;
    const contentType = request.headers.get("content-type") || "";
    const isLogin = url.pathname === "/api/login" && request.method === "POST";

    if (isLogin && secretApiKey && contentType.includes("application/x-www-form-urlencoded")) {
      // Hardening opcional: inyectar la API key desde el secreto del entorno,
      // ocultándola del cliente.
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
        // Si algo falla, reenviamos el cuerpo original sin tocar.
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
