-- FireWorks training category (its "Training Category List": Fire, Medical Training, Officer Training, ...),
-- kept apart from the subject (Company, Hazmat, ...) that comes with the certification
ALTER TABLE training_records ADD COLUMN IF NOT EXISTS fw_category text NOT NULL DEFAULT '';
