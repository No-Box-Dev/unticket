-- Add a per-project owner to the manual Specs feature.
--
-- One owner per project (Person), nullable. Value is a GitHub login — same
-- shape as Feature.owners entries and members.login rows. No FK: an org
-- member can be removed from GitHub without cascading here (we already keep
-- a `pending`-style tombstone in features when an assignee leaves).

ALTER TABLE spec_folders ADD COLUMN owner TEXT;
