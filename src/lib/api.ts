/** Broadcast an error so the UI can show it in a banner. */
export function broadcastError(message: string, status?: number) {
  window.dispatchEvent(
    new CustomEvent("gp:error", { detail: { message, status } }),
  );
}

/** Custom error that preserves HTTP status for downstream handling. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    broadcastError(message, status);
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
  localStorage.removeItem("gp_token");
  localStorage.removeItem("n1_github_token");
  // Dispatch event so AuthProvider can react without circular imports
  window.dispatchEvent(new CustomEvent("gp:force-logout"));
}

export async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const token = localStorage.getItem("gp_token");
  const org = localStorage.getItem("gp_org");
  return fetch(path, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token ?? ""}`,
      "X-Org": org ?? "",
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.ok) return res.json() as Promise<T>;

  const body = await res.json().catch(() => ({ error: res.statusText }));
  const message = (body as { error?: string }).error ?? `API error: ${res.status}`;

  // Stale / revoked token → force logout so user re-authenticates
  if (res.status === 401) {
    forceLogout();
    throw new ApiError(message, 401);
  }

  // Rate limited — our server returns 429 with Retry-After header
  if (res.status === 429) {
    const resetHeader = res.headers.get("retry-after");
    const resetInfo = resetHeader
      ? `. Try again in ${resetHeader}s`
      : "";
    throw new ApiError(`Rate limit exceeded${resetInfo}`, 429);
  }

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
