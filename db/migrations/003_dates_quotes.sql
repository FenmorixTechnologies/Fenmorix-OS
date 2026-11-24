-- Real requisition dates, paper signatures recorded by admins, date
-- corrections, and quotes. Applied automatically at startup.

-- ---------------------------------------------------------------------
-- Quotes
-- ---------------------------------------------------------------------
CREATE TABLE quotes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id       uuid NOT NULL REFERENCES vendors(id),
  division_id     int  NOT NULL REFERENCES divisions(id),
  title           text NOT NULL,                 -- what the quote is for
  amount          numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  quote_number    text,
  quote_date      date NOT NULL DEFAULT current_date,
  expires_on      date,
  notes           text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  decided_by      uuid REFERENCES users(id),
  decided_by_name text,
  decided_at      timestamptz,
  decline_reason  text,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'pending' OR decided_at IS NOT NULL)
);
CREATE INDEX quotes_vendor_idx ON quotes (vendor_id);
CREATE INDEX quotes_status_idx ON quotes (status);

CREATE TABLE quote_attachments (
  quote_id  uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  file_id   uuid NOT NULL REFERENCES files(id),
  PRIMARY KEY (quote_id, file_id)
);

-- ---------------------------------------------------------------------
-- Requisitions: the real date of the requisition/quote, where it came from
-- ---------------------------------------------------------------------
ALTER TABLE requisitions
  ADD COLUMN req_date      date,
  ADD COLUMN quote_id      uuid REFERENCES quotes(id),
  ADD COLUMN repeated_from uuid REFERENCES requisitions(id);

-- Existing requisitions take the date they were entered (Central time).
-- The lock on finalized requisitions is paused only for this one-time fill of
-- the new column; it's switched back on immediately below.
ALTER TABLE requisitions DISABLE TRIGGER requisitions_guard;
UPDATE requisitions SET req_date = (created_at AT TIME ZONE 'America/Chicago')::date;
ALTER TABLE requisitions ENABLE TRIGGER requisitions_guard;
ALTER TABLE requisitions ALTER COLUMN req_date SET NOT NULL;
ALTER TABLE requisitions ALTER COLUMN req_date SET DEFAULT current_date;
CREATE INDEX requisitions_req_date_idx ON requisitions (req_date);
CREATE INDEX requisitions_quote_idx ON requisitions (quote_id);

-- Paper signatures entered by an admin on the signer's behalf
ALTER TABLE requisition_signatures
  ADD COLUMN recorded_by      uuid REFERENCES users(id),
  ADD COLUMN recorded_by_name text;

-- ---------------------------------------------------------------------
-- Date corrections on finalized records.
-- The server turns this on (SET LOCAL sgfd.date_correction = 'on') only
-- for a master admin, and only the date columns may change; every
-- correction is written to the audit log by the server.
-- ---------------------------------------------------------------------
CREATE FUNCTION sgfd_date_correction() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('sgfd.date_correction', true), '') = 'on'
$$;

CREATE OR REPLACE FUNCTION requisitions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  needed_stage    text;
  needed_decision text;
  only_dates      boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('approved','paid','rejected') THEN
      RAISE EXCEPTION 'Requisition % is finalized (%) and cannot be deleted', OLD.id, OLD.status;
    END IF;
    RETURN OLD;
  END IF;

  -- Only the date columns differ, and a master admin is correcting them
  only_dates := sgfd_date_correction()
    AND NEW.status = OLD.status
    AND (to_jsonb(NEW) - 'req_date' - 'paid_at') = (to_jsonb(OLD) - 'req_date' - 'paid_at');
  IF only_dates THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('paid','rejected') THEN
    RAISE EXCEPTION 'Requisition % is finalized (%) and cannot be changed', OLD.id, OLD.status;
  END IF;

  IF OLD.status = 'approved'
     AND (to_jsonb(NEW) - 'status' - 'paid_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'paid_at') THEN
    RAISE EXCEPTION 'Requisition % is approved; the only allowed change is marking it paid', OLD.id;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF (OLD.status, NEW.status) NOT IN (
         ('pending_auth1','pending_auth2'), ('pending_auth1','rejected'),
         ('pending_auth2','pending_chief'), ('pending_auth2','rejected'),
         ('pending_chief','approved'),      ('pending_chief','rejected'),
         ('approved','paid')) THEN
      RAISE EXCEPTION 'Requisition % cannot move from % to %', OLD.id, OLD.status, NEW.status;
    END IF;

    IF NEW.status <> 'paid' THEN
      needed_stage := CASE OLD.status
                        WHEN 'pending_auth1' THEN 'auth1'
                        WHEN 'pending_auth2' THEN 'auth2'
                        WHEN 'pending_chief' THEN 'chief'
                      END;
      needed_decision := CASE WHEN NEW.status = 'rejected' THEN 'rejected' ELSE 'approved' END;
      IF NOT EXISTS (SELECT 1 FROM requisition_signatures
                     WHERE requisition_id = OLD.id
                       AND stage = needed_stage
                       AND decision = needed_decision) THEN
        RAISE EXCEPTION 'Requisition % needs a % signature (%) before moving to %',
          OLD.id, needed_stage, needed_decision, NEW.status;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION requisition_children_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rid uuid;
  st  text;
BEGIN
  IF TG_OP = 'DELETE' THEN rid := OLD.requisition_id; ELSE rid := NEW.requisition_id; END IF;
  SELECT status INTO st FROM requisitions WHERE id = rid;
  IF st IN ('approved','paid','rejected') AND NOT sgfd_importing() THEN
    -- A master admin may correct the date of an existing signature, nothing else
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'requisition_signatures' AND sgfd_date_correction()
       AND (to_jsonb(NEW) - 'signed_at') = (to_jsonb(OLD) - 'signed_at') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Requisition % is finalized (%); % cannot be changed', rid, st, TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
