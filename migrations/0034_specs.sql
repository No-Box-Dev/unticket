-- Manual Specs — first-class, entirely user-curated (no GitHub round-trip).
--
-- Two tables:
--   spec_folders  — user-created "Projects" in the UI, org-scoped.
--   specs         — the specs themselves (Markdown description + link list).
--
-- Archive semantics mirror `projects.archived` — archived rows stay in the
-- table and are excluded from active views. Archiving a folder cascade-archives
-- its specs (see functions/api/spec-folders/[id]/archive.ts) but unarchiving a
-- folder does NOT cascade back — admins restore individual specs deliberately.

CREATE TABLE IF NOT EXISTS spec_folders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id       INTEGER NOT NULL,
  name         TEXT    NOT NULL,
  description  TEXT,
  archived     INTEGER NOT NULL DEFAULT 0,
  archived_at  TEXT,
  created_by   TEXT    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_spec_folders_org
  ON spec_folders (org_id, archived, name COLLATE NOCASE);

-- Partial unique index: name uniqueness applies to ACTIVE folders only, so an
-- admin can archive "Payments" and later create a new "Payments" without a
-- collision. Uses LOWER() for case-insensitive matching.
CREATE UNIQUE INDEX IF NOT EXISTS uq_spec_folders_active_name
  ON spec_folders (org_id, LOWER(name))
  WHERE archived = 0;

CREATE TABLE IF NOT EXISTS specs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id       INTEGER NOT NULL,
  folder_id    INTEGER,
  title        TEXT    NOT NULL,
  description  TEXT    NOT NULL DEFAULT '',
  links_json   TEXT    NOT NULL DEFAULT '[]',
  archived     INTEGER NOT NULL DEFAULT 0,
  archived_at  TEXT,
  created_by   TEXT    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  FOREIGN KEY (folder_id) REFERENCES spec_folders(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_specs_org_folder
  ON specs (org_id, archived, folder_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_specs_org_updated
  ON specs (org_id, archived, updated_at DESC);
