-- TV display screens (dashboard mode). A screen is not a person: it signs in by pairing (the TV shows a code, an accounts admin
-- enters it), holds its own cookie, and can only read the dashboard views it was given. Signing it out clears token_hash.
CREATE TABLE IF NOT EXISTS display_screens (
  id              uuid PRIMARY KEY,
  name            text NOT NULL,
  token_hash      text UNIQUE,
  settings        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {views: [...], seconds, switchToBoard}
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by_name text NOT NULL DEFAULT '',
  paired_at       timestamptz,
  last_seen_at    timestamptz,
  user_agent      text NOT NULL DEFAULT ''
);

-- A TV waiting to be paired: the code it shows, and the hash of the cookie it already holds. Expires after 15 minutes.
CREATE TABLE IF NOT EXISTS display_pairings (
  code        text PRIMARY KEY,
  token_hash  text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  user_agent  text NOT NULL DEFAULT ''
);
