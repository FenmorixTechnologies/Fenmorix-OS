-- Per-person display preferences that follow them to any device
-- (e.g. Your Day widget order and which widgets are collapsed).
ALTER TABLE users ADD COLUMN IF NOT EXISTS ui_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;
