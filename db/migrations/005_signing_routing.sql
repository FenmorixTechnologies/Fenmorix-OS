-- Approvers can sign for divisions beyond their own, and each pending
-- requisition can be sent to a specific next signer.

CREATE TABLE user_sign_divisions (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  division_id int  NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, division_id)
);

-- Who the current stage was sent to (others who are eligible can still sign)
ALTER TABLE requisitions
  ADD COLUMN next_signer_id uuid REFERENCES users(id);
CREATE INDEX requisitions_next_signer_idx ON requisitions (next_signer_id);
