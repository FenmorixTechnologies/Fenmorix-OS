-- Off Work: days people are out (vacation, training, out of office, ...), posted by them (or for them by their division's
-- coordinators), seen by everyone, their division, or certain people/groups. Sick leave call-outs show up on their own
-- (server/offwork.js reads sick_entries); nothing about them is copied here.
CREATE TABLE IF NOT EXISTS off_work (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  start_day   date NOT NULL,
  end_day     date NOT NULL CHECK (end_day >= start_day),
  kind        text NOT NULL DEFAULT 'off',
  note        text NOT NULL DEFAULT '',
  visibility  text NOT NULL DEFAULT 'everyone' CHECK (visibility IN ('everyone', 'division', 'people')),
  people      jsonb NOT NULL DEFAULT '[]',          -- [{kind: user|group, id, name}] when visibility = people
  created_by  uuid REFERENCES users(id),
  created_by_name text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS off_work_days_idx ON off_work (start_day, end_day);
CREATE INDEX IF NOT EXISTS off_work_user_idx ON off_work (user_id);
