-- Leave picks: people on the roster before they have a Nexus account ("locked").
-- Each roster entry gets its own id; the Nexus account (user_id) is optional and is filled in when the
-- person's account is approved (matched by Emp # or name), which unlocks them. Picks belong to the
-- roster entry (member_id), so picks entered for someone before they had an account stay theirs.

ALTER TABLE leave_members ADD COLUMN IF NOT EXISTS id uuid;
UPDATE leave_members SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE leave_members ALTER COLUMN id SET NOT NULL;
ALTER TABLE leave_members DROP CONSTRAINT IF EXISTS leave_members_pkey;
ALTER TABLE leave_members ADD PRIMARY KEY (id);
ALTER TABLE leave_members ALTER COLUMN user_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS leave_members_season_user ON leave_members (season_id, user_id) WHERE user_id IS NOT NULL;
-- The name and division as on the roster (used while there's no account)
ALTER TABLE leave_members ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '';
ALTER TABLE leave_members ADD COLUMN IF NOT EXISTS division text NOT NULL DEFAULT '';
UPDATE leave_members m SET name = u.full_name, division = d.name FROM users u JOIN divisions d ON d.id = u.division_id
 WHERE u.id = m.user_id AND m.name = '';

ALTER TABLE leave_picks ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES leave_members(id) ON DELETE CASCADE;
UPDATE leave_picks p SET member_id = m.id FROM leave_members m WHERE m.season_id = p.season_id AND m.user_id = p.user_id AND p.member_id IS NULL;
DELETE FROM leave_picks WHERE member_id IS NULL;
ALTER TABLE leave_picks ALTER COLUMN member_id SET NOT NULL;
ALTER TABLE leave_picks ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE leave_picks DROP CONSTRAINT IF EXISTS leave_picks_season_id_user_id_round_key;
DO $$ BEGIN
  ALTER TABLE leave_picks ADD CONSTRAINT leave_picks_member_round UNIQUE (member_id, round);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

ALTER TABLE leave_pick_days ADD COLUMN IF NOT EXISTS member_id uuid;
UPDATE leave_pick_days d SET member_id = p.member_id FROM leave_picks p WHERE p.id = d.pick_id AND d.member_id IS NULL;
ALTER TABLE leave_pick_days ALTER COLUMN member_id SET NOT NULL;
ALTER TABLE leave_pick_days ALTER COLUMN user_id DROP NOT NULL;
-- leave_units.notified_user now holds the roster entry (member) id
