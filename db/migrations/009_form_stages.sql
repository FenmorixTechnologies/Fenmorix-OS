-- Progress steps on submitted forms (e.g. a uniform order: Ordered -> Ready for pickup -> Picked up).
-- The steps are listed in the form's settings.stages; stage_seen is false when the person
-- who submitted it hasn't looked since a step that notifies them was set.
ALTER TABLE form_submissions
  ADD COLUMN stage         text,
  ADD COLUMN stage_at      timestamptz,
  ADD COLUMN stage_by      uuid REFERENCES users(id),
  ADD COLUMN stage_by_name text,
  ADD COLUMN stage_note    text,
  ADD COLUMN stage_seen    boolean NOT NULL DEFAULT true;

-- Files attached to form answers (photos, documents). Uploaded first, then linked
-- to the submission when the form is sent; unlinked uploads older than a day are removed.
CREATE TABLE form_files (
  id            uuid PRIMARY KEY,
  uploaded_by   uuid NOT NULL REFERENCES users(id),
  submission_id uuid REFERENCES form_submissions(id) ON DELETE CASCADE,
  name          text NOT NULL,
  mime          text NOT NULL,
  size          integer NOT NULL,
  data          bytea NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX form_files_submission ON form_files (submission_id);
