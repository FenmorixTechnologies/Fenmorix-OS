-- Drawn signatures on requisition sign-offs (PNG data URL, optional alongside the button)
ALTER TABLE requisition_signatures ADD COLUMN IF NOT EXISTS signature_image text;

-- System audit log: faster filtering by person and time
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (actor_name, occurred_at DESC);

-- Sick leave tracker: call-outs logged by each division (no medical details are kept)
CREATE TABLE IF NOT EXISTS sick_entries (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id),
  division      text NOT NULL,                     -- the person's division when logged
  day           date NOT NULL,                     -- the shift / work day missed
  hours         numeric(5,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  kind          text NOT NULL DEFAULT 'sick',      -- sick | family | fmla | injury | other_protected
  protected     boolean NOT NULL DEFAULT false,    -- FMLA, on-duty injury, approved accommodation: left out of pattern analysis
  note_on_file  boolean NOT NULL DEFAULT false,    -- doctor's note received
  called_at     timestamp,                         -- when they called out (wall clock), optional
  notes         text NOT NULL DEFAULT '',
  entered_by    uuid REFERENCES users(id),
  entered_by_name text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, day)
);
CREATE INDEX IF NOT EXISTS sick_entries_day ON sick_entries (day);
CREATE TABLE IF NOT EXISTS sick_settings (
  id    boolean PRIMARY KEY DEFAULT true CHECK (id),
  data  jsonb NOT NULL DEFAULT '{}'
);
INSERT INTO sick_settings (id) VALUES (true) ON CONFLICT DO NOTHING;
