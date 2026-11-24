/* ============================================================================
   SGFD Nexus: Active calls view for SGFD's CentralSquare (Inform / VisiCAD)
   database "System". Replaces dbo.vw_nexus_active_calls.

   Shows every open call on the CAD (all agencies) that is really active:
     - any call with units still on it (up to 7 days, so a long major incident stays), and
     - a call waiting for units that has a location, for up to 4 hours.
   CAD's leftover records (no location, no units, never closed) are left out.
   For each call:
     problem nature, agency, priority, address, city, cross streets, map point,
     and each unit still on the call with its own status:
       Dispatched -> Enroute -> On scene -> Patient contact
   Nexus shows the call's status as the furthest along of its units.
   Nothing about the caller, comments/narrative or patient details.

   Run in SQL Server Management Studio on the CAD SQL Server, as an admin, one
   step at a time. CentralSquare column names differ a little between versions,
   so step 2 looks up which names this CAD has and builds the view from them
   (it prints what it picked). Running it again replaces the view.
   ============================================================================ */

USE [System];
GO

-- STEP 1 (optional, names only, no call data): the columns step 2 can choose from
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
  FROM INFORMATION_SCHEMA.COLUMNS
 WHERE (TABLE_NAME = 'Response_Master_Incident'
        AND (COLUMN_NAME IN ('ID', 'Master_Incident_Number', 'Jurisdiction', 'Problem', 'Incident_Type', 'Priority_Number',
                             'Priority_Description', 'Response_Date', 'Time_PhonePickUp', 'Time_First_Unit_Assigned', 'Time_CallClosed')
             OR COLUMN_NAME LIKE '%Address%' OR COLUMN_NAME LIKE '%City%' OR COLUMN_NAME LIKE '%Cross%'
             OR COLUMN_NAME LIKE '%itude%' OR COLUMN_NAME LIKE 'Location%'))
    OR (TABLE_NAME = 'Response_Vehicles_Assigned' AND (COLUMN_NAME LIKE 'Time[_]%' OR COLUMN_NAME IN ('Radio_Name', 'Master_Incident_ID')))
 ORDER BY TABLE_NAME, COLUMN_NAME;
GO

-- STEP 2: build the view from the column names this CAD has
DECLARE @pick TABLE (field sysname, tbl sysname, ord int, name sysname);
INSERT @pick VALUES
  ('nature',   'Response_Master_Incident', 1, 'Problem'),           ('nature',   'Response_Master_Incident', 2, 'Incident_Type'),
  ('priority', 'Response_Master_Incident', 1, 'Priority_Number'),   ('priority', 'Response_Master_Incident', 2, 'Priority_Description'),
  ('address',  'Response_Master_Incident', 1, 'Address'),           ('address',  'Response_Master_Incident', 2, 'Location'),
  ('address',  'Response_Master_Incident', 3, 'Street_Address'),
  ('city',     'Response_Master_Incident', 1, 'City'),              ('city',     'Response_Master_Incident', 2, 'Municipality'),
  ('cross',    'Response_Master_Incident', 1, 'Cross_Street'),      ('cross',    'Response_Master_Incident', 2, 'CrossStreet'),
  ('cross',    'Response_Master_Incident', 3, 'Cross_Streets'),     ('cross',    'Response_Master_Incident', 4, 'Cross_Street_Name'),
  ('lat',      'Response_Master_Incident', 1, 'Latitude'),          ('lat',      'Response_Master_Incident', 2, 'Lat'),
  ('lon',      'Response_Master_Incident', 1, 'Longitude'),         ('lon',      'Response_Master_Incident', 2, 'Lon'),
  ('patient',  'Response_Vehicles_Assigned', 1, 'Time_Patient_Contact'), ('patient', 'Response_Vehicles_Assigned', 2, 'Time_PatientContact'),
  ('patient',  'Response_Vehicles_Assigned', 3, 'Time_Contact'),    ('patient',  'Response_Vehicles_Assigned', 4, 'Time_At_Patient'),
  ('patient',  'Response_Vehicles_Assigned', 5, 'Time_AtPatient');

DECLARE @f TABLE (field sysname PRIMARY KEY, col sysname NULL);
INSERT @f SELECT field, (SELECT TOP 1 c.COLUMN_NAME FROM @pick p2 JOIN INFORMATION_SCHEMA.COLUMNS c ON c.TABLE_NAME = p2.tbl AND c.COLUMN_NAME = p2.name
                          WHERE p2.field = p.field ORDER BY p2.ord)
  FROM (SELECT DISTINCT field FROM @pick) p;
-- Patient contact under another name: any unit time column that mentions Patient or Contact
UPDATE @f SET col = (SELECT TOP 1 COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Response_Vehicles_Assigned'
                      AND COLUMN_NAME LIKE 'Time[_]%' AND (COLUMN_NAME LIKE '%Patient%' OR COLUMN_NAME LIKE '%Contact%') ORDER BY COLUMN_NAME)
 WHERE field = 'patient' AND col IS NULL;

