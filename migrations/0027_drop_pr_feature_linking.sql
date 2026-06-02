-- Remove the PR↔Feature linking feature entirely (flaky LLM auto-matcher +
-- manual pr_feature_links). Dropping the tables also drops their indexes.
-- The app no longer reads or writes either table.
DROP TABLE IF EXISTS pr_feature_links;
DROP TABLE IF EXISTS pr_match_attempts;
