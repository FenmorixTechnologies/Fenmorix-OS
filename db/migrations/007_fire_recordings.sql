-- Working Fire Recordings (imported from NICE Inform .distribution files)

-- New permission: listen to and import recordings (not per division)
ALTER TABLE user_permissions DROP CONSTRAINT IF EXISTS user_permissions_permission_check;
ALTER TABLE user_permissions ADD CONSTRAINT user_permissions_permission_check
  CHECK (permission IN ('time_view', 'callout_edit', 'recordings'));

-- Departments a recording can be filed under (kept by master admins)
CREATE TABLE fire_departments (
  id   serial PRIMARY KEY,
  name text NOT NULL UNIQUE
);
INSERT INTO fire_departments (name) VALUES ('St. George Fire Protection District');

CREATE TABLE fire_recordings (
  id               uuid PRIMARY KEY,
  universal_id     text UNIQUE,                 -- NICE's ID for the export (blocks duplicate imports)
  incident_number  text NOT NULL DEFAULT '',
  address          text NOT NULL DEFAULT '',
  description      text NOT NULL DEFAULT '',
  department       text NOT NULL DEFAULT '',
  notes            text NOT NULL DEFAULT '',
  started_at       timestamptz,
  ended_at         timestamptz,
  clip_count       int NOT NULL DEFAULT 0,
  audio_seconds    numeric(10,2) NOT NULL DEFAULT 0,
  talkgroups       text NOT NULL DEFAULT '',     -- "A | B | C"
  original_name    text NOT NULL DEFAULT '',
  size_bytes       bigint NOT NULL DEFAULT 0,
  imported_by      uuid REFERENCES users(id),
  imported_by_name text NOT NULL DEFAULT '',
  imported_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fire_recordings_started ON fire_recordings (started_at);

-- One row per radio transmission in a recording
CREATE TABLE fire_recording_clips (
  recording_id uuid NOT NULL REFERENCES fire_recordings(id) ON DELETE CASCADE,
  item_id      bigint NOT NULL,
  started_at   timestamptz,
  duration     numeric(8,2) NOT NULL DEFAULT 0,
  talkgroup    text NOT NULL DEFAULT '',
  unit         text NOT NULL DEFAULT '',
  unit_id      text NOT NULL DEFAULT '',
  site         text NOT NULL DEFAULT '',
  PRIMARY KEY (recording_id, item_id)
);
