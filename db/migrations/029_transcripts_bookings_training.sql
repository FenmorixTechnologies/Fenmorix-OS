-- Working Fire transcripts (speech-to-text on the Nexus server)
ALTER TABLE fire_recording_clips ADD COLUMN IF NOT EXISTS transcript text;              -- NULL = not transcribed
ALTER TABLE fire_recording_clips ADD COLUMN IF NOT EXISTS transcript_edited boolean NOT NULL DEFAULT false;
ALTER TABLE fire_recordings ADD COLUMN IF NOT EXISTS transcript_status text NOT NULL DEFAULT '';   -- '' | queued | running | done | failed
ALTER TABLE fire_recordings ADD COLUMN IF NOT EXISTS transcript_error text NOT NULL DEFAULT '';
ALTER TABLE fire_recordings ADD COLUMN IF NOT EXISTS transcript_done int NOT NULL DEFAULT 0;      -- transmissions finished so far
ALTER TABLE fire_recordings ADD COLUMN IF NOT EXISTS transcript_at timestamptz;
ALTER TABLE fire_recordings ADD COLUMN IF NOT EXISTS transcript_by text NOT NULL DEFAULT '';
ALTER TABLE fire_recordings ADD COLUMN IF NOT EXISTS transcript_model text NOT NULL DEFAULT '';

-- Apparatus (used by classroom bookings, training scenarios)
CREATE TABLE IF NOT EXISTS apparatus (
  id          uuid PRIMARY KEY,
  unit        text NOT NULL,                     -- radio name, e.g. EG613
  kind        text NOT NULL DEFAULT 'Engine',    -- Engine, Ladder, Rescue, Medic, Tanker, ...
  station     text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'in_service',-- in_service | reserve | out_of_service
  notes       text NOT NULL DEFAULT '',
  sort        int NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS apparatus_unit_idx ON apparatus (lower(unit)) WHERE active;

-- Classroom / facility bookings (from the Facility & Resource Request form, or added directly)
CREATE TABLE IF NOT EXISTS bookings (
  id             uuid PRIMARY KEY,
  request_id     uuid NOT NULL,                  -- one request can book several rooms and days
  submission_id  uuid REFERENCES form_submissions(id) ON DELETE SET NULL,
  room           text NOT NULL,
  day            date NOT NULL,
  start_time     time NOT NULL,
  end_time       time NOT NULL CHECK (end_time > start_time),
  title          text NOT NULL DEFAULT '',
  division       text NOT NULL DEFAULT '',
  contact_id     uuid REFERENCES users(id),
  contact_name   text NOT NULL DEFAULT '',
  attendees      int,
  status         text NOT NULL DEFAULT 'requested', -- requested | approved | cancelled
  needs_rotation boolean NOT NULL DEFAULT false,
  notes          text NOT NULL DEFAULT '',
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  cancelled_reason text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS bookings_day_idx ON bookings (day, room) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS bookings_request_idx ON bookings (request_id);

-- Apparatus rotations for a class: rotation 1 = these units from .. to, rotation 2 = ...
CREATE TABLE IF NOT EXISTS booking_rotations (
  id          uuid PRIMARY KEY,
  request_id  uuid NOT NULL,
  seq         int NOT NULL,
  day         date,                               -- NULL = every day of the request
  start_time  time NOT NULL,
  end_time    time NOT NULL CHECK (end_time > start_time),
  apparatus   jsonb NOT NULL DEFAULT '[]',        -- [apparatus id]
  notes       text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS booking_rotations_request_idx ON booking_rotations (request_id);

-- Training hours (FireWorks imports and hand entries)
CREATE TABLE IF NOT EXISTS training_records (
  id          uuid PRIMARY KEY,
  user_id     uuid REFERENCES users(id),
  person_name text NOT NULL,                      -- as it appears in the file
  emp_no      text NOT NULL DEFAULT '',
  day         date NOT NULL,
  hours       numeric(6,2) NOT NULL CHECK (hours >= 0 AND hours <= 48),
  certification text NOT NULL DEFAULT '',         -- FireWorks certification, e.g. "01 PIAL - Firefighter/Operator"
  category    text NOT NULL DEFAULT '',           -- FireWorks subject, e.g. "Company", "Hazmat"
  topic       text NOT NULL DEFAULT '',           -- content title (class name)
  instructor  text NOT NULL DEFAULT '',
  source      text NOT NULL DEFAULT 'manual',     -- manual | fireworks
  source_key  text,                               -- FireWorks class id + person, to skip duplicates
  import_id   uuid,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS training_records_source_idx ON training_records (source_key) WHERE source_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS training_records_user_idx ON training_records (user_id, day);
CREATE INDEX IF NOT EXISTS training_records_name_idx ON training_records (lower(person_name), day);

CREATE TABLE IF NOT EXISTS training_imports (
  id          uuid PRIMARY KEY,
  file_name   text NOT NULL DEFAULT '',
  rows_added  int NOT NULL DEFAULT 0,
  rows_skipped int NOT NULL DEFAULT 0,
  date_from   date,
  date_to     date,
  by_id       uuid REFERENCES users(id),
  by_name     text NOT NULL DEFAULT '',
  at          timestamptz NOT NULL DEFAULT now()
);

-- FireWorks "Certification Subjects and Relevant Content Master List": which certification and subject
-- each content title belongs to (fills them in when a training export only has the title)
CREATE TABLE IF NOT EXISTS training_content (
  certification text NOT NULL,
  subject       text NOT NULL DEFAULT '',
  title         text NOT NULL,
  credit        text NOT NULL DEFAULT '',          -- By Time Spent | Auto Assign Hours
  auto_hours    numeric(6,2),
  max_hours     numeric(7,2),
  max_times     int,
  PRIMARY KEY (certification, subject, title)
);
CREATE INDEX IF NOT EXISTS training_content_title_idx ON training_content (lower(title));

-- Requirements, category mapping and other training settings
CREATE TABLE IF NOT EXISTS training_settings (
  id    int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data  jsonb NOT NULL DEFAULT '{}'
);
INSERT INTO training_settings (id, data) VALUES (1, '{}') ON CONFLICT DO NOTHING;
