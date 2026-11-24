-- Emergency recall (Policy 1010): a recall board that runs beside Aladtec. Aladtec stays the system of record for
-- sign-ups, approvals and assignments (read-only here); Nexus sends the notice, takes members' responses, keeps the
-- unit staffing board, roll call on arrival and the after-action timeline.
CREATE TABLE IF NOT EXISTS recall_events (
  id            uuid PRIMARY KEY,
  kind          text NOT NULL DEFAULT 'hurricane',   -- hurricane | emac | imac | major | multiple | peak | other
  title         text NOT NULL,
  instructions  text NOT NULL DEFAULT '',
  report_to     text NOT NULL DEFAULT '',
  start_date    date NOT NULL,                       -- recall day(s), matching the Aladtec schedule dates
  end_date      date NOT NULL,
  status        text NOT NULL DEFAULT 'open',        -- open | closed
  imt_incident_id uuid,
  checklist     jsonb NOT NULL DEFAULT '{}',         -- {key: {done, by, at}}
  started_by    uuid REFERENCES users(id),
  started_name  text NOT NULL DEFAULT '',
  started_at    timestamptz NOT NULL DEFAULT now(),
  closed_by_name text NOT NULL DEFAULT '',
  closed_at     timestamptz,
  close_note    text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS recall_members (
  id            uuid PRIMARY KEY,
  event_id      uuid NOT NULL REFERENCES recall_events(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES users(id),
  name          text NOT NULL,
  notified_at   timestamptz,
  response      text NOT NULL DEFAULT '',            -- '' | coming | impaired
  eta           text NOT NULL DEFAULT '',
  note          text NOT NULL DEFAULT '',
  responded_at  timestamptz,
  responded_via text NOT NULL DEFAULT '',            -- self | <name of who recorded it>
  checked_in_at timestamptz,
  checked_in_by text NOT NULL DEFAULT '',
  released_at   timestamptz,
  UNIQUE (event_id, user_id)
);
CREATE TABLE IF NOT EXISTS recall_units (
  id            uuid PRIMARY KEY,
  event_id      uuid NOT NULL REFERENCES recall_events(id) ON DELETE CASCADE,
  unit          text NOT NULL,
  kind          text NOT NULL DEFAULT '',
  location      text NOT NULL DEFAULT '',
  seats         jsonb NOT NULL DEFAULT '[]',         -- [{role officer|driver|ff, userId|null}]
  notes         text NOT NULL DEFAULT '',
  special_ops   boolean NOT NULL DEFAULT false,
  sort          int NOT NULL DEFAULT 0,
  in_service_at timestamptz,
  in_service_by text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS recall_log (
  id        bigserial PRIMARY KEY,
  event_id  uuid NOT NULL REFERENCES recall_events(id) ON DELETE CASCADE,
  at        timestamptz NOT NULL DEFAULT now(),
  who       text NOT NULL DEFAULT '',
  what      text NOT NULL
);
CREATE INDEX IF NOT EXISTS recall_members_user_idx ON recall_members (user_id);
CREATE INDEX IF NOT EXISTS recall_log_event_idx ON recall_log (event_id, at);
