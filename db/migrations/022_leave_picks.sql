-- Annual leave picks (vacation pick).
--
-- A season is one calendar year. People pick inside a "unit": the group where only one person can
-- be off on a shift (a Suppression company on its shift, the chiefs on a shift, a Communications crew).
-- Picks go in turn order inside each unit, round after round. Each picked shift is one row in
-- leave_pick_days; the unique (unit_id, day) index is what keeps it to one off per unit per shift.
-- Leave codes (OH/OV/OC) aren't stored: they're charged in date order (holidays, then vacation,
-- then banked/comp) whenever a report or screen needs them.

CREATE TABLE leave_seasons (
  id          uuid PRIMARY KEY,
  year        int  NOT NULL UNIQUE CHECK (year BETWEEN 2020 AND 2100),
  status      text NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'open', 'closed')),
  rules       jsonb NOT NULL DEFAULT '{}',      -- { fire: {...}, comms: {...} }, see server/leave.js DEFAULT_RULES
  opened_by   uuid REFERENCES users(id),
  opened_at   timestamptz,
  closed_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE leave_units (
  id          uuid PRIMARY KEY,
  season_id   uuid NOT NULL REFERENCES leave_seasons(id) ON DELETE CASCADE,
  name        text NOT NULL,                    -- "613", "Chiefs", "Comms C Crew"
  ruleset     text NOT NULL CHECK (ruleset IN ('fire', 'comms')),
  shift       text NOT NULL CHECK (shift IN ('A', 'B', 'C', 'D')),
  pool        text NOT NULL DEFAULT '',         -- daily cap group: "Suppression", "Special Operations", "EMS", "Chiefs"
  notified_user uuid,                           -- whose turn we last sent a message about
  notified_round int,
  sort        int NOT NULL DEFAULT 0,
  UNIQUE (season_id, ruleset, shift, name)
);

CREATE TABLE leave_members (
  season_id       uuid NOT NULL REFERENCES leave_seasons(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id),
  unit_id         uuid REFERENCES leave_units(id) ON DELETE SET NULL,
  pick_order      int  NOT NULL DEFAULT 0,
  leader          boolean NOT NULL DEFAULT false,   -- Captain / Shift Lead: can pick for the unit
  rank            text NOT NULL DEFAULT '',
  emp_no          text NOT NULL DEFAULT '',
  hire_date       date,
  seniority_date  date,                             -- adjusted hire date (seniority, anniversary)
  yos             int,
  holiday_hours   numeric(7,2) NOT NULL DEFAULT 0,
  vacation_hours  numeric(7,2) NOT NULL DEFAULT 0,
  banked_hours    numeric(7,2) NOT NULL DEFAULT 0,  -- banked vacation / comp time they may also pick
  done            boolean NOT NULL DEFAULT false,
  done_at         timestamptz,
  note            text NOT NULL DEFAULT '',
  PRIMARY KEY (season_id, user_id)
);
CREATE INDEX leave_members_unit ON leave_members (unit_id, pick_order);

CREATE TABLE leave_picks (
  id            uuid PRIMARY KEY,
  season_id     uuid NOT NULL REFERENCES leave_seasons(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id),
  unit_id       uuid NOT NULL REFERENCES leave_units(id) ON DELETE CASCADE,
  round         int  NOT NULL,
  skipped       boolean NOT NULL DEFAULT false,
  entered_by    uuid REFERENCES users(id),
  entered_by_name text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_id, user_id, round)
);

CREATE TABLE leave_pick_days (
  pick_id     uuid NOT NULL REFERENCES leave_picks(id) ON DELETE CASCADE,
  season_id   uuid NOT NULL,
  user_id     uuid NOT NULL,
  unit_id     uuid NOT NULL,
  day         date NOT NULL,
  start_time  text NOT NULL,                        -- "0700" / "1900"
  hours       numeric(5,2) NOT NULL,
  PRIMARY KEY (pick_id, day),
  UNIQUE (unit_id, day)
);
CREATE INDEX leave_pick_days_season ON leave_pick_days (season_id, day);
