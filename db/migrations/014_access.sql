-- Granular permissions and groups.
--
-- access_groups: named sets of people. Members come from automatic rules (rules jsonb:
--   { "divisions": [...], "patterns": ["fire:A", "comms:C"], "roles": [...], "titles": ["Captain"] };
--   within one kind any value matches, across kinds all must match) plus hand-picked
--   includes and excludes in access_group_members.
-- access_grants: "this person or group can <level> <section>", optionally limited to one
--   division (one row per division), or to each member's own division (own_division).
--   Levels rank view < edit < manage. A section's managers can grant view/edit in it.

CREATE TABLE access_groups (
  id          uuid PRIMARY KEY,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  rules       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX access_groups_name ON access_groups (lower(name));

CREATE TABLE access_group_members (
  group_id  uuid NOT NULL REFERENCES access_groups(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode      text NOT NULL CHECK (mode IN ('include', 'exclude')),
  added_by  uuid REFERENCES users(id),
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE access_grants (
  id           uuid PRIMARY KEY,
  section      text NOT NULL,
  level        text NOT NULL CHECK (level IN ('view', 'edit', 'manage')),
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
  group_id     uuid REFERENCES access_groups(id) ON DELETE CASCADE,
  division_id  int REFERENCES divisions(id) ON DELETE CASCADE,
  own_division boolean NOT NULL DEFAULT false,
  granted_by   uuid REFERENCES users(id),
  granted_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((user_id IS NULL) <> (group_id IS NULL)),
  CHECK (NOT (own_division AND division_id IS NOT NULL))
);
CREATE UNIQUE INDEX access_grants_uniq ON access_grants
  (section, level, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'), COALESCE(group_id, '00000000-0000-0000-0000-000000000000'),
   COALESCE(division_id, 0), own_division);
CREATE INDEX access_grants_user ON access_grants (user_id);
CREATE INDEX access_grants_group ON access_grants (group_id);

-- Carry over everything granted so far (same access, new home)
INSERT INTO access_grants (id, section, level, user_id, division_id)
SELECT gen_random_uuid(),
       CASE p.permission WHEN 'time_view' THEN 'time' WHEN 'callout_edit' THEN 'callout' WHEN 'recordings' THEN 'recordings'
                         WHEN 'directory_admin' THEN 'directory' WHEN 'forms_admin' THEN 'forms' ELSE 'accounts' END,
       CASE p.permission WHEN 'time_view' THEN 'view' WHEN 'callout_edit' THEN 'edit' WHEN 'recordings' THEN 'view' ELSE 'manage' END,
       p.user_id, p.division_id
  FROM user_permissions p
ON CONFLICT DO NOTHING;

-- Kept (renamed) for reference only; nothing reads it any more
ALTER TABLE user_permissions RENAME TO user_permissions_before_014;
