-- Clients & Quotes (module "sales", opt-in): Fenmorix Technologies' own client book, quotes and secure vault. Runs on the
-- vendor's private office install, never on a customer's (packaging/owners.json keeps it out of customer packages).
CREATE TABLE IF NOT EXISTS sales_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'ps' CHECK (kind IN ('ps', 'biz', 'gov')),
  status text NOT NULL DEFAULT 'prospect' CHECK (status IN ('prospect', 'active', 'former', 'lost')),
  website text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT '',
  zip text NOT NULL DEFAULT '',
  instance_url text NOT NULL DEFAULT '',          -- their Fenmorix OS address once installed
  license_id text NOT NULL DEFAULT '',            -- License Manager id (L-2026...)
  modules jsonb NOT NULL DEFAULT '[]',            -- licensed module keys
  renewal_date date,
  notes text NOT NULL DEFAULT '',
  contacts jsonb NOT NULL DEFAULT '[]',           -- [{name, title, email, phone, primary}]
  current_spend jsonb NOT NULL DEFAULT '[]',      -- [{label, annual}] software Fenmorix could replace
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_clients_name ON sales_clients (lower(name));

-- Secure vault: server logins, admin accounts, keys, notes. secret = forms.js encrypt({user, password, note}); every reveal is audited.
CREATE TABLE IF NOT EXISTS sales_vault (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES sales_clients(id) ON DELETE CASCADE,
  label text NOT NULL,
  kind text NOT NULL DEFAULT 'login' CHECK (kind IN ('server', 'login', 'database', 'key', 'note', 'other')),
  host text NOT NULL DEFAULT '',                  -- address shown openly (host name, IP, URL); the secret part is encrypted
  secret text,
  updated_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_vault_client ON sales_vault (client_id);

-- Quotes: inputs + the computed result + the price book they were priced with (snapshot), so a sent quote never changes
CREATE TABLE IF NOT EXISTS sales_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,                    -- Q-2026-0001
  client_id uuid NOT NULL REFERENCES sales_clients(id) ON DELETE RESTRICT,
  title text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'expired')),
  inputs jsonb NOT NULL,
  result jsonb NOT NULL,
  book jsonb NOT NULL,
  valid_until date,
  notes text NOT NULL DEFAULT '',                 -- printed on the quote
  internal_notes text NOT NULL DEFAULT '',        -- never printed
  created_by uuid REFERENCES users(id),
  created_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS sales_quotes_client ON sales_quotes (client_id, created_at DESC);

-- Work log per client: calls, meetings, emails, and work done (hours, billable)
CREATE TABLE IF NOT EXISTS sales_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES sales_clients(id) ON DELETE CASCADE,
  day date NOT NULL DEFAULT CURRENT_DATE,
  kind text NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'call', 'email', 'meeting', 'work', 'support')),
  body text NOT NULL,
  hours numeric(6, 2) NOT NULL DEFAULT 0,
  billable boolean NOT NULL DEFAULT false,
  by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_activity_client ON sales_activity (client_id, day DESC);
