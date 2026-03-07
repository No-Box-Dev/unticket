-- Features (cached from .gitpulse repo issues)
CREATE TABLE features (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  body TEXT DEFAULT '',
  assignees_json TEXT DEFAULT '[]',
  labels_json TEXT DEFAULT '[]',
  milestone_title TEXT,
  html_url TEXT,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(org_id, number)
);
