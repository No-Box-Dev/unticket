import { encryptToken } from "../../lib/crypto";

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

  // --- Server-side CSRF validation ---
  // The client sets a cookie `gp_oauth_state` before redirecting to GitHub.
  // GitHub sends the same state back as a query param. We compare both.
  const stateParam = url.searchParams.get("state") || "";
  const cookies = parseCookies(context.request.headers.get("Cookie") || "");
  const stateCookie = cookies["gp_oauth_state"] || "";

  if (!stateParam || !stateCookie || stateParam !== stateCookie) {
    return new Response(JSON.stringify({ error: "OAuth state mismatch — possible CSRF attack" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Exchange code for token with GitHub
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

  // --- Store token with one-time exchange code (never put token in URL) ---
  const exchangeCode = generateExchangeCode();
  const encryptionKey = context.env.ENCRYPTION_KEY;
  const encryptedToken = await encryptToken(data.access_token, encryptionKey);

  try {
    // Clean up expired pending tokens (older than 5 minutes)
    await context.env.DB.prepare(
      "DELETE FROM pending_tokens WHERE created_at < datetime('now', '-5 minutes')"
    ).run();

    // Store the encrypted token with the exchange code
    await context.env.DB.prepare(
      "INSERT INTO pending_tokens (code, encrypted_token, csrf_state, created_at) VALUES (?, ?, ?, datetime('now'))"
    ).bind(exchangeCode, encryptedToken, stateParam).run();
  } catch (e) {
    console.error("[gitpulse] Failed to store exchange code in D1:", e);
    return new Response(JSON.stringify({ error: "Authentication service temporarily unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Redirect back with only the exchange code (token never appears in URL)
  const origin = url.origin;
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${origin}/?auth_code=${encodeURIComponent(exchangeCode)}`,
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "CDN-Cache-Control": "no-store",
      "Cloudflare-CDN-Cache-Control": "no-store",
      Pragma: "no-cache",
      Vary: "*",
      // Clear the CSRF cookie
      "Set-Cookie": "gp_oauth_state=; Path=/; Max-Age=0; SameSite=Lax; Secure",
    },
  });
}

function parseCookies(cookieHeader) {
  const cookies = {};
  for (const pair of cookieHeader.split(";")) {
    const [key, ...rest] = pair.trim().split("=");
    if (key) cookies[key.trim()] = rest.join("=").trim();
  }
  return cookies;
}

function generateExchangeCode() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
