-- Punch clock and work patterns.
-- A punch-in is a time entry with a start time and no end time yet (hours 0 until punched out).
-- work_pattern: how "hours needed per shift" is counted in the Time Tracker:
--   '' (not set), 'weekdays', 'fire:A'|'fire:B'|'fire:C', 'comms:A'..'comms:D'.
ALTER TABLE users ADD COLUMN IF NOT EXISTS work_pattern text NOT NULL DEFAULT ''
  CHECK (work_pattern ~ '^(|weekdays|fire:[ABC]|comms:[ABCD])$');
-- At most one open punch per person
CREATE UNIQUE INDEX IF NOT EXISTS time_entries_one_open
  ON time_entries (user_id) WHERE start_time IS NOT NULL AND end_time IS NULL;
