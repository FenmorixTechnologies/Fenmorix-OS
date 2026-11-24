-- Chat status (Available / Busy / Do not disturb / Out of office) with an away message
ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_status    text NOT NULL DEFAULT 'available';   -- available | busy | dnd | away
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_message text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_until   timestamptz;                         -- back to Available after this (optional)
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_set_at  timestamptz;

-- Phones, tablets and computers that get push notifications (Web Push)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint        text NOT NULL UNIQUE,
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  label           text NOT NULL DEFAULT '',
  important_only  boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used       timestamptz,
  failures        int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (user_id);

-- Out-of-office automatic replies: one per sender each time someone sets their status
CREATE TABLE IF NOT EXISTS auto_reply_log (
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status_set_at  timestamptz NOT NULL,
  sent_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sender_id, status_set_at)
);
