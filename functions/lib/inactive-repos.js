// Source of truth for which repos are inactive in this org.
// A repo is inactive (and therefore excluded from sync, the issues/PRs
// endpoints, and any other "all repos" surface) if any of:
//   - listed in settings.draftRepos
//   - has projects.archived = 1 (platform-level archive)
//   - has repos.archived_at IS NOT NULL (GitHub-side archive, captured by
//     the `repository.archived` webhook)
//   - is the configured "unticket" repo (settings.unticketRepo, default
//     "unticket") — that repo holds features/todos/plans, not product work
//
// Returns a Set<string> of repo names to exclude.
export async function getInactiveRepoSet(db, orgId, orgLogin) {
  const [settingsRow, archivedRows, ghArchivedRows] = await db.batch([
    db.prepare("SELECT data FROM config WHERE org_id = ? AND key = 'settings'").bind(orgId),
    db.prepare("SELECT repo FROM projects WHERE owner_id = ? AND archived = 1").bind(orgLogin),
    db.prepare("SELECT name FROM repos WHERE org_id = ? AND archived_at IS NOT NULL").bind(orgId),
  ]);

  const exclude = new Set();
  let unticketRepo = "unticket";
  const settingsData = settingsRow.results?.[0]?.data;
  if (settingsData) {
    try {
      const parsed = JSON.parse(settingsData);
      for (const r of parsed.draftRepos ?? []) exclude.add(r);
      if (typeof parsed.unticketRepo === "string" && parsed.unticketRepo.trim()) {
        unticketRepo = parsed.unticketRepo.trim();
      }
    } catch (e) {
      console.warn(`[unticket] Corrupt settings JSON for org ${orgId}:`, e);
    }
  }
  exclude.add(unticketRepo);

  for (const row of archivedRows.results ?? []) {
    if (row.repo) exclude.add(row.repo);
  }

  for (const row of ghArchivedRows.results ?? []) {
    if (row.name) exclude.add(row.name);
  }

  return exclude;
}

// Resolve the configured unticket repo name (settings.unticketRepo, default
// "unticket"). The unticket repo holds features/todos/plans, not product work,
// and is read separately from the product-repo sync.
export async function getUnticketRepoName(db, orgId) {
  const settingsRow = await db
    .prepare("SELECT data FROM config WHERE org_id = ? AND key = 'settings'")
    .bind(orgId)
    .first();
  if (settingsRow?.data) {
    try {
      const parsed = JSON.parse(settingsRow.data);
      if (typeof parsed.unticketRepo === "string" && parsed.unticketRepo.trim()) {
        return parsed.unticketRepo.trim();
      }
    } catch (e) {
      console.warn(`[unticket] Corrupt settings JSON for org ${orgId}:`, e);
    }
  }
  return "unticket";
}

export async function filterInactive(db, orgId, orgLogin, repoNames) {
  if (!Array.isArray(repoNames) || repoNames.length === 0) return repoNames ?? [];
  const exclude = await getInactiveRepoSet(db, orgId, orgLogin);
  return exclude.size > 0 ? repoNames.filter((n) => !exclude.has(n)) : repoNames;
}

// Active list = every repo in `repos` minus everything `getInactiveRepoSet`
// would exclude. Used by read endpoints to filter via `repo IN (?, ?, …)`
// instead of `NOT IN (capped-list)` — keeps the bind count bounded by the
// active count (small in practice) and never silently drops inactive repos
// past the old 30-bind cap.
export async function getActiveRepoNames(db, orgId, orgLogin) {
  const [reposRow, inactive] = await Promise.all([
    db.prepare("SELECT name FROM repos WHERE org_id = ?").bind(orgId).all(),
    getInactiveRepoSet(db, orgId, orgLogin),
  ]);
  const out = [];
  for (const row of reposRow.results ?? []) {
    if (row?.name && !inactive.has(row.name)) out.push(row.name);
  }
  return out;
}
