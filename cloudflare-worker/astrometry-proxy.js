export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Rewrite host to the upstream target
    const targetUrl = "https://nova.astrometry.net" + url.pathname + url.search;

    // Determine CORS origin based on request Origin header and allowed list
    const origin = request.headers.get("Origin");
    let allowedOrigin = "*";
    if (origin) {
      const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      const isGithubPages = origin === "https://ninocabra.github.io";
      if (isLocalhost || isGithubPages) {
        allowedOrigin = origin;
      }
    }

    // Handle CORS preflight (OPTIONS) requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": allowedOrigin,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") || "Content-Type, Authorization, X-Requested-With",
          "Access-Control-Max-Age": "86400",
        }
      });
    }

    // Prepare headers for forwarding, rewriting host for upstream compatibility
    const headers = new Headers(request.headers);
    headers.set("host", "nova.astrometry.net");

    let body = request.body;
    let modified = false;

    // Optional hardening: Inject/mask API key from a Worker secret if configured
    const secretApiKey = env && env.ASTROMETRY_API_KEY;
    if (url.pathname === "/api/login" && request.method === "POST" && secretApiKey) {
      try {
        const contentType = request.headers.get("content-type") || "";
        if (contentType.includes("application/x-www-form-urlencoded")) {
          const text = await request.clone().text();
          const params = new URLSearchParams(text);
          const reqJsonStr = params.get("request-json");
          if (reqJsonStr) {
            const reqJson = JSON.parse(reqJsonStr);
            reqJson.apikey = secretApiKey;
            params.set("request-json", JSON.stringify(reqJson));
            body = params.toString();
            modified = true;
          }
        }
      } catch (e) {
        console.error("Error during API key injection:", e);
      }
    }

    // If we modified the body payload, we must remove the content-length header 
    // to let fetch recalculate it correctly.
    if (modified) {
      headers.delete("content-length");
    }

    // GET and HEAD requests cannot contain a request body
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const fetchBody = hasBody ? body : null;

    try {
      // Forward request to Astrometry.net upstream
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: headers,
        body: fetchBody,
        redirect: "manual"
      });

      // Prepare CORS response headers
      const corsHeaders = new Headers(response.headers);
      corsHeaders.set("Access-Control-Allow-Origin", allowedOrigin);
      corsHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      corsHeaders.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: corsHeaders
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": allowedOrigin
        }
      });
    }
  }
};
