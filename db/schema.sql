-- =====================================================================
-- St. George Fire Protection District — Management System
-- PostgreSQL schema (target: PostgreSQL 18)
--
-- Run once against the empty sgfd database, as the app account:
--   psql -U sgfd_app -d sgfd -f schema.sql
--
-- Everything runs inside one transaction: if any statement fails,
-- nothing is created and you can fix the problem and run it again.
--
-- Covers every module in procurement-system.jsx:
--   Procurement, Reimbursements, Certifications, PPE & Gear,
--   Help Desk, Meetings, Directory, Announcements, Audit log.
--
-- Rules the database enforces itself (not just the screen):
--   * Requisitions/reimbursements lock once approved, paid, or rejected.
--     An approved record can only be marked paid.
--   * Requisitions must follow the signature chain in order, and a
--     status change requires the matching signature to exist.
--   * The audit log is append-only: no edits, deletes, or truncates.
--   * Closed help-desk tickets accept no new comments or attachments.
--   * People are deactivated (users.active = false), never deleted,
--     so history always points at a real person.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------

CREATE TABLE divisions (
  id          serial PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id          serial PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Simple key/value settings (e.g. mileage_rate)
CREATE TABLE settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- People: roster + directory in one table
-- ---------------------------------------------------------------------

CREATE TABLE users (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name                text NOT NULL,
  division_id              int  NOT NULL REFERENCES divisions(id),
  role                     text NOT NULL DEFAULT 'user'
                           CHECK (role IN ('user','approver1','approver2','fire_chief','accounting','master')),
  email                    text,
  phone                    text,
  emergency_contact_name   text,   -- visible only to the person and master admins (enforced by the API)
  emergency_contact_phone  text,
  staff_id                 text,   -- defaults for the reimbursement form
  position                 text,
  supervisor               text,
  sso_subject              text UNIQUE,  -- Microsoft 365 / Google account ID, filled in when real sign-in is added
  active                   boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX users_division_idx ON users (division_id);

-- ---------------------------------------------------------------------
-- Uploaded files (metadata only — the file itself lives in the
-- uploads folder on disk, at storage_key)
-- ---------------------------------------------------------------------

CREATE TABLE files (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key    text NOT NULL UNIQUE,
  original_name  text NOT NULL,
  mime_type      text,
  size_bytes     bigint NOT NULL CHECK (size_bytes >= 0),
  uploaded_by    uuid REFERENCES users(id),
  uploaded_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Procurement
-- ---------------------------------------------------------------------

CREATE TABLE vendors (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  phone           text,
  fax             text,
  address         text,
  city            text,
  state           text,
  zip             text,
  account_number  text,   -- the district's customer account number with this vendor
  rep_name        text,
  rep_phone       text,
  rep_email       text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- "Acme Corp" and " acme corp " are the same vendor
CREATE UNIQUE INDEX vendors_name_uq ON vendors (lower(btrim(name)));

CREATE TABLE requisitions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id        int  NOT NULL REFERENCES divisions(id),
  category_id        int  NOT NULL REFERENCES categories(id),
  title              text NOT NULL,
  vendor_id          uuid NOT NULL REFERENCES vendors(id),
  description        text NOT NULL DEFAULT '',
  contractual        boolean NOT NULL DEFAULT false,
  frequency          text NOT NULL DEFAULT 'one_time'
                     CHECK (frequency IN ('one_time','monthly','quarterly','semiannually','yearly')),
  amount             numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),  -- per occurrence; ignored when line items exist
  invoice_number     text,
  payment_method     text,
  card_last4         text CHECK (card_last4 ~ '^[0-9]{4}$'),   -- never the full card number
  cardholder_name    text,
  requested_by       uuid REFERENCES users(id),     -- NULL for imported records
  requested_by_name  text NOT NULL,
  status             text NOT NULL DEFAULT 'pending_auth1'
                     CHECK (status IN ('pending_auth1','pending_auth2','pending_chief','approved','paid','rejected')),
  rejected_reason    text,
  paid_at            timestamptz,
  imported           boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'paid'     OR paid_at IS NOT NULL),
  CHECK (status <> 'rejected' OR rejected_reason IS NOT NULL),
  CHECK (card_last4 IS NULL   OR payment_method = 'Credit card')
);
CREATE INDEX requisitions_division_idx ON requisitions (division_id);
CREATE INDEX requisitions_status_idx   ON requisitions (status);
CREATE INDEX requisitions_vendor_idx   ON requisitions (vendor_id);
CREATE INDEX requisitions_created_idx  ON requisitions (created_at);

CREATE TABLE requisition_line_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id  uuid NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
  position        int  NOT NULL DEFAULT 0,
  description     text NOT NULL,
  amount          numeric(12,2) NOT NULL CHECK (amount > 0),
  frequency       text NOT NULL
                  CHECK (frequency IN ('one_time','monthly','quarterly','semiannually','yearly'))
);
CREATE INDEX requisition_line_items_req_idx ON requisition_line_items (requisition_id);

