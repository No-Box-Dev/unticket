-- Organizations
CREATE TABLE orgs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  github_login TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- User sessions (for server-side GitHub calls)
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  github_login TEXT NOT NULL,
  encrypted_token TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(org_id, github_login)
);

-- Cached repos
CREATE TABLE repos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  language TEXT,
  pushed_at TEXT,
  UNIQUE(org_id, name)
);

-- Pull requests (cached)
CREATE TABLE pull_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL,
  author TEXT,
  author_avatar TEXT,
  draft INTEGER DEFAULT 0,
  head_ref TEXT,
  base_ref TEXT,
  merged_at TEXT,
  created_at TEXT,
  updated_at TEXT,
  html_url TEXT,
  requested_reviewers_json TEXT DEFAULT '[]',
  labels_json TEXT DEFAULT '[]',
  UNIQUE(org_id, repo, number)
);

-- Issues (cached)
CREATE TABLE issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL,
  author TEXT,
  author_avatar TEXT,
  created_at TEXT,
  updated_at TEXT,
  closed_at TEXT,
  html_url TEXT,
  assignees_json TEXT DEFAULT '[]',
  labels_json TEXT DEFAULT '[]',
  milestone_title TEXT,
  UNIQUE(org_id, repo, number)
);

-- Sync tracking
CREATE TABLE sync_state (
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  resource TEXT NOT NULL,
  last_synced TEXT NOT NULL,
  etag TEXT,
  PRIMARY KEY(org_id, resource)
);

-- Config (flexible JSON storage)
CREATE TABLE config (
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  key TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY(org_id, key)
);

-- Members (cached)
CREATE TABLE members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  login TEXT NOT NULL,
  avatar_url TEXT,
  UNIQUE(org_id, login)
);
