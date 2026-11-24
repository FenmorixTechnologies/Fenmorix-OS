-- Time punches, call-out schedules, and per-person permissions.

-- Extra permissions a master admin can grant. division_id NULL = every division.
--   time_view     see other people's time punches (supervisors)
--   callout_edit  edit the call-out schedule for a division (besides their own)
CREATE TABLE user_permissions (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission  text NOT NULL CHECK (permission IN ('time_view', 'callout_edit')),
  division_id int REFERENCES divisions(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX user_permissions_uniq ON user_permissions (user_id, permission, COALESCE(division_id, 0));

-- One punch (in/out) or a block of leave hours on a day
CREATE TABLE time_entries (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id),
  work_date   date NOT NULL,                 -- the day the punch started
  start_time  time,                          -- 24-hour; blank for hours-only leave
  end_time    time,                          -- earlier than start = ends next day
  hours       numeric(5,2) NOT NULL CHECK (hours >= 0 AND hours <= 48),
  kind        text NOT NULL CHECK (kind IN ('regular', 'vacation', 'comp', 'sick', 'swap')),
  note        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX time_entries_user_date ON time_entries (user_id, work_date);

-- Who's on call for a division (or the floor's call-back order) over a date range
CREATE TABLE callout_entries (
  id          uuid PRIMARY KEY,
  division_id int NOT NULL REFERENCES divisions(id),
  start_date  date NOT NULL,
  end_date    date NOT NULL CHECK (end_date >= start_date),
  position    int NOT NULL DEFAULT 1 CHECK (position BETWEEN 1 AND 99),   -- call-back order
  user_id     uuid REFERENCES users(id),
  person_name text NOT NULL,
  phone       text NOT NULL DEFAULT '',
  notes       text NOT NULL DEFAULT '',
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX callout_entries_dates ON callout_entries (start_date, end_date);
