-- Add configurable config repo name per org (default: .gitpulse)
ALTER TABLE orgs ADD COLUMN config_repo TEXT NOT NULL DEFAULT '.gitpulse';