DECLARE @nature nvarchar(200), @priority nvarchar(200), @address nvarchar(200), @city nvarchar(200), @cross nvarchar(200),
        @lat nvarchar(200), @lon nvarchar(200), @patient nvarchar(200);
SELECT @nature   = ISNULL('rmi.' + QUOTENAME((SELECT col FROM @f WHERE field = 'nature')),   'CAST(NULL AS nvarchar(80))'),
       @priority = ISNULL('rmi.' + QUOTENAME((SELECT col FROM @f WHERE field = 'priority')), 'CAST(NULL AS nvarchar(20))'),
       @address  = ISNULL('rmi.' + QUOTENAME((SELECT col FROM @f WHERE field = 'address')),  'CAST(NULL AS nvarchar(200))'),
       @city     = ISNULL('rmi.' + QUOTENAME((SELECT col FROM @f WHERE field = 'city')),     'CAST(NULL AS nvarchar(60))'),
       @cross    = ISNULL('rmi.' + QUOTENAME((SELECT col FROM @f WHERE field = 'cross')),    'CAST(NULL AS nvarchar(120))'),
       @lat      = ISNULL('rmi.' + QUOTENAME((SELECT col FROM @f WHERE field = 'lat')),      'CAST(NULL AS float)'),
       @lon      = ISNULL('rmi.' + QUOTENAME((SELECT col FROM @f WHERE field = 'lon')),      'CAST(NULL AS float)'),
       @patient  = ISNULL('rva.' + QUOTENAME((SELECT col FROM @f WHERE field = 'patient')),  'CAST(NULL AS datetime)');

SELECT field AS [Nexus field], ISNULL(col, '(not found: left empty)') AS [CAD column used] FROM @f ORDER BY field;

DECLARE @sql nvarchar(max) = N'
CREATE OR ALTER VIEW dbo.vw_nexus_active_calls
AS
SELECT
    rmi.ID                                   AS incident_id,
    rmi.Master_Incident_Number               AS incident_number,
    rmi.Jurisdiction                         AS agency,
    ' + @nature + N'                         AS call_type,        -- problem nature
    ' + @priority + N'                       AS priority,
    ' + @address + N'                        AS address,
    ' + @city + N'                           AS city,
    ' + @cross + N'                          AS cross_streets,
    ' + @lat + N'                            AS latitude,         -- Nexus converts CAD''s millionths
    ' + @lon + N'                            AS longitude,
    -- every unit still on the call with its own status, e.g. ''EG613:On scene, MD687:Patient contact''
    STUFF((SELECT '', '' + rva.Radio_Name + '':'' +
                  CASE WHEN ' + @patient + N' IS NOT NULL THEN ''Patient contact''
                       WHEN rva.Time_ArrivedAtScene IS NOT NULL THEN ''On scene''
                       WHEN rva.Time_Enroute IS NOT NULL THEN ''Enroute''
                       ELSE ''Dispatched'' END
             FROM dbo.Response_Vehicles_Assigned rva
            WHERE rva.Master_Incident_ID = rmi.ID
              AND rva.Time_Call_Cleared IS NULL
            ORDER BY rva.Time_Assigned
            FOR XML PATH(''''), TYPE).value(''.'', ''nvarchar(max)''), 1, 2, '''')
                                             AS units,
    COALESCE(rmi.Time_PhonePickUp, rmi.Response_Date) AS received_at,
    rmi.Time_First_Unit_Assigned             AS dispatched_at,
    rmi.Time_CallClosed                      AS closed_at         -- NULL while active
FROM dbo.Response_Master_Incident rmi
WHERE rmi.Time_CallClosed IS NULL                              -- every agency
  AND (   -- a call with units still on it (up to 7 days, for a long major incident)
          (rmi.Response_Date > DATEADD(day, -7, GETDATE())
           AND EXISTS (SELECT 1 FROM dbo.Response_Vehicles_Assigned v
                        WHERE v.Master_Incident_ID = rmi.ID AND v.Time_Call_Cleared IS NULL))
       OR -- or a call waiting for units: it needs a location, and drops off after 4 hours with nobody assigned
          (rmi.Response_Date > DATEADD(hour, -4, GETDATE())
           AND (NULLIF(LTRIM(RTRIM(CAST(' + @address + N' AS nvarchar(400)))), '''') IS NOT NULL
                OR ISNULL(TRY_CAST(' + @lat + N' AS float), 0) <> 0)));
';
EXEC sp_executesql @sql;
PRINT 'dbo.vw_nexus_active_calls created.';
GO

-- STEP 3: let the Nexus login read it (and nothing else). Running it again does no harm.
GRANT SELECT ON dbo.vw_nexus_active_calls TO [sgfdnexus];
GO

-- STEP 4: check it, signed in as sgfdnexus. Compare with the open calls on a CAD screen right now:
--   SELECT incident_number, agency, call_type, units, received_at FROM dbo.vw_nexus_active_calls ORDER BY received_at DESC;
-- Then restart Nexus (running update.ps1 does it) so it re-reads the view's columns, and press "Feed check" on Active calls.
