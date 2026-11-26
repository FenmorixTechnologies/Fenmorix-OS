# Notes for Claude Code

Fenmorix OS (Fenmorix Technologies, LLC) — and SGFD Nexus, St. George Fire Protection District's own install of it. Started as a
single-file Claude artifact for St. George, moved to a real app: Postgres-backed, real accounts.

## Where things are (11/2026)
- Master copy: GitHub `FenmorixTechnologies/Fenmorix-OS` (private). Working copy in the build workspace: /home/claude/fenmorix-os
  (old paths /home/claude/sgfd-app, /home/claude/testrun and /home/claude/license-manager are links to it, its tests/ and tools/license-manager).
- `tests/` = the old testrun folder (e2e*.mjs, build.sh, run-*.sh, shims, stubs, small fixtures). Its `app/` (a built copy with node_modules),
  sysroot*/, screenshots and generated data are git-ignored; generated data comes back from make-stats-data.mjs /
  scripts/sandbox/make-demo-stats.mjs. tests/keys/*.lic are test licenses signed with the dev key; dev-private.pem is NOT in git.
- Customer downloads: `node packaging/build-package.mjs all` -> /home/claude/dist (see "Customer packages"). Never send a -TEST zip.

## Architecture
- `src/App.jsx` is the original artifact (~4,800 lines, all modules in one file).
  It still calls `window.storage.get/set/delete` and saves whole arrays per key.
- `src/storage.js` implements `window.storage`. Shared keys go to
  `/api/collections/<key>`; it diffs each save against the last loaded value and
  sends only `{ upserts, deletes }`. `<prefix>-file:<id>` keys go to `/api/files/<id>`
  as data URLs. `current-identity` returns the signed-in account; setting it to ""
  (the app's "Sign out") logs out. Mutating requests carry `X-SGFD: 1` (CSRF guard).
- Auth (`server/auth.js`, `src/AuthGate.jsx`): email + scrypt password, HttpOnly
  session cookie (hashed in `sessions`), self sign-up -> pending -> master approves
  with role/division. First-run setup is localhost-only and takes over an existing
  master. Temp passwords force a change at next sign-in.
- The server derives the actor from the session; `server/collections.js` enforces
  role rules (signature stages, paid, roster/settings master-only, private emergency
  contacts, audit log master-only).
- `server/collections.js` maps each key (roster, divisions, categories,
  mileage-rate, vendors, requisitions, contracts, certifications, gear,
  reimbursements, tickets, meetings, announcements, audit-log) to tables in
  `db/schema.sql`. Updates only touch rows whose values changed, so unchanged
  locked records never trip the triggers.
- `server/index.js` is plain `node:http` (no Express). Dev mode mounts Vite as
  middleware; `--production` serves `dist/`.

## Requisition dates, paper signatures, quotes (migration 003)
- `requisitions.req_date` (calendar date) is the app's `createdAt`, sent as
  "YYYY-MM-DDT12:00:00" (no zone) so it never shifts a day; `created_at` = entry time.
- Signatures with `recorded: true` from master/accounting store the named signer and
  date plus `recorded_by`. Date corrections set `sgfd.date_correction` for the
  transaction; triggers then allow only req_date/paid_at/signed_at to change, and the
  server writes an audit row with old -> new.
- `quotes` (+ `quote_attachments`); `requisitions.quote_id` links a requisition to its
  quote; `repeated_from` records the requisition it was copied from.

## Signing divisions and routing (migration 005)
- `user_sign_divisions` lists extra divisions an approver covers. `covers()` /
  `eligibleSigner()` in collections.js decide who can sign each stage; the client mirrors
  this with `coversDivision`/`signersFor`/`canSignStage` in App.jsx.
- `requisitions.next_signer_id` = who the current stage was sent to (optional; others who
  are eligible can still sign). It's validated against the stage, reset on each status
  change to the signer's chosen next person (or null), and null once finalized.
- The main-menu "Your Day" panel (`src/YourDay.jsx`) and the "Waiting for me" filter use
  `isWaitingOnMe` / `waitingSummary`. `useListView` accepts `initialFilters`, used when a
  Your Day button opens Help Desk (assignee) or Reimbursements (status) pre-filtered.

## Lists
- Every list uses `useListView(items, { search, sorts, filters, resetKey })` plus
  `<ListControls view>` and `<Pager view>` from `src/ListControls.jsx`. Hooks must run
  before a module's early returns (`if (!loaded)` / `if (!me)`). Rows per page is kept in
  localStorage (`sgfd-rows-per-page`).

## Time Tracker, Call-Out Schedule, permissions (migration 006)
- `user_permissions` (time_view, callout_edit; division_id NULL = all). Roster read returns
  `permissions: { timeView: [...], calloutEdit: [...] }` ("*" = all); master roster saves set them.
- `time-entries` collection: read filtered server-side (own; master; time_view scope);
  only the owner can upsert/delete; hours recomputed server-side from HH:MM in/out.
- `callouts` collection: readable by all; edit if master, same home division, or callout_edit.
- New screens live in their own files and import shared styles/helpers from App.jsx's
  export block (only inside components, because of the circular import).
- Rotations and pay periods: `src/shifts.js`.

## Working Fire Recordings (migration 007)
- `server/recordings.js` handles `/api/recordings/*` directly (not a collection): raw-body
  import of NICE `.distribution` files (a ZIP: `Index.xml`, `Original Data/*.incident` XML
  with one `<IncidentSearchResults>` per transmission, `Reconstruction Content/Audio_<id>.wav`
  8 kHz PCM). Built-in ZIP reader (zlib) with size/entry caps; file names validated.
- Stored at `UPLOAD_DIR/recordings/<id>/original.distribution` + `clips/<itemId>.wav`
  (each clip peak-normalized, max 8x). Audio responses are `Cache-Control: no-store`.
- Access: master or `user_permissions.permission = 'recordings'` (roster `permissions.recordings`).
  Edit: importer or master. Delete and department list: master.

## Forms, cases, personnel file (migration 008)
- `server/forms.js` handles `/api/forms/*` (not a collection). Definitions are JSON
  (`fields`, `settings`) edited by the builder; seeds in `server/formSeeds.js` are inserted
  once by key at startup (`seedForms`). Submissions store a snapshot of the fields.
- Access: full = master, `form_viewers` (form key or '*'), the form's `settings.recipients`, or
  full access to the form that opened the submission's case. Limited (sensitive masked) =
  subject (if `subjectCanView`), submitter, approvers. Anonymous: `submitted_by` NULL,
  audit actor "Anonymous".
- Sensitive answers (type ssn or `sensitive`) are AES-256-GCM encrypted in `secret` with the
  key from FORMS_KEY / FORMS_KEY_FILE (default `secrets/forms.key`, auto-created).
- Cases: `settings.case` on the opening form (`summary` field map, `followUps` with assign =
  `field:<key>` | `subject` | `users`). Tasks in `form_tasks`. Prefill `case:*` and
  `case:initial.<key>` come from `/api/forms/tasks/:id` (initial only with full access).
- `settings.pdf` = template in `server/pdf-templates` + field map; `/submissions/:id/pdf`
  fills it with pdf-lib (dependency) and flattens.
- Profile columns on users (employee_number, job_title, hire_date, station, street/city/state/zip);
  roster returns job title/station to all, the rest only to self/master (`saveProfile`).

## Database rules (enforced by triggers in db/schema.sql and migrations)
- Requisitions/reimbursements lock at approved/paid/rejected; approved -> paid only.
- Requisition status moves require the matching `requisition_signatures` row first.
- Imports of already-finalized records set `sgfd.importing = 'on'` for the transaction.
- `audit_log` is append-only. Users are deactivated, never deleted.

## Next phases
- Split App.jsx into modules and replace whole-array saves with per-record API calls.
- HTTPS certificate from IT (temporary self-signed until then). Dedicated server setup: see below.
- Optional: Microsoft 365 sign-in alongside app accounts.

## Form progress, limits, files, JotForm batch (migration 009)
- `settings.stages` = [{label, notify, done}]: handlers (full access) set a submission's step via
  `POST /submissions/:id/stage` {stage, note}. A notify step sets `stage_seen = false`; the submitter/subject
  sees it in inbox `updates` (Forms "Waiting for me" + Your Day) until they open it. Forms with steps stay in
  recipients' `toReview` until a `done` step (or the last step), instead of "Mark reviewed".
- `settings.limits` = [{label, max, count: [{field, option, qty}]}]: yearly counts per subject from
  `GET /limits/:key` (server `countLimit`, mirrored in Forms.jsx). Warn only; never blocks.
- Field type `file`: uploads go to `POST /api/forms/files` {name, dataUrl} (10 MB, stored in `form_files`
  as bytea, sent as hex text), linked to the submission on submit (only the uploader's unlinked files);
  `GET /api/forms/files/:id` checks submission access.
- `showIf.any` = list of values (any match). Visibility cascades: `visibleValues()` on the client and
  `visible(f, data so far)` in `validate` drop answers under hidden questions.
- `server/formSeeds2.js` (`MORE_FORM_SEEDS`): the forms carried over from JotForm.
- Inbox `mine` items carry `open` / `reviewed` / `noHandler` (Your Day "Your forms" card). Masters get
  submissions of step forms with no recipients in `toReview` (`unassigned: true`). Forms has a
  "Submissions" tab (GET /submissions, filtered by access) for anyone with full access to some form.

## Layout: AppShell (every screen)
- `src/AppShell.jsx` is the frame for every section: dark side bar (small logo, "St. George Fire /
  <section>", Main menu, the section's nav with badges and group headings, signed-in footer with
  Change password / Sign out / pending account requests), page on the right. Under 860px it becomes a
  top bar with a menu button and a slide-out drawer.
- Each module builds `shellNav` [{ key, label, icon, badge, group }], `shellActive` and `shellGo` from its
  own state (tabs, list filters via `listView.setFilter`, or views like "new"/"add") just before its main
  return, and renders `<AppShell section=... nav={shellNav} active={shellActive} onNav={shellGo} onHome={onBack}>`.
- `src/session.js` (SessionContext) carries the signed-in user, pendingCount, changePassword and signOut
  from AuthGate; the old corner account bar is gone.
- Main page (SplashScreen) = AppShell with every section in the side bar (badges from `tileBadges`),
  the announcement ticker and the Your Day widgets (YourDay.jsx: Widget, Ring, Stat, ShiftChip).
- Nav buttons are real <button>s (aria-current="page"); tests click them by role/name.

## Directory, delegated admins, Aladtec (migration 010)
- `user_permissions` adds whole-department `directory_admin`, `forms_admin`, `accounts_admin`
  (roster `permissions.directoryAdmin/formsAdmin/accountsAdmin`, set by masters only). `hasPerm(c, user, p)`
  in collections.js (masters always true). auth.js: accounts admins list/approve/reject/reset, never to or of
  masters. forms.js: `acc.formsAdmin` may edit definitions; `/access` (see-all grants) stays master-only.
- users: `home_phone`, `extension`, `emergency_contact_relationship` (phone = cell). Private fields
  (home phone, emergency) go to self, masters, directory admins (roster and directory API).
- `server/directory.js` (`/api/directory/*`): GET everything; POST people/:id (self or admin; counts as
  confirming during a check); places (station|facility|outside) CRUD for admins; favorites; verification
  start/confirm/close/stamp/status; `check` for Your Day; `aladtec` status/refresh.
- `server/aladtec.js`: OAuth client credentials, `/schedules` hourly, `/members` every 6 h (paged),
  `/scheduled-time/members-scheduled-now`; checks at ALADTEC_REFRESH_TIMES (07:00,19:00) + every ALADTEC_REFRESH_HOURS (3)
  from the first, ALADTEC_REFRESH_DELAY_SECONDS (60) after the mark (`nextRefresh`, setTimeout chain); ALADTEC_REFRESH_MINUTES
  set = old fixed interval (min 30). Every request counted per day (`countCall`); stops at ALADTEC_DAILY_CAP (500, max 2400);
  "Check now" (`refreshNow`) at most once per 2 min. Measured: 42 requests/day for scheduled checks (+ ~8 per restart). `onDuty()` = `live(snapshot)`: onNow and `assignments` recomputed from `today` at read time.
  In-memory snapshot. Stations
  match assignments by `aladtec_match` (comma-separated whole words in schedule/position names);
  the same rule is mirrored in Directory.jsx `matchStation`.
- Aladtec v2 (token/expires) and v3 (access_token/expires_in) both supported; ids compared as strings (`key()`);
  assignments sorted by schedule `order`, then position `order`. Match words support `?` (one letter/digit) and `*`.
  SGFD units are <type><station><digit> (EG613, LD618, MD687); migration 012 sets untouched station matches to `??NN*`.
- Today's shift: each refresh also GETs `/scheduled-time` (range = ALADTEC_SHIFT_START 07:00 -> +24 h, include_time_types,
  daily_split_time) and `/time-off`; flattened (date-keyed, data-wrapped or time_records) into snapshot `today`
  (start/stop HH:MM, onNow, trade = time type contains "trade") and `timeOff`. Failures land in todayError/timeOffError.
- `src/DutyBoard.jsx` (own colors; no App.jsx import): cards for Chiefs (`SG*`), each station, each other schedule
  (split into "<name> Days"/"Nights" when it has both day and 17:00-05:00 starts), Trades, Time Off. Used on Aladtec
  setup and, `compact`, in the Your Day "On duty today" widget (YourDay.jsx `OnDutyWidget`, scrollable, 5-min poll)
  via `GET /api/directory/duty` (any user; leave types and errors only for directory/master admins).
- `src/Directory.jsx`: AppShell nav (My card, Favorites, Everyone, divisions, Fire stations, Facilities,
  Outside contacts, admin: Directory check, Aladtec setup), PersonCard/PlaceCard, editors in a dialog,
  print, vCard download.

## Notifications, sessions, security headers (migration 011)
- Your Day (`useYourDay`) reloads every 60 s with `setBackground(true)` (storage.js adds
  `X-SGFD-Background: 1`); `notifyCounts(d)` rising in any category plays `chime()` (src/chime.js, Web Audio,
  unlocked on first click; `sgfd-sound` in localStorage) and fires a `sgfd-chime` event; tab title shows the total.
- sessions: `last_seen_at`, `ip`. `getSessionUser` deletes sessions idle > SESSION_IDLE_MINUTES (60) and
  touches last_seen (not for background requests, at most every 30 s). auth actions: `sessions`,
  `end-session`, `end-other-sessions` ({everyone} for masters). UI: src/Sessions.jsx from the AppShell footer.
- Production HTML gets a CSP (self only; inline styles allowed; data:/blob: images), Permissions-Policy,
  and HSTS when HTTPS is on (index.js `PAGE_HEADERS`).
- `scripts/backup.ps1`: pg_dump -Fc every run + uploads zip at most once per 20 h; keeps all from the last 2 days, then the last
  of each day to -KeepDays (30). `-Register` = nightly 2:15 task; `-Register -EveryHours N` = repeat every N hours from 2:15.

## Branding: SGFD Nexus
- Name "SGFD Nexus" (tab title, side bar label, sign-in). Sign-in `Shell` in AuthGate.jsx: navy gradient + dot "network"
  texture + red glow, `<NexusBrand size="splash">` (src/Brand.jsx) left, card right (stacked under 860px). The splash emblem is
  three layers (nexus-hero-art / -bolts / -ring.png, 640 px, made from Michael's icon art): bolts flicker (`nx-strike`, two
  half-clipped copies on 7.3 s / 9.7 s cycles), ring breathes, embers drift; all off under prefers-reduced-motion.
  The old nexus-login.jpg is gone (it had duplicate labels). Brand.jsx also renders the side bar brand (small / big). AppShell draws `public/nexus-watermark.jpg` fixed behind `main`
  (multiply, opacity 0.24, radial mask). Server MIME map includes .jpg/.webp.
- Side bar look (from Michael's mockup): `SIDEBAR_BG` gradient with a red glow, brand block = `public/nexus-emblem.png`
  (fire-ring knight/dragon, transparent) + italic "SGFD / NEXUS / MANAGEMENT SYSTEM", red rules (`RED_RULE`) under the
  brand and above the footer, active nav item = red gradient pill, 19 px icons. Home page nav item is "Home"; other
  sections show their name (clickable, goes home) under the brand. Ticker separates items with red `Zap` bolts.
- App icons: `public/favicon.ico` (16-256), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`,
  `manifest.webmanifest` (standalone, theme #13233F); linked in index.html. MIME map has `.webmanifest`.
- Lucide is pinned at 0.263.1: check new icon names exist in that version (all 53 used today do).

## Active calls (CentralSquare Enterprise CAD)
- `server/cad.js`: polls the view every CAD_REFRESH_SECONDS (15; snapshot `refreshSeconds`, ActiveCalls.jsx polls at the same pace) with `mssql`: columns learned once (`SELECT TOP 0 *`), then
  `SELECT TOP 2000 * … WHERE <closed col> IS NULL AND <received col> > now - CAD_MAX_AGE_HOURS (24) ORDER BY <received col> DESC`
  (the old unordered TOP 200 showed random calls when the view held closed/old rows). `mergeCalls()` merges rows per incident_id
  (one row per unit is fine; units from any of `UNIT_COLUMNS`), skips closed/stale. `cadDiagnostics()` -> GET /api/cad/diagnostics
  (masters; column names, counts, call numbers/types/unit counts, no addresses) = "Feed check" button on Active calls. Uses `mssql`
  (lazy import, `useUTC: false`, readOnlyIntent, encrypt on). `normalize()` lowercases column names, skips rows
  with closed_at, and returns only station-alert fields. `fixCoord()`: CentralSquare sends coordinates as unsigned millionths
  (30383119, 91021720) -> scaled into range and longitude made west (CAD_WEST_LONGITUDE=off to skip the sign flip). In-memory snapshot; `CAD_TEST_FILE` = JSON rows instead.
- `GET /api/cad/active` (any signed-in user; error text only for masters), `POST /api/cad/refresh` (masters).
- `src/ActiveCalls.jsx` on Your Day (below "Needs your attention", shown even when widgets are hidden);
  own 20 s poll, optional new-call ding (`sgfd-call-sound`, default off). Hidden when not configured.
- `scripts/cad-active-view-sgfd.sql` = SGFD's view: EVERY open call (all agencies, received in 24 h), built with dynamic SQL from whichever
  column names the CAD has (nature Problem>Incident_Type, address/city/cross/lat/lon, patient-contact unit time); units = uncleared
  Response_Vehicles_Assigned as "EG613:On scene, MD687:Patient contact". cad.js parses `unit:status` into `unitStatus` and sets the call's
  status to the furthest along (`STATUS_ORDER` Dispatched < Enroute < On scene < Patient contact; else the view's status; no units = Pending);
  `agency` shown. Columns re-learned every 5 min. mergeCalls leaves off calls with no address and no map point (CAD placeholders) and calls with no units
  older than CAD_PENDING_MAX_HOURS (4); Feed check counts both. Calls WITH units stay past CAD_MAX_AGE_HOURS up to CAD_WORKING_MAX_DAYS (7)
  (SQL `recent OR (units <> '' AND within 7 days)`). The SGFD view itself already keeps only calls with uncleared units (7 days) or
  located calls under 4 h old, so CAD's leftover blank records never reach Nexus. Same address (normalized) within 5 minutes = one card
  (`otherNumbers`, units combined). ActiveCalls.jsx: calls list scrolls inside the card (max 400 px ≈ 4 calls). `scripts/cad-view-template.sql` for the CAD admin (login, view, GRANT SELECT on the view only, firewall).

## Dedicated server, HTTPS on 443
- `scripts/install-prereqs.ps1` (admin, idempotent): Node LTS msi (from nodejs.org index.json, SHA256 checked),
  PostgreSQL 18 (EDB installer, `--optionfile` so the superuser password isn't on the command line), Git, NSSM;
  `-InstallerDir` for offline installers. Creates role sgfd_app (random password into .env) + db sgfd; sets
  PORT=443, HOST=0.0.0.0, HTTP_REDIRECT_PORT=80; certificate from `-PfxFile`, `-CertThumbprint`, or a temporary
  self-signed .pfx; firewall 443/80 (Domain,Private; `-AllowFrom`); icacls on .env, D:\sgfd-nexus\certs, secrets\.
- index.js: TLS from `HTTPS_PFX_FILE` + `HTTPS_PFX_PASSPHRASE` or `HTTPS_CERT_FILE` + `HTTPS_KEY_FILE`;
  `HTTP_REDIRECT_PORT` = plain http server that 301s to https (Host header validated). EADDRINUSE/EACCES and bad
  certificate passwords print plain-language messages and exit.
- `scripts/restore.ps1`: pg_restore (--clean --if-exists --no-owner --single-transaction) of a backup.ps1 dump,
  uploads zip, forms.key; stops/starts the service; asks before replacing a database with data.
- Layout: everything under the folder above the app (production: D:\sgfd-nexus): app\, nodejs\, postgresql\18\
  (programs + data), git\, tools\nssm, certs, logs, backups, installers. Scripts derive it as `Split-Path -Parent $AppDir`.

## Punch clock and work patterns (migration 013)
- `server/timeclock.js` (`/api/time/*`): GET/POST `clock` {action: in|out}. Punch-in = time_entries row with start_time and
  NULL end_time, hours 0 (unique partial index: one open per user), server-local date/time. Out: refuses < 1 min or > 24 h
  (fix by hand in Time Tracker). POST `pattern` sets `users.work_pattern` ('' | weekdays | fire:A-C | comms:A-D); roster
  returns `workPattern`.
- `src/PunchClock.jsx` (own colors): on Time Tracker (top card) and in the Your Day time widget (`compact`; fires
  `sgfd-time-changed`, which useYourDay listens to). shifts.js: `WORK_PATTERNS`, `worksOn`, `workDaysBetween`,
  `neededPerShift` (today counts unless finished time exists today), `unitWord`. Time Tracker marks scheduled days.

## Weather (Your Day)
- `server/weather.js` `GET /api/weather` (any signed-in user): NWS api.weather.gov (User-Agent "SGFD Nexus ..."), points lookup
  cached 24 h, data cached 10 min (one in-flight load; on failure keeps the last reading, `stale: true`, retries in 1 min).
  Latest station observation (if < 2 h old) else the current hourly period; rain = hourly probabilityOfPrecipitation
  (now, peak and first hour >= 30% in the next 12); active alerts for the point (severe first). WEATHER_LAT/LON/LABEL/
  DISABLED/API_BASE in .env (default 30.37,-91.01 Headquarters). Tests: testrun/nws-mock.mjs.
- `src/Weather.jsx` `WeatherBar` under the greeting: temp/feels, wind arrow + dir/mph/gusts, rain; click = next 12 hours;
  red/amber pill for alerts with headline + instructions.

## Permissions and groups (migration 014)
- `server/access.js`: `SECTIONS` catalog (time, callout, recordings, directory, forms, accounts; each with its levels and
  whether grants can be limited to divisions). `access_grants` (section, level view<edit<manage, user_id XOR group_id,
  division_id NULL = all or own_division). `access_groups` (rules jsonb: divisions / patterns / roles / titles; AND across kinds,
  OR within) + `access_group_members` include/exclude. Effective access computed for everyone in one pass (`effectiveAll`,
  5 s cache outside transactions; `clearAccessCache()` on grant/group/roster/work-pattern changes).
- Old names still work: `hasPerm(c, user, "directory_admin")` -> `hasLegacy` via `LEGACY` map; roster `permissions`
  ({ timeView: [...] ...}) is effective access (incl. groups) in the old shape, plus `manages` (sections) for the signed-in
  user. A roster save with `permissions` only writes the person's own grants for what groups don't already give
  (`setLegacyPermissions`), so group access is never copied onto people. user_permissions -> user_permissions_before_014.
- `/api/access`: GET (masters + section managers; managers see only their sections), POST `grants` {section, level,
  userId|groupId, scope: "all"|"own"|[divisions]}, POST `grants/:id/remove`, POST `groups` (create/update: masters and accounts admins = Accounts manage; GET returns `canGroups`),
  POST `groups/:id/remove` (accounts admins can't add themselves to, or delete, a group that has grants or profile assignments; e2e43), GET `me`. Managers give/remove view/edit in sections they manage, inside their divisions;
  never manage level. Audit module "Permissions".
- UI: `src/Permissions.jsx` in User Management (pages By person / By section / Groups; colors local). User Management is open
  to masters, accounts admins and section managers (tile shows when roster `manages` is non-empty).
- Adding a section later: add it to SECTIONS (levels + divisions flag) and check with `hasAccess(c, user, "pial", "edit", division)`.

## Messages (migration 015)
- `server/messages.js` (`/api/messages`): GET `?box=inbox|sent|archived`, GET `summary` (unread/important/latest, used by
  useYourDay), GET `people` (people, plus groups/Everyone when allowed), GET `:id` (marks read), POST (send), POST `:id/reply`,
  POST `:id/archive`. Sending to groups/everyone needs `hasAccess(.., "messages", "edit")` (section "messages" in access.js);
  anyone can message people.
- Recipients fixed at send time (group members then). `timing: "next_shift"` sets each `deliver_at` from `nextShiftStart(pattern)`
  (users.work_pattern + src/shifts.js, imported server-side: fire 07:00/24 h, comms day 07:00 or night 19:00/12 h, weekdays
  07:00/10 h; now if on shift or no pattern). Broadcast (group/everyone) replies by members get `private_to = creator`;
  the creator's posts go to all. Visibility rule `VISIBLE` in messages.js. A reply un-archives the thread for whoever sees it.
  Unread = a visible post by someone else newer than `seen_post`. Group sends audited (module "Messages").
- `src/Messages.jsx` (AppShell nav New/Inbox/Sent/Archived; list + thread; compose with people/group/Everyone picker, timing,
  important; sender gets read receipts and "Reply to X only" -> new direct message). Your Day: unread messages in Needs your
  attention (important ones first), counted in notifyCounts (ding) and tileBadges (side bar).

## Messages round 2: delete, bulk, live events, chat, alerts (migration 021)
- `message_recipients.cleared_at`: per-person delete; posts at or before it are hidden for that person (myThreads/openThread
  filter; a thread with no visible posts drops out / 404s). New replies show again. `act()` in messages.js does
  archive/unarchive/read/unread/delete for one or many (`POST /api/messages/bulk {ids, action}`, `POST :id/delete`,
  `:id/archive` now goes through it too); delete purges the thread when every recipient row has cleared_at >= newest post
  (a recipient still waiting for next-shift delivery has cleared_at null, so it's kept). Only rows of the caller change.
- `message_threads.kind` 'message' | 'chat'. `POST /api/messages/chat {userId, body}`: finds the pair's chat (exactly two
  recipients) or creates it; `GET chat/:userId` -> { id|null }. `GET recent` = box "all" (inbox+sent+archived) top 40.
  Thread output adds `kind`, `with` {id,name,online} for chats, `archived`. `GET people` adds `online`.
- `server/events.js`: SSE `/api/events` (one stream per tab; `publish(userIds, type, data)`, `isOnline`). Session re-checked
  every ~75 s ("signedout" event -> page reloads). getSessionUser treats /api/events as background (doesn't keep the session
  alive). `LIVE_EVENTS=off` -> 204 and `/api/auth/me` `live:false`. Events: "message" {threadId, subject, from, preview,
  important, kind, mine} from `announce()` after send/reply/chat (private broadcast replies only to sender), and from
  `startDeliveries()` (every 20 s, next-shift rows whose deliver_at just passed); "changed" after act() (other tabs).
- Client: `src/live.js` (EventSource -> window events "sgfd-message", "sgfd-messages-changed", "sgfd-message-summary"; summary
  safety net every 90 s live / 30 s not; `setViewing(threadId)` so the open conversation doesn't pop up).
  `src/MessageCenter.jsx` mounted in AuthGate on every screen: toasts, sounds (chime.js `messageTone`, `importantTone`,
  `alertPrefs` in localStorage "sgfd-message-alerts"), desktop Notification (important = requireInteraction), blinking tab
  title while hidden, red banner for summary.importantUnread (dismiss per session), chat button + panel (ChatList, ChatView,
  AlertSettings; full screen under 600 px). Opens modules with window event "sgfd-open" {module, init} (App listens;
  MessagesModule keyed by thread). Your Day no longer dings for messages (MessageCenter does) and reloads on message events.
  Messages.jsx: checkboxes + Select all + bulk toolbar, Delete in the thread, chat rows, live list refresh.
- Tests: testrun/e2e25.mjs (run with `LIVE_EVENTS=on ./reset-db.sh`; reset-db.sh defaults to off because Playwright's
  "networkidle" never settles with an open event stream).

## Leave picks (migration 022)
- `server/leave.js` (`/api/leave/*`), `src/LeavePicks.jsx`, `server/xlsx.js` (own .xlsx writer: stored ZIP + styles list
  `STYLE_LIST`; reader: unzip with inflateRaw, shared strings, date styles -> ISO). Rules from the Suppression 2025 memo and
  Comms 2026 Annual Leave Procedure; `DEFAULT_RULES.fire/comms` (shiftHours, firstPicks/firstMax/firstConsecutive,
  laterMax/laterConsecutive, holidaysAll, caps {pool: n}, blocked [{from,to,label}], note) merged with `leave_seasons.rules`.
- Tables: leave_seasons (year, status setup|open|closed, opened_by = sender of turn messages), leave_units (ruleset fire|comms,
  shift A-D, name "613"/"Chiefs"/"Comms C Crew", pool = daily-cap group, notified_user/round), leave_members (per season:
  unit, pick_order, leader, rank, emp_no, hire/seniority date, yos, holiday/vacation/banked hours, done), leave_picks
  (round, skipped, entered_by), leave_pick_days (UNIQUE unit_id+day = one off per unit per shift).
- `compute()`: used/remaining hours, autoDone (remaining < one shift), turn = first (round, member in order) without a pick,
  `charge()` OH -> OV -> OC by date (split days possible; "OVER" = more than available), anniversary (seniority date after
  Jan 1 of the prior year -> +1 year; days before it must fit in holiday hours), daily standing per (ruleset, pool, shift, day)
  sorted by yos desc, seniority asc, pick time -> rank > cap = bumped (flag only). `checkPick()` = turn, size, consecutive
  (index in the unit's shift-day list from src/shifts.js fireShift/commsShifts), blocked, taken, hours, anniversary, cap warnings.
- Routes: GET `` (seasons visible + turn), GET `turn` (Your Day: myTurn round, unitUp for leaders), POST `seasons`; per season
  GET (stateFor: units the viewer may see; balances only for self/leader/view access), POST check|pick|skip|done|undo
  ({pickId, day?}: latest unit pick by person/leader, anything by manage), manage: settings {rules, status}, import/preview
  {filename, data base64} -> parseImport (header row with Employee + Shift; Position/section rows -> unit/pool; SG-5/6/7/91 ->
  Chiefs; COM -> comms with crew from users.work_pattern; ADM skipped; names "Last, First" matched to users), import/apply
  (upsert units/members, default order via reorderUnit when the unit has no picks), member (add/edit/remove), order {unitId,
  userIds, leaders, pool}, remove (setup only). Reports GET report/aladtec.csv | forms.xlsx | master.xlsx (?ruleset&shift&unit).
- afterChange(): publishes SSE "leave" {seasonId, unitId} to unit members (live.js -> window "sgfd-leave") and messages the
  person whose turn it is (messages.js `send` is exported) once per (unit, user, round). Audit module "Leave picks".
- Out of turn (migration 023: leave_picks.manual, rules_waived): pick/check `{manual: true, waive?}` by a leader, Leave picks
  Edit (division) or Manage (not for one's own picks unless manage); round = member's max round + 1; `waive` turns size and
  in-a-row errors into warnings (taken/blocked/hours/anniversary still errors); manage may enter while closed. Comms default
  laterMax 7 (every pick up to 7 in a row). Comms order = seniority only, no default leader (no Shift Leads anymore).
- Permission section `leave` (divisions): view / edit (pick-for in divisions) / manage. Tile for everyone. Your Day action
  "It's your turn to pick leave" (tileBadges/notifyCounts `leave`). Tests: testrun/e2e26.mjs, e2e27.mjs.
- Locked members (migration 024): leave_members.id is the PK; user_id nullable (unique per season when set); name/division
  kept on the row. Picks/days carry member_id (picks UNIQUE member_id+round); user_id copied when linked. Everything in
  compute/checkPick/stateFor is keyed by member id (`st.mem`), `st.byUser` maps accounts; API takes `{memberId}` (or legacy
  `{userId}`); `order` takes memberIds; leave_units.notified_user holds a member id. locked = no user, no password, or inactive.
  Locked person's turn -> message to unit leaders, else coordinators (Leave edit for the division, not masters), else the
  opener (messages.send `toSelf`). autoLink() (GET list) + accountReady(userId) (auth approve / reset-password) link by
  Emp # then unique first+last name. Import: existingFor() = memberId, account, Emp #, name; preview returns row status
  new|update + memberId and `missing` (not removed). member endpoint: create/edit by memberId, name-only, link/unlink account.
- Records + officers (migration 025): leave_records (one per member: lines/totals snapshot, status complete|reopened,
  revisions) filed in afterChange -> fileRecords() when done/autoDone; GET /api/leave/records?user= (self, master, leave view
  for the division, the shift's officers); Personnel File "Leave picks" tab. rules.fire.officers {A,B,C: userIds} (settings);
  completionNotices(): per unit (leave_units.complete_notified) and per shift (leave_seasons.shifts_notified). Officers see
  their shift in stateFor (access.officer, access.reports) and reports are limited to it; reports take ?member=.

## Your Day widget layout (migration 016)
- `users.ui_prefs` jsonb; `server/prefs.js` GET/POST `/api/prefs` {key (allow-list: "yourDay"), value <= 8 KB}.
- YourDay.jsx `useWidgetLayout()` + `WidgetLayout` context: `yourDay = { order: [ids], collapsed: [ids] }` (saved 400 ms after a
  change). `Widget id=...` reads it: CSS `order` for position, collapsed = header only (alignSelf start), Customize mode =
  draggable (HTML5 drag/drop -> `moveTo`) + up/down arrows (`move`, skipping widgets not on screen; widgets `register`).
  `DEFAULT_ORDER` lists the ids (time, messages, oncall, duty, meetings, forms, tickets, reqs); new widgets need an id there.
- `MessagesWidget`: latest 5 inbox threads (own 60 s poll + on `sgfd-chime`), click opens the thread.

## Default groups, station rule, My lists (migration 017)
- `access_groups.is_default` marks the seeded groups: A/B/C-Shift, Comms A-D Crew, Weekday Staff, Station NN and
  "Station NN · X-Shift" for each numbered station in directory_places, and "<division> Division". They are ordinary groups
  (masters can edit/delete; ON CONFLICT DO NOTHING so edits survive). Groups UI shows a "default" badge.
- New rule kind `stations` (home station from the directory card, users.station): `stationKey()` in access.js (and Permissions.jsx)
  turns "61", "Station 61", "Sta. 61" into "61". Directory card saves call clearAccessCache().
- `message_lists` / `message_list_members`: each person's private lists. `/api/messages/lists` GET, POST {id?, name, members},
  POST `lists/:id/remove` (owner only; name unique per owner, case-insensitive). Send accepts `lists: [ids]` (owner's only; no
  broadcast permission needed) and `privateReplies` (people/lists with 2+ recipients: true = replies go to sender only).
  Messages.jsx: "My lists" nav page (MyLists), lists in the To picker (kind "l"), replies choice (default private when a list is picked).
- Tests: testrun/e2e22.mjs.

## Communications Statistics (migration 018)
- `server/cadstats.js` (`/api/stats/*`): closed incidents for every agency Comms handles, from a second read-only view
  (`scripts/cad-stats-view-template.sql`, CAD_STATS_VIEW, same CAD_SQL_* login as Active calls; off until CAD_STATS_VIEW is set).
  `normalizeIncident()` lowercases columns; times kept as CAD wall-clock (`timestamp`, `wall()`), hold = assigned - (queued or
  received), null for self-initiated or outside 0..24 h; process = queued - received. Upsert by incident_id (batches of 400);
  disposition codes / operator ids auto-inserted, view descriptions/names fill blanks only.
- Sync: backfill from CAD_STATS_START a month at a time until one backfill finishes clean (resumes from max(received_at)), then
  nightly at CAD_STATS_SYNC_TIME re-reading CAD_STATS_LOOKBACK_DAYS; catch-up at startup if the last good sync is > 26 h old
  (after CAD_STATS_START_DELAY_SECONDS, 30). Manual "Sync now" (manage) at most once per 5 min. Log in `cad_stats_sync`.
  CAD_STATS_TEST_FILE = JSON rows instead of SQL (testrun/make-stats-data.mjs -> stats-mock.json, 42,434 rows).
- Filters: from/to (inclusive days), agency, calls = dispatched (default) | all. LY = same dates a year earlier (`addYears`, Feb 29 -> 28).
  Series grain: day <= 92 days, week (Monday) <= 731, else month; partial buckets flagged. Percentiles exact (`P()` = separate
  percentile_cont columns: pg returns float8[] as text). Trend summary anchored on the last loaded day, not today.
- Permission section `stats`: view = pages + reports, edit = per-person (call takers/dispatchers), manage = Data & settings
  (codes, operator names/accounts, hold goal + tail minutes in `cad_stats_settings`, sync). Roster `me.access` = {section: level}
  (from legacyAll `sections`); the main-menu tile shows for masters or `access.stats`. Audit module "Comms statistics".
- UI: `src/CommsStats.jsx` (Overview, Volume & Trends, Call-taking, Call takers & dispatchers, Reports, Data & settings) and
  `src/StatCharts.jsx` (own SVG charts: TimeChart, BarChart, Heatmap (5th-95th percentile scale), Histogram, DataTable, CSV;
  validated blue/gray palette). Every chart card has Chart/Table + CSV. Reports: `comms_reports` (blocks jsonb, window_kind
  last7/last30/lastMonth/custom, shared = template for everyone; saving someone else's makes a copy); printing renders a second
  copy of the paper in a portal (`.sgfd-print-portal`) and print CSS hides #root, so only the report prints (Letter, 12 mm).
- Each month a CAD sync reads (when the view returned rows) deletes `source = 'upload'` rows in that date range: CAD is the record for
  days it covers, even when the uploaded report numbers calls differently (9-digit CADNumber) and has no call taker/dispatcher.
  POST admin/sync {full: true} = "Reload all since CAD_STATS_START" (syncRange manual from c.start). Tests: e2e41.mjs (stats-mini.json).
- Dispositions are no longer used (migration 039 cleared them): normalize/upload store '', no overview card, data-quality rows, report
  block (old saved blocks render nothing) or admin code list.
- Apparatus (migration 038): `cad_unit_responses` (incident_id, unit, assigned_at PK; enroute/arrived/cleared, number/agency/nature) from
  CAD_STATS_UNITS_VIEW (`scripts/cad-units-view-sgfd.sql`: Response_Vehicles_Assigned.Radio_Name/Time_* — names unconfirmed, step 1 lists them)
  or CAD_STATS_UNITS_TEST_FILE, read in the same monthly syncRange chunks (`storeUnits`: replace the month only when rows came back).
  GET /api/stats/apparatus?from&to&pattern (stats view): shift day = assigned_at − ALADTEC_SHIFT_START (07:00), count DISTINCT incident per
  unit, arrived, busy = Σ min(cleared − assigned, 24 h); default unit filter in settings 'stats_units' (`DEFAULT_UNIT_PATTERN` SGFD units +
  SG chiefs), POST apparatus {pattern} (manage). UI `Apparatus` page (One shift / Date range, Calls by unit card, Calls per shift matrix ≤ 62 days).
- CAD-to-CAD transfers (CAD id in CAD_TRANSFER_IDS, default C2CI, or operator name "CAD2CAD") are listed last in the people tables as
  CAD_TRANSFER_LABEL ("Transfer from EBR CAD (C2C)", `transfer: true`). SGFD's view: `scripts/cad-stats-view-sgfd.sql` (Response_Master_Incident;
  dispatcher = Performed_By of the first "Automatic case number" comment, which CAD writes when the first unit is assigned).
- Tests: testrun/e2e23.mjs (needs CAD_STATS_TEST_FILE, CAD_STATS_START=2025-01-01, CAD_STATS_START_DELAY_SECONDS=1).

## PIAL tracker (migration 019)
- `server/pial.js` (`/api/pial/*`): `CATALOG` of 55 items (2012 FSRS as applied by PIAL / Louisiana Addendum 6/16/2016; weights from
  PIAL's Relative Point Value Guide): comms 10, FD 50 (training group capped at 9, incl. IFSAC bonus up to 3), water 40, CRR 5.5.
  `compute()` = per-item pct (0-1) by `kind` (features checklist, answer %, CAD processing, EPSS, apparatus equipment, reserve ratio,
  deployment (max of road-mile estimate and CAD/fire-report AE/AL vs 90%), training model, preplan, SOPs, IMS, hydrant intervals) or the
  manual estimate (`pial_items.manual_pct`); score = sections − divergence (0.5 × |0.8·FD − water|); class = 10 − floor(score/10), 90+ = 1.
- Exact Addendum rules: `testInterval()` (3 most recent passed tests on/before graded-year end, average gap rounded up to whole years;
  examples 1/2/4 yrs unit-tested) + `TABLES` (pump 100/75/50/25, hose & aerial 50/37/25/12, hydrant inspection 30/20/10/5, flow 5 yrs→40…,
  preplan factor 1/.83/.67/.58/.42); `EQUIPMENT` relative points (engine 600, service 356, ladder 772) incl. tank 1 pt/10 gal, aerial reach
  vs `aerialRequiredFt` (<50' = 0), pump/hose/aerial test intervals. Training targets are FSRS defaults (`DEFAULT_TARGETS`, editable):
  company 192, facility 18, officer CE 12, driver 12, new driver 60, hazmat 6, recruit 240, minimum 12, IFSAC 45 in-house company hrs;
  CBT ≤ 50% of company target, outside training at half. scoreMode "projected" scales hours by 1/elapsed while the graded year runs.
- Data: `pial_members` (roster), `pial_certs`, `pial_training` (+ `pial_category_map`, auto-guessed by `guessCategory`), `pial_fires`,
  `pial_tests` (kinds in `TEST_KINDS`), `pial_apparatus` (inventory jsonb), `pial_evidence` (bytea, 15 MB), `pial_settings.data`
  (year, scoreMode, cadAgency + nature patterns for CAD metrics from `cad_incidents`, targets, baseline, minimum confirmations, ppe).
- Imports (`IMPORTS`, CSV via `parseCsv`, header aliases, `preview: true` first): roster (replaces all), certs (replaces all), training
  (replaces rows between the file's first/last date), fires (upsert by incident), tests (skips same kind/subject/date). Manage only.
- Permission section `pial` (divisions: true): view; edit = items/records/evidence whose owner division is in the grant (item owner =
  `pial_items.owner_division` or catalog default; records belong to `TEST_KINDS[kind].item`, apparatus to f513); manage = imports,
  settings, owners. Tile shows for masters or `me.access.pial`. Audit module "PIAL".
- UI `src/Pial.jsx`: Scorecard, 4 section pages (ItemCard: inputs by kind, estimate, notes, owner, evidence), Training worksheet +
  category mapping, Apparatus & equipment, Testing & reviews (+ SOP table), Fire responses, FireWorks imports, Settings, Grader binder
  (portal print like CommsStats; "Items for" division filter; worksheets). Tests: testrun/e2e24.mjs (sample CSVs: make-pial-data.mjs).
- Updated to the Louisiana Addendum of January 1, 2021 and checked against the 2012 ISO FSRS text (Michael sent both, 11/2026):
  alarm processing 90% ≤ 64 s / 95% ≤ 106 s on fire+EMS+rescue calls (target key `t64`; old `t60` dropped from settings); hydrant
  inspection HI = FI/50 × 4 with +10 flushing, +10 pressure test, +20 dry-hydrant drafting; flow testing FT = FF/50 × 3, ×1.25 with a
  marking program; partial records −25% (inputs `complete:false`); company training capped at 16 hrs per member per MONTH, CBT max 8 of
  those, interactive virtual (Zoom/Teams) = in-house; deployment parts weighted by engine / ladder-service equipment (FSRS 561); IFSAC
  "or equivalent" (Pro Board no longer excluded; cert dated by graded-year end); `w2400` hydrant data bonus +0.50 (`bonus: true`,
  added to the score outside CWS and divergence, all-or-nothing checklist). Divergence/class confirmed against FSRS 1101.
- Benchmark (migration 020): PIAL's grading of 11/5/2025 (letter 6/1/2026, Class 1 W.H., 91.18) in `pial_settings.data.baseline`: section
  totals (fd 41.48 = CFD 39.48 + COC 2.00), `items[key] = {earned (tracker points), raw (PIAL's figures), rec (PIAL's recommendation)}`,
  improvementDeadline 2026-12-01. CRR raw × 0.055, training raw × 0.09 (580C split evenly between c1/c2). Items with no records and no
  estimate fall back to `last.earned` (method "last grading"), so an empty tracker reproduces 91.18 / divergence 2.37 exactly (e2e24).
  `pointValue` = marginal worth of a point given the divergence side (water ahead: FD ×1.4, water ×0.5). Settings baseline saves merge.

- CAD links (no migration): compute() picks the CAD agency automatically when unset (most common cad_incidents agency matching St. George /
  SGFD; `settings.cadAgencyAuto`). `cadFires(s, y)` = structure-fire calls (structureNatures) + cad_unit_responses for our units (cadstats
  `unitSettings()` pattern): first engine (settings.engineUnits regex) and full complement (fullEngines engines + fullLadders ladder/service by
  settings.ladderUnits; default 2 + 1) in seconds from the incident's assigned_at. 561 order: fire reports (5+) > CAD unit arrivals (5+) >
  CAD first unit on scene; full complement: fire reports > CAD units > road-mile estimate. `sources` (GET /api/pial) = "Where the numbers come
  from" panel on the Scorecard; GET /fires adds `cadFire` (list with inReports) for the "Structure fires from CAD" table. Tests: e2e42.mjs.

## Procurement / Reimbursements / Help Desk refresh (no migration)
- `server/documents.js`: POST `/api/documents/autofill` {filename, data base64, divisions, categories} -> {fields}: PDF = document
  block, images = image block, xlsx/csv (readWorkbook / parseCsv) and docx (unzip word/document.xml) = text; .xls/.doc/HEIC get
  plain-language 415s; no ANTHROPIC_API_KEY = 503 with what to do; upstream errors mapped (401 key, 404 model, 429, too large).
  `AI_MODEL` (default claude-sonnet-4-6), `AI_API_BASE` (tests: mock on 3099). POST `/api/documents/sheet` -> {sheets} for imports
  (App.jsx `readSpreadsheet`, `dayFromText` = no time-zone day shifts). `/api/ai/messages` still exists but the app no longer uses it.
  New requisition attaches the autofill file on submit (`form.attachFile`). File inputs accept office/CSV/msg/zip; limits 15 MB.
- collections.js: `requisitions.read(c, actor)` scoped by `reqScope` (GLOBAL_ROLES all; else home + sign divisions + own);
  reimbursements read scoped (global, approvers' divisions, own), upsert by others only for approver/accounting roles, remove =
  requester while pending or master (audited); tickets: `helpdeskLevel` (edit = master, Technology, access section `helpdesk` edit;
  view = see all), non-techs only their own (comments/files; details while open), requester forced to the actor on create (except
  tech Spiceworks imports), new comments authored by the actor, remove = tech or requester while open (audited).
- Notifications: `notify(ctx, ids, subject, body)` queues on `ctx.after` (run after the save commits, `messages.send` as the actor).
  Requisition new/stage -> routed signer else `stageSigners` (role + covers, no masters); approved -> requester + accounting;
  rejected/paid -> requester. Reimbursements: submit -> approver1/2 covering the division (else fire_chief); approved/rejected/paid.
  Tickets: new -> assignee else `helpdeskTechs`; assignment; status/comments -> requester; requester comments -> assignee/techs.
  pg arrays: the query wrapper JSON-encodes arrays, so use `string_to_array($1, ',')`.
- Roster adds `helpdeskTech` for everyone. Old artifact "sign in as" screens replaced by `NotOnRoster`. Procurement Admin keeps
  divisions/categories; people/roles moved to User Management (button fires "sgfd-open" users). ListControls no longer prints
  "No <label>" (modules show their own empty state). Tests: testrun/e2e28.mjs (run with
  `ANTHROPIC_API_KEY=test AI_API_BASE=http://127.0.0.1:3099 ./reset-db.sh`).

## FireWorks / CAD report uploads (migration 026)
- xlsx.js reader: strips namespace prefixes (`<x:row>`), takes absolute part paths (`/xl/...`), relationship/sheet attributes in
  any order; date-time cells (fmt 22/18-21/45-47 or custom with h) -> "YYYY-MM-DD HH:MM:SS", time-only -> "HH:MM:SS".
  `zip`/`unzip` exported. documents.js `readSheets(filename, data, maxRows)`.
- PIAL: imports take `{fileName, data (base64)}` (CSV or xlsx; legacy `{text}` still works); `importRows()` finds the first sheet and
  header row (first 25 rows) that satisfies the import's `need`. New import `alarms` -> `pial_alarms` (incident PK, alarm_date,
  psap/queued/alarm timestamps, talk_s/process_s/total_s computed from timestamps, else the duration columns; range replace).
  `settings.alarmMeasure` "queue" (default; queue -> alarm, matched PIAL 2025) | "total" (PSAP -> alarm), also used for CAD metrics
  (COALESCE(queued_at, received_at)). 420-A-2 order: FireWorks report (graded year) > CAD > entered %. `{toStats, agency}` on the
  alarms import also stores the calls in Comms Statistics (needs stats manage). GET /imports adds canStats, agencies.
- Comms Statistics: `cad_incidents.source` 'cad' | 'upload'; `cad_stats_sync` kind 'upload' + file_name/by_name. POST
  /api/stats/admin/upload {fileName, data, agency, preview} -> `parseUpload` (UPLOAD_FIELDS aliases, header in first 25 rows, US
  date-times, time-only + date column) -> `importIncidents` (skips numbers the CAD view has; reuses an uploaded row's id).
  `store(list, "cad")` deletes uploaded rows with the same incident_number first. Backfill start / startup catch-up ignore uploads.
  UI: UploadCard on Data & settings; Freshness says "from uploaded reports" when the view isn't configured. Tests: e2e29.mjs.

## Signatures, quick view, purchases, system audit, sick leave (migration 027)
- `requisition_signatures.signature_image` (PNG data URL <= ~200 KB, `signatureImage()` validates; only live signatures). Read
  returns `drawn: true` (no image in the list); GET `/api/req-signature/:id/:stage` (index.js -> `requisitionSignature`, same
  visibility as `reqScope`, no-store). App.jsx `SignaturePad` (canvas, pointer events, exported at <= 480 px) in DecisionButtons;
  `decide(..., signature)` puts `signature` on the stage record; ApprovalRow/printRequisition show it.
- `ReqQuickView` (exported) used by VendorsTab (history rows), BudgetReport (supporting rows) and Personnel File; "Open in
  Requisitions" = `openRequisition(id)` -> `focusReq` -> RequisitionsList `focus` (filter all, search title, scroll to `#req-<id>`).
- GET `/api/personnel/purchases?user=` (collections.js `purchasesFor`: self, or GLOBAL_ROLES) -> requisitions requested_by the person +
  their reimbursements; Personnel File tab "Requisitions & reimbursements" (PurchasesTab).
- `server/audit.js` `/api/audit` (?from&to&module&actor&q&page&size), `/meta`, `/export.csv`; access section `audit` (view). Dates in
  APP_TIMEZONE. `src/AuditLog.jsx`; main-menu tile for masters / `access.audit`. Procurement's AuditLogViewer starts filtered to Procurement.
- `server/sick.js` `/api/sick` (section `sick`, divisions): GET `` (people in view scope + canEdit, kinds, holidays), GET `entries`
  (+ `/export.csv`), GET `analysis` (?person&days), GET `outlook` (?days&min), POST `entries` (range -> one per scheduled day via
  shifts.js `worksOn`, no pattern = weekdays; UNIQUE user+day upsert), POST `entries/:id` (+ `/remove`), POST `settings` (manage).
  Tables `sick_entries` (kind sick|family|fmla|injury|accommodation; protected excluded from analysis), `sick_settings.data`
  (lookbackMonths, windowDays, alertScore, removed default holiday labels, extra [{day,label}]). Holidays computed (`defaultHolidays`,
  Easter-based Mardi Gras/Good Friday). Model in the file header: occurrences, empirical-Bayes base rate (B = 30 shifts toward the
  department rate `deptRate`, cached 60 s), context lifts (holiday window, weekday, `leaveAdjacent` from leave_pick_days) with k = 1.5,
  p = 1 − exp(−r·L) (L <= 8), score = 10(1 − e^(−p/0.15)). Audit module "Sick leave". UI `src/SickLeave.jsx`. Tests: e2e30.mjs.
  Schedules by division (`scheduleOf`): Suppression = fire 24 h, Communications = comms 12 h, others = weekdays 8 h; the work pattern gives the
  letter, a different-kind pattern overrides (`override`). Fire/comms with no letter = `missing`: rate estimated (1/3 or 1/2 of days), no patterns or
  forecast, flagged on People. Bradford = S² × shifts missed (one shift = one Bradford day for that schedule; compare within a division).

## Push notifications and chat status (migration 028)
- `server/push.js`: Web Push without a library. VAPID P-256 key generated on first use, stored in `settings` key `vapid`
  ({privateKey JWK, publicKey raw 65-byte base64url}). ES256 JWT (aud = endpoint origin, exp 12 h, sub = PUSH_CONTACT or
  PUBLIC_URL or https://nexus.stgeorgefire.com). Payload encrypted aes128gcm (RFC 8291). 404/410 deletes the subscription;
  other failures count up, deleted at 20. `sendToUser(userId, {title, body, url, tag, important})` skips `important_only`
  devices unless important (or test). Routes `/api/push/key|devices` (GET), `subscribe|unsubscribe|device|test` (POST).
  `PUSH_ALLOW_HTTP=1` lets tests subscribe http endpoints (e2e31 runs a decrypting mock push service on :3111).
- `public/sw.js` (served no-cache): shows the notification (skips when a Nexus window is focused, except on Apple devices,
  which must always show one); click focuses a window and posts `sgfd-open-url`, or opens `/?thread=ID` / `/?chat=ID`.
  MessageCenter reads those params on load (then replaceState) and the worker's message. Client helpers `src/pushClient.js`;
  localStorage `sgfd-push-on` marks this browser as subscribed (then the page doesn't also make its own desktop Notification
  while in the background). A device stays with whoever turned it on.
- messages.js `announce()` pushes to every recipient except the author, unless their status isn't Available and the
  message isn't important. Auto-replies announce with `{push:false}`.
- Status: `users.chat_status` (available|busy|dnd|away), `status_message`, `status_until` (lazy expiry in `effective()`),
  `status_set_at`. GET/POST `/api/messages/status`; people / chat partners carry `status, statusLabel, statusMessage,
  statusUntil`; change publishes live event `status` (client `sgfd-status`).
  `redirectChat()`: chat()/reply() on a chat thread to someone not Available -> normal message (subject "Chat from X (while you were
  …)", reused while the same status lasts), returns `{redirected, messageId, to, status, label, awayMessage, until}`; ChatView
  shows a dashed bubble + note. `autoReplies()` (send to Direct recipients, replies in non-broadcast threads of <= 10 people,
  diverted chats): one post per (recipient, sender, status_set_at) via `auto_reply_log`, authored by the away person,
  private_to the sender, body "Automatic reply · <label>[ (until …)]\n<message>".
- Client (MessageCenter.jsx): `STATUSES`, StatusDot/Avatar `status`, StatusPicker view, PushSettings in AlertSettings; toasts,
  sounds and desktop pop-ups suppressed for non-important while not Available. On phones the full-screen chat sits above the
  important banner. Tests: e2e31.mjs (53).

## Transcripts, apparatus, classroom bookings, Training (migration 029)
- `server/transcribe.js`: whisper.cpp CLI (`WHISPER_BIN`/`WHISPER_MODEL`, default `<install>/tools/whisper`, model order small.en >
  medium.en > base.en). One worker; `fire_recordings.transcript_status` '' | queued | running | done | failed, `transcript_done`,
  resumes after restart (`startTranscripts`). Batches of 40 clips: `-m -t -l en -otxt -np -nt -sns --prompt <fireground words + apparatus +
  recording units> -f clip.wav -of tmp/<item>` (miniaudio resamples the 8 kHz WAVs). `cleanText` drops [BLANK_AUDIO]/(static)/"Thank you."
  Clips: `transcript` (NULL = not done), `transcript_edited` (kept on redo). recordings.js: GET `transcriber`, POST `:id/transcribe {redo}`,
  PUT `:id/clips/:item {text}` (audited). UI: Recordings.jsx `TranscriptCard`, inline Correct, `printTranscript` (App.jsx printDocument).
  `scripts/install-whisper.ps1`. Tests use `testrun/fake-whisper.mjs`; the real CLI was checked with whisper.cpp's test model.
- `server/bookings.js`: `/api/apparatus` (edit: master, bookings manage or training manage; `import` {text} guesses kind by prefix),
  `/api/bookings` (GET list/rooms/check; POST direct booking = approved, requests/:rid edit/approve/cancel/rotations, rooms). Tables
  `apparatus`, `bookings` (one row per room per day, `request_id` groups them, status requested|approved|cancelled), `booking_rotations`
  (seq, day NULL = every day, apparatus jsonb ids). Overlap = same room/day, start < other end and end > other start, under
  `pg_advisory_xact_lock(hashtext('sgfd-bookings'))`. Rooms in `settings` key `booking_rooms` (default `DEFAULT_ROOMS`).
  Forms: `settings.booking` field map (formSeeds2 `BOOKING`) -> `bookFromSubmission` inside submit's transaction (409 = whole submit
  refused, with second-choice tip); stage handler -> `bookingStage` (approveStage/releaseStage). `upgradeFacilityForm()` (seedForms) swaps
  the old "times" text field for start_time/end_time and adds `booking`, once. Forms.jsx `BookingPanel` checks live. Access section `bookings`.
  YourDay.jsx `BookingsWidget` (id "bookings" in DEFAULT_ORDER).
- `server/training.js` `/api/training`: requirements in `training_settings.data` (`DEFAULT_REQUIREMENTS`: ISO with divisions
  suppression|operations, LA state, NREMT with `holders`); `counts` = "iso:<kind>" (FireWorks subject via `subjectKind`, then catmap, then
  pial.js `guessCategory`) or words in certification/subject/title; `monthlyCap`; periods month|quarter|year|2years; `pace` for year ones.
  `training_records` (certification, category = subject, topic = content title; `source_key` sha1 dedupe), `training_imports`,
  `training_content` (FireWorks master list; `fillFromContent` fills cert/subject from the title). Crew = Aladtec `onDuty().today` minus
  `timeOff`, matched by `normName`. `linkRecords` (emp no, then unique name) on GET. Access section `training`. Audit module "Training".
  UI `src/Training.jsx` (also bookings pages, RotationEditor, ApparatusPage). Tests: e2e32.mjs (64; Aladtec mock on 3099, fake whisper).
- Migration 030: `training_records.fw_category` (FireWorks "Training Category List" value; `category` stays = subject). Settings `fwCategories`
  [{name, archived}] (POST `/api/training/categories` {fileName, data}; Archived -1 = archived) and `fwmap` {lower name: iso kind} (POST settings).
  `isoKinds` order: subject (catmap / `subjectKind`) > fw_category (fwmap / `categoryKind`) > title catmap > guess. Import header "Subject" ->
  category, "Category"/"Training Category" -> fw_category. install-whisper.ps1 scans the last 40 releases for an x64 CPU zip (or `-Url`).

## IMT: incident action plans (migration 031)
- `server/imt.js` `/api/imt/*` (routes in the file header). Tables `imt_incidents`, `imt_periods` (seq, starts_at/ends_at = wall-clock
  `timestamp`, sent as "YYYY-MM-DDTHH:MM"; status draft|approved, approved_signature PNG), `imt_forms` (kind, sort, data jsonb, version for
  optimistic saves -> 409), `imt_files` (bytea; PDF page images are rows with parent_id, image/jpeg), `imt_library` (channels | hospitals |
  stations | transport). `blank(kind)` = each form's data shape; `ORDER` = IAP order; `PER_PERIOD` (211/213/214) not copied by
  `newPeriod(copyFrom "previous")`. Access section `imt`; readers also = anyone in `assigned(forms)` (203 rows, 204 supervisor/resources,
  214 owner, by userId) and share_all incidents' approved periods. Approve/reopen: manage or `icIds` (203 command "IC..." with userId).
  `cleanData` bounds JSON. Notify -> messages.send to assigned. `fromImport` maps Claude's JSON (IMPORT_PROMPT) to forms.
- documents.js now exports `askClaude(content, {maxTokens, what, noKey, notFound, fail, json, timeoutMs})` (autofill uses it too) and
  `pdfOrImageContent`. weather.js exports `forecastAt(lat, lon)` (points -> daily forecast, latest obs, alerts; 30-min cache per point).
  Geocoding: Census onelineaddress (`GEOCODER_BASE`).
- Client: `src/Imt.jsx` (list, IncidentForm, ImportIap, IncidentView + NewPeriod + FilesCard, PeriodView: left form list with
  `missing()` counts, editor in `<fieldset disabled>` when approved/read-only, 900 ms debounced saves with version, approve with
  SignaturePad), `src/ImtForms.jsx` (EDITORS per kind, PersonField = datalist of /api/imt/people -> userId, Rows table editor,
  AiButton/Draft, OrgChart, WeatherView), `src/ImtPrint.js` (`iapHtml` = ICS-style HTML per form, named @page "land", `printIap` waits
  for images). `src/pdfPages.js` renders PDF pages to JPEG with pdfjs-dist (dependency, pinned 6.2.108), loaded at runtime from
  `/vendor/pdfjs/pdf.min.mjs` (index.js `servePdfjs` serves node_modules/pdfjs-dist/build, or PDFJS_DIR) with `import(/* @vite-ignore */)`
  so Vite never bundles it (its syntax can't be lowered to Vite's default target). Server MIME adds .mjs/.wasm.
  Tests: e2e33.mjs (53; Claude/NWS/geocoder stand-in on 3099; PDFJS_DIR=/opt/npm-tools/node_modules/pdfjs-dist/build).


## Evaluations & Simulations (migration 032)
- `server/evals.js` `/api/evals/*` (routes in the file header). Tables: `eval_programs` (key = seed key; kind wtp | form; data =
  {scale {min,max}, passComposite, passModule, months, reviews [months], outcomes, signatures, overview, modules [{key, title, weight,
  quarter, competency, sim, elements [{label, mult}], guide, note}]}; `evaluators` jsonb user ids), `eval_candidates` (working test
  periods: start/end, status active|extended|completed|withdrawn, evaluators, outcome + signature), `eval_results` (kind
  practice|formal|retest; modules [keys]; scores {key: [score|null]}; comments; observations; feedback; flags [{text, done}]; ai draft;
  status draft|final; signature; pct stored at finalize; session_id), `eval_submissions` (bytea), `eval_reviews` (UNIQUE candidate+month,
  evaluator signature, candidate ack signature), `sim_scenarios` (kind radio|conversation, program_key/module_key link, data), `sim_sessions`
  (scenario snapshot, transcript [{t, who officer|ai|scene|system, from, text, inject, cue}], state {delivered, rubric, mood, aiError}, grade).
- Seeds: `server/evalSeeds.js` is GENERATED from Michael's three .docx files by `scripts/dev/make-eval-seeds.py` (line ranges per module;
  element rows parsed from "label | 5 |" / "label | ×2 |" tables). `server/simSeeds.js` scenarios (fictional names). `seedEvals()` at
  startup inserts by key ON CONFLICT DO NOTHING, so app edits stick.
- Math (`modulePct`, `resultPct`, `standing`, mirrored in src/evalsShared.js): module % = Σ score×mult / Σ max×mult over scored elements;
  result % = weight-averaged modules (weight null -> 1); standing per module = latest final retest, else average of final formals;
  composite over scored modules; passing = all scored, composite ≥ passComposite, none < passModule. The CO 7-category form's weights
  add to 105 in the document (kept; the average divides by Σ weights).
- Access: section `evals` (view / edit = evaluator everywhere / manage); `evaluatesCandidate` also = program.evaluators or
  candidate.evaluators. No self-evaluation (except masters). Practice results/sessions visible only to the person (and the evaluator who
  made them). Final formal/retest needs every element scored, all flags done, a drawn signature (PNG data URL ≤ 280 KB).
- AI (documents.js `askClaude`): `/ai/draft` (rubric + guide ≤ 16k chars + observations + candidate submissions -> scores|null, why,
  comment, feedback, flags); sim turns (radio: Dispatch/units, never coach, no invented Mayday; conversation: persona in character with
  mood); `gradeSession` (rubric = linked module elements, else scenario rubric, else `RUBRICS` in simSeeds.js; cues with expected
  actions; returns scores/why, summary, strengths, improvements, keyMoments, cues/assignments or helped/escalated/listening/...).
  Turns without a key still save the transcript (`state.aiError`).
- Voice: `src/EvalSim.jsx` `MicRecorder` (getUserMedia + ScriptProcessor, Float32 chunks) -> `encodeWav` (averaging downsample to 16 kHz
  16-bit mono) -> base64 in `turn {clock, audio}`; server checks RIFF/WAVE, ≤ 6 MB, `transcribe.js transcribeWav(buf, unitNames)` (one at a
  time, temp dir `voice-1.wav`). Permissions-Policy now allows `microphone=(self)`. Speech out = speechSynthesis with a voice per
  speaker + a short squelch beep; `sgfd-sim-voice` in localStorage. Ticks every 3 s deliver due injects (units auto-report "on scene"
  at eta unless an inject from that unit is within 20 s). Clock is client time since start, clamped server-side to ≥ last entry and
  ≤ minutes+10.
- UI `src/Evals.jsx` (My development, Working test periods, CandidateView: StandingTable, results, Submissions, ReviewCard, FinalCard +
  print; ResultEditor with ScoreButtons/AI draft/flags/SignaturePad; ResultsList; Programs/ProgramEditor; ModuleGuide dialog) and
  `src/EvalSim.jsx` (Simulator, LiveRun, SessionView debrief + replay + print, SessionList, ScenarioAdmin/ScenarioEditor). Audit module
  "Evaluations". Tests: e2e34.mjs (fake mic via Chromium flags, fake whisper reads testrun/fake-voice.txt for `voice-N.wav`).

## Pass/fail skills programs (no migration)
- `server/evalSeeds2.js` (`MORE_PROGRAM_SEEDS`, hand-written, seeded with the others): ff-probation (wtp, 12 months, reviews 3/6/9, skills A–G),
  ff-lateral (form: A aerobic + skills B–H), op-pumper and op-aerial (form, A equipment / B operating). Same criteria as the Forms versions
  (formSeeds2.js probationary_eval, lateral_eval, operator_pumper, operator_aerial), split into one element per critical criterion / minimum.
- `data.scale.labels` (["Fail","Pass"], length = max − min + 1; scale max may now be 1) makes a pass/fail program: ScoreButtons show the
  words, `scaleWords()` tells the AI "0 = Fail or 1 = Pass", results carry `passFail {failed, missing, total}`, lists/prints say Passed /
  Not passed / skills passed N of M. `data.standing = "latest"`: a module's standing is the latest signed formal or retest (attempt #2 = Retest),
  instead of the average of formals. Program editor: Scoring (points | pass/fail) and Standing per module. Tests: testrun/e2e36.mjs.
- op-confirm (Operator Requirements Confirmation, from formSeeds2 operator_confirmation): 5 pass/fail skills A–E.
- Assistant Chief: `server/evalSeedsAC.js` (`AC_PROGRAM_SEEDS`) is GENERATED by `scripts/dev/make-ac-seeds.py` from the AC framework
  (pandoc -t plain --wrap=none). ac-wtp: modules A–F, 5 elements 0–5 each, quarters A/B 1, C/D 2, E/F 3, pass 70/70 (our choice; the
  document says "satisfactory completion"); F has no write-up in the document and uses its five-criteria rubric. ac-matrix: A–E with ×1/×2,
  170 points, bands from the rating guide.

## Strategies & Tactics scene maps (migration 033)
- `sim_images` (bytea picture, width/height, ft_per_px for USGS, source upload|usgs, attribution, lat/lon). `POST /api/evals/images` (manage;
  jpeg/png/webp ≤ 15 MB, client sends naturalWidth/Height), `GET /api/evals/images/:id` (any signed-in user, private cache 1 day),
  `POST /api/evals/aerial {address | lat+lon, feet 200–3000}` (manage): Census geocoder (`GEOCODER_BASE`) -> USGS The National Map
  `USGSImageryOnly/MapServer/export` (`USGS_BASE`), bbox in EPSG:3857 widened by 1/cos(lat) so 1280 px = `feet` on the ground. No Esri key.
- Scene in `sim_scenarios.data.scene` (`cleanScene`): imageId, width, height, ftPerPx, wind {from°, mph}, hydrants [{x,y,label}], building
  [polygon], fire [{x,y,t,r}], hazards [{x,y,r,kind power|collapse|other,label}], blocked [{x,y,w,h,label}]. Picture pixels, north up.
- `POST /sessions/:id/place {unit, x, y, angle, clock}`: unit must be on the assignment and arrived (eta ≤ clock); `placementEffects`
  (exported; unitKind by call-sign prefix, `APPARATUS` sizes/reach in feet, mirrored in src/evalsShared.js) refuses blocked boxes / inside the
  building outline, else notes (ft to building = nearest polygon edge or fire point, hydrant ft for engines/tankers, preconnects 200 ft,
  aerial 100 ft, collapse / power / other hazard radius). History in `state.placements`, transcript entry `who: "place"`; sessJson returns
  `placements` (latest per unit) and `placementLog`. The radio prompt gets "APPARATUS POSITIONS" (latest per unit + wind); the grade prompt
  gets "APPARATUS PLACEMENT" and returns `placement` text.
- `src/SceneMap.jsx` (SVG over the picture; viewBox zoom/pan via wheel, +/−, Fit, drag; modes edit | run | view): fire = radial gradient
  that grows with time + blurred smoke circles downwind; units drawn to scale (rect L×W ft / ftPerPx), ladder reach circle, engine→hydrant
  dashed line with ft. Collapse zones and the building outline are hidden in run mode. EvalSim.jsx: `SceneEditor` (upload / USGS / wind),
  LiveRun map layout (map + clock bar left, radio log right), `PlacementReplay` (time slider) in the debrief. Tests: e2e35.mjs (USGS/geocoder
  stand-in on 3099 serving testrun/aerial-mock.jpg).
- Test pg shim (testrun/shims/pg) now sends Buffers as bytea hex and parses bytea (oid 17) to Buffers, like the real driver.

## Training upgrades: drills, proficiency, company/shift views, roster history, PIAL estimate (migration 034)
- `server/trainingPlus.js` (routes in the file header; training.js hands over `drills|todo|proficiency|company|shift|views|roster|pial`).
  training.js now exports settings/isoKinds/summarize/access/recordsFor/byPerson/audit; `recordsFor` skips `superseded_by` rows.
- Scope: Training view = all. Otherwise roles from job titles (`training_settings.data.roles`: officer, bc, driver, rosterDivisions;
  `DEFAULT_ROLES`): company officer = own company (users.station via stationKey + shift from work_pattern fire:X), BC = whole shift.
  `inScope()` also lets officers/BCs open GET /api/training/person for their people. Content search (`GET /training/content`) is open to all.
- Drills: `training_drills` (status draft|submitted|returned|verified, officer signature PNG, kind = ISO kind, delivery inhouse|virtual|cbt|outside,
  at_facility) + `training_drill_people` (hours each, confirmed_at / disputed). Officers/BCs log for their scope, Training edit for any.
  Submit = signature + ≥1 person; officer's own row auto-confirmed; crew messaged to confirm (dispute -> message to the officer).
  Verify (Training edit, not your own unless master) -> `training_records` source 'drill' (drill_id, delivery) + skill checks final;
  Return {note} -> officer fixes (people keep confirmations when hours unchanged). `supersedeDrills()` (after verify and after every FireWorks
  import): a FireWorks row for the same user/day/hours ±0.5 sets the drill record's `superseded_by`, so hours aren't doubled.
  `GET drills/export.csv` = verified drills per person for FireWorks entry. Your Day: `/api/training/todo` {confirm, verify, returned}
  (actions + tileBadges.training).
- Proficiency: `training_skill_checks` (met|not_met, status pending on unverified drills, else final). Skills in settings (`DEFAULT_SKILLS`,
  {id, label, every months, who = title regex, standard}); status per person/skill = latest final: current | due (within a month) | overdue |
  retrain (latest not met) | never. Officers/BCs record checks for their scope (not themselves).
- Views: `/company` (people summaries + proficiency + company drills), `/shift` (per-station rollups incl. "No home station").
- Roster history: `training_roster` (year, user/name, joined, left_on, officer/driver/driver_since, hire_date, suppression, source auto|manual,
  locked, changes[]). `syncRoster(year)` keeps the CURRENT year in step with accounts (rosterDivisions): new members join (Jan 1 when the
  year's roster is new, else hire date/today), deactivated / moved out -> left_on, title/station/shift/officer/driver changes logged.
  Hand edits (manage) lock a row. `roster/start {year}` seeds any year from today's accounts.
- PIAL: `pialTrainingData(year)` = roster members + non-superseded training records as pial.js trainingModel rows (src `nexus:<cat>`,
  delivery from the record or guessed, certs from pial_certs matched by name). `compute({trainingSource, year})`; PIAL setting
  `trainingSource` "pial" (default, its own imports) | "nexus". `GET /api/training/pial` = 580 items + 720 from Nexus vs the tracker now.
- UI `src/TrainingPlus.jsx` (DrillsPage, DrillEditor, DrillView + print, CompanyView + print, ShiftView, ProficiencyPage, RosterPage,
  PialEstimate, SkillSettings), wired into Training.jsx nav (Drills & proficiency, Views, PIAL, Admin › Skills & roles). Tests: e2e37.mjs (63).

## Emergency recall (migration 035)
- Policy 1010 (draft). Aladtec stays the system of record (members sign up, the AC approves/assigns there); Nexus never writes to it.
  `server/recall.js` (routes in the file header): `recall_events` (kind per 1010.3.1, start/end date ≤ 14 days, checklist jsonb keyed by
  `CHECKLIST` = 1010.3.2 / 1010.4 steps, optional imt_incident_id), `recall_members` (response '' | coming | impaired — no refusal,
  1010.3.4; eta, note, responded_via self|operator name, checked_in_at/by = roll call, released_at), `recall_units` (seats jsonb
  [{role officer|driver|ff, userId}], defaults by evals.js `unitKind`, special_ops, in_service_at = step 17), `recall_log` (timeline).
- Rights: start/close = master, recall manage, or job title matching settings.starters (Assistant Chief and above, per Michael);
  operate = starters + recall edit (e.g. Communications); board view = recall view; members see only their own row.
  Settings in `settings` key 'recall' {starters, officerTitles, driverTitles, portalUrl (Aladtec link from the policy), specialOps
  [{unit, location, note, people}]} (step 15's Special Operations Assignments list).
- Notice = messages.send important + privateReplies to everyone recalled (also when people are added later); impaired answers message the
  starter. Seat qualification flags: officer seat = officerTitles; driver seat = driverTitles or a final op-pumper/op-aerial result with
  every element passed.
- Aladtec mirror: aladtec.js `scheduleForDay(day, {fresh})` = one /scheduled-time request per shift day (07:00 → +24 h), cached 5 min,
  "Check Aladtec" refresh at most once a minute; up to 4 days per recall; members matched by normName.
- Your Day: `/api/recall/todo` {waiting (my unanswered recalls → top BRICK action "EMERGENCY RECALL: …" opening the recall), openBoards
  (operators)}; tileBadges.recall. UI `src/Recall.jsx` (MyRecall, StartRecall, Board + after-action print, RecallSettings); tile
  "Emergency Recall" for everyone. Access section `recall`. Audit module "Emergency recall". Tests: e2e38.mjs (27).

## Account requests (no migration)
- Request-an-account form has First name + Last name (both required); auth.js signup builds full_name from them (an older client's single
  `name` still works only with two or more words). Your Day "Needs your attention": "N new account requests are waiting for you" for
  accounts admins/masters (useYourDay reads `/api/auth/me` pendingCount; notifyCounts `accounts` dings), opening User Management.


## Fire Prevention + permission profiles (migration 036)
- `server/fireprev.js` (`/api/fireprev`, routes in the file header): `fp_properties` (Property # PK, area = Neighborhood, box =
  first-due station, district, active = in the latest import, excluded + reason), `fp_inspections` (UNIQUE property/day/inspector,
  source import|manual), `fp_imports`. `parseInspectionReport(rows)` finds the header (Property # + Date columns) and DateN/InspectorN
  pairs, merges repeated rows. Settings key 'fireprev' {districts {value: bool} (default regex St. George / SGnn / blank),
  excludeVacant, partialRecords, certified}. `coverage(from, to)` -> pial.js item p1022 (kind "inspections": 8 × inspected/counted ×
  0.75 partial, 0 if not certified; no data -> manual / last grading). Rights: fireprev view/edit/manage; division matching
  `FIREPREV_DIVISION` (access.js) = edit. Tile for masters, `me.access.fireprev`, or that division. UI `src/FirePrevention.jsx`.
  Real report (11/2026): 7,025 rows -> 6,892 properties, 6,839 counted, 6,046 inspected in 2026 (88.4%, 7.07 of 8).
- access.js SECTIONS now carry `tile` (everyone | access | users), `everyone` (what anyone gets), and `profiles` {profileKey: level}.
  `BUILTIN_PROFILES` (basic, chief, division, firechief with `all: "view"`); `builtinLevels(key)` from SECTIONS; `access_profiles`
  rows hold only local changes for built-ins ({add, remove}) or the levels of custom ones; `access_profile_members` (user XOR group).
  computeEffective adds profile levels (all divisions) with `via: "Profile: <name>"`, `profile`, grantId null. A new section: give it
  `tile`, `everyone`, and `profiles` so existing profiles pick it up on update.
- `/api/access` GET adds `profiles`, `profileOf`, `auto` (autoRules: Technology helpdesk edit, Fire Prevention division, recall starters
  and training officer/BC by job title). POST `profiles` {key?, name, description, levels}, `profiles/:key/assign` {userIds, groupIds},
  `unassign` {id}, `reset` (built-in), `remove` (custom). Masters only. Permissions.jsx: `personMatrix()` + ByPerson table, Profiles,
  ProfileEditor. Tests: testrun/e2e39.mjs (49).

## Investigations (arson) under CJIS (migration 037)
- `server/totp.js`: RFC 6238 TOTP (base32, `checkCode(secret, code, lastStep)` ±1 step, no replay) + `qrMatrix(text)` (QR byte mode, ECC M,
  v1–10, after Nayuki; verified with OpenCV). auth.js `mfa-status|setup|confirm|verify|reset` (users.totp_secret/pending encrypted with the forms
  key, totp_last_step, mfa_failures/first_fail/locked_at: 5 in 15 min -> locked until released by investigations manage/master, managers
  messaged); sessions.mfa_at / inv_seen_at; `MFA_HOURS` 12, `MFA_IDLE_MINUTES` 30. Failed password sign-ins are now audited ("Sign-in failed").
- `server/investigations.js` (`/api/inv`, routes in the header). `gate()`: access section `investigations` (edit/manage; no view level, no
  profiles) -> authenticator (locked / setup / fresh) -> CJIS list (`inv_cjis_people`: background + training within a year; `skipList` for the
  cjis routes so a manager can bootstrap). Need-to-know via `inv_members` (manage/master see all). `logView()` writes `inv_access_log`
  (append-only trigger) and fails closed (503 + hourly notice to managers). Encrypted: case `secret` {summary, causeNarrative, notes},
  inv_people.secret, inv_supplements.secret (append-only), inv_cji.secret + file, inv_files.data (forms.js `encryptBuffer/decryptBuffer`).
  `inv_dissemination` for CJI releases; purge nulls contents. Errors with `need` -> {error, need, missing}. Audit module "Investigations"
  (case numbers only). Your Day: `/api/inv/todo` {reviewDue (weekly, managers), trainingDue (30 days)}.
- UI `src/Investigations.jsx` (gate screens MfaSetup/MfaVerify with QrCode, CaseList + deconfliction lookup, CaseView tabs, CjisList,
  AccessLog + weekly sign-off; 30-minute client idle lock). Tile for masters / `me.access.investigations`. Tests: testrun/e2e40.mjs (49).

## Tickets: Help Desk + Gear desks, Send to, status updates (migration 040)
- `tickets.desk` 'helpdesk' | 'gear' (category CHECK dropped: TICKET_CATEGORIES / GEAR_TICKET_CATEGORIES checked in collections.js), `sent_to`
  jsonb [{kind group|user, id, name}], status adds `acknowledged` and `awaiting_delivery` (labels: Open, Acknowledged, Being worked on, On hold,
  Awaiting delivery, Resolved, Closed). `ticket_watchers` = who it was sent to (group members when sent + people picked): notified on the new
  ticket and on status updates, can see/follow/comment, but do NOT work it (Michael: end users don't assign; the desk's team does).
  `ticket_updates` (status, note, author) = status timeline; only the desk team (`deskLevel` edit: Help Desk = Technology/master/helpdesk edit;
  Gear = master/access section `gear` edit) posts them; a status change without a note still records one. New tickets: always notify the
  desk team (`deskTeam`: helpdesk techs; gear edit holders, else masters) plus watchers; non-team creators can't set status/assignee/due.
- GET `/api/tickets/routing` (any user) = groups to send to. Roster adds `gearTech`.
- UI (App.jsx): `DESKS` config; HelpDeskModule({desk, onInventory, initialScope}) serves both desks (tickets state keeps every desk; display
  filters `deskTickets`); `SendToPicker` in NewTicketForm; `TicketStatusUpdates` panel in TicketRow; nav "Sent to me". PPEModule nav/button
  "Gear tickets" -> HelpDeskModule desk="gear" (`initialView: "tickets"` via openWith). YourDay: "N new Help Desk/gear tickets need to be
  acknowledged" (team, open + unassigned), gear tickets assigned to me; tileBadges ppe. Tests: e2e44.mjs (27); e2e3 uses the status panel.

## Off Work (migration 041)
- `server/offwork.js` (routes in the header): `off_work` (user, start_day..end_day, kind off|vacation|training|ooo|remote|other, note,
  visibility everyone|division|people, people jsonb [{kind user|group, id, name}], created_by). Sick leave is NOT copied: `entriesFor()` reads
  `sick_entries` and merges consecutive days per person into "Out sick" (protected kinds -> just "Out", kind "leave"; never hours/notes/reasons),
  shown per settings key 'offwork' {sickVisibility everyone (default) | division | off}. Visible = owner, poster, offwork view, everyone,
  same division, or listed people/group members (live membership). Access section `offwork` (divisions): view = all, edit = post for people in
  the divisions, manage = settings. GET `/widget` -> Your Day `OffWorkWidget` (id "offwork", "Out today" + next 7 days). UI `src/OffWork.jsx`
  (Who's out, My days off, Post days off, Settings). Tile for everyone. Audit module "Off Work". Tests: e2e45.mjs.
- Part of a day (migration 043): off_work.start_time / end_time (estimated, "about"), location; kind `meeting` (Off-site meeting) turns on
  "Only part of the day" in the editor (to = from). Widget drops an entry from Out today once today's end_time has passed (server time).

## Board report (migration 042)
- `server/board.js` `/api/board` (meta, data, reports, settings): `boardData(from, to)` for our CAD agency (settings 'board'.agency, else PIAL
  cadAgency, else the St. George agency found in cad_incidents), dispatched calls only: kpis vs same dates last year, series (day <= 62 days,
  week <= 400, month), call types (settings categories or `DEFAULT_CATEGORIES`, first PG regex match wins; order alarms, fires, crashes, hazmat,
  EMS, service; use PG regex syntax, not \b), top natures, response times (received -> first on scene and assigned -> on scene, median/90th, per
  type, < 2 h), hours/dow averages, apparatus from cad_unit_responses (cadstats unitSettings pattern) + aid given (other agencies), structure
  fires (PIAL structureNatures), fp_inspections, training_records hours, verified drills, sick_entries totals, PIAL compute() score/class.
  `board_reports` saved layouts (window lastMonth | lastQuarter | ytd | lastYear | last30 | custom; blocks with optional title + comment text).
- Access section `board` (view = build/save/print, manage = settings); Fire Chief profile sees it via all:view. Tile "Board Report" for masters /
  `me.access.board`. UI `src/BoardReport.jsx` (templates monthly/quarterly/annual, Builder like CommsStats ReportBuilder, Paper "REPORT TO THE FIRE
  BOARD", print portal, Settings: agency + call types). Tests: e2e45.mjs (prints a 3-page Letter PDF).

## Command Board (migration 044)
- `server/command.js` `/api/command`: one board per CAD incident (`command_boards`, state jsonb applied one action at a time under SELECT FOR
  UPDATE, version++). Every action also writes `command_events` (append-only trigger; critical flag = red). Actions: crew_add/move/assign/names/
  place, par_crew, par_complete, strategy (offensive->defensive is critical), attack, benchmark, mayday/mayday_clear, note {critical}, smoke
  {side, volume, velocity, density, color}, scene {view, aSide, building}, close/reopen. `sideOf(building, aSide, x, y)` -> "A side" / "B/C
  corner" etc. (A = the edge the front faces, then clockwise B, C, D; scene space 1280x1280, same for diagram and USGS aerial).
- Opened from Active calls (button on any call whose nature contains FIRE; officers only until a board exists). Crews come from the CAD units;
  units CAD adds later join on the next GET. `ridersFor(units)`: Aladtec on-duty assignments whose schedule/position names the unit ("EG653",
  or "Engine 653" = same first letter + number), else directory `users.call_sign` (Directory card "Radio call sign"). Active calls unit chips:
  hover = names, click = ride list.
- Rights: everyone watches; edit = master, access `command` edit, or job title matching settings 'command'.officerTitles (default
  chief|battalion|captain|lieutenant|bc|ac). PAR every 13 min until 60 min after the call was received, then every 10 (client `parInterval`).
- Saving: every tap is a POST; offline taps queue in localStorage (`sgfd-cmd-queue-<id>`) and replay. Board polls every 3 s with ?v=.
- Emergency mode: an officer with an open board open on screen -> `src/emergency.js` setEmergency(true): chime/tones silent, MessageCenter
  no toasts / desktop notifications / important banner (unread counts and chat still work), banner "EMERGENCY MODE · Command Board active".
  Board GET ?em=1 -> `server/emergency.js` markEmergency (30 s); push.js sendToUser skips (except test pushes).
- Close = the record: completed_by (Personnel File tab "Command boards", GET /person/:id), report_html (GET /:id/report, ?download=1; no
  scripts, CSP), fire_recordings.command_board_id set for the same incident number (also on recording import; attach/remove by hand in the
  recording view, audited). Audit module "Command board" (open/close). Tests: e2e46.mjs.
- Boards by hand (migration 045: kind incident|training, from_cad, title): POST /new {kind, title, nature, address, findAddress (Census
  geocoder, GEOCODER_BASE), number, units, copyFrom (training "Run again": same units/address/building/aerial, fresh state)}. incident_id
  `manual-<uuid>`. Training: blue TRAINING bar, no emergency mode, "End training" -> Save (close; listed forever under Saved training boards)
  or Discard (POST /:id/discard, training only, deletes). Incident boards can't be discarded.
- Smoke readings carry an optional floor (`floorOf`: 1–150, Basement, Attic, Roof); `st.smoke` is keyed side|floor so each side and floor keeps its own latest reading. e2e46 checks it.
- Who runs a board (no migration; `state.command` {icId, icName, editors [{id,name}] ≤ 8}; older boards = opener is IC via `commandOf`):
  `roleOn(b, user, r)` = ic | editor | officer (has Command edit, not on the board: watches, may `assume_command`) | watch. Changes need ic/editor;
  the IC alone closes, adds/removes editors (`editor_add/remove`, any active account: GET /api/command/people) and `transfer_command`. Assume /
  transfer keep the previous IC on as an editor. A closed board reopened by an officer makes them IC. Emergency mode = ic/editor only. Board
  JSON adds command, role, isIc, canAssume; the report names the IC and editors. UI `CommandLine` + `PersonPick` in CommandBoard.jsx.
- Scene picture: POST /:id/aerial {range closer|normal|wider = 500/800/1500 ft, or feet; dx, dy = re-center on a tapped point of the current
  aerial} fetches USGS at 2048 px (`fetchAerial({size})`); POST /:id/picture {picture {mime, data, width, height}, credit} = an uploaded
  picture (no scale). state.imgLat/imgLon/imgFtPerPx/imgCredit; a new picture takes units off the scene (they stay on the board). The Scene
  SVG zooms/pans by viewBox (wheel, pinch, drag the background, + − Fit); unit tags and side letters scale by vb.w/1280 to stay screen-size.
- Benchmarks include `primaryStart` / `secondaryStart` (Primary / Secondary search started) before each all clear.

## TV display screens / dashboard mode (migration 046)
- `server/display.js` `/api/display` (routes in the header; mounted in index.js BEFORE the signed-in check). A screen is not a person:
  `display_screens` (name, token_hash, settings {views, seconds 8–120, switchToBoard}, last_seen_at) + `display_pairings` (6-char code,
  15 min). The TV at `/display` (main.jsx lazy-loads `src/Display.jsx` so App.jsx's circular import order is untouched) POSTs `pair` ->
  HttpOnly cookie `sgfd_display` (Path=/api/display, SameSite Strict, 400 days) + code; an accounts admin / master enters the code in
  User Management › Display screens (`src/DisplayAdmin.jsx`). Sign out = token_hash NULL. Audit module "Display screens".
- Views (`VIEWS`): duty (Aladtec, no time off, station phones stripped), weather, oncall (callout_entries today), classes (approved
  bookings today), calls (Active calls, with addresses: opt-in, warning in the UI). `switchToBoard`: GET /boards every 10 s; open
  incident boards (never training) take over the screen read-only (`Board` from CommandBoard.jsx with `display`: DisplayFrame instead of
  AppShell, no back/record buttons, no emergency mode, data from /api/display/board/:id, aerial from /api/display/image/:id), several
  rotate every 30 s; closed -> back to cycling. `AutoScroll` (Display.jsx): anything taller than its space pauses 4 s, scrolls 45 px/s,
  pauses; a view reports how long that takes (`onNeed`) and stays up at least that long; the board (`loop`) scrolls back up and repeats.
  Tests: e2e47.mjs.


## Security review fixes (Nov 2026, no migration)
- `/api/files/:id` (legacy file store): `canReadFile` = uploader, master, or someone whose collection read (requisitions, reimbursements, tickets,
  quotes, contracts, certifications, gear via `LINKS`) contains the id; else 404. `putFile` refuses to replace a stored file that is linked or
  someone else's (same bytes = no-op); DELETE only when readable.
- `/api/ai/messages` pass-through removed. Push subscribe only to browser push hosts (`PUSH_HOSTS`, + PUSH_EXTRA_HOSTS; PUSH_ALLOW_HTTP skips for tests).
- `server/saferegex.js` `risky(p)`: nested repeats / back-references refused wherever patterns are entered (stats unit filter incl. the GET
  query, board call types, command officer titles, PIAL settings, recall titles).
- `server/ratelimit.js` `allow(key, max, ms)`: signed-out non-GET 120/min per address + 256 KB bodies (auth, display); login 30/min per
  address; signup 10/hour per address. Loopback is exempt unless RATE_LIMIT_LOOPBACK=on (set it if a same-box reverse proxy is ever added).
  Login always runs scrypt (`DUMMY_HASH`) so unknown emails take the same time. `/api/command/person/:id` for others = officers/managers/masters.
- Tests: testrun/e2e48.mjs (24). Review write-up: Claude Doc "SGFD Nexus — Security & IP Review (Nov 2026)".

## Sign-in hardening (migration 047)
- Password rule (`passwordProblem` / `checkNewPassword`, mirrored in SignIn.jsx `RULES`): 10+ chars, a capital, a lowercase, a symbol
  (space counts). `users.password_changed_at` (migration starts everyone's clock), expiry PASSWORD_MAX_DAYS (90): at login an older one
  sets must_change_password + `must_change_reason` 'expired' (AuthGate ChangePassword says "90 days old"); admin temp passwords
  ("Ember-hydrant-4821") = 'temp'.
- Two-step sign-in for master and accounts admins (`mfaRequired`; MFA_ADMINS=off only for tests — testrun/run-some.sh exports it):
  login starts a `sessions.mfa_pending` session (10 min) that `getSessionUser` ignores unless `{allowPending}` (only /api/auth/* gets it,
  as handleAuth's 7th arg `pending`). /me (signed out) returns `mfaPending {setup, locked, name}`; mfa-setup / mfa-confirm (returns 10
  recovery codes, sha256 in `users.mfa_recovery`) / mfa-verify (a code or a recovery code `xxxx-xxxx`, once) finish it. Same authenticator
  as Investigations. mfa-reset: masters, accounts admins (not of masters), Investigations managers; AccountsPanel "Release authenticator" /
  "Reset two-step sign-in". mfa-recovery {code} = new codes (Sessions.jsx `TwoStep`).
- Forgot password: POST /api/auth/forgot {email} (same answer always; 5/15 min per address, 3/hour per email) -> `password_resets`
  (sha256 token, 30 min, single use) -> email via `server/mail.js` (own SMTP client: STARTTLS / implicit TLS, AUTH LOGIN; SMTP_* in .env)
  with `${PUBLIC_URL}/reset-password?token=`. reset-check / reset {token, password, code?}: people with an authenticator also give a code;
  all sessions ended; confirmation email. No SMTP = /me resetByEmail false, the page says ask an accounts admin.
- App code only after sign-in: vite builds two pages (vite.config.js inputs index.html + signin.html -> src/signedOut.jsx ->
  src/SignIn.jsx, which must never import App.jsx). index.js serveBuilt: HTML for anyone without a session (or paired display cookie,
  now Path=/) = signin.html; .js/.css not reachable from signin.html (`publicScripts()` follows its tags and imports) = 404 without one.
  No dist/signin.html (old build) = old behavior. AuthGate renders SignInRoot when signed out (dev mode has no gating).
  Test build: build.sh also esbuilds dist/signin.js + dist/signin.html. Note the file is signedOut.jsx: Windows can't hold
  signin.jsx next to SignIn.jsx. Tests: e2e49.mjs (56); test password is "Correct horse battery".

## Which calls count + pending cleanup (migration 048)
- `cad_incidents.zone` (CAD response area; stats view column `zone`, found by name in scripts/cad-stats-view-sgfd.sql: Response_Area > Zone >
  Response_Zone > ResponseArea; uploads accept a Zone / Response Area column). `cad_stats_settings.include` [{agency, zone}] (zone "*" = whole
  agency; [] = every call) + `drop_blank` (default true: no agency or no call type = duplicate / linked / appended / test records).
  `scopeSql(set, params)` is appended by `where()` (readFilters puts `f.scope`) so every page, chart, report and LY comparison follows it; meta's
  agency list too. Plain column names on purpose (joined queries prefix `agency` by text replacement). POST /api/stats/admin/scope
  {include, dropBlank} (manage, audited); admin GET returns `areas` (agency, zone, n, untyped). UI: CommsStats.jsx `ScopeCard`
  ("Check zones by number"). Michael (11/2026): count only Baton Rouge zone 1213 and Zachary zones 1389L / 1389I.
- Active calls: CAD_PENDING_MAX_MINUTES default 10 (was 4 hours; CAD_PENDING_MAX_HOURS still read); a call with no units and no call type is left off at once (`untypedPending`).
- Tests: testrun/e2e50.mjs (21; CAD_STATS_TEST_FILE=stats-scope.json).

## Force Back, Team time, System page, cert-progress import (migration 049)
- `server/forceback.js` `/api/forceback` (routes in the header): `fb_lists` (name, division = permission scope, steps text), `fb_members`
  (user_id nullable, name, shift free text, last_fb NULL = never = top, last_by initials, active), `fb_log` (append-only trigger; kinds
  forced|oncall|no_answer|excused|note|added|removed|changed|imported, initials from the actor's name). Order = last_fb ASC NULLS FIRST.
  forced/oncall set last_fb (never backwards) and message the person (important, `notify` default on). Import = the Comms workbook
  (Employee "Last, First", Shift, Force Back Date, Entered By; preview first; names matched to accounts). Access section `forceback`
  (divisions): anyone on a list sees it; view/edit (log)/manage (people, dates, import, lists). UI `src/ForceBack.jsx`. Audit "Force back".
- Time Tracker: side bar "Team time" (one item) -> `TeamTime` = groups (division + crew from work_pattern) -> people with this period's
  hours, plus "Find a person". The "Whose time" select stays.
- System (User Management › System, masters): `server/system.js` `/api/system` + `src/SystemAdmin.jsx`. Upload a release zip (checked:
  everything under app/, no .env/secrets/node_modules/.git, no `..`, has package.json/server/index.js/src/main.jsx/scripts/update.ps1;
  VERSION.json = version + notes; new migrations listed) -> updates/incoming. Actions install|restart|rollback|backup need a TOTP code in
  the last 5 min (`sessions.mfa_at`; the page calls /api/auth/mfa-verify, errors carry `need: "code"`, index.js passes `need` through) ->
  updates/pending.json + `schtasks /Run /TN "SGFD Nexus Update"` (UPDATER_COMMAND in tests). `scripts/apply-update.ps1` (task copy in
  tools\updater, refreshed after each good install; made by `scripts/install-updater.ps1`, once, admin): backup.ps1 -> snapshot app code to
  updates\previous\app (never node_modules/.git/secrets/uploads/tmp/logs/.env) -> robocopy /E new files over -> update.ps1 -> on failure
  restore the snapshot (code folders mirrored) and update.ps1 again. Result in updates/last-result.json (+ logs/update-<time>-<action>.log).
  Every release zip now carries VERSION.json. Audit module "System". Tests: e2e51.mjs (fake-updater.sh; SYSTEM_DIR=testrun/sysroot).
- PIAL certs import: aliases for FireWorks' "Training Certification Progress" report (CertificateName / StaffName / StartDay /
  ExpirationDay / HoursNeeded; camelCase headers also match in pial.js and training.js via `normCamel`). "PIAL -" lines and yearly
  hour requirements (Jan 1–Dec 31 with hours needed) are skipped; one row per person + certificate (latest date). Communications titles
  (`NOT_IFSAC_RE`) never count as IFSAC.

## Call alerts (migration 050)
- `server/callalerts.js` `/api/callalerts` (routes in the header). `call_alert_rules` (owner_id set = someone's own alert, else department
  rule with recipients [{kind user|group, id, name}]; match {agencies, types (substring words), exclude, units (EG61*, ??613: whole call
  signs), priorities}; important; on_duty_only (Aladtec onDuty assignments, names matched loosely; ignored when Aladtec has no data);
  show_address (off by default: lock screens)), `call_alert_mutes` (per person, department rules), `call_alert_sent` (PK rule+incident =
  once per call; people -1 = call was already open when the rule was saved, so no retro alerts; kept 30 days).
- cad.js refreshCalls -> `checkCallAlerts(calls)` after every check: calls received within CALL_ALERT_MAX_AGE_MINUTES (30), `callMatches()`
  (a unit filter makes it fire when that unit is assigned), claim row first, then push.js sendToUser (important -> high urgency; skipped in
  Command Board emergency mode) + live event "callalert" -> live.js "sgfd-callalert" -> MessageCenter red pop-up (role alert "Call alert",
  important tone; desktop Notification when in the background and push isn't on here). Push url `/?calls=1` -> home (Active calls).
- Rights: everyone = own alerts + mute department ones; access section `callalerts` edit = department rules (audited, module "Call alerts").
  UI `src/CallAlerts.jsx` (tile "Call Alerts": My call alerts, Alerts for people & groups; editor with "Check against calls open now").
  Tests: e2e52.mjs (29; CAD_TEST_FILE=calls-alerts.json, PUSH_ALLOW_HTTP=1, LIVE_EVENTS=on, push stand-in on :3112).

## System page: server settings + progress bar (no migration)
- `/api/system/env` (masters): `envState()` = every key in .env.example (section from "# --- X ---", description = comment lines just
  above) plus keys in .env; `SECRET_KEY` names (PASS/SECRET/TOKEN/_KEY/...) never leave the server (only set / not set), `LOCKED_KEY`
  (PG*, PORT, HOST, HTTPS_*, FORMS_KEY*, UPLOAD_DIR, SYSTEM_DIR, UPDATER_*...) can't be changed here. POST {changes} / env/restore {name} need
  the 5-minute code: backup to updates/env-history (last 30; the folder is admins+SYSTEM only), then the file is rewritten IN PLACE (keeps
  its ACL and line endings; values quoted only when needed; new keys under "# --- Set in Nexus"). Audit lists key names only. ENV_FILE
  overrides the path (tests). UI: SystemAdmin.jsx `EnvCard` ("Show settings", Save N changes, Restart now to use them, earlier copies).
- Progress: apply-update.ps1 `Progress n total label` writes updates/progress.json (install = 6 steps, rollback 2, restart/backup 1),
  removed in Finish; GET /api/system returns `progress`. `ProgressCard` (role progressbar "Updater progress"): striped bar, Step n of N,
  elapsed, "Nexus is restarting" while the server is down; reopening the page picks up a pending job. CodeDialog is generic
  ({title, note, run}). Tests: e2e53.mjs (25; ENV_FILE, FAKE_UPDATER_MS).
- Updater hardening (11/2026: the first install from the page left the service stopped): apply-update.ps1 puts the node folder
  (D:\sgfd-nexus\nodejs or Program Files\nodejs) + the machine PATH first, gives npm tools\npm\cache|prefix, logs whoami/node/npm
  versions, and `Finish` calls `Ensure-Running` (Start-Service if stopped; the message says whether Nexus came back). update.ps1 finds
  npm on PATH or next to node and starts the app again if npm is missing. After shipping a changed apply-update.ps1 the task's copy in
  tools\updater only refreshes after a successful install, so a broken copy needs install-updater.ps1 run again on the server.
- mail.js cmd(line, ok, label): AUTH LOGIN user/password lines are never echoed in errors (11/2026 the base64 password reached sgfd-app.log and the audit log).
- Root cause of the first failed install: PS 5.1 + ErrorActionPreference Stop + `2>&1` on a native command turns npm's stderr warnings into a terminating error. Run-Script runs child scripts with Continue, lines as text, exit code decides.
- updates/*.json from PowerShell: readJson strips a UTF-8 BOM (PS 5.1 Set-Content -Encoding UTF8 adds one; the page waited forever); apply-update.ps1 now writes them with [IO.File]::WriteAllText (no BOM). fake-updater.mjs writes a BOM on purpose.
- npm audit (11/2026): esbuild <=0.24.2 (GHSA-67mh-4wv8-2f99) via vite 5 = dev-server only; production never loads vite (only `vite build` in update.ps1), so not reachable. Don't `npm audit fix --force` (jumps to vite 8). TODO: planned vite upgrade as its own release (registry is blocked in the build sandbox, so it can only be tested on the server; the updater rolls back a failed build).
- Comms stats labels (11/2026, Michael: nobody knew what P50/P90/Within meant): Typical (P50), 9 in 10 under (P90), Unit assigned within <goal>; explainer in Call-taking › How to read this. people(): blank cad_id rows dropped from the table and shares, returned as `unrecorded` (note under the table).
- Anthropic workspace (11/2026): askClaude sends `anthropic-workspace-id` when ANTHROPIC_WORKSPACE_ID is set (keys not scoped to a workspace
  are refused without it); a "workspace" upstream error tells the admin to set it in System › Server settings. Not a secret (shows in the editor).
- Sick Leave shifts (11/2026): POST /api/sick/shifts {shifts: [{userId, pattern}]} (sick edit for the person's division) sets users.work_pattern
  (same values as the punch clock; clears the access cache and dept cache; audited "Set a shift" with old -> new). UI: People banner "Set their
  shifts" (SetShifts dialog, people without a shift), PersonShift on the person page, and side bar page "Shifts" (ShiftsPage: everyone
  the editor covers, badge = no shift). Tests in e2e30.
- Messages reply box: Enter sends, Shift+Enter = new line (ignores IME composition); same as the chat panel. New-message compose keeps Enter = new line. e2e20.

## Ownership, branding, sandboxes (11/2026, no migration except 051)
- Michael (11/2026): the Nexus framework / software suite is HIS property (built on his own Claude account, largely at home); the
  "SGFD Nexus" install, its configuration and SGFD's own content belong to SGFD. Keep SGFD content out of generic/sandbox/commercial
  builds: the St. George seal (App.jsx SGFD_LOGO, public/logo-large.png) and knight/dragon emblem art, forms from SGFD's JotForm
  (formSeeds*.js), evaluation programs generated from SGFD documents (evalSeeds*.js) and the radio scenarios linked to them, PIAL
  grading (migration 020 baseline), the Aladtec portal URL. Still SGFD-shaped in code (generalize before selling): Leave Picks
  DEFAULT_RULES (SGFD memos), Recall CHECKLIST (SGFD Policy 1010), injury forms' Louisiana/EBR defaults, Comms transfer label.
- `server/brand.js` (ORG_NAME, ORG_SHORT, ORG_PLACE, APP_NAME, BRAND_ASSETS_DIR, SANDBOX, SANDBOX_NOTE; St. George defaults):
  `brandHtml()` puts `<meta name="nexus-brand" content=json>` + title into every served HTML page (index.js serveBuilt), `brandManifest()`,
  `BRAND_FILES` served from BRAND_ASSETS_DIR (sandbox default public/brand-sandbox: generic Maltese-cross "N" set made with PIL),
  `brandText/brandDeep` rename text in seeds and AI prompts. Client `src/brand.js` BRAND (reads the meta; never import App.jsx there).
  Every user-visible "St. George"/"SGFD" in src and server now goes through BRAND / brand(). App.jsx LOGO_DATA_URL = SGFD seal only
  when short is SGFD and not a sandbox, else `${origin}/logo-large.png`.
- `server/demoSeeds.js`: `departmentContent()` (DEPARTMENT_CONTENT, default on except sandbox). Off = DEMO_FORM_SEEDS (supply order,
  equipment damage, ride-along) + DEMO_PROGRAM_SEEDS (demo-officer), and only sim scenarios with no program link.
- Sandbox (SANDBOX=on, locked in the System settings editor): `src/SandboxBanner.jsx` on SignIn Shell and AppShell; sign-up requires
  "Your department or agency" (users.signup_org, migration 051; accounts list `organization`, PendingRow "From:"); Investigations tile
  hidden and /api/inv 404; CAD_DEMO (default on in a sandbox without CAD): `server/cadDemo.js demoCalls(now, lat, lon)` deterministic
  per 7-minute slot, units EG111/LD121/MD131/BC1.
- `scripts/sandbox/seed-demo.mjs` (refuses unless SANDBOX=on; once, marker settings 'sandbox_seed'): stations 11–14 + HQ/Training
  Center, ~59 fictional people (@demo.example.org, no password) on A/B/C and comms A–D, vendors, 12 requisitions in every status
  (sgfd.importing), tickets, announcements, sick history (two holiday-pattern people), off work, Comms force-back list, IT on-call,
  settings (stats_units ^([A-Z]{2}1[1-4]1|BC\d+)$, board agency DEMO FD, recall portalUrl ''), PIAL baseline removed, group
  "Sandbox testers" (all roles) with the firechief profile (everyone views everything). `--export-accounts f` / `--import-accounts f`
  keep real sign-ups across a reset. `scripts/sandbox/make-demo-stats.mjs calls.json units.json`: 540 days to yesterday, per-day seeds
  (re-running only adds the new day), agencies DEMO FD (zones 11–14), Northside FD, Lakeview FD.
- Linux kit `scripts/linux/` (Ubuntu 22.04/24.04, /opt/nexus/{app,updates,logs,backups,certs,tools,data}, user nexus):
  install-ubuntu.sh (--domain --email --sandbox|--no-sandbox --org --short --place --app-name --timezone --lat --lon; NodeSource 22,
  apt PostgreSQL, role nexus_app/db nexus, .env with PORT 443 + HTTP_REDIRECT_PORT 80 + PEM certs + UPDATER_COMMAND=/bin/true;
  Let's Encrypt standalone with pre/post hooks stopping/starting nexus + deploy hook copying PEMs to certs/), nexus.service
  (CAP_NET_BIND_SERVICE, log to logs/sgfd-app.log), nexus-update.path (PathExists updates/pending.json) -> nexus-update.service ->
  tools/updater/apply-update.sh (bash twin of apply-update.ps1: progress.json, last-result.json, rsync snapshot/restore, update.sh),
  update.sh (npm install if package.json newer, build, restart, wait for https://127.0.0.1/), backup.sh (pg_dump -Fc + uploads/secrets
  tar once per 20 h, 14 days), nightly.sh via nexus-nightly.timer 02:15 (backup + new demo stats day), reset-sandbox.sh (type RESET;
  backup, export accounts, drop/create db, start, seed, import accounts; --wipe-accounts). First admin: SSH tunnel
  `ssh -L 8443:127.0.0.1:443` (first-run is localhost-only). Tested here with stand-ins for systemctl/sudo/rsync (no systemd in the sandbox).
- Tests: testrun/e2e54.mjs (sandbox), build.sh copies scripts/ and public/brand-sandbox.

## Module licensing (11/2026, no migration)
- Michael (11/2026): commercial plan = core framework + modules unlocked per customer; hosted by Avexon (MSP, server side) by default,
  on-prem by exception; new market name (Sonatype holds NEXUS software trademarks); his own LLC. Build order: licensing -> branding/wizard
  -> environments (prod/test/training + switcher) -> protection packaging (compiled/obfuscated per-customer builds, fingerprint, containers)
  -> retail flavor.
- `src/modules.js` (shared by server, screens, license manager): `CORE` {tiles, api, collections} always on; `MODULES` [{key, name, group,
  tiles, api, collections, needs, desc}]; `withNeeds`, `moduleOfTile/Api/Collection`. Keys are written into licenses: never rename.
- `server/license.js`: Ed25519-signed file (LICENSE_FILE, default <SYSTEM_DIR>/license/nexus.lic; `-----BEGIN NEXUS LICENSE-----`
  base64url(payload JSON).base64url(sig)); payload {v:1, kid, id, customer, product, modules (or ["*"]), environments, hosts (*.wildcards),
  seats, issued, expires, graceDays}. Public keys in `KEYS` (dev key only works when PUBLIC_URL is empty/localhost; Michael's production
  key to be added when he runs keygen). `licenseState()` (30 s cache): no file -> `buildFlags.REQUIRE_LICENSE` ? core : full (St. George,
  dev); bad file -> core + error; expired -> warning through grace, then core. `apiAllowed`, `collectionAllowed`, `moduleOn`, `seatLimit`,
  `licenseSummary`, `installLicense` (keeps .previous). `server/buildFlags.js` REQUIRE_LICENSE=false in source (customer builds set true).
- Enforcement: index.js 404 `{locked:true}` for non-core API parts of locked modules; collections GET -> {value:null, locked}, writes 403;
  startup seeds/jobs only for licensed modules (forms seeds, evals seeds, CAD poller, stats sync, transcripts; deliveries always);
  auth approve refuses past the seat limit (active approved accounts with a password). HTML meta nexus-brand carries `modules` ->
  src/brand.js `moduleOn/tileOn`: App tiles filtered + activeModule guard, YourDay Widget hides by WIDGET_TILE, ActiveCalls, chat button.
- System page `LicenseCard` (SystemAdmin.jsx): status, customer/id/issued/expires/users/environments/hosts, modules on/off by group,
  "Install a license file" (5-minute code; POST /api/system/license {text} checks before saving, audited "Installed a license"), restart.
- License Manager lives OUTSIDE the app (/home/claude/license-manager: nexus-license.mjs keygen|modules|issue|show + copy of modules.js +
  README). Test keys: testrun/keys (dev-private.pem, lakeview.lic, expired.lic, hosted.lic). Tests: testrun/e2e55.mjs (19).
- Open: when Messaging isn't licensed, other modules' notices still go to the (hidden) inbox -> decide: Messages in core, or a core
  "Notifications" inbox. License `environments` not enforced yet (Phase 3). LICENSE_FILE locked in the settings editor.
- Notifications (11/2026, migration 052): message_threads.kind adds 'notice'. messages.js `send()` makes a notice unless `b.kind === "message"`
  (only the POST /api/messages route passes that); notices skip auto-replies. Core API /api/notices (handleNotices: list ?box, summary,
  :id read-only, read-all, bulk) = notices sent to the user by someone else. `src/Notifications.jsx` (core tile "notifications", shown only
  when Messaging isn't licensed; badge = unread notices); App redirects "messages" -> "notifications" without Messaging; YourDay and live.js
  read /api/notices/summary then. GET /api/messages/people stays open (Recall uses it). Module names/groups in src/modules.js are neutral
  (business + government): Communication, Finance & Purchasing, Workflow, Workforce, Training & Development, Public Safety, Analytics &
  Compliance. In-app labels still SGFD wording until per-customer terminology (branding phase).
- `src/licensing.js` holds moduleOn/tileOn (NOT brand.js): the public sign-in bundle must not contain the module catalog (e2e49 checks
  signin.js for Requisition|Command Board|PIAL). signin.html's nexus-brand meta carries no `modules`.

## Products: Nexus vs Fenmorix OS (11/2026, no migration)
- Two presentations of one codebase. `server/brand.js product()`: "nexus" = St. George's own install (no ORG_NAME/ORG_SHORT, not a sandbox) — name "SGFD Nexus", St. George's exact colors (src/brand.js NEXUS_THEME), seal/knight art. Must look unchanged. "fenmorix" = Fenmorix OS by Fenmorix Technologies, LLC — every other install, sandboxes included. `PRODUCT=nexus|fenmorix` overrides.
- Fenmorix assets: `public/brand-fenmorix/` (emblem, hero art, icons, favicon, watermark, `brand-wordmark.png` lockup, `vendor-logo.png`), served for the same file names as St. George's; a customer folder (BRAND_ASSETS_DIR) wins, then the Fenmorix set (`brandFilePath`).
- Colors: `makeTheme()` in src/brand.js builds sidebar/sign-in/active pill/rules from Fenmorix Orange #FF7900, Burnt #C94D00, Arctic Blue #55CFFF, Midnight Navy #08131D, Carbon Black #050709, Titanium Silver #C5CAD0; THEME_ACCENT / THEME_ACCENT_DARK / THEME_GLOW / THEME_NAVY / THEME_BLACK / THEME_SILVER in .env replace them per customer. AppShell, SignIn and Brand read `THEME`, never hard-coded red.
- Sign-in shows the product subtitle and the Fenmorix copyright line; the sidebar footer shows "Fenmorix OS · Fenmorix Technologies, LLC". The splash uses the lockup image when `brand.wordmark`.
- Product name in text: never write "Nexus" in page text or server messages. Client: `import { PN } from "./brand.js"` (JSX `{PN}`, strings `"... " + PN`, attributes `title={"..." + PN}`). Server: `brand().productName` (or `brand().app` for the full app name, e.g. CAD appName, authenticator issuer). St. George still reads "Nexus". e2e54 fails if a sandbox section shows "Nexus".
- Branding page (User Management › System, master admins; Fenmorix OS installs only, St. George's Nexus = no card, POST 409): `src/BrandingAdmin.jsx`
  (BrandingCard; uses SystemAdmin.jsx's exported `call` / `CodeDialog`) + system.js `brandingState` / `saveBranding` (GET/POST /api/system/branding,
  /branding/logo {files: {name: dataUrl}}, /branding/remove {all|files}; 5-minute code; audited "Changed the branding" / "Changed the logo" /
  "Removed logo files"). Saved in `<SYSTEM_DIR>/branding/branding.json` {org, short, place, app, colors {accent, accentDark, glow, navy, black,
  silver}, terms {tileKey: name}} + `branding/assets/` (outside the app folder: updates keep it; backup.sh / backup.ps1 archive branding + license
  as settings-*.tar.gz / sgfd-settings-*.zip). server/brand.js `savedBranding()` (mtime cache) wins over ORG_* / THEME_* in .env; brand files:
  branding/assets, then BRAND_ASSETS_DIR, then public/brand-fenmorix.
- Logo -> icon set is drawn in the browser (`makeIconSet`: emblem 512, hero 640, logo-large 512, icon-192/512 + maskable + apple-touch on the
  side-bar color, favicon.ico = PNG-in-ICO 16/32/48, watermark 1600x1000 JPEG); the wide name logo -> brand-wordmark.png ≤ 1200 wide. The server
  only checks names (BRAND_FILES), magic bytes vs extension and size (3 MB).
- Menu names: `TILE_LABELS` in src/modules.js (key, label, section alias); licensing.js `tileName(key, fallback)` (App tiles) and `sectionName()`
  (AppShell maps the section name it's given). BRAND.terms from the meta. Theme adds `sectionLabel` (side-bar section heading color).
- Tests: testrun/e2e56.mjs via `run-brand.sh` (both modes; the test itself needs SYSTEM_DIR / NEXUS_MODE, which run-some.sh doesn't pass).
- New customer flow (11/2026): License Manager `new-customer` -> kit folder `customers/<slug>/` (license.lic, branding.json with
  `setup: "pending"`, customer.json {org, short, place, domain, timezone, lat, lon, license}, logo.<ext>, INSTALL.txt for Avexon) ->
  `install-ubuntu.sh --kit DIR` (real install: SANDBOX=0, PRODUCT=fenmorix + ORG_* in .env; license -> <ROOT>/license/nexus.lic; branding.json
  -> <ROOT>/branding/ only if missing; logo -> <ROOT>/branding/setup/logo.*; DOMAIN/timezone/lat/lon from the kit unless given) -> brand()
  `setupPending` (fenmorix, not sandbox, setup "pending") -> App.jsx shows `SetupWizard` (BrandingAdmin.jsx) to master admins: Welcome (license
  modules) / Name / Logo (GET /api/system/branding/setup-logo, served sandboxed) / Colors / Menu names / Finish (one code: logo files, then
  branding with `setup: "done"`, audited "Finished the setup wizard"). "Do this later" = sessionStorage `sgfd-setup-later`.
  Tests: testrun/e2e57.mjs via `run-kit.sh` (17). install-ubuntu.sh --kit was run here with stand-ins for apt/certbot/systemd/psql/npm.
- Still to do: terminology beyond menu names (Shift/Station/Division words inside sections, Your Day widget titles); Windows on-prem kit
  (install-prereqs.ps1 has no --kit yet).
- License Manager (outside the app, Michael's computer): default product "Fenmorix OS". The license file header stays `NEXUS LICENSE` (format, never change).
- Production signing key: `key-2026-11` (Fenmorix Technologies) is in server/license.js KEYS. Its private key lives only on Michael's computer (License Manager folder). Licenses signed with it work on real servers; "dev" licenses still only on localhost/empty PUBLIC_URL.

## Retail modules: Spot Prices + Quick Links (11/2026, migration 053)
- First retail customer: Louisiana Gold & Coins (Michael's wife LaurAnn's precious-metals shop, Baton Rouge; on-prem, reached over Tailscale).
  Wanted: time clock, sick/days-off calendar, messaging, frequently used links with logins, a live spot-price ticker. Her purchase system
  (seller driver's license, EBRSO Pawn Division reporting/hold) stays as is unless she asks.
- Opt-in modules (`optIn: true` in src/modules.js): never on an install without a license (St. George gets `STANDARD_KEYS`), never in "all"/"*";
  a license names them ("all,spot,links" -> modules ["*", "spot", "links"]). access.js sections with `module` only show when it's licensed
  (`shownSections`); display.js offers the "spot" TV view only when licensed (`offeredViews`). e2e56 (Nexus mode) checks SGFD has neither.
- `server/spot.js`: providers nfusion (her website's data source; SPOT_API_URL default https://api.nfusionsolutions.biz/api/v1/Metals/spot/summary,
  token in SPOT_API_KEY — field names parsed loosely by `parseNfusion`; CONFIRM against her real account), metalpriceapi (latest; USDXAU = $/oz),
  demo (labeled made-up walk; default on sandboxes), test (SPOT_TEST_FILE). SPOT_REFRESH_SECONDS 60, 30 min while markets are closed
  (Fri 5 pm–Sun 6 pm New York). One fetch for everyone; spot_points (35 days) for day/week(30 min)/month(3 h) history; change = source's, else
  vs the first reading of the day. GET /api/spot, /api/spot/history, POST /api/spot/refresh (masters, once a minute). Michael asked to "pull
  the ticker from her site": her site's prices come from an nFusion widget (JS, her widget token) — not scraped; ask nFusion for an API token.
- Client `src/Spot.jsx`: `useSpot()` (one shared poll per page, useSyncExternalStore), `SpotTicker` (AppShell, every page, under the sandbox
  banner), `SpotChart` (SVG), `SpotPrices` (tile "spot" page, App.jsx inline AppShell), `SpotTv` (Display.jsx view "spot"); YourDay
  `SpotWidget` (id spot).
- `server/links.js` + `src/QuickLinks.jsx` (tile "links"): quick_links (visible_to [] = everyone; login_to = who may reveal; secret = forms.js
  encrypt({user, password, note})). Reveal: master or login_to, 30/hour, audited "Revealed a shared login" (title only); URLs http(s) only
  (`cleanUrl`). Access section `links` edit = add/change/remove. YourDay `LinksWidget` (id links).
- Tests: testrun/e2e58.mjs via run-shop.sh (25; license keys/shop.lic). Branded preview: run-lgc.sh -> lgc-preview.mjs (her logo files in testrun/lgc:
  coin.png cut from the logo = icon; logo_light.png = name logo on dark; colors navy #06234A, gold #C9A227, light blue #7FA6D6).

## Customer packages (11/2026, no migration)
- Michael (11/2026): every customer gets their OWN download; nothing of one customer's (code for modules they don't have, St. George's
  documents) in another's. Master copy of the source: a private GitHub repo for Fenmorix Technologies (Michael creating the account).
- `packaging/` (never shipped): `customers.json` (id -> name, customer, product, modules "standard" | [keys], sgfdContent, requireLicense,
  keepNotes, sandboxScripts) + `owners.json` (file -> modules that own it) + `build-package.mjs <id|all> [--out dir]` -> ../dist/<name>-<version>.zip
  (staging in ../.package-stage/<id>/app). Module files whose owners are all excluded become stand-ins with the same export names (`standIn`:
  handle* -> 404, UPPER consts -> [], Components -> () => null, functions -> null / async null), so imports never break. sgfdContent false:
  seed files emptied, migration 020 -> SELECT 1, 007's department name, SGFD_LOGO "", public art -> brand-fenmorix copies, pdf-templates,
  scripts/dev, SGFD CAD views, CLAUDE.md/docs removed, src/brand.js + server/brand.js St. George defaults swapped, package.json name
  "fenmorix-os", release notes mentioning St. George/SGFD dropped. Writes server/buildFlags.js (REQUIRE_LICENSE, SGFD_CONTENT, PACKAGE) and
  VERSION.json {package, customer, product, modules}.
- buildFlags: SGFD_CONTENT false -> brand.js product() always "fenmorix", defaults "Your organization"/"ORG", no stgeorgefire URL;
  demoSeeds.departmentContent() false. system.js checkRelease: a server installs only its own package (PACKAGE; source tree = "sgfd" or
  unstamped); package.json name must match /sgfd|fenmorix/.
- Shared helpers moved out of module files so modules can be left out: server/csv.js (parseCsv), server/isoKinds.js (guessCategory); pial.js
  re-exports both. trainingPlus PIAL estimate 404s when PIAL isn't there; board.js already tolerates it.
- Testing a package: `SRC=../.package-stage/<id>/app testrun/build.sh` then the usual tests (e2e58 passes on the lgc package; SGFD and sandbox
  packages run the SGFD/sandbox suites). Plain `./build.sh` = source tree again.
- Development licenses: refused by every customer package (REQUIRE_LICENSE, unless buildFlags ALLOW_DEV_LICENSE, which only `--test` builds
  set: `node packaging/build-package.mjs lgc --test` -> ../.package-stage-test, zip name ends -TEST). Reason: an admin can blank PUBLIC_URL.
- Still in every package: App.jsx's inline modules (procurement, reimbursements, help desk, gear, meetings) until App.jsx is split; code
  comments (stripped by the protection step: minify/obfuscate).

## Sandbox demo modules + local trial installs (11/2026, no migration)
- Sandbox package ships EVERY module (customers.json sandbox modules "all", add-ons included). license.js: SANDBOX on + no license file ->
  `<SYSTEM_DIR>/sandbox/modules.json` {modules} (`demoModules`, `setDemoModules` with withNeeds; default = STANDARD_KEYS). POST
  /api/system/demo-modules {modules} (masters, sandbox only, 409 when a license file is installed, no code needed, audited "Changed the demo
  modules"; starts the spot poller when spot is on). index.js starts every module's seeds/jobs on a sandbox (`startOn`) so switching needs no
  restart; pages pick it up on the next load (meta). UI: SystemAdmin.jsx `DemoModules` (replaces LicenseCard on a sandbox without a license;
  quick picks Everything / Standard / Gold & coin shop / Core only; unchecking removes dependents). Tests: e2e59.mjs via run-demo.sh (16).
- install-ubuntu.sh `--local`: DOMAIN=localhost, PUBLIC_URL https://localhost, self-signed cert (openssl, SAN localhost/127.0.0.1, 10 years)
  in certs/, no email/certbot/ufw; checks systemd (WSL: writes /etc/wsl.conf [boot] systemd=true and asks for `wsl --shutdown`).
  License Manager new-customer accepts "localhost" (suggests blank hosts so the same license works on the real machine later; INSTALL.txt
  then has the WSL steps). Run here with stand-ins for apt/systemctl/sudo/npm/psql.
- Side bar logo (11/2026, Michael): Fenmorix OS installs with their own logo show it large across the top (Brand.jsx, `BRAND.orgLogo`) and
  "FENMORIX OS" + tagline smaller under it; phone top bar = logo + product. File `org-logo.png` (BRAND_FILES): the logo in its own shape,
  transparent margins trimmed, 900 wide (BrandingAdmin `wordmarkFrom(img, 900)`, made by makeIconSet and by the name-logo upload); until one
  is uploaded, brandFile falls back to the kit's setup logo (png/jpg/webp) while an uploaded emblem exists. Directory on Fenmorix OS installs
  (not SGFD, not sandbox): My card, Everyone, Outside contacts. tests/sweep.mjs = open every section/page, report errors/blank/stuck loading.

## Organization settings, Work Schedule, business wording (11/2026, migration 054)
- Michael (11/2026, testing LGC): labels and options must be editable per client, not rebuilt. `<SYSTEM_DIR>/settings/org.json` (server/brand.js
  `orgSettings()` / `saveOrgSettings()`, mtime cache): industry fire|business (default fire for nexus/sandbox, business otherwise), words {station
  (Personnel File), homeStation (Directory card), callSign ('' = hidden)}, work {rotations {fire, comms}, pay {kind weekly|biweekly|semimonthly|
  monthly, start, payDays}, periodHours (null = Mon–Fri days × dayHours), dayHours, dayStart}. brand() meta adds industry/fire/words/work;
  src/brand.js BRAND.fire/words/work. src/shifts.js `configureWork` (client: reads the meta itself on load; server: orgSettings() calls it),
  payPeriod/previousPeriod/nextPeriod/periodHours/describePay, WORK_PATTERNS filtered in place (ALL_PATTERNS for names). Time Tracker and Your Day
  use periodHours and hide fire/comms chips unless those rotations are on. Directory: simple nav (My card, Everyone, Outside contacts) when !fire.
- User Management › Organization (masters, `src/OrgAdmin.jsx`): GET/POST /api/system/org (audited "Changed organization settings"), POST
  /api/system/divisions {action add|rename|remove, name, to, moveTo} (remove moves people, refuses when old records point at it). Packages without
  SGFD content seed divisions Administration + Operations (build-package swaps 001/schema.sql).
- Sick Leave kinds: settings.kinds {key: {label, off}} + customKinds [{key c_*, label, protected, off}] (`kindsFor`); off types not offered.
- access.js: SECTION_MODULE gives every section its module; Permissions lists only licensed sections; profile levels filtered to them;
  BUSINESS_PROFILES names (Basic, Supervisor, Manager, Owner / Director) when !fire. display.js offeredViews by module (duty only for fire),
  switchToBoard only with the Command module.
- Work Schedule (module timeclock: tile "schedule", api "schedule", section "schedule" edit/manage): server/schedule.js, table work_schedule
  (user+day unique, start/end, early_at, note), GET ?from&to, /today (status working|later|left_early|done|out, Off Work overlay via offwork.js
  `offFor`; TV = only "everyone" entries, reasons hidden), POST save/copy. UI src/Schedule.jsx (week grid, Fill the week, Copy last week, Today +
  Leaving early), YourDay ScheduleWidget (id schedule), Display view "schedule"; helpers src/scheduleShared.js. Tests: e2e60.mjs via run-biz.sh (37).
- Quick Links: "Copy password and open the site" + a note that websites can't be signed into from another site.
- Work schedule stepping out (migration 055): `work_schedule.back_at`; earlyAt alone = leaving early, earlyAt + backAt = out for that stretch
  (status `away` "Stepped out" between them, working again after; must fall inside the workday). scheduleShared `STATUS_ORDER`, `awayText`.
- Job roles (11/2026, no migration): org.json `roles` [{name, profile}] (brand.js `orgSettings().roles`, `cleanRoles`; business default Owner→firechief,
  Manager→division, Employee; fire = []). A person's role = users.job_title; `server/jobroles.js` `assignRole` (sets the title, removes every
  role-linked profile membership, adds the role's) via auth.js action `job-role` {id, role} and `approve` {jobRole}; accounts admins only roles
  with no/basic profile and never for masters. `changeRoles` (POST /api/system/roles add|rename|remove|profile, masters): rename renames titles,
  profile re-syncs holders, remove keeps the title text. auth `accounts` returns `jobRoles` + `jobTitle`. UI: OrgAdmin `JobRoles` card; People &
  roles "Job role" select (refetched when the page opens); without Procurement the access-role picker is just Regular user / Master admin and
  recordings / time view / call-out / forms admin items hide by module. Not in the HTML meta (keeps role names off the sign-in page). e2e60.
- Messages fixes (11/2026, migration 056): `message_recipients.held` = row held for a later delivery (next shift); `startDeliveries()` only
  announces held rows (it was announcing every unread "now" message a second time = double push/pop-up). A chat diverted while someone isn't
  Available is sent with kind "message" (since 052 it had become a notice). pushClient `subscribeWithRetry`: "Registration failed - push service
  error" = browser can't reach its push service; clears and retries once, then explains (Brave: brave://settings/privacy push messaging).
- Backups every 6 hours (11/2026, Linux kit): nexus-nightly.timer OnCalendar 02,08,14,20:15 (name kept so existing installs only need the
  timer file swapped); backup.sh copies each run's files to BACKUP_COPY_TO (optional; e.g. /mnt/c/... on WSL), pruned after BACKUP_COPY_DAYS (30).
  BACKUP_COPY_TO is in LOCKED_KEY (root writes there), so it's set in .env by hand, not from the System page.
- Behind Cloudflare (11/2026, Michael registered fenmorix.com on Cloudflare Pro; LGC to be reachable at lgc.fenmorix.com): server/clientip.js
  `clientIp` (TRUST_PROXY=cloudflare: CF-Connecting-IP only when the peer is loopback (cloudflared) or a Cloudflare range, net.BlockList) and
  `isLocalRequest` (loopback AND no cf-connecting-ip/cf-ray/x-forwarded-for/x-real-ip, so first-run never opens through a tunnel). auth.js,
  investigations.js and ratelimit.js `ipOf` use them.
- Report headers (11/2026): BoardReport, CommsStats and Pial print `BRAND.org` (they had St. George hard-coded). Marketing video/deck capture: /home/claude/fxdemo (capture.mjs = fictional Riverbend Regional Public Safety, biz-shots.mjs = LGC demo staff) and /home/claude/video (fx_render.py / fx_scenes.py); OCR the frames for sgfd|nexus|st george before sending.
- Demo sandbox (11/2026): AWS Lightsail `fenmorix-sandbox` (Ohio us-east-2, Ubuntu 24.04, 2 GB, static IP 3.19.183.152), installed with
  install-ubuntu.sh --domain sandbox.fenmorix.com --sandbox (Let's Encrypt; Cloudflare record proxied, Always Use HTTPS off so renewals pass).
  Michael's own server for demos and private work; LGC still on his PC tunnel (lgc.fenmorix.com) until it moves to its own Lightsail box.

## Clients & Quotes: vendor sales tool (11/2026, migration 057)
- Module `sales` (src/modules.js, optIn + `vendor: true`): never in "all"/"*", never in sandbox demo switching (license.js filters vendor
  modules), never in a customer package (packaging/owners.json: server/sales.js, src/Sales.jsx, src/pricing.js, src/SalesPrint.js; build-package
  "all" skips vendor modules). Runs on Fenmorix Technologies' own office install with a license naming it (test: tests/keys/office.lic = all,sales).
- `src/pricing.js` = DEFAULT_BOOK (editions per segment ps flat by size / biz per user with yearly minimum, add-ons, environment / DR / support %,
  one-time fees, group + family-of-companies pricing, terms with discount/price lock/escalator, founding, on-prem license × + maintenance %,
  hourly, seller, payment terms, termsSections = DRAFT contract language for an attorney) and `calculate(inputs, book)`. Book in settings
  'sales_pricebook' (mergeBook over defaults).
- `server/sales.js` `/api/sales` (routes in the header): sales_clients (contacts, current_spend, instance_url, license_id, modules, renewal),
  sales_vault (forms.js encrypt; reveal = sales manage, 30/hour, audited "Revealed a vault login"), sales_quotes (Q-YYYY-NNNN under an advisory
  lock; server recomputes result from inputs and stores the book snapshot; non-draft = locked, copy to revise; accepted -> client active +
  modules; sent past valid_until -> expired on list), sales_activity (work log, hours, billable). `/api/sales/logo` = vendor-logo.png for prints.
  Access section `sales` (view/edit/manage). Audit module "Clients & Quotes".
- UI `src/Sales.jsx` (Overview, Clients, ClientView with vault + work log, QuoteBuilder with live Summary, Quotes, Spec sheets, BookEditor) and
  `src/SalesPrint.js` (quoteHtml / specHtml / printHtml, logo embedded as a data URL). Own input style (App.jsx exports aren't ready at load).
  Tests: tests/e2e61.mjs via run-office.sh (38).
- Michael (11/2026): hosting and compute are NOT in Fenmorix's price; Avexon sizes and quotes them (users, data, recovery tier), and the
  recovery tier's servers are part of that. book.dr pct defaults 0 (= Fenmorix's own fee for a tier, optional); inputs hostingAnnual /
  hostingOneTime / hostingNote = Avexon's figures, returned as result.hosting {known}, printed as a separate section, never in Fenmorix
  totals, counted in the savings comparison (labelled "before hosting" when unknown). Terms "Hosting, updates and support" say so.
- CAD pricing (11/2026, Michael): book.oneTime.cad {existing 2500 (we already have SQL views for that CAD / shared regional CAD), new 7500
  (vendor not integrated before), includedViews 2 (active calls + statistics), extraView 1500}; inputs cadKind none|existing|new, cadSystems,
  cadVendor, cadExtraViews, cadCustomHours (× hourly.custom). Old quotes' cadIntegrations count = new. Idea from Michael: a future Reports
  module reading a master incident list view from CAD so departments build their own reports (that view = an extra standard view).
- book.marketRates = typical competitor costs from public contracts / published prices (Aladtec, Vector, PSTrax, First Due, FireWorks modules,
  Jotform, Active911, IamResponding, Everbridge, Tablet Command, FirstWatch, ClearGov, Procurify, Otter, Slack, Deputy, Power BI), with sources;
  `marketLine(rate, users, size)`; builder "Add a typical cost…" adds a Software-it-replaces line; Price book › Typical competitor costs.
  Tests e2e61 (42).
- Office server (11/2026): AWS Lightsail `fenmorix-office` (Ohio, Ubuntu 24.04, 2 GB, static IP 52.15.58.152, snapshots on), office.fenmorix.com
  (Cloudflare proxied), installed from packaging customers.json `office` (every module + sales) with --no-sandbox; license from Michael's
  production key (currently procurement, reimbursements, messaging, meetings, links, timeclock, sales). Cloudflare Access app "Fenmorix Office"
  (email one-time PIN, michael@fenmorix.com only, 24 h) + bypass app for /.well-known/acme-challenge so certbot renewals pass. A mid-session
  Access expiry shows as "Failed to fetch" on saves: reload. fenmorix.com Login button = Worker `fenmorix-site-login` (HTMLRewriter appends a
  fixed pill to <body>; routes fenmorix.com/* and www, fail-open) until BlakSheep's site has its own link, then remove the Worker.

## Expenses & Deductions, module switches, broadcast updates (11/2026, migrations 058-059)
- Expenses & Deductions (tile/api/section "books", part of vendor module "sales"; office only): `server/books.js`, `src/Books.jsx`, math in
  `src/booksShared.js` (CATEGORIES with Schedule C line / 8829, `summarize()`: business % and 50% meals, vehicles standard rate (rate x business
  miles + parking + interest x use%) or actual costs (x use% from odometer Jan 1/Dec 31), home office simplified $5 x <=300 sq ft x months/12 vs
  actual (home bills x office share + office-only)). Tables biz_vehicles, biz_vehicle_years, biz_trips, biz_expenses, biz_receipts (bytea; jpeg/png/pdf
  sniffed; the browser converts other photos to JPEG <= 2000 px), biz_recurring (monthly bills, posted once per month). Settings key 'biz_books'
  {rates (IRS: 2026 0.725, 2025 0.70), home {year}, business}. Packet: GET export.pdf (pdf-lib; summary, notes, vehicles, home office, every
  expense, mileage log, receipts each on a page; PDFs' pages copied) / export.csv. read-receipt = askClaude. Tests: e2e62 (run-office.sh).
- Module switches: `<SYSTEM_DIR>/settings/modules-off.json` (license.js offModules/setOffModules; dependents go off too); licenseState keeps
  `licensed` and `off`; licenseSummary modules carry licensed/switchedOff. POST /api/system/modules-off {off} (masters, audited). UI
  SystemAdmin `ModuleSwitches` (unlicensed = "<name>: not licensed"). Background jobs follow at the next restart.
- `src/netGuard.js` (imported first in main.jsx): wraps fetch; a failed same-origin request is diagnosed with /api/health redirect:manual ->
  sign-in in front ended (Cloudflare Access) = red role=alert banner "Your secure sign-in has ended" + Reload; offline; server down. The error
  the screen shows gets the same words.
- Broadcast updates. Releases are signed on Michael's computer: License Manager `sign-release <zips>` -> <zip>.sig {v, kid, package, version,
  sha256, sig over "fenmorix-release:v1\n<package>\n<version>\n<sha256>"} (license.js releaseMessage/verifyRelease; same KEYS; dev keys only on
  localhost). Hub (office; vendor module "sales", api "hub"): `server/hub.js` + `src/HubAdmin.jsx` (Clients & Quotes › Updates: Installations,
  Releases). hub_installs (enrollment key fxu_..., sha256 stored, hold), hub_releases (+ file in <SYSTEM_DIR>/releases/<pkg>/<ver>.zip; upload
  needs the matching .sig; -TEST refused). Customer servers: POST /api/hub/client/checkin, GET /api/hub/client/download/:id with Bearer key,
  mounted before the signed-in check (rate limited). Cloudflare Access on office.fenmorix.com needs a bypass for /api/hub/client.
  Client side (core): `server/updates.js` (<SYSTEM_DIR>/hub/hub.json {url, key, auto, autoAt} 0600, state.json): check-in 90 s after start then
  every UPDATE_CHECK_HOURS (6); download -> sha256 + signature -> system.js `stageRelease` (now exported, with `queueAction`, `currentVersion`)
  -> Install as before with a code; auto = night install in [autoAt, +60 min) via queueAction as "Automatic update". UI SystemAdmin `UpdatesCard`.
  Tests: e2e63 (run-hub.sh; dev2 test key tests/keys/dev2-private.pem, not in git). tests/make-sysdata.mjs remakes e2e51/53 zips.

## Client portal (11/2026, migration 060)
- Customers' contacts sign in at the portal's own address (PORTAL_HOST, e.g. portal.fenmorix.com; PORTAL_URL for links). index.js
  `servePortalHost`: on that host ONLY portal.html, the scripts reachable from it (publicScripts("portal.html")), pictures and /api/portal/*
  answer; everything else 404 / portal page. Needs module "sales" (office only). Portal API on other hosts = 404 (not mounted in handleApi).
- `server/portal.js`: portal_users (separate from app users; scrypt via auth.js hashPassword/verifyPassword, invite = sha256 one-time
  token, 7 days), portal_sessions (cookie fx_portal, 60 min idle, 12 h max), portal_tickets + portal_posts (support requests; vendor_seen /
  client_seen), portal_docs (pdf/png/jpeg/docx/xlsx sniffed, downloaded as attachment). Overview = client modules/renewal/instance, servers
  from hub_installs (version vs latest published release, last check-in, users, auto), quotes (never drafts, internal notes or the price
  book; HTML rendered server-side with SalesPrint quoteHtml + setLogo), tickets, release notes, docs. Accept {name, title, agree} /
  decline {note}: sales_quotes.decided_by/title/ip/note (migration 060), client -> active + modules, sales_activity line. Rate limits per
  address and email; audit module "Client portal". Vendor side `/api/clientportal` (sales edit; access changes = manage): users + links
  (emailed when SMTP is set), tickets reply/status, docs. UI: `src/portal/Portal.jsx` (+ main.jsx, portal.html, vite input "portal"; must
  never import App.jsx), vendor `src/PortalAdmin.jsx` (PortalCard on the client page, PortalRequests on the Overview). Tests: e2e64
  (run-portal.sh; PORTAL_HOST=127.0.0.1 so 127.0.0.1:3077 is the portal and localhost:3077 the office). build.sh builds dist/portal.js.
- Cloudflare: portal.fenmorix.com must NOT sit behind the office's Access app; add its DNS only after the office runs a version with
  PORTAL_HOST set (before that the name would show the office app). SSL mode is Full (not strict), so the office's certificate works.

## Website (11/2026)
- `website/` (not shipped; packaging copies only SHIP): Fenmorix Technologies' own marketing site, one page (index.html + assets/), dark navy +
  Fenmorix orange, Barlow Condensed / Barlow (Google Fonts), hero = interactive module "switchboard" with Fire department / Business presets,
  a shift in Fenmorix OS (recall, command board PAR, signature chain, ISO/PIAL), business, security, steps, pricing approach (no prices;
  hosting by Avexon), contact = mailto michael@fenmorix.com (demo email lists the picked modules). Preview artifact
  https://claude.ai/artifact/3xT6nGT5N35Ttd2Z47niXQ. fenmorix.com today = Cloudflare Pages project "fenmorix" (BlakSheep) + Worker
  `fenmorix-site-login`; replacing it waits for Michael's go-ahead. BlakSheep does SEO.
- packaging SHIP now includes portal.html (vite's third input: every package needs it or `vite build` fails).
