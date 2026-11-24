-- Work schedule (Time Clock module): who works which day and hours, set ahead of time by the people allowed to (access section
-- "schedule"). One row per person per day; end_time before start_time = past midnight. early_at = leaving early at that time.
CREATE TABLE IF NOT EXISTS work_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  day date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  early_at time,
  note text NOT NULL DEFAULT '',
  updated_by uuid REFERENCES users(id),
  updated_by_name text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, day)
);
CREATE INDEX IF NOT EXISTS work_schedule_day ON work_schedule (day);
