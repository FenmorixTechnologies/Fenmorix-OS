-- Comms Statistics no longer uses call dispositions (Communications, 11/2026): clear what was pulled before.
UPDATE cad_incidents SET disposition = '' WHERE disposition <> '';
DELETE FROM cad_dispositions;
