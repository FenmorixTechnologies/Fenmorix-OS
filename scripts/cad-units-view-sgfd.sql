/* ============================================================================
   SGFD Nexus: units on each call, for Comms Statistics > Apparatus
   (calls each unit ran per shift / date range, arrivals, time committed).
   For SGFD's CentralSquare (Inform / VisiCAD) database "System".

   Run in SQL Server Management Studio on the CAD SQL Server, as an admin, one
   step at a time. Step 1 only reads table and column NAMES (no call data).
   If step 2 says "Invalid object name" or "Invalid column name ...", send the
   step 1 output to Nexus support (Claude) and the names will be corrected.
   ============================================================================ */

USE [System];
GO

-- STEP 1: where CAD keeps unit assignments (names only)
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
  FROM INFORMATION_SCHEMA.COLUMNS
 WHERE TABLE_NAME LIKE 'Response[_]Vehicle%'
   AND (COLUMN_NAME LIKE 'Time[_]%' OR COLUMN_NAME LIKE '%Radio%' OR COLUMN_NAME LIKE '%Unit%'
        OR COLUMN_NAME LIKE '%Vehicle%' OR COLUMN_NAME LIKE '%Master_Incident%')
 ORDER BY TABLE_NAME, COLUMN_NAME;
GO

-- STEP 2: one row per unit assigned to a call. Unit, times and the call's number/type only.
CREATE OR ALTER VIEW dbo.vw_nexus_unit_responses
AS
SELECT
    rva.Master_Incident_ID          AS incident_id,      -- same id as vw_nexus_call_stats.incident_id
    rmi.Master_Incident_Number      AS incident_number,
    rmi.Jurisdiction                AS agency,
    rmi.Incident_Type               AS nature,
    rva.Radio_Name                  AS unit,             -- e.g. EG613
    rva.Time_Assigned               AS assigned_at,
    rva.Time_Enroute                AS enroute_at,
    rva.Time_ArrivedAtScene         AS arrived_at,
    rva.Time_Call_Cleared           AS cleared_at
FROM dbo.Response_Vehicles_Assigned rva
JOIN dbo.Response_Master_Incident rmi ON rmi.ID = rva.Master_Incident_ID
WHERE rva.Time_Assigned IS NOT NULL;
GO

-- STEP 3: let the Nexus login read it (and nothing else)
GRANT SELECT ON dbo.vw_nexus_unit_responses TO [sgfdnexus];
GO

-- STEP 4: check it, signed in as sgfdnexus
--   SELECT TOP 20 * FROM dbo.vw_nexus_unit_responses WHERE assigned_at >= DATEADD(day, -1, GETDATE());
-- Then in the Nexus .env add:   CAD_STATS_UNITS_VIEW=dbo.vw_nexus_unit_responses
-- restart Nexus (or run update.ps1), and press "Reload all since ..." in Comms Statistics > Data & settings.
