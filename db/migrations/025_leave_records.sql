-- Leave picks: when a person's picks are complete, a copy of their dates and leave types is filed in their
-- Personnel File (one record per person per year, updated if their picks change afterwards).
CREATE TABLE IF NOT EXISTS leave_records (
  id uuid PRIMARY KEY,
  season_id uuid NOT NULL REFERENCES leave_seasons(id) ON DELETE CASCADE,
  member_id uuid NOT NULL UNIQUE REFERENCES leave_members(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  year integer NOT NULL,
  name text NOT NULL,
  unit text NOT NULL DEFAULT '',
  shift text NOT NULL DEFAULT '',
  ruleset text NOT NULL DEFAULT 'fire',
  lines jsonb NOT NULL DEFAULT '[]',      -- [{ day, start, hours, code, round, bumped }]
  totals jsonb NOT NULL DEFAULT '{}',     -- { OH, OV, OC, total }
  status text NOT NULL DEFAULT 'complete', -- complete | reopened
  filed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revisions integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS leave_records_user ON leave_records (user_id);

-- Completion messages to each Suppression shift's Assistant Chief and Battalion Chiefs: sent once per unit / shift
ALTER TABLE leave_units ADD COLUMN IF NOT EXISTS complete_notified boolean NOT NULL DEFAULT false;
ALTER TABLE leave_seasons ADD COLUMN IF NOT EXISTS shifts_notified jsonb NOT NULL DEFAULT '{}';
