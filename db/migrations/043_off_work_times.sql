-- Off Work: part of a day (leaving / back by, estimated) and where they'll be
ALTER TABLE off_work ADD COLUMN IF NOT EXISTS start_time time;
ALTER TABLE off_work ADD COLUMN IF NOT EXISTS end_time time;
ALTER TABLE off_work ADD COLUMN IF NOT EXISTS location text NOT NULL DEFAULT '';
