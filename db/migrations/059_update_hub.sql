-- Update service (vendor module "sales", office install only): every customer server that checks in, and the signed releases offered to them.
CREATE TABLE IF NOT EXISTS hub_installs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  client_id uuid REFERENCES sales_clients(id) ON DELETE SET NULL,
  package text NOT NULL,                          -- packaging/customers.json id: sgfd, lgc, sandbox, office...
  key_hash text NOT NULL UNIQUE,                  -- sha256 of the enrollment key (the key itself is shown once)
  hold boolean NOT NULL DEFAULT false,            -- don't offer updates to this server
  version text NOT NULL DEFAULT '',
  last_seen timestamptz,
  last_ip text NOT NULL DEFAULT '',
  info jsonb NOT NULL DEFAULT '{}',               -- what it reported: org, url, users, modules, auto, last update result
  downloads int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hub_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package text NOT NULL,
  version text NOT NULL,
  notes jsonb NOT NULL DEFAULT '[]',
  file_name text NOT NULL,
  size int NOT NULL,
  sha256 text NOT NULL,
  kid text NOT NULL,
  sig text NOT NULL,
  published boolean NOT NULL DEFAULT true,
  uploaded_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package, version)
);
