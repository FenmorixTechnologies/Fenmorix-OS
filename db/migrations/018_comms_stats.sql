-- Communications Statistics: closed CAD incidents pulled nightly from a second read-only view
-- (scripts/cad-stats-view-template.sql), plus code/ID lookups, settings and saved reports.
--
-- Times are stored as the CAD's local wall-clock time (timestamp without time zone), so a call
-- at 23:50 always counts on its own day and hour with no time-zone math.

CREATE TABLE cad_incidents (
  incident_id      text PRIMARY KEY,
  incident_number  text NOT NULL DEFAULT '',
  agency           text NOT NULL DEFAULT '',
  received_at      timestamp NOT NULL,          -- call received / incident created
  queued_at        timestamp,                   -- entered the pending (dispatch) queue
  assigned_at      timestamp,                   -- first unit assigned / dispatched
  enroute_at       timestamp,
  arrived_at       timestamp,
  closed_at        timestamp,
  nature           text NOT NULL DEFAULT '',
  priority         text NOT NULL DEFAULT '',
  disposition      text NOT NULL DEFAULT '',
  call_taker       text NOT NULL DEFAULT '',     -- CAD operator id
  dispatcher       text NOT NULL DEFAULT '',     -- CAD operator id
  first_unit       text NOT NULL DEFAULT '',
  self_initiated   boolean NOT NULL DEFAULT false,
  dispatched       boolean NOT NULL DEFAULT false,
  hold_seconds     integer,                      -- queue (or received) -> first assigned; NULL if not measurable
  process_seconds  integer,                      -- received -> queued (call-taking time); NULL if not measurable
  synced_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cad_incidents_received ON cad_incidents (received_at);
CREATE INDEX cad_incidents_agency ON cad_incidents (agency, received_at);

-- Disposition codes: filled in automatically from the view (description column if it has one);
-- Comms statistics managers can describe and group the rest.
CREATE TABLE cad_dispositions (
  code         text PRIMARY KEY,
  description  text NOT NULL DEFAULT '',
  category     text NOT NULL DEFAULT ''          -- completed | canceled | false_alarm | duplicate | unfounded | other | ''
);

-- CAD operator ids -> people (call takers and dispatchers)
CREATE TABLE cad_operators (
  cad_id   text PRIMARY KEY,
  name     text NOT NULL DEFAULT '',
  user_id  uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE cad_stats_sync (
  id           serial PRIMARY KEY,
  kind         text NOT NULL,                    -- backfill | nightly | manual
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  range_from   date,
  range_to     date,
  rows         integer NOT NULL DEFAULT 0,
  error        text NOT NULL DEFAULT ''
);

CREATE TABLE cad_stats_settings (
  id                 boolean PRIMARY KEY DEFAULT true CHECK (id),
  hold_goal_seconds  integer NOT NULL DEFAULT 60,
  tail_minutes       integer NOT NULL DEFAULT 15
);
INSERT INTO cad_stats_settings DEFAULT VALUES;

-- Saved reports (Report builder). shared = everyone with Comms statistics access can use it as a template.
CREATE TABLE comms_reports (
  id           uuid PRIMARY KEY,
  owner_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        text NOT NULL,
  report_type  text NOT NULL DEFAULT '',
  prepared_by  text NOT NULL DEFAULT '',
  notes        text NOT NULL DEFAULT '',
  window_kind  text NOT NULL DEFAULT 'last7',      -- last7 | last30 | lastMonth | custom
  window_from  date,
  window_to    date,
  agency       text NOT NULL DEFAULT '',
  blocks       jsonb NOT NULL DEFAULT '[]',
  shared       boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comms_reports_owner ON comms_reports (owner_id);
