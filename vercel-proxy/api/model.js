// Proxy CORS para modelos ONNX — Vercel Edge Function.
// GitHub Releases (Azure Blob) NO devuelve `Access-Control-Allow-Origin`, así que el navegador
// bloquea el fetch cross-origin desde cabraspace.com ("Failed to fetch"). Este endpoint descarga
// el modelo server-side (siguiendo el redirect 302 -> Azure) y lo re-emite con CORS, en streaming.
//
// Routing: vercel.json reescribe /m/:file -> /api/model?file=:file
// El cliente pide https://<proxy>/m/<archivo.onnx>; aquí solo servimos archivos de NUESTRA Release
// (allowlist por nombre) para no abrir un proxy genérico (anti-SSRF).

export const config = { runtime: "edge" };

const RELEASE_BASE =
  "https://github.com/Ninocabra/CabraSpace-Web/releases/download/models-v1/";

// Solo nombres tipo "algo.onnx" (sin barras ni '..'): impide path traversal y SSRF.
const SAFE_NAME = /^[A-Za-z0-9._-]+\.onnx$/;

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
  const file = url.searchParams.get("file") || "";
  const origin = request.headers.get("Origin");
  const allowedOrigin = resolveAllowedOrigin(origin);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Range, Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  if (!SAFE_NAME.test(file)) {
    return new Response(JSON.stringify({ error: "invalid model name" }), {
      status: 400,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": allowedOrigin,
      },
    });
  }

  const targetUrl = RELEASE_BASE + file;

  // Reenvía Range si el cliente lo usa (no es el caso de fetchModelWithCache, pero por robustez).
  const fwdHeaders = new Headers();
  const range = request.headers.get("Range");
  if (range) fwdHeaders.set("Range", range);

  try {
    const upstream = await fetch(targetUrl, {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers: fwdHeaders,
      redirect: "follow",
    });

    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", allowedOrigin);
    headers.set("Access-Control-Expose-Headers",
      "Content-Length, Content-Range, Accept-Ranges, ETag");
    headers.set("Vary", "Origin");
    headers.set("Content-Type", "application/octet-stream");
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    for (const h of ["content-length", "content-range", "accept-ranges", "etag"]) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }

    // Streaming directo (no bufferiza los ~200MB en memoria de la función).
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": allowedOrigin,
      },
    });
  }
}
