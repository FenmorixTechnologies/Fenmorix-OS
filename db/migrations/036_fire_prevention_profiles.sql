-- Fire Prevention: annual periodic inspections (FireWorks "PIAL Annual/Periodic Inspection History" report) feeding PIAL 1022,
-- and permission profiles (bundles of view access assigned to people or groups).

CREATE TABLE IF NOT EXISTS fp_properties (
  property_no   text PRIMARY KEY,                    -- FireWorks Property #
  address       text NOT NULL DEFAULT '',
  unit          text NOT NULL DEFAULT '',
  description   text NOT NULL DEFAULT '',            -- occupant / business name
  neighborhood  text NOT NULL DEFAULT '',            -- inspection area (Alpha … Juliet)
  box           text NOT NULL DEFAULT '',            -- first-due station
  zone          text NOT NULL DEFAULT '',
  district      text NOT NULL DEFAULT '',            -- Fire District as FireWorks has it
  active        boolean NOT NULL DEFAULT true,       -- in the latest import
  excluded      boolean NOT NULL DEFAULT false,      -- left out of the PIAL count by hand (reason required)
  exclude_reason text NOT NULL DEFAULT '',
  excluded_by   text NOT NULL DEFAULT '',
  first_seen    timestamptz NOT NULL DEFAULT now(),
  last_seen     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fp_inspections (
  id           uuid PRIMARY KEY,
  property_no  text NOT NULL REFERENCES fp_properties(property_no) ON DELETE CASCADE,
  day          date NOT NULL,
  inspector    text NOT NULL DEFAULT '',
  source       text NOT NULL DEFAULT 'import',       -- import | manual
  import_id    uuid,
  created_by   text NOT NULL DEFAULT '',
  UNIQUE (property_no, day, inspector)
);
CREATE INDEX IF NOT EXISTS fp_inspections_day_idx ON fp_inspections (day);
CREATE TABLE IF NOT EXISTS fp_imports (
  id           uuid PRIMARY KEY,
  file_name    text NOT NULL,
  rows         int NOT NULL,
  properties   int NOT NULL,
  added        int NOT NULL,
  new_properties int NOT NULL,
  dropped      int NOT NULL,
  date_from    date,
  date_to      date,
  by_name      text NOT NULL DEFAULT '',
  at           timestamptz NOT NULL DEFAULT now()
);

-- Permission profiles. Built-in ones are defined in server/access.js (BUILTIN_PROFILES) so updates can add new sections to
-- them; a row here only holds a built-in's local changes ({add: {section: level}, remove: [section]}). Custom profiles keep
-- their levels here ({section: level}).
CREATE TABLE IF NOT EXISTS access_profiles (
  key          text PRIMARY KEY,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  builtin      boolean NOT NULL DEFAULT false,
  levels       jsonb NOT NULL DEFAULT '{}',
  updated_by   text NOT NULL DEFAULT '',
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS access_profile_members (
  id           uuid PRIMARY KEY,
  profile_key  text NOT NULL,
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
  group_id     uuid REFERENCES access_groups(id) ON DELETE CASCADE,
  added_by     text NOT NULL DEFAULT '',
  added_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((user_id IS NULL) <> (group_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS access_profile_members_user_idx ON access_profile_members (profile_key, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS access_profile_members_group_idx ON access_profile_members (profile_key, group_id) WHERE group_id IS NOT NULL;
