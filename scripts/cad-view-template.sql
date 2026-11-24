/* ============================================================================
   SGFD Nexus: read-only access to active calls in CentralSquare Enterprise CAD
   ----------------------------------------------------------------------------
   For the CAD database administrator. Run on the CAD SQL Server.

   What this does:
     1. Creates a SQL login that can do nothing except read ONE view.
     2. Creates that view with only station-alert-level fields
        (call type, address, units, status, times). No caller name or phone,
        no narrative/comments, no patient or medical details.

   Replace everything in <ANGLE BRACKETS>. The source tables and column names
   below are placeholders: CentralSquare's schema varies by version, so the CAD
   admin (or CentralSquare support) fills in the real ones. The column NAMES the
   view returns must stay exactly as written (the app reads them by name).

   Before going live: confirm with whoever owns CJIS compliance that showing
   these fields to signed-in district staff is approved.
   ============================================================================ */

-- 1) Login (server level) ------------------------------------------------------
USE [master];
GO
CREATE LOGIN [nexus_reader]
  WITH PASSWORD = N'<LONG RANDOM PASSWORD - put it only in the Nexus .env file>',
       CHECK_POLICY = ON, CHECK_EXPIRATION = OFF,
       DEFAULT_DATABASE = [<CAD DATABASE NAME>];
GO

-- 2) The view ------------------------------------------------------------------
USE [<CAD DATABASE NAME>];
GO
CREATE OR ALTER VIEW dbo.vw_nexus_active_calls
AS
SELECT
    i.<INCIDENT KEY COLUMN>            AS incident_id,      -- required, unique
    i.<INCIDENT NUMBER COLUMN>         AS incident_number,
    i.<CALL TYPE / NATURE COLUMN>      AS call_type,
    i.<PRIORITY COLUMN>                AS priority,
    i.<STREET ADDRESS COLUMN>          AS address,
    i.<CITY COLUMN>                    AS city,
    i.<CROSS STREETS COLUMN>           AS cross_streets,    -- or NULL
    i.<LATITUDE COLUMN>                AS latitude,         -- decimal degrees, or NULL
    i.<LONGITUDE COLUMN>               AS longitude,
    i.<STATUS COLUMN>                  AS status,           -- e.g. DISPATCHED / ENROUTE / ON SCENE
    -- All units on the call as one comma-separated string, e.g. 'E61, M61, BC1'
    STUFF((SELECT ', ' + u.<UNIT ID COLUMN>
             FROM <UNIT ASSIGNMENT TABLE> u
            WHERE u.<INCIDENT KEY COLUMN> = i.<INCIDENT KEY COLUMN>
              AND u.<CLEARED TIME COLUMN> IS NULL           -- only units still assigned
            ORDER BY u.<DISPATCH TIME COLUMN>
            FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, '')
                                       AS units,
    i.<CALL RECEIVED TIME COLUMN>      AS received_at,
    i.<FIRST DISPATCH TIME COLUMN>     AS dispatched_at,
    i.<CLOSED TIME COLUMN>             AS closed_at         -- NULL while active
FROM <INCIDENT TABLE> i
WHERE i.<CLOSED TIME COLUMN> IS NULL                        -- active calls only
  AND i.<AGENCY COLUMN> = '<OUR AGENCY CODE>'               -- St. George Fire only
  AND i.<CALL RECEIVED TIME COLUMN> > DATEADD(hour, -24, GETDATE());  -- ignore stale/never-closed calls
GO

-- 3) Permissions: this view and nothing else ------------------------------------
CREATE USER [nexus_reader] FOR LOGIN [nexus_reader];
GRANT SELECT ON dbo.vw_nexus_active_calls TO [nexus_reader];
-- Do NOT add nexus_reader to db_datareader or any other role.
GO

-- 4) Check it (run as nexus_reader) ---------------------------------------------
--   SELECT TOP 20 * FROM dbo.vw_nexus_active_calls;      -- should work
--   SELECT TOP 1 * FROM <INCIDENT TABLE>;                -- should be DENIED

/* ----------------------------------------------------------------------------
   Network (on the CAD SQL Server, PowerShell as administrator): allow SQL only
   from the Nexus server's IP address.

   New-NetFirewallRule -DisplayName "SQL 1433 from SGFD Nexus" -Direction Inbound `
     -Protocol TCP -LocalPort 1433 -RemoteAddress <NEXUS SERVER IP> -Action Allow

   Encryption: Nexus connects with encryption on. If the SQL Server uses its own
   self-signed certificate, set CAD_SQL_TRUST_CERT=true in the Nexus .env (or,
   better, give SQL Server a certificate from your internal CA).

   Nexus .env:
     CAD_SQL_SERVER=<CAD SQL SERVER NAME OR IP>
     CAD_SQL_PORT=1433
     CAD_SQL_DATABASE=<CAD DATABASE NAME>
     CAD_SQL_USER=nexus_reader
     CAD_SQL_PASSWORD=<the password from step 1>
     CAD_SQL_VIEW=dbo.vw_nexus_active_calls
   ---------------------------------------------------------------------------- */
