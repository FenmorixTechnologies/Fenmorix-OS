-- Radio call sign on the directory card (e.g. SG10), used for "who is on this unit" when Aladtec doesn't say
ALTER TABLE users ADD COLUMN IF NOT EXISTS call_sign text NOT NULL DEFAULT '';

-- Command Board: the incident commander's board for a fire call (accountability, PAR, strategy, mayday, benchmarks,
-- radio notes, smoke reading, apparatus positions). One board per CAD incident; state is applied by the server one
-- action at a time (version goes up each time) and every action is also written to command_events (append-only).
CREATE TABLE IF NOT EXISTS command_boards (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id     text NOT NULL UNIQUE,
  incident_number text NOT NULL DEFAULT '',
  nature          text NOT NULL DEFAULT '',
  address         text NOT NULL DEFAULT '',
  lat             double precision,
  lon             double precision,
  received_at     timestamptz,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  state           jsonb NOT NULL DEFAULT '{}',
  version         int NOT NULL DEFAULT 1,
  opened_by       uuid REFERENCES users(id),
  opened_by_name  text NOT NULL DEFAULT '',
  opened_at       timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz
);
CREATE TABLE IF NOT EXISTS command_events (
  id        bigserial PRIMARY KEY,
  board_id  uuid NOT NULL REFERENCES command_boards(id) ON DELETE CASCADE,
  at        timestamptz NOT NULL DEFAULT now(),
  kind      text NOT NULL,
  text      text NOT NULL DEFAULT '',
  critical  boolean NOT NULL DEFAULT false,
  by_id     uuid REFERENCES users(id),
  by_name   text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS command_events_board_idx ON command_events (board_id, at);
CREATE OR REPLACE FUNCTION command_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Command board events cannot be changed'; END $$;
DROP TRIGGER IF EXISTS command_events_no_change ON command_events;
CREATE TRIGGER command_events_no_change BEFORE UPDATE ON command_events FOR EACH ROW EXECUTE FUNCTION command_events_append_only();

-- When a board is closed it becomes a record: who completed it (shown in their Personnel File), and a frozen
-- after-action report (HTML file, downloadable, printable). Reopening and closing again rewrites the report.
ALTER TABLE command_boards ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES users(id);
ALTER TABLE command_boards ADD COLUMN IF NOT EXISTS completed_by_name text NOT NULL DEFAULT '';
ALTER TABLE command_boards ADD COLUMN IF NOT EXISTS report_html text;
ALTER TABLE command_boards ADD COLUMN IF NOT EXISTS report_at timestamptz;
CREATE INDEX IF NOT EXISTS command_boards_completed_idx ON command_boards (completed_by);

-- A working fire recording can carry the command board for the same incident (linked by incident number on close /
-- import, or by hand) so the after-action review has the radio traffic and the board together.
ALTER TABLE fire_recordings ADD COLUMN IF NOT EXISTS command_board_id uuid REFERENCES command_boards(id) ON DELETE SET NULL;
