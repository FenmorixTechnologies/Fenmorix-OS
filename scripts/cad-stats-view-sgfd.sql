/* ============================================================================
   SGFD Nexus: Communications Statistics view, filled in for SGFD's CentralSquare
   (Inform / VisiCAD) database "System", from the table and column names in the
   Comms call-processing script (Response_Master_Incident).

   Run in SQL Server Management Studio on the CAD SQL Server, as an admin.
   Step 1 only reads column NAMES (no call data). If step 2 says
   "Invalid column name ...", send the step 1 output to Nexus support (Claude).
   ============================================================================ */

USE [System];
GO

-- STEP 1: check the column names this view uses (names only)
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
  FROM INFORMATION_SCHEMA.COLUMNS
 WHERE TABLE_NAME = 'Response_Master_Incident'
   AND (COLUMN_NAME IN ('ID', 'Master_Incident_Number', 'Jurisdiction', 'Response_Area', 'Zone', 'Response_Zone', 'ResponseArea', 'Incident_Type', 'Problem', 'Priority_Number',
                        'Response_Date', 'Time_PhonePickUp', 'Time_CallEnteredQueue', 'Time_First_Unit_Assigned',
                        'Time_First_Unit_Enroute', 'Time_First_Unit_Arrived', 'Time_CallClosed',
                        'CallTaking_Performed_By', 'Method_Of_Call_Rcvd')
        OR COLUMN_NAME LIKE '%Performed_By%' OR COLUMN_NAME LIKE 'Time[_]%')
 ORDER BY COLUMN_NAME;
GO

-- STEP 2: the view. Timestamps and codes only: no address, caller, comments/narrative or patient details.
-- (Running it again replaces the view; nothing else changes.)
-- The zone / response area (e.g. 1213, 1389L) is found by name: Response_Area, Zone, Response_Zone or ResponseArea,
-- whichever this CAD has. If none, zone comes through blank (step 1 lists the column names to send to Nexus support).
DECLARE @zone nvarchar(200) = ISNULL('rmi.' + QUOTENAME((
    SELECT TOP 1 COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_NAME = 'Response_Master_Incident' AND COLUMN_NAME IN ('Response_Area', 'Zone', 'Response_Zone', 'ResponseArea')
     ORDER BY CASE COLUMN_NAME WHEN 'Response_Area' THEN 1 WHEN 'Zone' THEN 2 WHEN 'Response_Zone' THEN 3 ELSE 4 END)),
  'CAST(NULL AS varchar(40))');
PRINT 'Zone column used: ' + @zone;
DECLARE @sql nvarchar(max) = N'
CREATE OR ALTER VIEW dbo.vw_nexus_call_stats
AS
SELECT
    rmi.ID                                   AS incident_id,
    rmi.Master_Incident_Number               AS incident_number,
    rmi.Jurisdiction                         AS agency,          -- e.g. St George FD, Baton Rouge FD
    ' + @zone + N'                           AS zone,            -- response area / zone, e.g. 1213, 1389L (Which calls count in Nexus)
    COALESCE(rmi.Time_PhonePickUp, rmi.Response_Date)
                                             AS received_at,     -- call answered / incident created
    rmi.Time_CallEnteredQueue                AS queued_at,       -- call taker sent it to dispatch
    rmi.Time_First_Unit_Assigned             AS assigned_at,     -- same pair as the Comms processing-time script
    rmi.Time_First_Unit_Enroute              AS enroute_at,
    rmi.Time_First_Unit_Arrived              AS arrived_at,
    rmi.Time_CallClosed                      AS closed_at,
    rmi.Incident_Type                        AS nature,
    rmi.Priority_Number                      AS priority,
    NULLIF(rmi.CallTaking_Performed_By, '''')  AS call_taker,
    CAST(NULL AS varchar(80))                AS call_taker_name,
    ac.Performed_By                          AS dispatcher,      -- whoever made the "Automatic case number" entry
    CAST(NULL AS varchar(80))                AS dispatcher_name,
    CAST(NULL AS varchar(20))                AS first_unit,
    CASE WHEN rmi.Time_PhonePickUp IS NULL THEN 1 ELSE 0 END
                                             AS self_initiated,  -- no phone pickup = unit/officer-initiated
    CASE WHEN rmi.Time_First_Unit_Assigned IS NOT NULL THEN 1 ELSE 0 END
                                             AS dispatched
FROM dbo.Response_Master_Incident rmi
OUTER APPLY (SELECT TOP 1 rc.Performed_By                     -- only the person; the comment text is never read out
               FROM dbo.Response_Comments rc
              WHERE rc.Master_Incident_ID = rmi.ID
                AND rc.Comment LIKE ''%Automatic case number%''
              ORDER BY rc.Date_Time) ac
WHERE rmi.Time_CallClosed IS NOT NULL;                         -- closed incidents only
';
EXEC sp_executesql @sql;
GO

-- STEP 3: let the Nexus login read this view (and nothing else)
GRANT SELECT ON dbo.vw_nexus_call_stats TO [sgfdnexus];
GO

-- STEP 4: check it, signed in as sgfdnexus
--   SELECT TOP 20 * FROM dbo.vw_nexus_call_stats WHERE received_at >= DATEADD(day, -1, GETDATE());
--   SELECT agency, zone, COUNT(*) AS calls FROM dbo.vw_nexus_call_stats
--    WHERE received_at >= DATEADD(day, -30, GETDATE()) GROUP BY agency, zone ORDER BY agency, zone;
-- Then in Nexus: Comms Statistics > Data & settings > "Reload all since ..." (fills in the zone on older calls),
-- then "Which calls count".
