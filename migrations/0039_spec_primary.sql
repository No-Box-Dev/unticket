-- A Feature may nominate one of its active Specs as the direct link shown on
-- the Feature card. The flag lives on the Spec because a Spec belongs to at
-- most one Feature.
ALTER TABLE specs ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_specs_primary_per_feature
  ON specs (org_id, feature_number)
  WHERE is_primary = 1 AND archived = 0 AND feature_number IS NOT NULL;
