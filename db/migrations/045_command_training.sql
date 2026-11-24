-- Command boards made by hand from the Command Board section: training boards (to teach the board; no emergency mode) and
-- real incidents that aren't in CAD. A training board is kept for future reference only if it's saved when it's closed.
ALTER TABLE command_boards ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'incident';
ALTER TABLE command_boards DROP CONSTRAINT IF EXISTS command_boards_kind_check;
ALTER TABLE command_boards ADD CONSTRAINT command_boards_kind_check CHECK (kind IN ('incident', 'training'));
ALTER TABLE command_boards ADD COLUMN IF NOT EXISTS from_cad boolean NOT NULL DEFAULT true;
ALTER TABLE command_boards ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '';
