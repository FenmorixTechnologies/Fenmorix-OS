-- Sandbox sign-ups say which department they're from (shown to the admin who approves them)
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_org text NOT NULL DEFAULT '';