-- One row per signature stage: auth1 = purchaser's signature,
-- auth2 = pre-approval, chief = final approval
CREATE TABLE requisition_signatures (
  requisition_id  uuid NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
  stage           text NOT NULL CHECK (stage IN ('auth1','auth2','chief')),
  signer_id       uuid REFERENCES users(id),   -- NULL for imported records
  signer_name     text NOT NULL,
  decision        text NOT NULL CHECK (decision IN ('approved','rejected')),
  note            text NOT NULL DEFAULT '',
  signed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (requisition_id, stage)
);

CREATE TABLE requisition_attachments (
  requisition_id  uuid NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
  file_id         uuid NOT NULL REFERENCES files(id),
  PRIMARY KEY (requisition_id, file_id)
);

CREATE TABLE contracts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  vendor_id    uuid REFERENCES vendors(id),
  division_id  int  REFERENCES divisions(id),   -- NULL = all divisions
  notes        text NOT NULL DEFAULT '',
  file_id      uuid NOT NULL REFERENCES files(id),
  uploaded_by  uuid REFERENCES users(id),
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Reimbursements
-- ---------------------------------------------------------------------

CREATE TABLE reimbursements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type             text NOT NULL CHECK (type IN ('travel','non_travel')),
  requester_id     uuid NOT NULL REFERENCES users(id),
  division_id      int  NOT NULL REFERENCES divisions(id),
  staff_id         text,
  position         text,
  supervisor       text,
  reason           text NOT NULL,
  period_from      date,
  period_to        date,
  advances         numeric(12,2) NOT NULL DEFAULT 0 CHECK (advances >= 0),
  mileage_rate     numeric(6,4)  NOT NULL CHECK (mileage_rate >= 0),  -- rate in effect when submitted
  status           text NOT NULL DEFAULT 'pending_approval'
                   CHECK (status IN ('pending_approval','approved','rejected','paid')),
  decided_by       uuid REFERENCES users(id),   -- who approved or rejected
  decided_by_name  text,
  decided_at       timestamptz,
  rejected_reason  text,
  paid_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (period_from IS NULL OR period_to IS NULL OR period_to >= period_from),
  CHECK (status = 'pending_approval' OR decided_at IS NOT NULL),
  CHECK (status <> 'paid'     OR paid_at IS NOT NULL),
  CHECK (status <> 'rejected' OR rejected_reason IS NOT NULL)
);
CREATE INDEX reimbursements_requester_idx ON reimbursements (requester_id);
CREATE INDEX reimbursements_div_status_idx ON reimbursements (division_id, status);

-- Travel rows use lodging/miles/meals/parking/other;
-- non-travel rows use qty/unit_price.
CREATE TABLE reimbursement_line_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reimbursement_id  uuid NOT NULL REFERENCES reimbursements(id) ON DELETE CASCADE,
  position          int  NOT NULL DEFAULT 0,
  item_date         date,
  description       text NOT NULL,
  lodging           numeric(12,2) NOT NULL DEFAULT 0 CHECK (lodging >= 0),
  miles             numeric(8,1)  NOT NULL DEFAULT 0 CHECK (miles >= 0),
  meals             numeric(12,2) NOT NULL DEFAULT 0 CHECK (meals >= 0),
  parking           numeric(12,2) NOT NULL DEFAULT 0 CHECK (parking >= 0),
  other             numeric(12,2) NOT NULL DEFAULT 0 CHECK (other >= 0),
  qty               numeric(10,2) NOT NULL DEFAULT 0 CHECK (qty >= 0),
  unit_price        numeric(12,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0)
);
CREATE INDEX reimbursement_line_items_reimb_idx ON reimbursement_line_items (reimbursement_id);

CREATE TABLE reimbursement_attachments (
  reimbursement_id  uuid NOT NULL REFERENCES reimbursements(id) ON DELETE CASCADE,
  file_id           uuid NOT NULL REFERENCES files(id),
  PRIMARY KEY (reimbursement_id, file_id)
);

