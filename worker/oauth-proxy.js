/**
 * Cloudflare Worker — GitHub OAuth token exchange proxy.
 * Deploy this for free on Cloudflare Workers to enable OAuth on GitHub Pages.
 *
 * Environment variables (set in Cloudflare dashboard):
 *   GITHUB_CLIENT_ID     — from your GitHub OAuth App
 *   GITHUB_CLIENT_SECRET  — from your GitHub OAuth App
 *   ALLOWED_ORIGINS       — comma-separated list of allowed origins
 *                           e.g. "https://yourname.github.io,http://localhost:5173"
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") ?? "";
    const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim());

    const corsHeaders = {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Only set allow-origin if the request origin is in the allow list
    if (allowed.includes(origin)) {
      corsHeaders["Access-Control-Allow-Origin"] = origin;
    }

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // --- Redirect-based flow (GitHub Pages) ---
    // GitHub redirects here with ?code=xxx&redirect=https://yoursite.github.io
    const code = url.searchParams.get("code");
    const redirect = url.searchParams.get("redirect");

    if (code && redirect) {
      const tokenRes = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            client_id: env.GITHUB_CLIENT_ID,
            client_secret: env.GITHUB_CLIENT_SECRET,
            code,
          }),
        },
      );

      const data = await tokenRes.json();

      if (data.error) {
        return new Response(JSON.stringify({ error: data.error_description }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Redirect back to the app with token
      return Response.redirect(`${redirect}?token=${data.access_token}`, 302);
    }

    // --- JSON API flow (for SPA fetch) ---
    if (request.method === "POST") {
      const body = await request.json();
      if (!body.code) {
        return new Response(JSON.stringify({ error: "Missing code" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const tokenRes = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            client_id: env.GITHUB_CLIENT_ID,
            client_secret: env.GITHUB_CLIENT_SECRET,
            code: body.code,
          }),
        },
      );

      const data = await tokenRes.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response("Unticket OAuth Proxy", { status: 200 });
  },
};
