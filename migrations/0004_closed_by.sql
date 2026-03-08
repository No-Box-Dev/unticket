-- Add closed_by column to track who closed each issue
ALTER TABLE issues ADD COLUMN closed_by TEXT;