-- ---------------------------------------------------------------------
-- Certifications and PPE & Gear
-- ---------------------------------------------------------------------

CREATE TABLE certifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id),
  cert_name        text NOT NULL,
  issuing_org      text NOT NULL DEFAULT '',
  completion_date  date NOT NULL,
  expiration_date  date,                 -- NULL = does not expire
  file_id          uuid REFERENCES files(id),
  added_by         uuid REFERENCES users(id),
  added_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX certifications_user_idx   ON certifications (user_id);
CREATE INDEX certifications_expire_idx ON certifications (expiration_date);

CREATE TABLE gear_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id),
  gear_type        text NOT NULL
                   CHECK (gear_type IN ('Turnout Coat','Turnout Pants','Helmet','SCBA','Boots','Gloves','Hood','Hose','Other')),
  item_name        text NOT NULL,
  serial_number    text NOT NULL DEFAULT '',
  issued_date      date NOT NULL,        -- inspection / issue date
  expiration_date  date,                 -- NULL = not tracked
  file_id          uuid REFERENCES files(id),
  added_by         uuid REFERENCES users(id),
  added_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gear_items_user_idx   ON gear_items (user_id);
CREATE INDEX gear_items_expire_idx ON gear_items (expiration_date);

-- ---------------------------------------------------------------------
-- Help Desk
-- ---------------------------------------------------------------------

CREATE TABLE tickets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spiceworks_id   text UNIQUE,           -- set for tickets imported from Spiceworks
  subject         text NOT NULL,
  category        text NOT NULL
                  CHECK (category IN ('Hardware','Software','Network','Account & Access','Phone / Radio','Printer','Other')),
  priority        text NOT NULL DEFAULT 'Medium'
                  CHECK (priority IN ('Low','Medium','High','Urgent')),
  division_id     int  NOT NULL REFERENCES divisions(id),
  location        text NOT NULL DEFAULT '',
  description     text NOT NULL,
  requester_id    uuid REFERENCES users(id),   -- NULL if an imported requester isn't on the roster
  requester_name  text NOT NULL,
  assignee_id     uuid REFERENCES users(id),
  status          text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','in_progress','on_hold','resolved','closed')),
  due_date        date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  closed_at       timestamptz
);
CREATE INDEX tickets_status_idx    ON tickets (status);
CREATE INDEX tickets_assignee_idx  ON tickets (assignee_id);
CREATE INDEX tickets_requester_idx ON tickets (requester_id);

CREATE TABLE ticket_comments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id    uuid REFERENCES users(id),
  author_name  text NOT NULL,
  body         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ticket_comments_ticket_idx ON ticket_comments (ticket_id);

CREATE TABLE ticket_attachments (
  ticket_id  uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  file_id    uuid NOT NULL REFERENCES files(id),
  PRIMARY KEY (ticket_id, file_id)
);

-- ---------------------------------------------------------------------
-- Meetings
-- ---------------------------------------------------------------------

CREATE TABLE meetings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject           text NOT NULL,
  organizer_id      uuid NOT NULL REFERENCES users(id),
  starts_at         timestamptz NOT NULL,
  duration_minutes  int  NOT NULL CHECK (duration_minutes > 0),
  location          text NOT NULL DEFAULT '',
  agenda            text NOT NULL DEFAULT '',
  cancelled         boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meetings_starts_idx ON meetings (starts_at);

CREATE TABLE meeting_invitees (
  meeting_id    uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  responded_at  timestamptz,
  note          text NOT NULL DEFAULT '',
  PRIMARY KEY (meeting_id, user_id)
);
CREATE INDEX meeting_invitees_user_idx ON meeting_invitees (user_id);

-- ---------------------------------------------------------------------
-- Announcements
-- ---------------------------------------------------------------------

CREATE TABLE announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  body        text NOT NULL,
  priority    text NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Normal','Important','Urgent')),
  pinned      boolean NOT NULL DEFAULT false,
  author_id   uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------

CREATE TABLE audit_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  actor_id     uuid REFERENCES users(id),   -- NULL for system actions such as imports
  actor_name   text NOT NULL,
  actor_role   text NOT NULL,
  module       text NOT NULL,
  action       text NOT NULL,
  detail       text NOT NULL DEFAULT ''
);
CREATE INDEX audit_log_occurred_idx ON audit_log (occurred_at DESC);
CREATE INDEX audit_log_module_idx   ON audit_log (module);

