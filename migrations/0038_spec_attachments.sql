-- User-uploaded documents attached to a Spec.
--
-- Object bytes live in R2 (bucket: unticket-spec-attachments, binding
-- SPEC_ATTACHMENTS in wrangler.toml). D1 stores the metadata row that
-- links the object back to its Spec + who uploaded it + how big it is.
-- FK is CASCADE — deleting a Spec drops its attachment rows in D1; the
-- server-side spec-delete flow (or a future prune cron) is responsible
-- for cleaning up the R2 objects.

CREATE TABLE IF NOT EXISTS spec_attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL,
  spec_id       INTEGER NOT NULL,
  filename      TEXT    NOT NULL,
  content_type  TEXT    NOT NULL,
  size          INTEGER NOT NULL,
  r2_key        TEXT    NOT NULL UNIQUE,
  uploaded_by   TEXT    NOT NULL,
  uploaded_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  FOREIGN KEY (spec_id) REFERENCES specs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_spec_attachments_spec
  ON spec_attachments (org_id, spec_id, uploaded_at DESC);
