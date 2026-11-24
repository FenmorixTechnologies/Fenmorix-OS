-- FireWorks / CAD report uploads.
-- PIAL: the FireWorks "Alarm Processing" report (one row per incident: PSAP time, entered queue, alarm time),
-- used for 420-A-2 alarm processing when it covers the graded year.
CREATE TABLE IF NOT EXISTS pial_alarms (
  incident     text PRIMARY KEY,
  alarm_date   date NOT NULL,
  psap_at      timestamp,            -- call received at the PSAP
  queued_at    timestamp,            -- entered the dispatch queue
  alarm_at     timestamp,            -- alarm (dispatch) time
  talk_s       integer,              -- PSAP -> queue
  process_s    integer,              -- queue -> alarm ("SG Processing")
  total_s      integer,              -- PSAP -> alarm
  import_id    integer
);
CREATE INDEX IF NOT EXISTS pial_alarms_date ON pial_alarms (alarm_date);

-- Comms Statistics: incidents can come from the CAD view (source 'cad') or an uploaded CAD/FireWorks report ('upload')
ALTER TABLE cad_incidents ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'cad';
CREATE INDEX IF NOT EXISTS cad_incidents_number ON cad_incidents (incident_number) WHERE incident_number <> '';
ALTER TABLE cad_stats_sync ADD COLUMN IF NOT EXISTS file_name text NOT NULL DEFAULT '';
ALTER TABLE cad_stats_sync ADD COLUMN IF NOT EXISTS by_name text NOT NULL DEFAULT '';
