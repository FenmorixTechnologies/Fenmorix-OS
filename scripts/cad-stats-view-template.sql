/* ============================================================================
   SGFD Nexus: Communications Statistics view (CentralSquare Enterprise CAD)
   ----------------------------------------------------------------------------
   For the CAD database administrator. Run on the CAD SQL Server AFTER
   cad-view-template.sql (it reuses the same read-only login, nexus_reader).

   What Nexus reads: one row per incident, timestamps and codes only, for every
   agency SGFD Communications handles. NO caller name/phone, NO address, NO
   narrative/comments, NO patient or medical details.

   Nexus reads it once a night (and a month at a time on the first run), always
   with:  WHERE received_at >= <from> AND received_at < <to>
   so an index on the received time column keeps it light.

   Replace everything in <ANGLE BRACKETS>. The source tables/columns are
   placeholders (CentralSquare's schema varies by version). The column NAMES the
   view returns must stay exactly as written. Columns marked "optional" can be
   NULL if your CAD doesn't keep them.

   Before going live: confirm with whoever owns CJIS compliance.
   ============================================================================ */

USE [<CAD DATABASE NAME>];
GO
CREATE OR ALTER VIEW dbo.vw_nexus_call_stats
AS
SELECT
    i.<INCIDENT KEY COLUMN>             AS incident_id,          -- required, unique
    i.<INCIDENT NUMBER COLUMN>          AS incident_number,
    i.<AGENCY COLUMN>                   AS agency,               -- e.g. SGFD, BRFD, ZFD
    i.<CALL RECEIVED TIME COLUMN>       AS received_at,          -- required: call answered / incident created
    i.<ENTERED PENDING QUEUE TIME>      AS queued_at,            -- optional: when the call taker sent it to dispatch
    i.<FIRST UNIT ASSIGNED TIME>        AS assigned_at,          -- first unit dispatched/assigned
    i.<FIRST UNIT ENROUTE TIME>         AS enroute_at,           -- optional
    i.<FIRST UNIT ARRIVED TIME>         AS arrived_at,           -- optional
    i.<CLOSED TIME COLUMN>              AS closed_at,
    i.<NATURE / PROBLEM COLUMN>         AS nature,               -- e.g. MEDICAL EMS
    i.<PRIORITY COLUMN>                 AS priority,
    i.<DISPOSITION CODE COLUMN>         AS disposition,          -- e.g. CCF
    d.<DISPOSITION DESCRIPTION COLUMN>  AS disposition_description,   -- optional, e.g. 'Call Completed'
    i.<CALL TAKER ID COLUMN>            AS call_taker,           -- CAD operator id, e.g. BRFD2343
    ct.<OPERATOR NAME COLUMN>           AS call_taker_name,      -- optional
    i.<DISPATCHER ID COLUMN>            AS dispatcher,           -- CAD operator id of the dispatcher
    dp.<OPERATOR NAME COLUMN>           AS dispatcher_name,      -- optional
    i.<FIRST UNIT COLUMN>               AS first_unit,           -- optional
    CASE WHEN i.<HOW RECEIVED COLUMN> IN (<SELF-INITIATED CODES>) THEN 1 ELSE 0 END
                                        AS self_initiated,       -- unit/officer-initiated (no call taker)
    CASE WHEN i.<FIRST UNIT ASSIGNED TIME> IS NOT NULL THEN 1 ELSE 0 END
                                        AS dispatched
FROM <INCIDENT TABLE> i
LEFT JOIN <DISPOSITION CODE TABLE> d  ON d.<CODE COLUMN> = i.<DISPOSITION CODE COLUMN>
LEFT JOIN <OPERATOR TABLE> ct         ON ct.<OPERATOR ID COLUMN> = i.<CALL TAKER ID COLUMN>
LEFT JOIN <OPERATOR TABLE> dp         ON dp.<OPERATOR ID COLUMN> = i.<DISPATCHER ID COLUMN>
WHERE i.<CLOSED TIME COLUMN> IS NOT NULL                      -- closed incidents only
  AND i.<AGENCY COLUMN> IN (<AGENCIES SGFD COMMUNICATIONS HANDLES>);
GO

GRANT SELECT ON dbo.vw_nexus_call_stats TO [nexus_reader];
-- Still nothing else: no db_datareader, no other roles.
GO

-- Check it (as nexus_reader):
--   SELECT TOP 20 * FROM dbo.vw_nexus_call_stats WHERE received_at >= DATEADD(day, -1, GETDATE());
--
-- Then in the Nexus .env (the CAD_SQL_* settings are already there from Active calls):
--   CAD_STATS_VIEW=dbo.vw_nexus_call_stats
--   CAD_STATS_START=2024-01-01      (how far back to load the first time)
--   CAD_STATS_SYNC_TIME=02:15
