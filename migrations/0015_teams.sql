-- Migration 0015: GitHub team mirror + membership map.
-- Webhook (team, membership), cron reconcile, and manual sync all
-- write here. /api/teams reads from these tables only.

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  github_id INTEGER NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(org_id, github_id)
);
CREATE INDEX IF NOT EXISTS idx_teams_org ON teams(org_id);

CREATE TABLE IF NOT EXISTS team_memberships (
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  team_github_id INTEGER NOT NULL,
  login TEXT NOT NULL,
  PRIMARY KEY (org_id, team_github_id, login)
);
CREATE INDEX IF NOT EXISTS idx_team_memberships_login ON team_memberships(org_id, login);
