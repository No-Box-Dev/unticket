// Source of truth for which repos are inactive in this org.
// A repo is inactive (and therefore excluded from sync, the issues/PRs
// endpoints, and any other "all repos" surface) if any of:
//   - listed in settings.draftRepos
//   - has projects.archived = 1
//   - is the configured "unticket" repo (settings.unticketRepo, default
//     "unticket") — that repo holds features/todos/plans, not product work
//
// Returns a Set<string> of repo names to exclude.
export async function getInactiveRepoSet(db, orgId, orgLogin) {
  const [settingsRow, archivedRows] = await db.batch([
    db.prepare("SELECT data FROM config WHERE org_id = ? AND key = 'settings'").bind(orgId),
    db.prepare("SELECT repo FROM projects WHERE owner_id = ? AND archived = 1").bind(orgLogin),
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

  return exclude;
}

export async function filterInactive(db, orgId, orgLogin, repoNames) {
  if (!Array.isArray(repoNames) || repoNames.length === 0) return repoNames ?? [];
  const exclude = await getInactiveRepoSet(db, orgId, orgLogin);
  return exclude.size > 0 ? repoNames.filter((n) => !exclude.has(n)) : repoNames;
}
