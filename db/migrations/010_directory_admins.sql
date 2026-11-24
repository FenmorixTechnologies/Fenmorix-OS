-- Delegated admins and the interdepartmental directory.

-- New permissions (not per division): run the directory, manage forms, approve accounts/reset passwords
ALTER TABLE user_permissions DROP CONSTRAINT IF EXISTS user_permissions_permission_check;
ALTER TABLE user_permissions ADD CONSTRAINT user_permissions_permission_check
  CHECK (permission IN ('time_view', 'callout_edit', 'recordings', 'directory_admin', 'forms_admin', 'accounts_admin'));

-- More contact details on each person (users.phone is the cell phone)
ALTER TABLE users
  ADD COLUMN home_phone                     text,   -- private: the person, master admins, directory admins
  ADD COLUMN extension                      text,   -- desk / short-code extension
  ADD COLUMN emergency_contact_relationship text;

-- Stations, facilities and outside agencies
CREATE TABLE directory_places (
  id            uuid PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('station', 'facility', 'outside')),
  name          text NOT NULL,
  number        text,                 -- station number, e.g. 61
  category      text,                 -- outside contacts: Hospital, Law enforcement, Utility...
  address       text,
  phone         text,
  fax           text,
  extension     text,                 -- short code for interdepartmental quick dial
  email         text,
  notes         text,
  aladtec_match text,                 -- text matched against Aladtec schedule/position names (stations)
  sort_order    integer NOT NULL DEFAULT 100,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES users(id)
);

-- A blanket verification of the whole directory
CREATE TABLE directory_verifications (
  id          uuid PRIMARY KEY,
  started_at  timestamptz NOT NULL DEFAULT now(),
  started_by  uuid REFERENCES users(id),
  closed_at   timestamptz,
  closed_by   uuid REFERENCES users(id),
  note        text
);
CREATE TABLE directory_confirmations (
  verification_id uuid NOT NULL REFERENCES directory_verifications(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id),
  confirmed_at    timestamptz NOT NULL DEFAULT now(),
  changed         boolean NOT NULL DEFAULT false,
  PRIMARY KEY (verification_id, user_id)
);

-- Each person's starred contacts
CREATE TABLE directory_favorites (
  user_id     uuid NOT NULL REFERENCES users(id),
  target_type text NOT NULL CHECK (target_type IN ('person', 'place')),
  target_id   uuid NOT NULL,
  PRIMARY KEY (user_id, target_type, target_id)
);

-- Starting entries (fill in addresses, phones, fax and extensions in the Directory)
INSERT INTO directory_places (id, kind, name, number, aladtec_match, sort_order) VALUES
  (gen_random_uuid(), 'station', 'Station 60', '60', '60', 60),
  (gen_random_uuid(), 'station', 'Station 61', '61', '61', 61),
  (gen_random_uuid(), 'station', 'Station 62', '62', '62', 62),
  (gen_random_uuid(), 'station', 'Station 63', '63', '63', 63),
  (gen_random_uuid(), 'station', 'Station 64', '64', '64', 64),
  (gen_random_uuid(), 'station', 'Station 65', '65', '65', 65),
  (gen_random_uuid(), 'station', 'Station 66', '66', '66', 66),
  (gen_random_uuid(), 'station', 'Station 68', '68', '68', 68);
INSERT INTO directory_places (id, kind, name, address, sort_order) VALUES
  (gen_random_uuid(), 'facility', 'Headquarters', '14100 Airline Hwy', 1);
