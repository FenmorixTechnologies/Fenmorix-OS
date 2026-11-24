-- Password rules (10+ characters with a capital letter and a symbol, changed every 90 days), two-factor sign-in for master and
-- accounts admins, and "Forgot your password?" links by email.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_reason text NOT NULL DEFAULT '';      -- '' | temp | expired
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_recovery jsonb NOT NULL DEFAULT '[]'::jsonb;  -- sha256 of unused recovery codes
-- Everyone who has a password today starts the 90-day clock now (nobody is forced out on the day this installs)
UPDATE users SET password_changed_at = now() WHERE password_hash IS NOT NULL AND password_changed_at IS NULL;

-- A session that has the password right but still owes its authenticator code; it can only finish sign-in
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mfa_pending boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  ip          text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS password_resets_user ON password_resets (user_id);
