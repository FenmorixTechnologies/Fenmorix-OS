-- Force Back lists (Communications first, Suppression later): who gets forced back next = the longest since their last force back.
CREATE TABLE IF NOT EXISTS fb_lists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  division    text NOT NULL DEFAULT '',            -- division name this list belongs to (permissions are by division)
  steps       text NOT NULL DEFAULT '',            -- "Steps to follow" shown on the list
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS fb_lists_name ON fb_lists (lower(name));
CREATE TABLE IF NOT EXISTS fb_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id     uuid NOT NULL REFERENCES fb_lists(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id),
  name        text NOT NULL,
  shift       text NOT NULL DEFAULT '',
  last_fb     date,                                -- NULL = never forced back (top of the list)
  last_by     text NOT NULL DEFAULT '',            -- initials of whoever entered it
  active      boolean NOT NULL DEFAULT true,       -- removed from the list = false (history kept)
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS fb_members_user ON fb_members (list_id, user_id) WHERE user_id IS NOT NULL AND active;
CREATE TABLE IF NOT EXISTS fb_log (
  id          bigserial PRIMARY KEY,
  list_id     uuid NOT NULL REFERENCES fb_lists(id) ON DELETE CASCADE,
  member_id   uuid REFERENCES fb_members(id),
  member_name text NOT NULL DEFAULT '',
  day         date NOT NULL,
  kind        text NOT NULL,                       -- forced | oncall | no_answer | excused | note | added | removed | changed | imported
  note        text NOT NULL DEFAULT '',
  by_id       uuid REFERENCES users(id),
  by_name     text NOT NULL DEFAULT '',
  initials    text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fb_log_list ON fb_log (list_id, id DESC);
-- The log is the record: no edits or deletes
CREATE OR REPLACE FUNCTION fb_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'The force back log can''t be changed'; END $$;
DROP TRIGGER IF EXISTS fb_log_no_change ON fb_log;
CREATE TRIGGER fb_log_no_change BEFORE UPDATE OR DELETE ON fb_log FOR EACH ROW EXECUTE FUNCTION fb_log_append_only();
