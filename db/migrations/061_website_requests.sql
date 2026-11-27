-- Feature ideas sent from fenmorix.com arrive as support requests that belong to no client yet (source 'website', contact details kept).
ALTER TABLE portal_tickets ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE portal_tickets ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'portal';
ALTER TABLE portal_tickets ADD COLUMN IF NOT EXISTS contact jsonb;
DO $$ BEGIN
  ALTER TABLE portal_tickets ADD CONSTRAINT portal_tickets_source CHECK (source IN ('portal', 'website'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
