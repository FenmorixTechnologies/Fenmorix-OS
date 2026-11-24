-- IMT: incidents run under NIMS/ICS, their operational periods, and the ICS forms that make each period's IAP
CREATE TABLE IF NOT EXISTS imt_incidents (
  id            uuid PRIMARY KEY,
  name          text NOT NULL,
  number        text NOT NULL DEFAULT '',            -- e.g. LA-EBR-2026-001
  kind          text NOT NULL DEFAULT '',            -- Hurricane, Flood, Winter storm, ...
  location      text NOT NULL DEFAULT '',
  lat           double precision,
  lon           double precision,
  description   text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'active',      -- active | closed
  share_all     boolean NOT NULL DEFAULT false,      -- everyone can read approved IAPs
  cover_file    uuid,
  created_by    uuid REFERENCES users(id),
  created_by_name text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz
);

CREATE TABLE IF NOT EXISTS imt_periods (
  id            uuid PRIMARY KEY,
  incident_id   uuid NOT NULL REFERENCES imt_incidents(id) ON DELETE CASCADE,
  seq           int NOT NULL,
  starts_at     timestamp NOT NULL,                  -- wall clock at the incident
  ends_at       timestamp NOT NULL CHECK (ends_at > starts_at),
  status        text NOT NULL DEFAULT 'draft',       -- draft | approved
  approved_by   uuid REFERENCES users(id),
  approved_name text NOT NULL DEFAULT '',
  approved_at   timestamptz,
  approved_signature text,                           -- PNG data URL (optional)
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (incident_id, seq)
);

CREATE TABLE IF NOT EXISTS imt_forms (
  id            uuid PRIMARY KEY,
  period_id     uuid NOT NULL REFERENCES imt_periods(id) ON DELETE CASCADE,
  kind          text NOT NULL,                       -- cover | 202 | 203 | 204 | 205 | 205a | 206 | 207 | 208 | 211 | 213 | 214 | 220 | weather | attachment
  sort          int NOT NULL DEFAULT 0,
  data          jsonb NOT NULL DEFAULT '{}',
  version       int NOT NULL DEFAULT 1,
  updated_by    uuid REFERENCES users(id),
  updated_name  text NOT NULL DEFAULT '',
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS imt_forms_period_idx ON imt_forms (period_id, sort);

-- Pictures, maps and PDFs for an incident (PDF pages are also kept as page images so they print in the IAP)
CREATE TABLE IF NOT EXISTS imt_files (
  id            uuid PRIMARY KEY,
  incident_id   uuid NOT NULL REFERENCES imt_incidents(id) ON DELETE CASCADE,
  parent_id     uuid REFERENCES imt_files(id) ON DELETE CASCADE,   -- page image of a PDF
  page          int,
  name          text NOT NULL,
  mime          text NOT NULL,
  size          int NOT NULL,
  data          bytea NOT NULL,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS imt_files_incident_idx ON imt_files (incident_id);

-- Lists kept from one incident to the next: radio channels (205), hospitals / aid stations / ambulances (206)
CREATE TABLE IF NOT EXISTS imt_library (
  kind          text PRIMARY KEY,                    -- channels | hospitals | stations | transport
  items         jsonb NOT NULL DEFAULT '[]',
  updated_at    timestamptz NOT NULL DEFAULT now()
);
