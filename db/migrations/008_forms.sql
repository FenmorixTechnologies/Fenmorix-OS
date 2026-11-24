-- Forms, personnel-file profile details, injury cases.

-- Profile details used to pre-fill forms (private: the person and master admins)
ALTER TABLE users
  ADD COLUMN employee_number text,
  ADD COLUMN job_title       text,
  ADD COLUMN hire_date       date,
  ADD COLUMN station         text,
  ADD COLUMN street          text,
  ADD COLUMN city            text,
  ADD COLUMN state           text,
  ADD COLUMN zip             text;

-- A form: its fields and settings are JSON so the form builder can edit them
CREATE TABLE form_definitions (
  id          uuid PRIMARY KEY,
  key         text NOT NULL UNIQUE,            -- stable name, e.g. injury_initial
  title       text NOT NULL,
  category    text NOT NULL DEFAULT 'Employee Forms',
  description text NOT NULL DEFAULT '',
  fields      jsonb NOT NULL DEFAULT '[]',
  settings    jsonb NOT NULL DEFAULT '{}',
  version     int NOT NULL DEFAULT 1,
  active      boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 100,
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Who can see every submission of a form (form_key '*' = all forms)
CREATE TABLE form_viewers (
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  form_key text NOT NULL,
  PRIMARY KEY (user_id, form_key)
);

-- A case groups related submissions (an injury: initial report + statements)
CREATE TABLE form_cases (
  id              uuid PRIMARY KEY,
  kind            text NOT NULL,                 -- 'injury'
  form_key        text NOT NULL,                 -- the form that opened it (its viewers see the case)
  subject_user_id uuid REFERENCES users(id),
  title           text NOT NULL,
  summary         jsonb NOT NULL DEFAULT '{}',   -- date, time, location (shared with follow-up forms)
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_by       uuid REFERENCES users(id),
  opened_at       timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz
);

CREATE TABLE form_submissions (
  id              uuid PRIMARY KEY,
  form_key        text NOT NULL,
  form_title      text NOT NULL,
  definition      jsonb NOT NULL,                -- the fields as they were when submitted
  subject_user_id uuid REFERENCES users(id),     -- whose personnel file it's filed in
  submitted_by    uuid REFERENCES users(id),     -- NULL for anonymous forms
  submitted_by_name text NOT NULL DEFAULT '',
  data            jsonb NOT NULL DEFAULT '{}',   -- answers (sensitive ones are in secret)
  secret          text,                          -- encrypted JSON of sensitive answers
  case_id         uuid REFERENCES form_cases(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'pending_approval', 'approved', 'denied')),
  submitted_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX form_submissions_subject ON form_submissions (subject_user_id);
CREATE INDEX form_submissions_case ON form_submissions (case_id);

-- Follow-up forms a case asks people to complete
CREATE TABLE form_tasks (
  id            uuid PRIMARY KEY,
  case_id       uuid NOT NULL REFERENCES form_cases(id) ON DELETE CASCADE,
  form_key      text NOT NULL,
  label         text NOT NULL DEFAULT '',        -- e.g. "Witness statement — J. Smith"
  assigned_to   uuid REFERENCES users(id),       -- NULL = not on the roster / unassigned
  assignee_name text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'cancelled')),
  submission_id uuid REFERENCES form_submissions(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);
CREATE INDEX form_tasks_assigned ON form_tasks (assigned_to, status);

-- Approvals (e.g. leave requests) and "Reviewed" marks by required recipients
CREATE TABLE form_approvals (
  submission_id uuid NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id),
  decision      text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'approved', 'denied')),
  note          text NOT NULL DEFAULT '',
  decided_at    timestamptz,
  PRIMARY KEY (submission_id, user_id)
);
CREATE TABLE form_reviews (
  submission_id uuid NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id),
  note          text NOT NULL DEFAULT '',
  reviewed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (submission_id, user_id)
);
