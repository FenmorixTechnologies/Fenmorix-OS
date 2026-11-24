-- Interdepartmental messages.
-- A thread is one conversation. Recipients are worked out when it's sent (a group's members at
-- that moment) and each gets a deliver_at: now, or the start of their next shift.
-- Group / everyone sends are "broadcasts": members' replies go to the sender only (private_to).

CREATE TABLE message_threads (
  id          uuid PRIMARY KEY,
  subject     text NOT NULL,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  broadcast   boolean NOT NULL DEFAULT false,
  important   boolean NOT NULL DEFAULT false,
  timing      text NOT NULL DEFAULT 'now' CHECK (timing IN ('now', 'next_shift')),
  to_label    text NOT NULL DEFAULT ''          -- "A-Shift, Captain Smith" as the sender wrote it
);

CREATE TABLE message_posts (
  id          uuid PRIMARY KEY,
  thread_id   uuid NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES users(id),
  body        text NOT NULL,
  private_to  uuid REFERENCES users(id),        -- broadcast replies: only the author and this person see it
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_posts_thread ON message_posts (thread_id, created_at);

CREATE TABLE message_recipients (
  thread_id   uuid NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id),
  deliver_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz,                      -- last time they opened it
  seen_post   timestamptz,                      -- newest post they've seen (for "new reply" markers)
  archived    boolean NOT NULL DEFAULT false,
  via         text NOT NULL DEFAULT '',         -- "Direct", a group name, or "Everyone"
  PRIMARY KEY (thread_id, user_id)
);
CREATE INDEX message_recipients_user ON message_recipients (user_id, deliver_at);
