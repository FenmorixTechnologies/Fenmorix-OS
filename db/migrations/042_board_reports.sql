-- Board operational reports (Fire Board meetings): saved report layouts, like comms_reports
CREATE TABLE IF NOT EXISTS board_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES users(id),
  title        text NOT NULL,
  report_type  text NOT NULL DEFAULT '',
  prepared_by  text NOT NULL DEFAULT '',
  notes        text NOT NULL DEFAULT '',
  window_kind  text NOT NULL DEFAULT 'lastMonth',
  window_from  date,
  window_to    date,
  blocks       jsonb NOT NULL DEFAULT '[]',
  shared       boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
