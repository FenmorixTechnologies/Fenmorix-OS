-- Leave picks entered out of turn (a pick phoned in, or backfilled from paper) by a leader or someone with
-- Leave picks: Edit / Manage. The size rules can be set aside for these; conflicts never can.
ALTER TABLE leave_picks ADD COLUMN IF NOT EXISTS manual boolean NOT NULL DEFAULT false;
ALTER TABLE leave_picks ADD COLUMN IF NOT EXISTS rules_waived boolean NOT NULL DEFAULT false;
