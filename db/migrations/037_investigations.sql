-- Fire investigations (arson) with CJIS Security Policy controls:
--   * a second factor (authenticator app, RFC 6238) for anyone who opens Investigations, re-checked after 30 idle minutes and
--     every 12 hours; 5 wrong codes in 15 minutes lock it until a manager releases it (AC-7)
--   * the CJIS list: who is authorized (fingerprint background check, security awareness training within the year)
--   * need-to-know: a case opens only for its investigators, Investigations managers (Chief of Fire Prevention) and masters
--   * criminal justice information (criminal history results) encrypted at rest, every view logged, dissemination log,
--     purge with a reason
--   * an append-only access log of every view, reviewed weekly
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret text;            -- encrypted (forms key), set once confirmed
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending text;           -- encrypted, during setup
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step bigint;       -- replay protection
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_failures int NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_first_fail_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_locked_at timestamptz;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mfa_at timestamptz;        -- second factor checked for this session
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS inv_seen_at timestamptz;   -- last Investigations request (30-minute lock)

CREATE TABLE IF NOT EXISTS inv_cjis_people (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  background_date date,                 -- fingerprint-based background check
  background_ref  text NOT NULL DEFAULT '',
  training_date   date,                 -- CJIS security awareness training (good for a year)
  note            text NOT NULL DEFAULT '',
  authorized_by   text NOT NULL DEFAULT '',
  authorized_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  revoked_by      text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS inv_cases (
  id              uuid PRIMARY KEY,
  case_no         text NOT NULL UNIQUE,                -- YYYY-NNN
  title           text NOT NULL,
  incident_no     text NOT NULL DEFAULT '',
  incident_date   date,
  address         text NOT NULL DEFAULT '',
  occupancy       text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'open',        -- open | active | referred | closed | unfounded
  classification  text NOT NULL DEFAULT 'pending',     -- pending | accidental | natural | incendiary | undetermined (NFPA 921)
  origin_area     text NOT NULL DEFAULT '',
  heat_source     text NOT NULL DEFAULT '',
  first_ignited   text NOT NULL DEFAULT '',
  secret          text,                                -- encrypted {summary, causeNarrative, notes}
  da_referral     jsonb NOT NULL DEFAULT '{}',         -- {date, office, number}
  juvenile_referral boolean NOT NULL DEFAULT false,
  lead_id         uuid REFERENCES users(id),
  created_by      text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz
);
CREATE TABLE IF NOT EXISTS inv_members (
  case_id   uuid NOT NULL REFERENCES inv_cases(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id),
  role      text NOT NULL DEFAULT 'investigator',      -- lead | investigator
  added_by  text NOT NULL DEFAULT '',
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, user_id)
);
CREATE TABLE IF NOT EXISTS inv_people (
  id        uuid PRIMARY KEY,
  case_id   uuid NOT NULL REFERENCES inv_cases(id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'witness',           -- owner | occupant | complainant | witness | victim | suspect | other
  secret    text NOT NULL,                             -- encrypted {name, dob, phone, address, notes}
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS inv_evidence (
  id            uuid PRIMARY KEY,
  case_id       uuid NOT NULL REFERENCES inv_cases(id) ON DELETE CASCADE,
  item_no       int NOT NULL,
  description   text NOT NULL,
  found_location text NOT NULL DEFAULT '',
  collected_at  timestamptz,
  collected_by  text NOT NULL DEFAULT '',
  storage       text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'held',          -- held | lab | returned | released | destroyed
  created_by    text NOT NULL DEFAULT '',
  UNIQUE (case_id, item_no)
);
CREATE TABLE IF NOT EXISTS inv_custody (
  id          uuid PRIMARY KEY,
  evidence_id uuid NOT NULL REFERENCES inv_evidence(id) ON DELETE CASCADE,
  at          timestamptz NOT NULL,
  released_by text NOT NULL,
  received_by text NOT NULL,
  purpose     text NOT NULL DEFAULT '',
  note        text NOT NULL DEFAULT '',
  entered_by  text NOT NULL DEFAULT '',
  entered_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS inv_files (
  id          uuid PRIMARY KEY,
  case_id     uuid NOT NULL REFERENCES inv_cases(id) ON DELETE CASCADE,
  name        text NOT NULL,
  mime        text NOT NULL,
  size        int NOT NULL,
  data        bytea NOT NULL,                          -- AES-256-GCM
  caption     text NOT NULL DEFAULT '',
  uploaded_by text NOT NULL DEFAULT '',
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS inv_supplements (
  id          uuid PRIMARY KEY,
  case_id     uuid NOT NULL REFERENCES inv_cases(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES users(id),
  author_name text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  secret      text NOT NULL                            -- encrypted {text}
);
-- Criminal justice information: results of checks the investigators run (NCIC, III, LLETS …)
CREATE TABLE IF NOT EXISTS inv_cji (
  id          uuid PRIMARY KEY,
  case_id     uuid NOT NULL REFERENCES inv_cases(id) ON DELETE CASCADE,
  person_id   uuid REFERENCES inv_people(id) ON DELETE SET NULL,
  kind        text NOT NULL DEFAULT 'ncic',            -- ncic | iii | llets | local | other
  run_on      date NOT NULL,
  run_by      text NOT NULL,
  purpose     text NOT NULL DEFAULT 'C',               -- purpose code
  secret      text,                                    -- encrypted {subject, result, notes}; NULL once purged
  file        bytea,                                   -- encrypted printout
  file_name   text NOT NULL DEFAULT '',
  file_mime   text NOT NULL DEFAULT '',
  created_by  text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  purged_at   timestamptz,
  purged_by   text NOT NULL DEFAULT '',
  purge_reason text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS inv_dissemination (
  id          uuid PRIMARY KEY,
  cji_id      uuid NOT NULL REFERENCES inv_cji(id) ON DELETE CASCADE,
  at          timestamptz NOT NULL DEFAULT now(),
  by_name     text NOT NULL,
  released_to text NOT NULL,
  agency      text NOT NULL DEFAULT '',
  purpose     text NOT NULL,
  method      text NOT NULL DEFAULT 'print'            -- print | in person | secure email | other
);
CREATE TABLE IF NOT EXISTS inv_access_log (
  id        bigserial PRIMARY KEY,
  at        timestamptz NOT NULL DEFAULT now(),
  user_id   uuid,
  user_name text NOT NULL,
  case_id   uuid,
  case_no   text NOT NULL DEFAULT '',
  what      text NOT NULL,
  ip        text NOT NULL DEFAULT '',
  ok        boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS inv_access_log_at_idx ON inv_access_log (at);
CREATE TABLE IF NOT EXISTS inv_reviews (
  id          uuid PRIMARY KEY,
  week_start  date NOT NULL UNIQUE,
  reviewed_by text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  note        text NOT NULL DEFAULT ''
);

-- The access log and supplements can't be changed or deleted
CREATE OR REPLACE FUNCTION inv_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS inv_access_log_lock ON inv_access_log;
CREATE TRIGGER inv_access_log_lock BEFORE UPDATE OR DELETE ON inv_access_log FOR EACH ROW EXECUTE FUNCTION inv_append_only();
DROP TRIGGER IF EXISTS inv_supplements_lock ON inv_supplements;
CREATE TRIGGER inv_supplements_lock BEFORE UPDATE OR DELETE ON inv_supplements FOR EACH ROW EXECUTE FUNCTION inv_append_only();
