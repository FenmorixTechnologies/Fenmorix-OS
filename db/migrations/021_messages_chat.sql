-- Messages: delete, chat conversations.
--
-- Delete is per person: cleared_at hides every post up to that moment for them. If someone replies
-- later, only the new posts show. Once everyone in a conversation has deleted it (and nobody is
-- still waiting for it at their next shift), the conversation is removed from the database.
-- kind 'chat': a one-to-one conversation from the chat window; the same two people always share one.

ALTER TABLE message_recipients ADD COLUMN IF NOT EXISTS cleared_at timestamptz;
ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'message';
DO $$ BEGIN
  ALTER TABLE message_threads ADD CONSTRAINT message_threads_kind CHECK (kind IN ('message', 'chat'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS message_threads_chat ON message_threads (created_by) WHERE kind = 'chat';
CREATE INDEX IF NOT EXISTS message_recipients_deliver ON message_recipients (deliver_at) WHERE read_at IS NULL;
