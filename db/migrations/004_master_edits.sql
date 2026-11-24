-- Master admins may edit or delete finalized requisitions.
-- The server turns this on (SET LOCAL sgfd.master_edit = 'on') only for a
-- master admin, and writes every such edit (old -> new) or deletion (a
-- snapshot of the record) to the audit log. The status itself never changes
-- this way, and signatures stay as recorded (dates via date correction).

CREATE FUNCTION sgfd_master_edit() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('sgfd.master_edit', true), '') = 'on'
$$;

CREATE OR REPLACE FUNCTION requisitions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  needed_stage    text;
  needed_decision text;
  only_dates      boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('approved','paid','rejected') AND NOT sgfd_master_edit() THEN
      RAISE EXCEPTION 'Requisition % is finalized (%) and cannot be deleted', OLD.id, OLD.status;
    END IF;
    RETURN OLD;
  END IF;

  -- Master admin editing details: anything but the status
  IF sgfd_master_edit() AND NEW.status = OLD.status THEN
    RETURN NEW;
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
    -- A master admin may change line items and attachments (signatures stay)
    IF sgfd_master_edit() AND TG_TABLE_NAME <> 'requisition_signatures' THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END IF;
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
