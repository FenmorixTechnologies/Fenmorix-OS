-- System notices (a requisition was approved, it's your turn to pick leave, ...) are their own kind of thread, so every install can
-- show them in the core Notifications inbox even when person-to-person Messaging isn't part of the subscription.
ALTER TABLE message_threads DROP CONSTRAINT IF EXISTS message_threads_kind;
ALTER TABLE message_threads ADD CONSTRAINT message_threads_kind CHECK (kind IN ('message', 'chat', 'notice'));
CREATE INDEX IF NOT EXISTS message_threads_notice ON message_threads (created_at) WHERE kind = 'notice';
