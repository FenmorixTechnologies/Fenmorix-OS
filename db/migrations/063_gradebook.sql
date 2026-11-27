-- Gradebook (schools; module "gradebook"). Classes, teachers, students, enrollments, assignments by category, scores with comments
-- and graded work, school-set grading periods and letter scale (settings key 'gradebook'). Students and parents / guardians sign in
-- with their own family accounts (gb_family, separate from staff accounts, own sessions) and see only their own records.
CREATE TABLE IF NOT EXISTS gb_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  school_year text NOT NULL DEFAULT '',
  starts date NOT NULL,
  ends date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends >= starts)
);
CREATE TABLE IF NOT EXISTS gb_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_number text NOT NULL DEFAULT '',
  first_name text NOT NULL,
  last_name text NOT NULL,
  grade_level text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gb_students_number ON gb_students (lower(student_number)) WHERE student_number <> '';
CREATE TABLE IF NOT EXISTS gb_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL DEFAULT '',                  -- the student system's section code, used to match imports
  name text NOT NULL,
  subject text NOT NULL DEFAULT '',
  grade_level text NOT NULL DEFAULT '',
  section text NOT NULL DEFAULT '',               -- class period / block ("3rd period")
  school_year text NOT NULL DEFAULT '',
  categories jsonb NOT NULL DEFAULT '[]',         -- [{id, name, weight}]
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gb_classes_code ON gb_classes (lower(code), school_year) WHERE code <> '';
CREATE TABLE IF NOT EXISTS gb_class_teachers (
  class_id uuid NOT NULL REFERENCES gb_classes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (class_id, user_id)
);
CREATE TABLE IF NOT EXISTS gb_enrollments (
  class_id uuid NOT NULL REFERENCES gb_classes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES gb_students(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  dropped_at timestamptz,
  PRIMARY KEY (class_id, student_id)
);
CREATE TABLE IF NOT EXISTS gb_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES gb_classes(id) ON DELETE CASCADE,
  period_id uuid REFERENCES gb_periods(id) ON DELETE SET NULL,
  category text NOT NULL DEFAULT '',
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  due date,
  points numeric(8,2) NOT NULL CHECK (points > 0),
  published boolean NOT NULL DEFAULT true,       -- students and families see it
  created_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gb_assignments_class ON gb_assignments (class_id, due);
CREATE TABLE IF NOT EXISTS gb_scores (
  assignment_id uuid NOT NULL REFERENCES gb_assignments(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES gb_students(id) ON DELETE CASCADE,
  points numeric(8,2),
  status text NOT NULL DEFAULT '' CHECK (status IN ('', 'missing', 'excused', 'late')),
  comment text NOT NULL DEFAULT '',
  updated_by_name text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, student_id)
);
CREATE TABLE IF NOT EXISTS gb_score_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES gb_assignments(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES gb_students(id) ON DELETE CASCADE,
  name text NOT NULL,
  mime text NOT NULL,
  size int NOT NULL,
  data bytea NOT NULL,
  uploaded_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gb_score_files_score ON gb_score_files (assignment_id, student_id);
CREATE TABLE IF NOT EXISTS gb_period_comments (     -- report-card comment per class, student and grading period
  class_id uuid NOT NULL REFERENCES gb_classes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES gb_students(id) ON DELETE CASCADE,
  period_id uuid NOT NULL REFERENCES gb_periods(id) ON DELETE CASCADE,
  comment text NOT NULL DEFAULT '',
  updated_by_name text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (class_id, student_id, period_id)
);

-- Family accounts: students and parents / guardians. Not staff accounts: they can only reach /grades and /api/family.
CREATE TABLE IF NOT EXISTS gb_family (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('student', 'guardian')),
  name text NOT NULL,
  email text NOT NULL,
  password_hash text,
  invite_hash text,
  invite_expires timestamptz,
  active boolean NOT NULL DEFAULT true,
  last_login timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gb_family_email ON gb_family (lower(email));
CREATE TABLE IF NOT EXISTS gb_family_links (
  family_id uuid NOT NULL REFERENCES gb_family(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES gb_students(id) ON DELETE CASCADE,
  relationship text NOT NULL DEFAULT '',          -- 'self' for a student's own account
  PRIMARY KEY (family_id, student_id)
);
CREATE TABLE IF NOT EXISTS gb_family_sessions (
  token_hash text PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES gb_family(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  ip text NOT NULL DEFAULT ''
);

-- Who looked at which student's grades (staff and family). Append-only.
CREATE TABLE IF NOT EXISTS gb_view_log (
  id bigserial PRIMARY KEY,
  viewer_kind text NOT NULL,                      -- staff | student | guardian
  viewer_id uuid,
  viewer_name text NOT NULL,
  student_id uuid NOT NULL,
  what text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gb_view_log_student ON gb_view_log (student_id, at DESC);
CREATE OR REPLACE FUNCTION gb_view_log_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'The gradebook access log cannot be changed'; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS gb_view_log_no_change ON gb_view_log;
CREATE TRIGGER gb_view_log_no_change BEFORE UPDATE OR DELETE ON gb_view_log FOR EACH ROW EXECUTE FUNCTION gb_view_log_append_only();
