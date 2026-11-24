-- Training upgrades: crew drills logged by company officers and verified by Training, proficiency
-- checks kept apart from hours, the grading-year roster history, and FireWorks matching of drill hours.

-- A drill (company training session) logged by an officer for the crew
CREATE TABLE IF NOT EXISTS training_drills (
  id            uuid PRIMARY KEY,
  day           date NOT NULL,
  start_time    time,
  end_time      time,
  hours         numeric(5,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  station       text NOT NULL DEFAULT '',          -- "61"
  shift         text NOT NULL DEFAULT '',          -- A | B | C | ''
  units         text NOT NULL DEFAULT '',          -- "EG613, LD618"
  location      text NOT NULL DEFAULT '',
  at_facility   boolean NOT NULL DEFAULT false,    -- training ground / props (ISO facility hours)
  kind          text NOT NULL DEFAULT 'company',   -- ISO kind: company | facility | officer | driver | hazmat | ims | other
  delivery      text NOT NULL DEFAULT 'inhouse',   -- inhouse | virtual | cbt | outside
  certification text NOT NULL DEFAULT '',
  subject       text NOT NULL DEFAULT '',
  fw_category   text NOT NULL DEFAULT '',
  topic         text NOT NULL,
  objectives    text NOT NULL DEFAULT '',
  instructor    text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'draft',     -- draft | submitted | verified | returned
  officer_id    uuid REFERENCES users(id),
  officer_name  text NOT NULL DEFAULT '',
  officer_signature text,                          -- PNG data URL, drawn when submitted
  submitted_at  timestamptz,
  verified_by   uuid REFERENCES users(id),
  verified_name text NOT NULL DEFAULT '',
  verified_at   timestamptz,
  return_note   text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS training_drills_day_idx ON training_drills (day DESC);
CREATE INDEX IF NOT EXISTS training_drills_status_idx ON training_drills (status);

CREATE TABLE IF NOT EXISTS training_drill_people (
  id            uuid PRIMARY KEY,
  drill_id      uuid NOT NULL REFERENCES training_drills(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES users(id),
  name          text NOT NULL,
  hours         numeric(5,2) NOT NULL CHECK (hours >= 0 AND hours <= 24),
  confirmed_at  timestamptz,                       -- the member confirmed they attended
  disputed      text NOT NULL DEFAULT '',          -- the member says something's wrong
  record_id     uuid,                              -- training_records row made when verified
  UNIQUE (drill_id, user_id)
);
CREATE INDEX IF NOT EXISTS training_drill_people_user_idx ON training_drill_people (user_id);

-- Training records made from verified drills; a FireWorks row for the same person/day/hours supersedes them
ALTER TABLE training_records ADD COLUMN IF NOT EXISTS drill_id uuid;
ALTER TABLE training_records ADD COLUMN IF NOT EXISTS superseded_by uuid;
ALTER TABLE training_records ADD COLUMN IF NOT EXISTS delivery text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS training_records_drill_idx ON training_records (drill_id) WHERE drill_id IS NOT NULL;

-- Proficiency: a skill demonstrated (or not), apart from hours
CREATE TABLE IF NOT EXISTS training_skill_checks (
  id         uuid PRIMARY KEY,
  user_id    uuid REFERENCES users(id),
  name       text NOT NULL,
  skill_id   text NOT NULL,
  day        date NOT NULL,
  result     text NOT NULL CHECK (result IN ('met', 'not_met')),
  drill_id   uuid REFERENCES training_drills(id) ON DELETE CASCADE,
  note       text NOT NULL DEFAULT '',
  by_id      uuid REFERENCES users(id),
  by_name    text NOT NULL DEFAULT '',
  status     text NOT NULL DEFAULT 'final',       -- final | pending (on a drill not verified yet)
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS training_skill_checks_user_idx ON training_skill_checks (user_id, skill_id, day DESC);

-- Who was on the roster in each grading year (PIAL grades the members of the graded year)
CREATE TABLE IF NOT EXISTS training_roster (
  id           uuid PRIMARY KEY,
  year         int NOT NULL,
  user_id      uuid REFERENCES users(id),
  name         text NOT NULL,
  emp_no       text NOT NULL DEFAULT '',
  title        text NOT NULL DEFAULT '',
  division     text NOT NULL DEFAULT '',
  station      text NOT NULL DEFAULT '',
  shift        text NOT NULL DEFAULT '',
  joined       date NOT NULL,                     -- on the roster from (Jan 1, hire date or when added)
  left_on      date,                              -- off the roster (left, moved out of suppression)
  officer      boolean NOT NULL DEFAULT false,
  driver       boolean NOT NULL DEFAULT false,
  driver_since date,
  hire_date    date,
  suppression  boolean NOT NULL DEFAULT true,
  source       text NOT NULL DEFAULT 'auto',      -- auto (kept in step with Nexus accounts) | manual
  locked       boolean NOT NULL DEFAULT false,    -- edited by hand: the automatic sync leaves it alone
  changes      jsonb NOT NULL DEFAULT '[]',       -- [{at, what}]
  note         text NOT NULL DEFAULT '',
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS training_roster_user_idx ON training_roster (year, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS training_roster_year_idx ON training_roster (year);
