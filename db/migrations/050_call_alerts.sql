-- Call alerts: push notifications for Active calls that match a rule (agency, call type words, units, priority), to people and groups.
CREATE TABLE IF NOT EXISTS call_alert_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  owner_id      uuid REFERENCES users(id),          -- set = someone's own alert (goes only to them); NULL = a department rule
  active        boolean NOT NULL DEFAULT true,
  match         jsonb NOT NULL DEFAULT '{}'::jsonb, -- {agencies: [], types: [], exclude: [], units: [], priorities: []}
  recipients    jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{kind: user|group, id, name}]
  important     boolean NOT NULL DEFAULT false,     -- reaches "important only" devices; stays on screen
  on_duty_only  boolean NOT NULL DEFAULT false,     -- only people Aladtec has on duty right now
  show_address  boolean NOT NULL DEFAULT false,     -- address in the notification (lock screens): off unless chosen
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS call_alert_mutes (
  rule_id  uuid NOT NULL REFERENCES call_alert_rules(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (rule_id, user_id)
);
-- One alert per rule per call (also the "recent alerts" list); kept 30 days
CREATE TABLE IF NOT EXISTS call_alert_sent (
  rule_id      uuid NOT NULL REFERENCES call_alert_rules(id) ON DELETE CASCADE,
  incident_id  text NOT NULL,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  call_number  text NOT NULL DEFAULT '',
  call_type    text NOT NULL DEFAULT '',
  units        text NOT NULL DEFAULT '',
  agency       text NOT NULL DEFAULT '',
  people       int NOT NULL DEFAULT 0,
  devices      int NOT NULL DEFAULT 0,
  PRIMARY KEY (rule_id, incident_id)
);
CREATE INDEX IF NOT EXISTS call_alert_sent_at ON call_alert_sent (sent_at DESC);
