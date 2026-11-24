-- Retail modules (opt-in, never on St. George's install): live spot prices and Quick Links.
-- Spot prices: one reading per metal per check (kept 35 days) for today's chart and the week/month views.
CREATE TABLE IF NOT EXISTS spot_points (
  at timestamptz NOT NULL,
  metal text NOT NULL CHECK (metal IN ('gold', 'silver', 'platinum', 'palladium')),
  price numeric(14, 4) NOT NULL,
  bid numeric(14, 4),
  ask numeric(14, 4),
  PRIMARY KEY (metal, at)
);
-- Quick Links: the websites the team uses. A link can carry a shared login, encrypted with the forms key (secret), that only the
-- people in login_to (and master admins) can reveal; every reveal is audited. visible_to = who sees the link ([] = everyone).
CREATE TABLE IF NOT EXISTS quick_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  url text NOT NULL,
  category text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  visible_to jsonb NOT NULL DEFAULT '[]',
  login_to jsonb NOT NULL DEFAULT '[]',
  secret text,
  has_login boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_name text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS quick_links_order ON quick_links (category, sort_order, title);
-- Personal logins: links where each person keeps their own (e.g. a reporting site with one login per employee). Encrypted the same
-- way; only that person can see theirs (not even master admins).
ALTER TABLE quick_links ADD COLUMN IF NOT EXISTS personal boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS quick_link_logins (
  link_id uuid NOT NULL REFERENCES quick_links(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  secret text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (link_id, user_id)
);
