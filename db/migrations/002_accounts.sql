-- Real accounts: email + password sign-in with master-admin approval.
-- Applied automatically by the server at startup.

ALTER TABLE users
  ADD COLUMN password_hash         text,
  ADD COLUMN account_status        text NOT NULL DEFAULT 'approved'
                                   CHECK (account_status IN ('pending','approved')),
  ADD COLUMN must_change_password  boolean NOT NULL DEFAULT false,
  ADD COLUMN signed_up_at          timestamptz,
  ADD COLUMN claimed_existing      boolean NOT NULL DEFAULT false,  -- sign-up matched a person already on the roster
  ADD COLUMN approved_by           uuid REFERENCES users(id),
  ADD COLUMN approved_at           timestamptz,
  ADD COLUMN last_login_at         timestamptz;

-- Signed-in browsers. Only a hash of each session token is stored.
CREATE TABLE sessions (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  user_agent  text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);
