-- Tickets: two desks (Help Desk and Gear), sent (as notifications) to groups and/or people, and a status-update timeline like forms.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS desk text NOT NULL DEFAULT 'helpdesk';
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_desk_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_desk_check CHECK (desk IN ('helpdesk', 'gear'));
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sent_to jsonb NOT NULL DEFAULT '[]';   -- [{kind: group|user, id, name}] as chosen
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_category_check;               -- categories differ per desk (checked in code)
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('open', 'acknowledged', 'in_progress', 'on_hold', 'awaiting_delivery', 'resolved', 'closed'));
CREATE INDEX IF NOT EXISTS tickets_desk_idx ON tickets (desk);

-- Everyone the ticket was sent to (group members at the time it was sent, plus people picked by name): notified, and they
-- can see and follow it. Only the desk's own team works it (status, assignee, due date).
CREATE TABLE IF NOT EXISTS ticket_watchers (
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (ticket_id, user_id)
);
CREATE INDEX IF NOT EXISTS ticket_watchers_user_idx ON ticket_watchers (user_id);

-- Status updates (Acknowledged, Being worked on, On hold, Awaiting delivery, ...), each with an optional note
CREATE TABLE IF NOT EXISTS ticket_updates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  status      text NOT NULL,
  note        text NOT NULL DEFAULT '',
  author_id   uuid REFERENCES users(id),
  author_name text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_updates_ticket_idx ON ticket_updates (ticket_id, created_at);
