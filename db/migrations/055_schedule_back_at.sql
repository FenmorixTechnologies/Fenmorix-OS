-- Work schedule: stepping out and coming back (a doctor's appointment, an errand). early_at = leaves at; back_at = back at
-- (NULL = gone for the rest of the day, as before).
ALTER TABLE work_schedule ADD COLUMN IF NOT EXISTS back_at time;
