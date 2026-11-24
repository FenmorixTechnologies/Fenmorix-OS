-- PIAL tracker: the department's standing against the 2012 FSRS + Louisiana Addendum (105.5 points),
-- with the records behind it. The item catalog and scoring live in server/pial.js; this holds state.

CREATE TABLE pial_settings (
  id        boolean PRIMARY KEY DEFAULT true CHECK (id),
  data      jsonb NOT NULL DEFAULT '{}',          -- graded year, CAD agency/natures, targets, baseline ...
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO pial_settings DEFAULT VALUES;

-- Per-item state: owner division, manual estimate, item inputs, notes
CREATE TABLE pial_items (
  key            text PRIMARY KEY,
  owner_division text,
  manual_pct     numeric CHECK (manual_pct IS NULL OR (manual_pct >= 0 AND manual_pct <= 100)),
  inputs         jsonb NOT NULL DEFAULT '{}',
  notes          text NOT NULL DEFAULT '',
  updated_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Supporting documents for an item (certificates, test reports, SOPs, letters ...)
CREATE TABLE pial_evidence (
  id          uuid PRIMARY KEY,
  item_key    text NOT NULL,
  title       text NOT NULL DEFAULT '',
  doc_date    date,
  name        text NOT NULL,
  mime        text NOT NULL,
  size        integer NOT NULL,
  data        bytea NOT NULL,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pial_evidence_item ON pial_evidence (item_key);

-- Roster for the graded year (from FireWorks), certifications, training hours, fire incidents
CREATE TABLE pial_members (
  key          text PRIMARY KEY,                  -- employee id, or lower(name) when there is none
  employee_id  text NOT NULL DEFAULT '',
  name         text NOT NULL,
  rank         text NOT NULL DEFAULT '',
  position     text NOT NULL DEFAULT '',
  rank_date    date,
  hire_date    date,
  end_date     date,
  shift        text NOT NULL DEFAULT '',
  officer      boolean NOT NULL DEFAULT false,
  driver       boolean NOT NULL DEFAULT false,
  driver_since date,
  suppression  boolean NOT NULL DEFAULT true
);
CREATE TABLE pial_certs (
  id          serial PRIMARY KEY,
  member_key  text NOT NULL,
  title       text NOT NULL,
  cert_date   date,
  ifsac       boolean NOT NULL DEFAULT false
);
CREATE INDEX pial_certs_member ON pial_certs (member_key);
CREATE TABLE pial_training (
  id              serial PRIMARY KEY,
  member_key      text NOT NULL,
  member_name     text NOT NULL DEFAULT '',
  train_date      date NOT NULL,
  hours           numeric NOT NULL CHECK (hours >= 0 AND hours <= 24),
  source_category text NOT NULL DEFAULT '',
  course          text NOT NULL DEFAULT '',
  at_facility     boolean NOT NULL DEFAULT false,
  delivery        text NOT NULL DEFAULT 'inhouse',   -- inhouse | outside | cbt
  import_id       integer
);
CREATE INDEX pial_training_member ON pial_training (member_key, train_date);
CREATE INDEX pial_training_date ON pial_training (train_date);
-- Imported training category text -> PIAL category
CREATE TABLE pial_category_map (
  source    text PRIMARY KEY,                     -- lower-case category text from the import
  category  text NOT NULL                          -- company | officer | driver | new_driver | hazmat | recruit | ims | other
);
CREATE TABLE pial_fires (
  incident      text PRIMARY KEY,
  alarm_date    date NOT NULL,
  alarm_time    text NOT NULL DEFAULT '',
  prop_type     text NOT NULL DEFAULT '',          -- C | R
  working       boolean NOT NULL DEFAULT false,
  responders    numeric,                           -- members of this department who responded
  first_engine_s integer,                          -- seconds from dispatch to first engine on scene
  full_s        integer                            -- seconds from dispatch to full complement on scene
);
CREATE INDEX pial_fires_date ON pial_fires (alarm_date);

-- Test and review records: pump, hose, aerial, hydrant inspection / flow, pre-plan, EPSS, SOP review
CREATE TABLE pial_tests (
  id          uuid PRIMARY KEY,
  kind        text NOT NULL,
  subject     text NOT NULL DEFAULT '',
  test_date   date NOT NULL,
  passed      boolean NOT NULL DEFAULT true,
  notes       text NOT NULL DEFAULT '',
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pial_tests_kind ON pial_tests (kind, subject, test_date);

CREATE TABLE pial_apparatus (
  id          uuid PRIMARY KEY,
  unit        text NOT NULL,
  type        text NOT NULL,                       -- engine | service | ladder | reserve_engine | reserve_service | reserve_ladder | tanker | other
  station     text NOT NULL DEFAULT '',
  make        text NOT NULL DEFAULT '',
  year        integer,
  pump_gpm    integer,
  tank_gal    integer,
  aerial_ft   integer,
  in_service  boolean NOT NULL DEFAULT true,
  inventory   jsonb NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pial_apparatus_unit ON pial_apparatus (lower(unit));

CREATE TABLE pial_imports (
  id         serial PRIMARY KEY,
  kind       text NOT NULL,
  file_name  text NOT NULL DEFAULT '',
  rows       integer NOT NULL DEFAULT 0,
  skipped    integer NOT NULL DEFAULT 0,
  notes      text NOT NULL DEFAULT '',
  by_name    text NOT NULL DEFAULT '',
  at         timestamptz NOT NULL DEFAULT now()
);
