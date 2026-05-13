-- Add kind column to members to distinguish humans from bots.
-- Bots are auto-registered when they open PRs; existing members are all human.
ALTER TABLE members ADD COLUMN kind TEXT NOT NULL DEFAULT 'human';
