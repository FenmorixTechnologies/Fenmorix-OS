-- Default groups (shifts, stations, station by shift, divisions) and personal message lists.
--
-- Groups get a new rule kind, "stations": the home station on each person's directory card
-- (users.station; "61", "Station 61" and "Sta. 61" all count as 61).
-- Default groups are ordinary groups (masters can edit or delete them) marked is_default.

ALTER TABLE access_groups ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- Shifts and crews (from each person's schedule setting in Time Tracker)
INSERT INTO access_groups (id, name, description, rules, is_default)
SELECT gen_random_uuid(), v.name, v.descr, v.rules::jsonb, true
  FROM (VALUES
    ('A-Shift', 'Fire A shift', '{"patterns":["fire:A"]}'),
    ('B-Shift', 'Fire B shift', '{"patterns":["fire:B"]}'),
    ('C-Shift', 'Fire C shift', '{"patterns":["fire:C"]}'),
    ('Comms A Crew', 'Communications A crew', '{"patterns":["comms:A"]}'),
    ('Comms B Crew', 'Communications B crew', '{"patterns":["comms:B"]}'),
    ('Comms C Crew', 'Communications C crew', '{"patterns":["comms:C"]}'),
    ('Comms D Crew', 'Communications D crew', '{"patterns":["comms:D"]}'),
    ('Weekday Staff', 'Monday-Friday schedule', '{"patterns":["weekdays"]}')
  ) AS v(name, descr, rules)
ON CONFLICT DO NOTHING;

-- Each fire station, and each station by shift
INSERT INTO access_groups (id, name, description, rules, is_default)
SELECT gen_random_uuid(), 'Station ' || p.number, 'Everyone whose home station is ' || p.number,
       jsonb_build_object('stations', jsonb_build_array(p.number)), true
  FROM directory_places p WHERE p.kind = 'station' AND p.number ~ '^[0-9]+$'
ON CONFLICT DO NOTHING;
INSERT INTO access_groups (id, name, description, rules, is_default)
SELECT gen_random_uuid(), 'Station ' || p.number || ' · ' || s.letter || '-Shift',
       s.letter || ' shift at Station ' || p.number,
       jsonb_build_object('stations', jsonb_build_array(p.number), 'patterns', jsonb_build_array('fire:' || s.letter)), true
  FROM directory_places p CROSS JOIN (VALUES ('A'), ('B'), ('C')) AS s(letter)
 WHERE p.kind = 'station' AND p.number ~ '^[0-9]+$'
ON CONFLICT DO NOTHING;

-- Each division
INSERT INTO access_groups (id, name, description, rules, is_default)
SELECT gen_random_uuid(), d.name || ' Division', 'Everyone in ' || d.name, jsonb_build_object('divisions', jsonb_build_array(d.name)), true
  FROM divisions d
ON CONFLICT DO NOTHING;

-- Personal lists: anyone can keep their own lists of people to message (private to them)
CREATE TABLE message_lists (
  id          uuid PRIMARY KEY,
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX message_lists_name ON message_lists (owner_id, lower(name));
CREATE TABLE message_list_members (
  list_id  uuid NOT NULL REFERENCES message_lists(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (list_id, user_id)
);
