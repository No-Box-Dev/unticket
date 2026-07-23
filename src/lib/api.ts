/** Broadcast an error so the UI can show it in a banner. */
export function broadcastError(message: string, status?: number) {
  window.dispatchEvent(
    new CustomEvent("ut:error", { detail: { message, status } }),
  );
}

/** Custom error that preserves HTTP status for downstream handling. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }

  get isUnauthorized() {
    return this.status === 401;
  }

  get isRateLimited() {
    return this.status === 429;
  }
}

/** Returns true if an error should NOT be retried by TanStack Query. */
export function shouldNotRetry(error: unknown): boolean {
  if (error instanceof ApiError) {
    // 401 = stale token, 429 = rate limit from our API, 403 = rate limit from GitHub (via Octokit)
    return error.status === 401 || error.status === 429 || error.status === 403;
  }
  // Octokit/fetch errors that indicate auth or rate limit problems
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("bad credentials") ||
      msg.includes("rate limit") ||
      msg.includes("not authenticated")
    );
  }
  return false;
}

/**
 * Force-logout: clears token and reloads. Called when the API returns 401,
 * meaning the stored token is stale/revoked.
 */
function forceLogout() {
  localStorage.removeItem("ut_token");
  localStorage.removeItem("ut_org");
  // Dispatch event so AuthProvider can react without circular imports
  window.dispatchEvent(new CustomEvent("ut:force-logout"));
}

// Coalesce concurrent refresh attempts in this tab. The Web Lock below extends
// that protection across tabs: GitHub rotates refresh tokens, so two tabs
// refreshing the same expired access token would otherwise invalidate one
// another and force the losing tab to log the whole browser session out.
let refreshPromise: Promise<string | null> | null = null;

async function requestRefreshedToken(expiredToken: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: expiredToken }),
    });
  } catch {
    throw new ApiError("Session refresh temporarily unavailable", 503);
  }

  // A 401 is the only confirmed terminal outcome: the refresh token is
  // unknown, expired, or rejected. Preserve the session for 5xx/network and
  // other unexpected responses so a temporary outage doesn't become logout.
  if (res.status === 401) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new ApiError(body?.error ?? "Session refresh temporarily unavailable", res.status);
  }

  const body = (await res.json().catch(() => null)) as { token?: string } | null;
  if (!body?.token) throw new ApiError("Session refresh returned an invalid response", 502);
  localStorage.setItem("ut_token", body.token);
  window.dispatchEvent(new CustomEvent("ut:token-refreshed"));
  return body.token;
}

async function refreshAcrossTabs(expiredToken: string): Promise<string | null> {
  const refresh = async () => {
    // A tab that waited for the lock can reuse the token written by the tab
    // that won it. Never send the already-rotated token to the refresh API.
    const currentToken = localStorage.getItem("ut_token");
    if (!currentToken) return null;
    if (currentToken !== expiredToken) return currentToken;
    return requestRefreshedToken(expiredToken);
  };

  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request("unticket-auth-refresh", refresh);
  }
  return refresh();
}

export async function refreshAccessToken(expiredToken: string): Promise<string | null> {
  const currentToken = localStorage.getItem("ut_token");
  if (currentToken && currentToken !== expiredToken) return currentToken;
  if (refreshPromise) return refreshPromise;
  refreshPromise = refreshAcrossTabs(expiredToken);
  const p = refreshPromise;
  // Use then(success, failure), rather than finally(), so a rejected refresh
  // doesn't create a second unhandled rejected promise.
  p.then(
    () => { if (refreshPromise === p) refreshPromise = null; },
    () => { if (refreshPromise === p) refreshPromise = null; },
  );
  return p;
}

function buildRequestInit(token: string | null, options?: RequestInit): RequestInit {
  const org = localStorage.getItem("ut_org");
  // FormData bodies need the browser to set Content-Type itself so it can
  // include the `boundary=...` parameter. Setting a plain
  // `application/json` here would strip the boundary and the server would
  // read the raw multipart bytes as JSON — reproducibly failing at parse.
  const isFormData =
    typeof FormData !== "undefined" && options?.body instanceof FormData;
  return {
    ...options,
    headers: {
      "Authorization": `Bearer ${token ?? ""}`,
      "X-Org": org ?? "",
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...options?.headers,
    },
  };
}

export async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const token = localStorage.getItem("ut_token");
  const res = await fetch(path, buildRequestInit(token, options));
  if (res.status !== 401 || !token) return res;

  // Stale access token? Try one silent refresh, then retry the original call.
  const refreshed = await refreshAccessToken(token);
  if (!refreshed) return res;
  return fetch(path, buildRequestInit(refreshed, options));
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.ok) return res.json() as Promise<T>;

  const body = await res.json().catch(() => ({ error: res.statusText }));
  const message = (body as { error?: string }).error ?? `API error: ${res.status}`;

  // Stale / revoked token → force logout so user re-authenticates
  if (res.status === 401) {
    forceLogout();
    broadcastError(message, 401);
    throw new ApiError(message, 401);
  }

  // Rate limited — our server returns 429 with Retry-After header
  if (res.status === 429) {
    const resetHeader = res.headers.get("retry-after");
    const resetInfo = resetHeader
      ? `. Try again in ${resetHeader}s`
      : "";
    const msg = `Rate limit exceeded${resetInfo}`;
    broadcastError(msg, 429);
    throw new ApiError(msg, 429);
  }

  broadcastError(message, res.status);
  throw new ApiError(message, res.status);
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  return handleResponse<T>(res);
}

export async function apiPut<T>(path: string, data: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  return handleResponse<T>(res);
}

export async function apiPost<T>(path: string, data?: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "POST",
    body: data ? JSON.stringify(data) : undefined,
  });
  return handleResponse<T>(res);
}

export async function apiPatch<T>(path: string, data: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  return handleResponse<T>(res);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await apiFetch(path, { method: "DELETE" });
  return handleResponse<T>(res);
}
