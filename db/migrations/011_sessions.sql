-- Idle sign-out and the "signed-in devices" list
ALTER TABLE sessions
  ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN ip           text;