-- =====================================================================
-- Rules enforced by triggers
-- =====================================================================

-- Imports insert already-finalized records along with their children.
-- The import code runs:  SET LOCAL sgfd.importing = 'on';
-- inside its transaction so those child rows are allowed.
CREATE FUNCTION sgfd_importing() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('sgfd.importing', true), '') = 'on'
$$;

-- ---- Requisitions: locking + signature chain ----
CREATE FUNCTION requisitions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  needed_stage    text;
  needed_decision text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('approved','paid','rejected') THEN
      RAISE EXCEPTION 'Requisition % is finalized (%) and cannot be deleted', OLD.id, OLD.status;
    END IF;
    RETURN OLD;
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

    -- Every move along the chain needs the matching signature first
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

CREATE TRIGGER requisitions_guard
  BEFORE UPDATE OR DELETE ON requisitions
  FOR EACH ROW EXECUTE FUNCTION requisitions_guard();

-- Line items, signatures and attachments of a finalized requisition are frozen too
CREATE FUNCTION requisition_children_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rid uuid;
  st  text;
BEGIN
  IF TG_OP = 'DELETE' THEN rid := OLD.requisition_id; ELSE rid := NEW.requisition_id; END IF;
  SELECT status INTO st FROM requisitions WHERE id = rid;
  IF st IN ('approved','paid','rejected') AND NOT sgfd_importing() THEN
    RAISE EXCEPTION 'Requisition % is finalized (%); % cannot be changed', rid, st, TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER requisition_line_items_guard
  BEFORE INSERT OR UPDATE OR DELETE ON requisition_line_items
  FOR EACH ROW EXECUTE FUNCTION requisition_children_guard();
CREATE TRIGGER requisition_signatures_guard
  BEFORE INSERT OR UPDATE OR DELETE ON requisition_signatures
  FOR EACH ROW EXECUTE FUNCTION requisition_children_guard();
CREATE TRIGGER requisition_attachments_guard
  BEFORE INSERT OR UPDATE OR DELETE ON requisition_attachments
  FOR EACH ROW EXECUTE FUNCTION requisition_children_guard();

