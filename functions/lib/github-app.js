// GitHub App authentication helpers (Web Crypto, no external deps).
//
// Two token types:
//   - App JWT: short-lived (10 min), proves we are the App. RS256-signed with the App's private key.
//   - Installation token: server-to-server token scoped to one installation (~1 hour).
//
// Usage from a route handler:
//   import { getInstallationToken } from "../lib/github-app";
//   const token = await getInstallationToken(env, installationId);
//   await fetch("https://api.github.com/...", { headers: { Authorization: `Bearer ${token}` }});

const installationTokenCache = new Map(); // installation_id -> { token, expiresAt }

function pemToArrayBuffer(pem) {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const buf = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
  return buf;
}

function base64UrlEncode(bytes) {
  let str = "";
  if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function importAppPrivateKey(pem) {
  const keyData = pemToArrayBuffer(pem);
  return crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

export async function signAppJwt(env) {
  const appId = env.GITHUB_APP_ID;
  const privateKeyPem = env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKeyPem) {
    throw new Error("GitHub App env vars missing (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY)");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: now - 30, // clock skew tolerance
    exp: now + 9 * 60, // 9 min — must be < 10 per GitHub's rule
    iss: String(appId),
  };

  const encoder = new TextEncoder();
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importAppPrivateKey(privateKeyPem);
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    encoder.encode(signingInput)
  );
  return `${signingInput}.${base64UrlEncode(sig)}`;
}

export async function getInstallationToken(env, installationId) {
  if (!installationId) throw new Error("installationId required");

  const cached = installationTokenCache.get(installationId);
  // Reuse if at least 5 min remain
  if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) {
    return cached.token;
  }

  const jwt = await signAppJwt(env);
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "unticket",
      },
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to mint installation token (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const expiresAt = new Date(data.expires_at).getTime();
  installationTokenCache.set(installationId, { token: data.token, expiresAt });
  return data.token;
}

export async function getInstallationIdForOrg(db, orgId) {
  const row = await db
    .prepare("SELECT installation_id FROM orgs WHERE id = ?")
    .bind(orgId)
    .first();
  return row?.installation_id ?? null;
}
