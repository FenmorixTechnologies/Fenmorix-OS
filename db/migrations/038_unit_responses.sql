-- Comms Statistics: one row per unit assigned to an incident (from CAD_STATS_UNITS_VIEW), for the Apparatus report:
-- calls per unit per shift (07:00 to 07:00), arrivals and time committed. Times are CAD wall-clock, like cad_incidents.
CREATE TABLE IF NOT EXISTS cad_unit_responses (
  incident_id     text NOT NULL,
  unit            text NOT NULL,
  assigned_at     timestamp NOT NULL,
  enroute_at      timestamp,
  arrived_at      timestamp,
  cleared_at      timestamp,
  incident_number text NOT NULL DEFAULT '',
  agency          text NOT NULL DEFAULT '',
  nature          text NOT NULL DEFAULT '',
  synced_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (incident_id, unit, assigned_at)
);
CREATE INDEX IF NOT EXISTS cad_unit_responses_assigned_idx ON cad_unit_responses (assigned_at);
CREATE INDEX IF NOT EXISTS cad_unit_responses_unit_idx ON cad_unit_responses (unit, assigned_at);
