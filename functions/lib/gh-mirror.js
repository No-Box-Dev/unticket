// GitHub mirror upserts (gh_users, gh_repos, gh_orgs).
// These tables are the canonical identity layer. The webhook keeps them
// fresh from event payloads; the 15-min reconcile cron (Phase 4) does
// full pulls for any installation that's gone stale.

export async function upsertGhUser(db, user) {
  if (!user?.id || !user?.login) return;
  await db.prepare(
    `INSERT INTO gh_users (id, login, avatar_url, type, name, synced_at)
     VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
     ON CONFLICT(id) DO UPDATE SET
       login = excluded.login,
       avatar_url = COALESCE(excluded.avatar_url, gh_users.avatar_url),
       type = excluded.type,
       name = COALESCE(excluded.name, gh_users.name),
       synced_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`
  ).bind(
    user.id,
    user.login,
    user.avatar_url ?? null,
    user.type ?? "User",
    user.name ?? null,
  ).run();
}

export async function upsertInstallation(db, installation, reposJson = null) {
  if (!installation?.id || !installation?.account?.login) return;
  const accountLogin = installation.account.login;
  const accountType = installation.account.type ?? "Organization";
  const now = Math.floor(Date.now() / 1000);
  // installed_at is set on INSERT only — never overwritten on conflict.
  // Re-fires from new_permissions_accepted/unsuspend would otherwise reset
  // the original install date. repos_json is updated only when caller
  // passes it (COALESCE preserves the existing list otherwise).
  await db.prepare(
    `INSERT INTO installations (installation_id, owner_id, account_login, account_type, repos_json, installed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(installation_id) DO UPDATE SET
       owner_id = excluded.owner_id,
       account_login = excluded.account_login,
       account_type = excluded.account_type,
       repos_json = COALESCE(excluded.repos_json, installations.repos_json),
       updated_at = excluded.updated_at`
  ).bind(
    installation.id,
    accountLogin,
    accountLogin,
    accountType,
    reposJson,
    now,
    now,
  ).run();
}

/** Replace the repos_json list for an installation (idempotent). */
export async function setInstallationRepos(db, installationId, fullNames) {
  if (!installationId) return;
  const list = Array.isArray(fullNames) ? fullNames.filter((n) => typeof n === "string" && n.includes("/")) : [];
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `UPDATE installations SET repos_json = ?, updated_at = ? WHERE installation_id = ?`
  ).bind(JSON.stringify(list), now, installationId).run();
}

/** Read the current repos_json list for an installation (returns []). */
export async function getInstallationRepos(db, installationId) {
  if (!installationId) return [];
  const row = await db.prepare(
    "SELECT repos_json FROM installations WHERE installation_id = ?"
  ).bind(installationId).first();
  if (!row?.repos_json) return [];
  try {
    const arr = JSON.parse(row.repos_json);
    return Array.isArray(arr) ? arr.filter((n) => typeof n === "string") : [];
  } catch (err) {
    // Surfacing the corruption is important: silently returning [] used to
    // make installations look empty in downstream callers. The webhook
    // handler (only current caller) will rebuild repos_json from the
    // add/remove payload on the next install_repositories event, so we
    // can't realistically throw here without breaking install resilience.
    console.error(
      `[unticket gh-mirror] Corrupt repos_json for installation ${installationId}:`,
      err?.message ?? err,
    );
    return [];
  }
}