-- ---- Reimbursements: locking + allowed status moves ----
CREATE FUNCTION reimbursements_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('approved','paid','rejected') THEN
      RAISE EXCEPTION 'Reimbursement % is finalized (%) and cannot be deleted', OLD.id, OLD.status;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status IN ('paid','rejected') THEN
    RAISE EXCEPTION 'Reimbursement % is finalized (%) and cannot be changed', OLD.id, OLD.status;
  END IF;

  IF OLD.status = 'approved'
     AND (to_jsonb(NEW) - 'status' - 'paid_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'paid_at') THEN
    RAISE EXCEPTION 'Reimbursement % is approved; the only allowed change is marking it paid', OLD.id;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND (OLD.status, NEW.status) NOT IN (
       ('pending_approval','approved'), ('pending_approval','rejected'), ('approved','paid')) THEN
    RAISE EXCEPTION 'Reimbursement % cannot move from % to %', OLD.id, OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER reimbursements_guard
  BEFORE UPDATE OR DELETE ON reimbursements
  FOR EACH ROW EXECUTE FUNCTION reimbursements_guard();

CREATE FUNCTION reimbursement_children_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rid uuid;
  st  text;
BEGIN
  IF TG_OP = 'DELETE' THEN rid := OLD.reimbursement_id; ELSE rid := NEW.reimbursement_id; END IF;
  SELECT status INTO st FROM reimbursements WHERE id = rid;
  IF st IN ('approved','paid','rejected') AND NOT sgfd_importing() THEN
    RAISE EXCEPTION 'Reimbursement % is finalized (%); % cannot be changed', rid, st, TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER reimbursement_line_items_guard
  BEFORE INSERT OR UPDATE OR DELETE ON reimbursement_line_items
  FOR EACH ROW EXECUTE FUNCTION reimbursement_children_guard();
CREATE TRIGGER reimbursement_attachments_guard
  BEFORE INSERT OR UPDATE OR DELETE ON reimbursement_attachments
  FOR EACH ROW EXECUTE FUNCTION reimbursement_children_guard();

-- ---- Tickets: keep timestamps current; closed tickets are frozen ----
CREATE FUNCTION tickets_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status = 'resolved' AND NEW.resolved_at IS NULL THEN NEW.resolved_at := now(); END IF;
  IF NEW.status = 'closed'   AND NEW.closed_at   IS NULL THEN NEW.closed_at   := now(); END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tickets_touch
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION tickets_touch();

CREATE FUNCTION ticket_children_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  tid uuid;
  st  text;
BEGIN
  IF TG_OP = 'DELETE' THEN tid := OLD.ticket_id; ELSE tid := NEW.ticket_id; END IF;
  SELECT status INTO st FROM tickets WHERE id = tid;
  IF st = 'closed' AND NOT sgfd_importing() THEN
    RAISE EXCEPTION 'Ticket % is closed; % cannot be changed', tid, TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER ticket_comments_guard
  BEFORE INSERT OR UPDATE OR DELETE ON ticket_comments
  FOR EACH ROW EXECUTE FUNCTION ticket_children_guard();
CREATE TRIGGER ticket_attachments_guard
  BEFORE INSERT OR UPDATE OR DELETE ON ticket_attachments
  FOR EACH ROW EXECUTE FUNCTION ticket_children_guard();

-- ---- Audit log: append-only ----
CREATE FUNCTION audit_log_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END $$;

CREATE TRIGGER audit_log_no_change
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();

-- =====================================================================
-- Calculated totals (same math as the app, done in one place)
-- =====================================================================

CREATE FUNCTION freq_multiplier(f text) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE f
           WHEN 'monthly'      THEN 12
           WHEN 'quarterly'    THEN 4
           WHEN 'semiannually' THEN 2
           WHEN 'yearly'       THEN 1
           ELSE 0
         END
$$;

-- Total, annualized recurring, and one-time amounts per requisition
CREATE VIEW requisition_totals AS
SELECT r.id                                                                    AS requisition_id,
       COALESCE(li.total, r.amount)                                            AS total_amount,
       COALESCE(li.annual_recurring, r.amount * freq_multiplier(r.frequency))  AS annual_recurring,
       COALESCE(li.one_time,
                CASE WHEN r.frequency = 'one_time' THEN r.amount ELSE 0 END)   AS one_time,
       COALESCE(li.item_count, 0)                                              AS line_item_count
FROM requisitions r
LEFT JOIN (
  SELECT requisition_id,
         sum(amount)                                                  AS total,
         sum(amount * freq_multiplier(frequency))                     AS annual_recurring,
         COALESCE(sum(amount) FILTER (WHERE frequency = 'one_time'), 0) AS one_time,
         count(*)                                                     AS item_count
  FROM requisition_line_items
  GROUP BY requisition_id
) li ON li.requisition_id = r.id;

-- Subtotal and total per reimbursement (travel subtracts advances)
CREATE VIEW reimbursement_totals AS
SELECT r.id                                AS reimbursement_id,
       round(COALESCE(s.subtotal, 0), 2)   AS subtotal,
       round(CASE WHEN r.type = 'travel' THEN COALESCE(s.subtotal, 0) - r.advances
                  ELSE COALESCE(s.subtotal, 0) END, 2) AS total
FROM reimbursements r
LEFT JOIN (
  SELECT li.reimbursement_id,
         sum(CASE WHEN p.type = 'travel'
                  THEN li.lodging + li.miles * p.mileage_rate + li.meals + li.parking + li.other
                  ELSE li.qty * li.unit_price END) AS subtotal
  FROM reimbursement_line_items li
  JOIN reimbursements p ON p.id = li.reimbursement_id
  GROUP BY li.reimbursement_id
) s ON s.reimbursement_id = r.id;

-- =====================================================================
-- Starting data (matches the app's defaults)
-- =====================================================================

INSERT INTO divisions (name) VALUES
  ('Administration'), ('Communications'), ('Community Relations'), ('Fire Prevention'),
  ('Medical'), ('Safety'), ('Special Events (FEMA)'), ('Special Events (Non-FEMA)'),
  ('Special Operations'), ('Special Services'), ('Suppression'), ('Technology'),
  ('Training'), ('Wellness');

INSERT INTO categories (name) VALUES
  ('Equipment'), ('Software & IT'), ('Vehicles & Fleet'), ('PPE & Safety Gear'),
  ('Facilities'), ('Training & Certification'), ('Supplies'), ('Contracted Services'), ('Other');

INSERT INTO settings (key, value) VALUES
  ('mileage_rate', '0.70');   -- update to the current rate from the Reimbursements screen

COMMIT;
