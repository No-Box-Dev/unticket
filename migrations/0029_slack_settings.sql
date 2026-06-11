-- Per-org Slack bot install. One row per org once OAuth completes; cleared on
-- Disconnect. The bot token is encrypted with ENCRYPTION_KEY (same helper the
-- llm_settings table uses) and never sent back to the browser — the Settings
-- UI shows the workspace name + bot user id only.
--
-- Public/per-feed channel selections (postsChannelId / releaseNotesChannelId)
-- live in the existing settings JSON (settings.slack.*) — they're not secrets
-- and benefit from the same admin-gate as everything else under settings.
CREATE TABLE IF NOT EXISTS slack_settings (
  org_id              INTEGER PRIMARY KEY REFERENCES orgs(id),
  team_id             TEXT NOT NULL,
  team_name           TEXT,
  bot_user_id         TEXT,
  encrypted_bot_token TEXT NOT NULL,
  installed_by        TEXT NOT NULL,
  installed_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
