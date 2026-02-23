export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return new Response(JSON.stringify({ error: "Missing code" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const clientId = context.env.GITHUB_CLIENT_ID;
  const clientSecret = context.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new Response(JSON.stringify({ error: "OAuth not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  const data = await tokenRes.json();

  if (data.error) {
    return new Response(JSON.stringify({ error: data.error_description }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Redirect back to app with token (never cache — token is per-user)
  const origin = url.origin;
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${origin}/?token=${data.access_token}`,
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "CDN-Cache-Control": "no-store",
      "Cloudflare-CDN-Cache-Control": "no-store",
      Pragma: "no-cache",
      Vary: "*",
    },
  });
}
