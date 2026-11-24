-- Communications Statistics: which calls count.
-- cad_incidents.zone = the CAD response area / zone (e.g. 1213, 1389L), from the stats view's "zone" column.
-- cad_stats_settings.include = [{agency, zone}] that count (zone "*" = every zone of that agency; empty list = every call),
-- drop_blank = leave out calls with no agency or no call type (duplicate, linked, appended and test records).
ALTER TABLE cad_incidents ADD COLUMN IF NOT EXISTS zone text NOT NULL DEFAULT '';
ALTER TABLE cad_stats_settings ADD COLUMN IF NOT EXISTS include jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE cad_stats_settings ADD COLUMN IF NOT EXISTS drop_blank boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS cad_incidents_agency_zone ON cad_incidents (agency, zone);
