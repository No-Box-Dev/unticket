// GitHub mirror upserts (gh_users, gh_repos, gh_orgs).
// These tables are the canonical identity layer. The webhook keeps them
// fresh from event payloads; the 15-min reconcile cron (Phase 4) does
// full pulls for any installation that's gone stale.

export async function upsertGhUser(db, user) {
  if (!user?.id || !user?.login) return;
  await db.prepare(
    `INSERT INTO gh_users (id, login, avatar_url, type, name, synced_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       login = excluded.login,
       avatar_url = COALESCE(excluded.avatar_url, gh_users.avatar_url),
       type = excluded.type,
       name = COALESCE(excluded.name, gh_users.name),
       synced_at = CURRENT_TIMESTAMP`
  ).bind(
    user.id,
    user.login,
    user.avatar_url ?? null,
    user.type ?? "User",
    user.name ?? null,
  ).run();
}

export async function upsertInstallation(db, installation) {
  if (!installation?.id || !installation?.account?.login) return;
  const accountLogin = installation.account.login;
  const accountType = installation.account.type ?? "Organization";
  // owner_id = github_login (NoxLink convention); stable across renames is
  // not strictly true but the rename event re-fires installation and we
  // re-upsert by installation_id PK.
  await db.prepare(
    `INSERT INTO installations (installation_id, owner_id, account_login, account_type, installed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(installation_id) DO UPDATE SET
       owner_id = excluded.owner_id,
       account_login = excluded.account_login,
       account_type = excluded.account_type,
       updated_at = excluded.updated_at`
  ).bind(
    installation.id,
    accountLogin,
    accountLogin,
    accountType,
    Math.floor(Date.now() / 1000),
    Math.floor(Date.now() / 1000),
  ).run();
}
