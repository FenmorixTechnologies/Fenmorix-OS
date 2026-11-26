-- Client portal (vendor office only; served on its own web address, PORTAL_HOST): Fenmorix Technologies' customers sign in to see their
-- servers and versions, quotes (accept or decline), support requests, release notes and shared documents.
CREATE TABLE IF NOT EXISTS portal_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES sales_clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  password_hash text,
  invite_hash text,                                -- sha256 of the one-time set-password link token
  invite_expires timestamptz,
  active boolean NOT NULL DEFAULT true,
  last_login timestamptz,
  created_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS portal_users_email ON portal_users (lower(email));
CREATE TABLE IF NOT EXISTS portal_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  ip text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS portal_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES sales_clients(id) ON DELETE CASCADE,
  number int GENERATED ALWAYS AS IDENTITY,
  subject text NOT NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'waiting', 'closed')),
  opened_by uuid REFERENCES portal_users(id) ON DELETE SET NULL,
  opened_by_name text NOT NULL DEFAULT '',
  vendor_seen boolean NOT NULL DEFAULT false,      -- the vendor has read the latest client post
  client_seen boolean NOT NULL DEFAULT true,       -- the client has read the latest vendor post
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portal_tickets_client ON portal_tickets (client_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS portal_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES portal_tickets(id) ON DELETE CASCADE,
  author text NOT NULL CHECK (author IN ('client', 'vendor')),
  author_name text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portal_posts_ticket ON portal_posts (ticket_id, created_at);
CREATE TABLE IF NOT EXISTS portal_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES sales_clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  note text NOT NULL DEFAULT '',
  mime text NOT NULL,
  size int NOT NULL,
  data bytea NOT NULL,
  uploaded_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
-- A quote accepted or declined in the portal: who, their title, when, from where
ALTER TABLE sales_quotes ADD COLUMN IF NOT EXISTS decided_by text NOT NULL DEFAULT '';
ALTER TABLE sales_quotes ADD COLUMN IF NOT EXISTS decided_title text NOT NULL DEFAULT '';
ALTER TABLE sales_quotes ADD COLUMN IF NOT EXISTS decided_ip text NOT NULL DEFAULT '';
ALTER TABLE sales_quotes ADD COLUMN IF NOT EXISTS decided_note text NOT NULL DEFAULT '';
