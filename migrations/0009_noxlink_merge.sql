-- Migration 0009: fold NoxLink brain tables into unticket D1.
-- Phase 2 of plans/fold-noxlink-into-unticket.md.
--
-- Additive only. No DROP, no destructive ALTER. Names kept verbatim to
-- the NoxLink schema so the code port (webhook, narrator, actors, notes)
-- stays a near-direct copy.
--
-- Deliberately NOT included:
--   - social_accounts / social_posts        (Bluesky out of scope)
--   - sessions (NoxLink shape)              (laptop-only signal layer
--                                            collides with unticket's
--                                            existing per-user auth
--                                            sessions table; Phase 6
--                                            kills the laptop pusher)
--
-- Deferred until Phase 4 (cron worker):
--   - narrator_queue / narrator_cooldown    (failsafe retry storage; the
--                                            webhook hot path uses
--                                            waitUntil + per-event
--                                            narrate, not a queue. Lands
--                                            with the cron deploy.)

-- ============================================================
-- GitHub mirror layer (owned by sync engine; read-only joins).
-- Keyed by GitHub's stable numeric id so login renames don't fragment
-- rows. API handlers and webhook handlers must NEVER write to these
-- tables — sync engine only.
-- ============================================================

CREATE TABLE IF NOT EXISTS gh_users (
  id          INTEGER PRIMARY KEY,
  login       TEXT NOT NULL,
  avatar_url  TEXT,
  type        TEXT NOT NULL,
  name        TEXT,
  synced_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gh_users_login ON gh_users(login);

CREATE TABLE IF NOT EXISTS gh_orgs (
  id           INTEGER PRIMARY KEY,
  login        TEXT NOT NULL UNIQUE,
  avatar_url   TEXT,
  description  TEXT,
  synced_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gh_repos (
  id              INTEGER PRIMARY KEY,
  full_name       TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  owner_login     TEXT NOT NULL,
  installation_id INTEGER NOT NULL,
  default_branch  TEXT,
  archived        INTEGER NOT NULL DEFAULT 0,
  synced_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_gh_repos_installation ON gh_repos(installation_id);

CREATE TABLE IF NOT EXISTS gh_members (
  installation_id INTEGER NOT NULL,
  gh_user_id      INTEGER NOT NULL,
  synced_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (installation_id, gh_user_id)
);
CREATE INDEX IF NOT EXISTS idx_gh_members_user ON gh_members(gh_user_id);

-- ============================================================
-- GitHub App installations (one row per org or user account).
-- Coexists with orgs.installation_id during cutover; orgs column will
-- repoint reads to this table in Phase 5 then drop.
-- ============================================================

CREATE TABLE IF NOT EXISTS installations (
  installation_id INTEGER PRIMARY KEY,
  owner_id        TEXT NOT NULL,
  account_login   TEXT NOT NULL,
  account_type    TEXT NOT NULL,
  repos_json      TEXT,
  installed_at    INTEGER,
  updated_at      INTEGER,
  bootstrapped_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_installations_owner ON installations(owner_id);
CREATE INDEX IF NOT EXISTS idx_installations_account_login ON installations(account_login);

-- ============================================================
-- Actors — overlay on gh_users adding tone, custom name, kind=human|bot.
-- One row per (owner_id, github_user_id). github_user_id may be NULL for
-- bots that don't map to a GH account; SQLite UNIQUE allows multiple
-- NULLs which is the desired behavior.
-- ============================================================

CREATE TABLE IF NOT EXISTS actors (
  id              TEXT PRIMARY KEY,
  github_user_id  TEXT,
  name            TEXT NOT NULL,
  avatar_url      TEXT,
  tone            TEXT,
  kind            TEXT NOT NULL DEFAULT 'human',
  owner_id        TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_id, github_user_id)
);
CREATE INDEX IF NOT EXISTS idx_actors_owner ON actors(owner_id);
CREATE INDEX IF NOT EXISTS idx_actors_github_user ON actors(owner_id, github_user_id);

-- Per-actor per-project tone nudge appended to the actor's base tone
-- when generating that project's narratives.
CREATE TABLE IF NOT EXISTS actor_repo_notes (
  actor_id     TEXT NOT NULL,
  project_id   TEXT NOT NULL,
  note         TEXT,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (actor_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_actor_notes_project ON actor_repo_notes(project_id);

-- ============================================================
-- Projects — narrator-scope overlay on gh_repos. Keyed by string id
-- (NoxLink convention) so existing brain rows port verbatim during the
-- Phase 7 data migration. unticket's existing repos table coexists
-- until UI repoints to gh_repos joins, then drops.
-- ============================================================

CREATE TABLE IF NOT EXISTS projects (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  slug              TEXT,
  org               TEXT,
  repo              TEXT,
  description       TEXT,
  narrator_enabled  INTEGER NOT NULL DEFAULT 1,
  updated_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  owner_id          TEXT
);
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(org);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);

-- ============================================================
-- Events — append-only log. One row per webhook-derived action
-- (pr:opened, pr:merged, push, issues:opened, ...) and one row per
-- narrator output (type='narrative'). Read by the in-app Posts tab.
-- ============================================================

CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id  TEXT UNIQUE,
  source       TEXT NOT NULL,
  type         TEXT NOT NULL,
  actor_id     TEXT,
  project_id   TEXT,
  org          TEXT,
  repo         TEXT,
  summary      TEXT,
  payload_json TEXT,
  owner_id     TEXT,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id);
CREATE INDEX IF NOT EXISTS idx_events_owner ON events(owner_id);
CREATE INDEX IF NOT EXISTS idx_events_actor ON events(actor_id);

-- ============================================================
-- FK pointers from existing unticket tables into the new mirror layer.
-- Nullable until Phase 7 backfill populates them; reads will dual-source
-- only during the brief migration window before UI repoints.
-- ============================================================

ALTER TABLE repos ADD COLUMN gh_repo_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_repos_gh_repo_id ON repos(gh_repo_id);

ALTER TABLE members ADD COLUMN gh_user_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_members_gh_user_id ON members(gh_user_id);
