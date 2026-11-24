-- Messages: mark the recipient rows held for later ("at their next shift"). Only those are announced by the delivery timer
-- when their time comes; rows sent "now" are announced when sent (they were being announced a second time).
ALTER TABLE message_recipients ADD COLUMN IF NOT EXISTS held boolean NOT NULL DEFAULT false;
UPDATE message_recipients SET held = true WHERE deliver_at > now();
