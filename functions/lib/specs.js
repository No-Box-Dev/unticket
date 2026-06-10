// Specs feature — list + fetch files from the configured spec source.
//
// The source is { repo: "owner/repo", rootPath: "specs" } stored in
// settings.specs. Each top-level directory under rootPath is one spec.
// All files inside a spec dir (recursively) belong to that spec.
//
// Auth model: server-to-server via the GitHub App installation token.
// Avoids burning the user's rate-limit budget on every asset load in a
// rendered HTML spec.

import { getInstallationToken } from "./github-app";

const GH = "https://api.github.com";

// Slash-safe path join. Strips leading/trailing slashes from each segment
// then joins with "/" — keeps "" segments from doubling slashes.
export function joinPath(...parts) {
  return parts
    .map((p) => String(p ?? "").replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

// Defense-in-depth: reject a segment that IS `..`, contains `/` (so a
// caller can't smuggle a multi-segment path in here), or contains `\`.
// We deliberately do NOT reject substrings like `foo..bar` — those are
// legitimate filenames; only the literal traversal segment `..` matters.
export function isSafeSegment(s) {
  if (typeof s !== "string" || !s) return false;
  if (s === "." || s === "..") return false;
  if (s.includes("/") || s.includes("\\")) return false;
  return true;
}

// Path-traversal check for slash-separated paths (root paths, relative file
// paths inside a spec). Splits on `/` and validates each segment, so a name
// like `design..v2.md` passes but `docs/../etc` fails.
export function hasUnsafePathSegment(path) {
  if (typeof path !== "string") return true;
  if (!path) return false;
  for (const seg of path.split("/")) {
    if (!seg || seg === "." || seg === ".." || seg.includes("\\")) return true;
  }
  return false;
}

// Resolve the spec source for an org. Reads settings.specs from D1 config.
// Falls back to nothing — callers must check `configured`.
export async function resolveSpecsConfig(db, orgId) {
  if (!db || !orgId) return { configured: false };
  const row = await db
    .prepare("SELECT data FROM config WHERE org_id = ? AND key = 'settings'")
    .bind(orgId)
    .first()
    .catch(() => null);
  if (!row?.data) return { configured: false };
  let parsed;
  try { parsed = JSON.parse(row.data); } catch { return { configured: false }; }
  const specs = parsed?.specs;
  if (!specs || typeof specs !== "object") return { configured: false };
  const repo = typeof specs.repo === "string" ? specs.repo.trim() : "";
  if (!repo || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) {
    return { configured: false };
  }
  const rootPath = typeof specs.rootPath === "string" ? specs.rootPath.trim().replace(/^\/+|\/+$/g, "") : "";
  // Reject path-traversal in the stored rootPath. Per-segment check so a
  // legitimate name like `docs..v2` still passes — only literal `..` /
  // `.` segments fail.
  if (hasUnsafePathSegment(rootPath)) return { configured: false };
  return { configured: true, repo, rootPath };
}

// Look up the installation_id for the org that owns this spec repo. The
// repo may live in a DIFFERENT org than the unticket-installed one (e.g.,
// docs in a sibling org), in which case we fall back to the org's own
// installation token — GitHub will 404 if the App isn't installed there.
async function getTokenForOrg(env, ownerLogin) {
  const inst = await env.DB
    .prepare("SELECT installation_id FROM installations WHERE account_login = ?")
    .bind(ownerLogin)
    .first();
  if (!inst?.installation_id) {
    throw new Error(`No GitHub App installation for ${ownerLogin}`);
  }
  return getInstallationToken(env, inst.installation_id);
}

// GET /repos/{owner}/{repo}/contents/{path} — directory listing or single file.
// Returns the parsed JSON (array for dirs, object for files) or throws.
async function ghContents(env, repo, path) {
  const [owner, name] = repo.split("/");
  const token = await getTokenForOrg(env, owner);
  const url = `${GH}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "Unticket",
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GitHub contents ${res.status} for ${repo}/${path}`);
  }
  return res.json();
}

// List top-level spec directories under rootPath. Returns an array of
// { name, path } where `path` is the full repo-relative path.
export async function listSpecs(env, repo, rootPath) {
  const entries = await ghContents(env, repo, rootPath);
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((e) => e.type === "dir")
    .map((e) => ({ name: e.name, path: e.path }));
}

// Walk a spec directory recursively, returning a flat list of files.
// Each entry: { path: "<spec>/sub/file.md", relative: "sub/file.md", size, ext }.
// Caps total entries at 200 so a runaway docs tree can't DOS us.
export async function listSpecFiles(env, repo, rootPath, specName) {
  if (!isSafeSegment(specName)) {
    throw new Error("Invalid spec name");
  }
  const base = joinPath(rootPath, specName);
  const files = [];
  await walk(env, repo, base, "", files);
  return files;
}

async function walk(env, repo, baseDir, rel, out, depth = 0) {
  if (out.length >= 200 || depth > 6) return;
  const entries = await ghContents(env, repo, joinPath(baseDir, rel));
  if (!Array.isArray(entries)) return;
  for (const e of entries) {
    if (out.length >= 200) return;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.type === "dir") {
      await walk(env, repo, baseDir, childRel, out, depth + 1);
    } else if (e.type === "file") {
      const dot = e.name.lastIndexOf(".");
      out.push({
        relative: childRel,
        size: e.size,
        ext: dot > 0 ? e.name.slice(dot + 1).toLowerCase() : "",
      });
    }
  }
}

// Fetch the raw bytes of a single file. Returns { content: ArrayBuffer,
// contentType: string } or null if missing. The Contents API returns
// base64-encoded payloads up to 1MB; for larger files we'd need the blob
// endpoint — out of scope for v1 spec docs.
export async function fetchSpecFile(env, repo, rootPath, specName, relativePath) {
  if (!isSafeSegment(specName)) throw new Error("Invalid spec name");
  // relative path is slash-separated; reject literal `..` segments but
  // allow `foo..bar.md` style names.
  if (typeof relativePath !== "string" || relativePath.startsWith("/") || hasUnsafePathSegment(relativePath)) {
    throw new Error("Invalid file path");
  }
  const fullPath = joinPath(rootPath, specName, relativePath);
  const entry = await ghContents(env, repo, fullPath);
  if (!entry || entry.type !== "file") return null;
  if (typeof entry.content !== "string") return null;
  // base64 -> bytes
  const bytes = Uint8Array.from(atob(entry.content.replace(/\s/g, "")), (c) => c.charCodeAt(0));
  return {
    bytes,
    contentType: guessContentType(entry.name),
    size: entry.size,
    name: entry.name,
  };
}

function guessContentType(name) {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  switch (ext) {
    case "html": case "htm": return "text/html; charset=utf-8";
    case "css": return "text/css; charset=utf-8";
    case "js": case "mjs": return "text/javascript; charset=utf-8";
    case "json": return "application/json; charset=utf-8";
    case "svg": return "image/svg+xml";
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "ico": return "image/x-icon";
    case "md": case "markdown": return "text/markdown; charset=utf-8";
    case "txt": return "text/plain; charset=utf-8";
    case "woff": return "font/woff";
    case "woff2": return "font/woff2";
    case "ttf": return "font/ttf";
    case "otf": return "font/otf";
    default: return "application/octet-stream";
  }
}
