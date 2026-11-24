# SGFD Nexus

**SGFD Nexus** — the St. George Fire Protection District management system.

St. George Fire Protection District internal management system: Procurement,
Reimbursements, Certifications, PPE & Gear, Help Desk, Meetings, Directory,
Announcements, and the Audit Log.

The screens are the same as the original Claude artifact; the data lives in
PostgreSQL (`sgfd` database), uploaded files are saved in the `uploads` folder,
and everyone signs in with their own account.

---

## Setting up the dedicated server (https, port 443)

On the new server (Windows Server 2016 or newer), signed in as an administrator.

Everything lives in **`D:\sgfd-nexus`**:

```
D:\sgfd-nexus\
  app\            the app (this folder: .env, uploads, secrets\forms.key)
  postgresql\18\  PostgreSQL programs, and the database files in data\
  nodejs\         Node.js
  git\            Git
  tools\nssm\     runs the app as a Windows service
  certs\          HTTPS certificate
  logs\           app log and setup logs
  backups\        nightly backups (also copy them off this server)
  installers\     downloaded installers
```

**1. Prerequisites (one script).** Unzip the download into `D:\sgfd-nexus` (it contains the `app`
folder), then in PowerShell opened with *Run as administrator*:

```powershell
cd D:\sgfd-nexus\app
powershell -ExecutionPolicy Bypass -File .\scripts\install-prereqs.ps1
```

It installs Node.js (LTS), PostgreSQL 18 (with pgAdmin), Git and NSSM. It asks you once for a
password for the PostgreSQL `postgres` account; keep that in your password manager. It also:

- creates the `sgfd` database and the `sgfd_app` login with a random password (saved in `.env`)
- sets `.env` to `PORT=443`, `HOST=0.0.0.0` and `HTTP_REDIRECT_PORT=80`, so typing the plain
  server name in a browser redirects to https
- sets up the HTTPS certificate (see below)
- opens TCP 443 and 80 in Windows Firewall for domain/private networks
  (`-AllowFrom 10.0.0.0/8` limits it to those addresses)
- checks that nothing else (IIS, usually) is using 443 or 80
- makes `.env`, `D:\sgfd-nexus\certs` and `secrets\` readable only by Administrators and SYSTEM
- turns off sleep and runs `npm install`

It's safe to run again; finished steps are skipped. A log is saved in `D:\sgfd-nexus\logs`.

*No internet on the server?* On another PC, download the Node.js Windows 64-bit `.msi`, the
PostgreSQL 18 Windows installer, the Git for Windows 64-bit installer and the NSSM zip. Put them in
`D:\sgfd-nexus\installers` (or pass `-InstallerDir`). `npm install` still needs to reach
registry.npmjs.org; if it can't, copy the `node_modules` folder from the old PC.

**2. Certificate.**
- From IT as a `.pfx`: `.\scripts\install-prereqs.ps1 -PfxFile D:\sgfd.pfx` (it asks for the password).
- IT installed it in the computer's certificate store: `.\scripts\install-prereqs.ps1 -CertThumbprint <thumbprint>`.
- Neither yet: the script makes a **temporary self-signed** certificate, so https works now, but
  browsers show a warning. When IT's arrives, run the script again with `-PfxFile`, then
  `Restart-Service SGFDApp`.

The certificate has to include the name people type (for example `nexus.yourdomain.local`), and DNS
has to point that name at the server. The script warns if they don't match. A `.crt` + `.key` pair
also works: set `HTTPS_CERT_FILE` / `HTTPS_KEY_FILE` in `.env` instead.

**3. Move the data from the old PC** (skip for a fresh start).
On the old PC: stop the service (`Stop-Service SGFDApp`), then run
`powershell -ExecutionPolicy Bypass -File .\scripts\backup.ps1`. Copy these three files to the new server:
the newest `sgfd-db-*.dump` and `sgfd-uploads-*.zip` from `C:\sgfd\backups`, and
`C:\sgfd\sgfd-app\secrets\forms.key`. Use a USB drive or a restricted share, and delete the copies
afterwards. Then on the new server:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\restore.ps1 -DatabaseFile D:\move\sgfd-db-....dump -UploadsZip D:\move\sgfd-uploads-....zip -FormsKey D:\move\forms.key
```

Also copy any settings you added to the old `.env` (Aladtec, CAD, Anthropic key). Don't copy the
`PG*` lines, `PORT`, `HOST` or `HTTPS_*`.

**4. Run it as a service:** `powershell -ExecutionPolicy Bypass -File .\scripts\install-service.ps1`.
Then open `https://SERVER-NAME`. On a fresh start, create the master admin on the server itself at
`https://localhost`.

**5. Afterwards:** schedule nightly backups (`.\scripts\backup.ps1 -Register`); keep a copy of
`secrets\forms.key` and the `postgres` password somewhere safe; and turn off the service on the old PC
(`.\scripts\uninstall-service.ps1`) so nobody keeps using the old copy.

---

## First-time setup (Windows)

You need Node.js and PostgreSQL installed and the `sgfd` database created.
The app creates and updates its own tables when it starts.

1. **Unzip** this folder to `D:\sgfd-nexus\app`.

2. **Create your settings file:**

   ```powershell
   cd D:\sgfd-nexus\app
   Copy-Item .env.example .env
   notepad .env
   ```

   Replace `put-the-sgfd_app-password-here` with the `sgfd_app` password, save, and close.

3. **Install the app's packages** (one time): `npm install`

4. **Start it:** `npm run dev`, then open **http://localhost:3000** on this computer.

5. **Create the master admin sign-in.** The first time, the app shows *First-time
   setup*. Enter your name, work email and a password. If a master admin already exists
   on the roster, this takes it over, keeping everything they've done.
   This step only works on the computer running the app.

To stop the app, click in the PowerShell window and press `Ctrl + C`.

---

## Running in the background (Windows service)

So the app keeps running with VS Code and PowerShell closed, after you log out or lock the PC,
and after a reboot. Set up once, in **PowerShell as Administrator**:

```powershell
cd D:\sgfd-nexus\app
powershell -ExecutionPolicy Bypass -File .\scripts\install-service.ps1
```

It downloads NSSM to `D:\sgfd-nexus\tools\nssm`, builds the app, and installs the **SGFD App**
service: it starts with Windows (after PostgreSQL), restarts itself within seconds if it ever
stops, and logs to `D:\sgfd-nexus\logs\sgfd-app.log`. At the end it offers to stop the PC sleeping
while plugged in (sleep would stop the app; locking doesn't).

- Stop/start/restart it in *Services* (`services.msc`) like any other service, or
  `Restart-Service SGFDApp` in an administrator PowerShell.
- While the service runs, don't also run `npm start` (both want port 3000). For trying changes
  with `npm run dev`, stop the service first, or set a different `PORT` for the dev copy.
- To remove it: `powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-service.ps1`

## Updating to a new version

**With the service installed:** unzip the new version over `D:\sgfd-nexus\app` (replacing
files), then in PowerShell as Administrator:

```powershell
cd D:\sgfd-nexus\app
powershell -ExecutionPolicy Bypass -File .\scripts\update.ps1
```

It stops the app, installs any new packages, builds, starts it again and shows any database
updates. Then save the version with git.

**Without the service:**

1. Stop the app (`Ctrl + C`).
2. Unzip the new version over `D:\sgfd-nexus\app`, replacing files. Your `.env`,
   `uploads` folder and `node_modules` are kept.
3. If `package.json` changed, run `npm install`.
4. `npm run dev` again. Any database changes are applied automatically at startup
   (you'll see `Database updated: ...`).
5. Save the version: `git add .` then `git commit -m "Update"`.

---

## Accounts

- **New people** click **Request an account** on the sign-in page, enter their name,
  work email, division and a password. They can't get in until approved.
- **A master admin approves them** in *Procurement / Requisitions → Admin → Accounts*,
  choosing their division and role. The corner of the screen shows how many requests
  are waiting.
- **Forgotten password, or someone added to the roster by hand:** in Admin → Accounts,
  open *Sign-in details and password resets* and create a temporary password. Give it
  to them in person or by phone. They choose their own password the first time they sign in.
- **Removing someone from the roster** signs them out everywhere and blocks sign-in.
  Their history (requisitions, signatures, audit entries) stays intact.
- Five wrong passwords in a row locks that email out for 15 minutes.
- Sign-ins last 12 hours (`SESSION_HOURS` in `.env`). Use **Sign out** on shared station computers.

### What the server enforces

The server now decides who did what from the signed-in account; the browser can't claim
to be someone else.

- Signatures are recorded as the person actually signed in, at the server's time, and only
  the right role (and division, for the first two signatures; see *Signing for other
  divisions*) can sign each stage.
- Only accounting, a fire chief, a master admin, or the division's pre-approver can mark a
  requisition paid; only accounting or a master admin can mark a reimbursement paid.
- Only master admins change the roster, roles, divisions, categories, and the mileage rate.
  Everyone can update their own phone, email and emergency contact.
- Emergency contacts are visible only to the person and master admins.
- Only fire chiefs and master admins post announcements. Only the person who added a
  certification, gear item or contract (or a master admin) can remove it.
- The audit log is visible only to master admins, and its entries carry the real signed-in name.

---

## Requisition tools

- **Autofill from a document:** on *New requisition*, choose a PDF, a picture (JPG/PNG), an Excel (.xlsx), CSV or
  Word (.docx) file: a filled-out requisition, an invoice or a quote. The server reads it and fills in the form for you
  to check; the file is attached to the requisition when you submit (untick *Attach … to this requisition* to skip).
  It needs `ANTHROPIC_API_KEY` in `.env` (and internet access from the server). Without it, the screen says autofill
  isn't turned on and everything else works. Old Excel (.xls) and Word (.doc) files have to be saved as .xlsx / .docx
  or PDF first; iPhone HEIC photos need to be JPEG (or a screenshot).
- **Attachments** (requisitions, quotes, contracts, reimbursement receipts, Help Desk tickets) take PDF, pictures,
  Word, Excel, CSV, text, email (.msg/.eml) and .zip files up to 15 MB each.
- **Import** (master admins and accounting): a CSV or Excel (.xlsx) file with Date, Division, Category, Title, Vendor,
  Amount (and optionally Frequency, Contractual, Invoice Number, Payment Method, Requested By). *Download CSV
  template* shows the columns.

- **Repeat a requisition** (monthly bills and the like): open any requisition and click
  **Repeat this requisition**, or use **Repeat** next to it in the vendor's history under
  *Vendors*. Everything is copied; enter the new invoice number and check the date.
- **Requisition date:** every requisition has its own date (the date on the requisition,
  quote or invoice), defaulting to today. Lists, reports and the budget year use it.
- **Historical requisitions signed on paper:** master admins and accounting can tick
  *Already signed on paper* when entering a requisition and fill in who signed each stage,
  on what date, and when it was paid. On a pending requisition, *Record paper signature*
  does the same one stage at a time. Each is marked "recorded by" whoever entered it.
- **Correcting dates:** *Edit dates* on a requisition changes the requisition, signature and
  paid dates. While pending: the requester, accounting or a master admin. Once approved,
  paid or rejected: master admins only. Every change is written to the audit log with the
  old and new dates, and nothing else on a finalized requisition can change.

- **Drawn signatures:** when you sign a requisition, a signing box sits above the button. Sign with a finger, stylus or
  mouse (optional): the drawing is kept with that sign-off, shown under the signer's name and printed on the requisition.
  Only people who can see the requisition can see the signature.
- **Quick view:** in *Vendors* (a vendor's history) and the *Budget report*, click a requisition to see a short version of it
  (amount, status, dates, invoice, who signed). *Open in Requisitions* jumps to the full one.
- **Your history:** Personnel File → *Requisitions & reimbursements* lists everything you submitted and where it stands.
  Master admins, the Fire Chief and accounting can open anyone's.

### Editing and deleting requisitions

Open a requisition and use **Edit** or **Delete requisition**.

| | Pending | Approved, paid or rejected |
|---|---|---|
| Edit | requester, accounting, master admin | master admin |
| Delete | requester, master admin | master admin |

Editing never changes the status or who signed; use **Edit dates** for dates. Every edit
is written to the audit log with the old and new values, and every deletion with a full
snapshot (amount, dates, invoice, each signer and date). Deleting also removes its files.

## Routing signatures ("send to") and what's waiting for you

- **Send to:** when submitting a requisition, you can pick who should give the purchaser's
  signature. When signing, you can pick who's next (pre-approval, then final approval). The
  list only shows people allowed to sign that stage for that division. It's optional.
- **Others can step in:** anyone else allowed to sign that stage still can (for example if
  the person it was sent to is out). The requester, accounting, a master admin, or anyone who
  can sign the current stage can change who it's sent to from the open requisition.
- **Waiting for you:** the main menu tells each person what's waiting on them ("You have 2
  pre-approvals to sign…"), and **Review now** opens just those. Requisitions sent to
  someone else don't count for you; ones sent to no one count for everyone who can sign them.
  Accounting and master admins also see how many approved requisitions are ready to mark paid.
  The *Requisitions* menu item shows a red count, and the list has a *Waiting for me* filter.
- **Nexus messages** (they pop up like any message, and show under Messages): when a requisition is
  submitted or moves to the next stage, whoever it was sent to (or, if no one, everyone who can sign that stage
  for that division) gets "Requisition to sign". At final approval the requester is told and accounting gets
  "Ready to pay"; the requester is also told when it's rejected (with the reason) or paid. Reimbursements work
  the same way (the division's approvers, then the requester and accounting). No email is sent.

### Signing for other divisions

Approvers (purchaser's signature and pre-approval) can sign for divisions besides their own.
Set it with the **Also signs for** checkboxes when approving their account, or later in
*User Management → People & roles*. (Procurement's *Admin* page now only keeps divisions and categories, with a
button to User Management.) They then see, sign, and can be sent requisitions and quotes
for those divisions; people without that division can't. Example: someone in Special Services
can sign Technology requisitions while Medical's purchaser never sees them.

## Who sees what: requisitions, reimbursements, Help Desk

The server only sends each person what they're allowed to see (the screens used to hide the rest):
- **Requisitions:** master admins, the Fire Chief and accounting see every division; everyone else sees their own
  division, the divisions they sign for, and requisitions they asked for.
- **Reimbursements:** master admins, the Fire Chief and accounting see all; purchaser's-signature and pre-approval
  approvers see their divisions; everyone else sees their own. Only the person who asked (while it's awaiting
  approval) or a master admin can delete one; only the requester changes its details.
- **Help Desk:** techs (the Technology division, master admins, and anyone given *Help Desk: Edit* in User
  Management → Permissions) see and work every ticket; *Help Desk: View* sees every ticket; everyone else sees
  their own. The person who asked can add comments and files (and fix the details while it's still Open), but
  status, assignment and due dates are the Help Desk's. Tickets are always filed as the person signed in, and
  comments are signed as whoever wrote them.
- **Help Desk messages:** a new ticket goes to the techs (or the person it's assigned to); assigning it tells that
  tech; status changes and tech comments tell the person who asked; their replies go to the assigned tech.

## Lists: search, filters, sorting and pages

Every list (requisitions, vendors and each vendor's history, quotes, contracts, help desk
tickets, reimbursements, certifications, PPE & gear, meetings, directory, announcements,
the roster, accounts and the audit log) has the same bar on top:

- **Search** looks across the useful text of each item (title, vendor, invoice #, people,
  notes, comments and so on). Several words narrow it down; all of them must match.
- **Filters** (division, category, status, person, priority… depending on the list).
- **Sort** by any of the listed fields; the arrow button flips ascending/descending.
- **Rows per page:** 25 (default), 50, 100 or 200, with page buttons at the bottom. The
  choice is remembered on that computer for all lists.
- *Clear search and filters* resets everything. Print and Export CSV use what's filtered.

## Your Day (main menu)

The top of the main menu shows each person's day:

- **Needs your attention:** requisitions to sign (by stage, and which were sent to you),
  help desk tickets assigned to you (and how many are past due), meeting requests waiting for
  your answer, reimbursements waiting for your approval, and (accounting / master admins)
  approved requisitions ready to mark paid. Each has a button that opens the right screen
  already filtered.
- **Today:** time this pay period (worked, left to 80, average per day), meetings today and
  your next one, who's on call in each division (tap the number to call), your open help desk
  tickets, and your requisitions still in progress with their status.
- Today's Fire and Communications shifts are in the header.
- Module tiles show a red count when something there is waiting for you.
- **Hide** collapses the cards (action items stay); the choice is remembered on that computer.

## Forms

*Main menu → Forms.* District forms, grouped by section, with a search box. What's submitted is
filed in the right **personnel file** and sent to the people who need it.

- **Filling out:** details fill in from the person's profile (name, email, phone, address, job
  title, hire date, employee number, station). Questions appear only when they apply (e.g.
  witness names only if there were witnesses). Signatures are drawn on screen with a mouse or
  finger. Every submission keeps a copy of the form exactly as it was filled out.
- **Waiting for me:** forms you've been asked to complete, approvals, and submissions you're a
  required recipient of (mark them **Reviewed**). These also show in **Your Day** on the main menu.
- **Print / save as PDF** on any submission; **Print case packet** prints every part of a case.
- **Approvals:** a form can require approval (e.g. the Communications leave request): the person
  submitting picks the approver(s); for a shift trade, both supervisors. All must approve.
- **Anonymous forms** never record who submitted them, not even in the audit log.

### Injury / illness cases

*Injury / Illness Report* (filled out by the member, or by an officer on their behalf) opens a
**case** and asks for the follow-up parts automatically: the supervisor's statement (the
supervisor chosen on the report), a witness statement from each witness on the roster, the safety
officer's report and the **LWC-WC-1007 Employer Report** (from the people set in the form's
settings), and the injury questionnaire (the member). Each part starts with the case's facts
filled in. The case page shows what's done and what's still waiting; people with access can
reassign, cancel, request another statement, or fill one in from a paper copy, then close the case.

**LWC-WC-1007:** filled in from the initial report (SSN, date of birth, address, dates, what
happened, part of body, medical care) plus district details saved once as default answers
(address, phone, UI and federal ID numbers, insurer). **Download official PDF** produces the
state's own form, filled in and locked. Set the district defaults in *Manage forms → Employer
Report of Injury/Illness*.

### Who sees what

- The person a form is about sees it (unless the form is set otherwise). The injured member does
  **not** see the supervisor, witness, safety officer or 1007 parts of their case.
- Whoever submitted a form, and its approvers, see it.
- **Required recipients** of a form, anyone given access to that form (in the form's settings or
  *User Management → Forms: can see every submission of*), and master admins see every submission
  of it, including sensitive details. Access to the Injury/Illness Report covers the whole case.
- **Sensitive answers** (Social Security number, date of birth) are encrypted. Everyone else sees
  them masked (`***-**-6789`).

### Encryption key (back it up)

Sensitive answers are encrypted with a key stored in `secrets\forms.key` in the app folder,
created the first time the app starts. **Back this file up with the database** and keep it
private: without it, encrypted answers can't be read. It's not in the zip or in git, so updates
never touch it. (Alternatively set `FORMS_KEY` or `FORMS_KEY_FILE` in `.env`.)

### Managing forms (master admins)

*Forms → Manage forms*: change any form or create new ones: questions (short/long answer,
number, date, time, dropdown, multiple choice, checkboxes, yes/no, phone, email, address, person,
people, SSN, acknowledgment, signature, section headings), required, help text, "only show when",
pre-fill and default answers, sensitive; who it's about (the filler, a person they choose, or no
one), anonymous, required recipients, who can see all submissions, and approval. **Preview**
before saving; **Archive** hides a form. Changes apply to new submissions only.

## Personnel File

*Main menu → Personnel File* (replaces the Certifications tile). Each person's **profile
details** (employee number, job title, station, hire date, address; used to fill in forms), the
**forms and cases** filed about them, and their **certifications** (*Open Certifications* goes to
the full certifications screen). Everyone sees their own file; master admins and people with access
to forms can choose others, and see only the forms they have access to. Address, hire date and
employee number are visible only to the person and master admins.

## Working Fire Recordings

*Main menu → Working Fire Recordings* (master admins, and anyone given the *Working Fire
Recordings* permission in User Management).

- **+ Import recording**: choose a NICE Inform `.distribution` export and the department.
  The address, incident number, description, start/end times and every radio transmission
  (time, talkgroup, radio) are read from the file. The same export can't be imported twice.
- Open a recording to listen: **Play all** plays every transmission in order, back to back,
  showing the time, talkgroup, radio and how far into the call it was. Filter by talkgroup or
  radio, change speed (up to 2x), or click any row to play it. Audio is raised to an even
  volume on import; the original file is kept unchanged under **Download for NICE player**.
- Whoever imported a recording (or a master admin) can edit its details and notes; only master
  admins can delete one. The department list is kept by master admins (*Department list…*).
- Imports, edits and deletions go in the audit log. Files are stored in `uploads/recordings`
  (include the `uploads` folder in backups). Upload limit: `RECORDINGS_MAX_MB` in `.env` (default 300).

### Transcripts (speech-to-text, on the server)
- Open a recording → **Transcribe Working Fire Audio**. It runs in the background on the Nexus server (Whisper,
  via whisper.cpp); the audio never leaves the district. Progress shows on the page, and you can leave it running.
- Each radio transmission becomes one line of text under its row. Radio audio is rough: click **Correct** under any
  line to fix it (corrections are audited and kept if the recording is transcribed again).
- **Print transcript** prints a radio log: time, time into the call, radio, and what was said. With talkgroups or a
  radio filtered out, only the transmissions shown are printed.
- **Setup, once**, on the server as Administrator:
  `powershell -ExecutionPolicy Bypass -File .\scripts\install-whisper.ps1`
  It finds the newest whisper.cpp build with a Windows x64 CPU zip (the numbered `bNNNN` builds carry the Windows
  programs; the `vX.Y.Z` releases may only have source code) - or use `-Url <zip link>` - and puts `whisper-cli.exe` and the `small.en` model (~460 MB) in `D:\sgfd-nexus\tools\whisper` (needs github.com and
  huggingface.co once; the script explains a manual download if the server can't reach them). `-Model base.en` is faster
  and less accurate; `-Model medium.en` is slower and more accurate. No restart needed. Optional `.env`: `WHISPER_BIN`,
  `WHISPER_MODEL`, `WHISPER_THREADS` (default: CPU cores − 1, max 8). Rough speed with small.en on an 8-core server: a
  20-minute fire in 3–6 minutes. Unit names from the apparatus list are given to Whisper so they're spelled your way.

## Time Tracker

*Main menu → Time Tracker.* Pay periods run Thursday through Wednesday (14 days, 80 hours);
pay day is the following Wednesday.

- Click a day, then **+ Add punch**. Times are 24-hour (type `0700` or `07:00`). An out time
  earlier than the in time ends the next day, so `0700`–`0700` is a 24-hour shift. Add as many
  punches per day as needed (call-outs, appointments). Each is Regular, Vacation, Comp time,
  Sick leave or Swap; all count toward 80. For leave, tick *Enter hours instead of in/out*.
- The top shows hours this period, hours remaining to 80 (or over 80), and the average needed
  per day for the days left (counting today). Each day shows the Fire and Communications shifts.
- Hours count on the day the punch starts.
- **Privacy:** people see only their own punches. Master admins and anyone given *View time
  punches* (for some or all divisions) can view others' read-only. Only the person can change theirs.


**Punch in / punch out.** On the Time Tracker (top) and in the Your Day "Time this pay period" card. Punch in when you
arrive and punch out when you leave; the server records the times, and overnight punches (19:00 → 07:00) count on the day
they started. A punch-in more than 24 hours old (forgot to punch out) has to be fixed by hand on that day.

**Needed per shift.** Each person picks their schedule once on the Time Tracker (weekdays, Fire A/B/C, or Communications
A–D crew). "Needed per shift" then divides the hours left by the shifts you're scheduled for in the rest of the pay period
(today counts until you've recorded time for it), and the calendar marks your scheduled days.

## Call-Out Schedule

*Main menu → Call-Out Schedule.* A month calendar of who's on call in each division, plus
"On call today" across all divisions with tap-to-call numbers. Add a person for one day or a
range (a week on call is one entry). Several people on the same day form a call-back order
(#1 called first), which the floor uses for its call-back roster. Divisions can be hidden
with the checkboxes. A division's schedule can be changed by its own members, master admins,
and anyone given *Edit call-out schedule* for it. Changes go in the audit log.

**Shifts shown on both calendars:**
- *Fire (F)*: A, B, C on a 9-day cycle (on, off, on, off, on, then 4 off for each).
  Oct 28, 2026 = A.
- *Communications (C-day/night)*: 0700–1900 and 1900–0700. Each shift works
  Mon Tue · Fri Sat Sun · Wed Thu over two weeks; its partner covers the other days. Every two
  weeks the pairs swap days and nights (starting Oct 26, 2026: C/A days, D/B nights).
  The rotations live in `src/shifts.js` if they ever change.

## User Management

*Main menu → User Management* (master admins only): account approvals and password resets,
each person's division and role, the divisions approvers also sign for, and permissions:
*View time punches* and *Edit call-out schedule*, each for none, all, or chosen divisions.
You can also add someone by hand or remove them from the roster here.

## Quotes

*Procurement → Quotes* holds quotes as they come in: vendor, what it's for, cost, quote
number and date, how long it's good for, notes and the quote document. Approvers for that
division, accounting, fire chiefs and master admins can accept or decline. Once accepted,
**Create requisition from this quote** starts a requisition filled in from it; the quote
lists every requisition made from it, and each requisition links back to its quote.

**Edit quote** is available to whoever added it and master admins. **Delete quote** is
available to master admins, and to whoever added it while it's still pending. A quote
can't be deleted while requisitions are linked to it; delete those first. Edits and
deletions are recorded in the audit log.

---

## Letting others use it

1. In `.env`, set `HOST=0.0.0.0`.
2. Allow the port through Windows Firewall, domain network only (PowerShell as Administrator;
   on a managed computer, IT may need to do this):

   ```powershell
   New-NetFirewallRule -DisplayName "SGFD App" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Domain
   ```

3. Run the final version: `npm run build`, then `npm start`.
4. Others open `http://YOUR-COMPUTER-NAME:3000` (find the name with `hostname`).

**Required before wider use: HTTPS.** Without it, passwords cross the network unencrypted.
On the dedicated server, `scripts\install-prereqs.ps1` sets this up (see "Setting up the dedicated server").

Without the service (above), the app only runs while the PowerShell window is open. Moving it
to an always-on machine is the next infrastructure step; the same service scripts work there.

---

## Everyday commands

| What | Command |
|---|---|
| Start for development (reloads when code changes) | `npm run dev` |
| Build the fast, final version | `npm run build` |
| Run the final version | `npm start` |

## Backups

`scripts\backup.ps1` saves the database and the uploads folder to `D:\sgfd-nexus\backups` (kept 30 days);
`-Register` runs it every night at 2:15 AM. `scripts\restore.ps1` puts a backup back. Keep a copy of
`secrets\forms.key` somewhere separate (not next to the backups).

---

## How it's put together

```
db/schema.sql            Original database design (reference; later changes are in db/migrations)
db/migrations/           Database changes, applied automatically at startup
server/index.js          Web server: serves the app and the /api routes
server/auth.js           Accounts, sign-in, sessions, approvals, password resets
server/collections.js    Translates the app's records to and from the tables; permission checks
server/files.js          Saves and serves uploaded files
server/migrate.js        Applies db/migrations
src/AuthGate.jsx         Sign-in, account request, first-run and password screens
src/AccountsPanel.jsx    Admin → Accounts (approvals and resets)
src/ListControls.jsx     Shared search / filter / sort / paging used by every list
src/TimeTracker.jsx      Time Tracker (pay-period punches)
src/CallOut.jsx          Call-Out Schedule
src/UserManagement.jsx   User Management (accounts, roles, permissions)
src/shifts.js            Fire / Communications rotations and pay periods
src/YourDay.jsx          "Your Day" panel and tile counts on the main menu
src/Recordings.jsx       Working Fire Recordings (list, import, player)
src/Forms.jsx            Forms section: fill out, submissions, approvals, cases
src/FormFields.jsx       Form field inputs, signature pad, pre-fill, printing
src/FormBuilder.jsx      Form builder (master admins)
src/PersonnelFile.jsx    Personnel File
server/forms.js          Forms API: definitions, submissions, cases, access, encryption
server/formSeeds.js      The forms the app starts with (injury set, 1007, leave request)
server/pdfFill.js        Fills official PDFs (server/pdf-templates/)
server/recordings.js     .distribution import (ZIP + NICE XML), audio, recordings API
src/App.jsx              The app itself (the artifact, with small changes listed below)
src/storage.js           Stands in for the artifact's storage and talks to the server
```

`App.jsx` started as the artifact. Since then: document autofill goes through `/api/documents/autofill`
(server/documents.js);
"Switch user" became "Sign out"; Admin includes the Accounts panel; full-screen layout and
Station navy colors; a Main menu button everywhere; requisition dates, repeat, paper
signatures and date corrections; the Quotes tab; and "send to" routing with the
*Waiting for you* panel on the main menu.

### Forms carried over from JotForm
Uniform Request, Station Supply Order, Facility & Resource Request, Pool Vehicle Checkout (+ return),
Password/Authenticator Reset, CAD Update, Employee Info Change, Executive Health Physical, Record of
Exceptional Performance, Incident Statement (+ Deputy Chief review), Officer Development Course Sign-Up,
Probationary and Lateral Firefighter Evaluations, Equipment Operator (Pumper, Aerial), Operator
Requirements Confirmation, SCBA Training Performance, Preceptee Feedback, Plan of Action / Safety Plan,
Safety Concern and Near Miss (anonymous), Accident / Damage to Property, Exposure Report, Medical Incident Report, Smoke Alarm
Installation, plus the Communications CAD & GIS forms (GIS Issue, Business/Premise Update, CAD Flags/Caution Notes). After installing, open **Forms → Manage forms** and for each one set the **required
recipients** (who handles it), and adjust wording if needed.

**Progress steps** (Manage forms → a form → Progress steps): the people who handle a form mark each
submission's progress (e.g. Ordered → Ready for pickup → Picked up), with an optional note. Steps marked
"Tell them" show up on the sender's Your Day.

## Directory
- **People** by division: name, title, division, home station, cell, home phone, email, extension and
  emergency contact. Everyone updates their own card (**My card**). Home phone and emergency contact
  (🔒) are only seen by the person, master admins and directory admins.
- **Fire stations, facilities and outside contacts** (hospitals, agencies, utilities…): address (opens
  maps), phone, fax, short code. Directory admins add and edit them.
- **Last verified**: shown at the top. A directory admin runs **Directory check**: everyone is asked on
  Your Day to confirm their card; closing the check stamps the date. "Just mark it verified today" stamps
  it without a check.
- One search box (names, titles, stations, phones, extensions), favorites (☆), Print, and Save contact /
  Save all to phone (vCard files phones import).
- **Who's on duty** on station cards: today's Fire shift, plus names from **Aladtec** once connected —
  put the API details from Aladtec Support in `.env` (see `.env.example`), restart, then set each
  station's "Aladtec match" (Directory → Aladtec setup shows the names Aladtec uses).

## Messages
**Messages** (main menu) is for messages inside the district. Anyone can message one or more people; a conversation
between a few people works like a group chat. To send to a **group** (A-Shift, Comms C crew, Division Heads...) or to
**Everyone**, someone needs *Messages: Edit* (User Management > Permissions > By section > Messages).
- **When:** "Right away" or "At each person's next shift" (from their Time Tracker schedule; anyone on shift now, or with no
  schedule set, gets it right away).
- **Group messages:** members' replies go only to the sender, who can answer one person privately ("Reply to ... only")
  or post an update to everyone. The sender sees who has read it and who's still waiting for their shift.
- **Important** messages are marked in red and go to the top of "Needs your attention". New messages ding and show a
  count on the Messages menu item.
- **My lists** (Messages side bar): anyone can save their own lists of people ("My crew", "Training committee") and pick
  one in the To box. Only the owner sees their lists, and no permission is needed to send to them.
- **Replies:** when writing to two or more people (or a list), choose "Everyone sees every reply" (a group conversation)
  or "Replies come back to just me". Lists default to just me.
- **Ready-made groups:** A/B/C-Shift, Comms A-D Crew, Weekday Staff, each station (Station 61) and each station by shift
  (Station 61 · B-Shift), and each division. They fill themselves from each person's **home station** (their directory
  card) and **schedule** (Time Tracker), so those need to be filled in. They're normal groups: edit or delete them under
  User Management > Permissions > Groups (new rule: "Home station").

### Deleting, archiving, and doing several at once
- Tick the box beside any conversation, or **Select all** at the top of the list, then **Mark read / Mark unread**,
  **Archive / Move to inbox**, or **Delete**. An open conversation also has **Delete**.
- **Delete** removes it from *your* messages for good; everyone else in it keeps their copy. If someone replies later,
  just the new reply shows up. Once every person in a conversation has deleted it (and nobody is still waiting to get
  it at their next shift), it's removed from the database.

### Alerts, important messages and the chat window
- A new message plays a soft pop and shows a pop-up in the corner of whatever screen you're on, with **Reply**.
- **Important** messages play an urgent triple tone, show a red banner across the top of every screen until they're
  read (**Read it**), and their desktop pop-up stays on screen until clicked.
- **Desktop pop-ups**: open the chat window, the ⚙ button, **Turn on desktop pop-ups**, and allow it in the browser.
  They show when Nexus is open in a background tab or behind other windows. The same panel turns each sound on or off
  (per computer). When the tab is in the background its title blinks.
- **Chat** (round button, bottom right, on every screen): recent conversations, who's **online now** (has Nexus open),
  and "Find someone to chat with". A chat is a one-to-one conversation that arrives instantly; the same two people always
  continue the same chat, and it shows in Messages like any other conversation. Enter sends; Shift+Enter adds a line.
- Messages arrive live through a connection each open page keeps to the server (`/api/events`). If that's blocked,
  pages check every 30 seconds instead. `LIVE_EVENTS=off` in `.env` turns live updates off.
- Without push (below), alerts need Nexus open in a browser tab (it can be in the background).

### Push notifications on phones, tablets and computers
Anything that lands in Messages (messages, chats, and the notices Nexus sends when a requisition needs your signature,
a ticket is assigned, it's your leave-pick turn, and so on) can also show on your phone, tablet or computer even when
Nexus is closed.
- **Turn it on**: chat button → ⚙ (Alerts and sounds) → **Turn on notifications here**, and allow notifications.
  Each device is turned on separately; **Send a test** checks it. "Only important messages on this device" keeps a phone
  quiet except for important ones. Devices you've turned on are listed, and can be removed from any of them.
- **Android** (Chrome, Edge, Samsung Internet) and **computers** (Chrome, Edge, Firefox, Safari): works in the browser.
- **iPhone / iPad** (iOS 16.4 or newer): open Nexus in Safari, Share → **Add to Home Screen**, open Nexus from the new icon,
  sign in, then turn notifications on there. Apple doesn't allow web notifications any other way.
- Tapping a notification opens the message (or the chat window).
- Don't turn it on for a shared station computer: message previews would show on it for whoever is there.
- **Server requirements**: a trusted HTTPS certificate on nexus.stgeorgefire.com (not self-signed: phones refuse push for
  sites they don't trust), and the server allowed to make outbound HTTPS (443) connections to the browsers' push
  services: `fcm.googleapis.com` (Chrome/Android/Edge on Android), `*.push.apple.com` (iPhone, iPad, Safari),
  `updates.push.services.mozilla.com` (Firefox), `*.notify.windows.com` (Edge on Windows). Nothing is sent through a
  third-party account and no keys are needed: Nexus makes its own signing key the first time (kept in the database).
  The notification text (sender, subject, first lines) is encrypted end to end to the device; the push services only
  see that something was sent.

### Status: Available, Busy, Do not disturb, Out of office
In the chat window, the button next to ⚙ shows your status; click it to change it.
- **Busy / Do not disturb / Out of office**: chats sent to you go to your **Messages inbox** instead of popping up as
  chats (everything one person sends while you're away collects in one message, "Chat from … (while you were …)").
  You get no pop-ups, sounds or phone notifications except for **important** messages. Your unread count still goes up.
- **Away message** (optional): shown to anyone who opens a chat with you, and sent once as an **automatic reply** to each
  person who messages you directly (once per person each time you set your status).
- **Go back to Available**: when you change it, in 1 or 2 hours, at the end of today, or on a date and time.
- Everyone sees the status next to your name: green = online, amber = Busy, red with a bar = Do not disturb,
  purple = Out of office.

## Leave Picks (annual vacation pick)

*Main menu → Leave Picks.* The yearly vacation/holiday pick for Suppression (with Special Operations and EMS) and
Communications, following the Suppression leave memo and the Communications Annual Leave Procedure.

**How picking works**
- People pick inside a **unit**: one person off per unit per shift. Suppression units are each company on its shift (613 A,
  618 A, …); the chiefs on a shift (SG-5, 6, 7, 91) pick as their own unit. Communications units are the crews (A–D).
- **Turn order** inside each unit: Suppression by rank (Captain, Lt., senior F/O, F/O), then seniority; Communications
  by seniority only. Each round goes down the list; people who are done are skipped.
- When it's someone's turn they get a Nexus message and a "Pick now" item on Your Day. The unit's leader (★, e.g. the
  Captain) can **pick for** someone who's off, or **skip** their turn. Communications crews have no leader by default; give
  the coordinator *Leave picks: Edit* for Communications (or star someone as a crew's leader in Setup).
- **Pick sizes** (editable in Setup): Suppression picks 1–3 = up to 3 shifts in a row, after that up to 3 shifts on any
  dates. Communications: every pick up to 7 shifts in a row (fewer is fine, e.g. 3).
- **Out of turn (phoned in or from paper):** a unit leader (Captain) or anyone with *Leave picks: Edit* for that
  division opens the person (My unit → Enter picks), ticks **Enter a pick out of turn**, and saves it as their next pick.
  For a backfill that doesn't fit the size rules, also tick **Set aside the pick-size and in-a-row rules**; one off per shift,
  blocked dates and hours still apply. These picks are marked "entered out of turn" and logged. People can't jump their own
  turn this way. Managers can also backfill after picking is closed. Communications start times
  (0700 / 1900) come from the crew rotation.
- **Blocked dates** (e.g. LIFT, APCO) can't be picked.
- **Suppression daily limit:** after the picks, only the first 6 people by years of service are offered a day (per shift;
  the chiefs aren't counted). Picks past the limit are allowed but **flagged**: the picker sees a warning, the calendar and
  reports mark them, and All units / Reports list them for the Assistant Chief.
- **Charging:** leave is charged in date order: holidays (OH), then vacation (OV), then banked vacation / comp time (OC).
  Suppression must schedule all holidays before finishing. Under one year of service on January 1: only holiday leave before
  the one-year anniversary.
- **Changes after a pick:** the person (or leader) can take back the unit's most recent pick. Anything else, moving or
  rescinding leave, is done by someone with *Leave picks: Manage* (the Fire Chief or his designee) and goes in the audit log.

**Setting up a year (Leave picks: Manage)**
1. Setup → create the year. Rules start from last year's (blocked dates cleared).
2. **Import the roster**: upload the department leave spreadsheet (.xlsx), e.g. the "A Shift" sheet, which has Position,
   Employee, Shift, YOS, OV Accrual and Holidays for Suppression, Special Ops, EMS and Communications, or a CSV with those
   columns. Names are matched to Nexus accounts ("Last, First"). ADM rows are skipped. Communications crews come from each
   person's Time Tracker schedule. In the preview you can fix anyone's **shift / crew** (A, B, C Shift or Comms A–D), unit,
   years of service and hours, or choose their account.
   - **People without a Nexus account yet** are imported **locked** (🔒). They're in the turn order like everyone else; when
     it's their turn their unit leader (or, with no leader, whoever has *Leave picks: Edit* for that division) gets a message
     to get the pick by phone and enter it (*Pick for*) or skip it. When their account is approved (matched by Emp #, or by
     first and last name) they **unlock** on their own, and any picks entered for them become theirs. You can also link the
     account by hand: Setup → Units and turn order → Edit → *Nexus account*. *Add someone…* also adds a person without an account.
   - **Uploading a newer roster** updates the people already there (same account, Emp # or name) and adds new ones. Anyone on
     this year's roster who isn't in the new file is listed under the preview, not removed; take them out there if they've left.
3. Check each unit's order and leader (Units and turn order), the hours, and the rules: blocked dates, the daily limit,
   and a note for pickers (deadlines).
4. **Shift officers (Suppression)**: choose each shift's Assistant Chief and Battalion Chiefs. They get a message as each
   unit on their shift finishes and when the whole shift is done, and they see their shift's units and reports (even without
   a Leave picks permission).
5. **Open picking.** The first person in every unit gets their message. Close picking when it's done.

**Reports (Leave picks: View)**: *List for Aladtec* (CSV: one line per shift with date, start time, hours and OH/OV/OC,
flagged days marked), *Annual Leave Request Forms* (Excel, one filled-in form per person in the paper form's layout, ready
to sign) and the *Department leave spreadsheet* (Excel: everyone by unit, a column per day, number off per day). Each can be
for everyone, Suppression or Communications, one shift/crew, or **one person**. The page also shows a summary: each person's
holiday / vacation / banked hours picked, hours left, and whether they're done. Shift officers get the same for their shift.

**Personnel File copy:** when someone's picks are complete (marked done, or all their hours are scheduled), a copy of their
dates and leave types is filed in their Personnel File (*Leave picks* tab, printable with signature lines) and they get a
message saying so. If their picks change afterwards the copy is marked reopened and then updated. They see their own;
people with Leave picks: View for their division, and their shift's officers, see it too.

**Who sees what:** everyone in the pick sees their own unit's calendar and turn order (and the count off per day on their
shift). Hours and balances show only to the person, their unit leader and people with Leave picks access.
*Leave picks: View* = every unit and the reports; *Edit* = also pick/skip for people in their divisions; *Manage* = setup,
roster, rules, opening/closing, rescinding.

## Comms Statistics
**Comms Statistics** (main menu) shows call volume and call handling for every agency SGFD Communications handles, from
CAD. It needs the *Comms statistics* permission (User Management > Permissions > By section):
- **View**: Overview, Volume & Trends, Call-taking, Reports.
- **Edit**: also per-person statistics for call takers and dispatchers.
- **Manage**: also Data & settings (describe disposition codes, put names on CAD operator ids, set the hold goal and "tail",
  start a sync) and deciding who else can see it.

Every chart has a Table view and a CSV download. Comparisons are against the **same dates last year**. **Hold** is the time
from the call entering the dispatch queue to the first unit being assigned. Percentiles (P50/P90/P95/P99) are exact.
**Reports** start from a template (Weekly Command Briefing, Monthly Communications Report, Call Handling Review). Add, remove
and reorder sections, then **Print / save as PDF** (SGFD letterhead, Letter size). Saved reports keep their window ("last
7 days" moves with the data), and can be shared as templates.

**Setting it up (once):**
1. The CAD administrator runs `scripts\cad-stats-view-template.sql`. It creates one more read-only view for the same
   `nexus_reader` login as Active calls: times and codes only (no addresses, callers or narratives).
2. In `.env`, set `CAD_STATS_VIEW=dbo.vw_nexus_call_stats` and `CAD_STATS_START=` (the first day to load, e.g. `2024-01-01`).
3. Run `update.ps1`. The first load runs a month at a time in the background. After that it syncs every night at 02:15 and
   re-reads the last 7 days, to pick up late dispositions.

**Uploading reports (with or without the CAD connection):** Data & settings → *Upload a CAD or FireWorks report* takes a CSV
or Excel (.xlsx) export with one row per incident: an incident (CAD) number and the call times. FireWorks' Alarm Processing
report (CADNumber, PSAPTime, Entered Queue, AlarmTime) works as is; Agency, Nature, Disposition, Call taker, Dispatcher,
En route, On scene and Closed columns are used when the file has them. If it has no Agency column, type the agency (e.g. SGFD).
A preview shows the date range and counts before anything is saved. Addresses and other columns are ignored. Uploading the
same incidents again updates them; incidents the CAD view already has are left alone (and when the CAD view later brings in
an incident that was uploaded, the CAD record replaces the upload). Each upload is listed with the file name and who did it.

## PIAL Tracker
**PIAL Tracker** (main menu) estimates the district's score against the 2012 FSRS as PIAL applies it in Louisiana (105.5
points: Communications 10, Fire Department 50, Water Supply 40, Community Risk Reduction 5.5, minus divergence). It also
keeps the records behind each item. It is an estimate to steer the work; PIAL's field visit decides the grade.
- **Items are owned by divisions.** Grant *PIAL tracker: Edit* limited to a division (User Management > Permissions), and
  that division can update its items, records and evidence. *View* is read-only. *Manage* imports, changes settings and owners.
- **Calculated from records:** test intervals (pump, hose, aerial, hydrant inspection and flow, pre-plans) using PIAL's
  "3 most recent, average interval rounded up" rule and credit tables; equipment on every apparatus against PIAL's inventory
  list; training hours by member and category; SOP review dates; IMS training; fire responses (4-firefighter minimum, 320 s /
  560 s arrival); alarm processing from the FireWorks Alarm Processing report or CAD. Everything else takes an estimate (%)
  with notes and attached evidence.
- **FireWorks:** export the reports listed under FireWorks imports (roster, certifications, training, structure fires,
  alarm processing, tests) as **Excel (.xlsx) or CSV** and import them; title lines above the column headings are fine.
  Each one has a template, and a preview is shown before anything is saved. See `docs/PIAL-FireWorks-reports.md`.
- **Alarm processing (420-A-2):** import FireWorks' *Alarm Processing Custom Report* as it comes out of FireWorks. The preview
  shows both measures: entered queue → alarm ("SG Processing") and PSAP → alarm ("Total Processing"), each against 64 s / 106 s.
  PIAL Settings chooses which one counts; the default is entered queue → alarm, which matches PIAL's November 2025 grading
  (19.57 of 20). When the report covers the graded year it's used ahead of CAD. Re-importing replaces the calls between the
  first and last date in the file. Tick *Also add these calls to Comms Statistics* to load them there too.
- **Grader binder** prints the score summary, minimum criteria, every item with notes and the evidence on file, and the
  worksheets (roster, training summary, stations and equipment with test dates, working and non-working fires). Use "Items
  for" to print only one division's part.
- Rules follow the 2012 FSRS and the Louisiana Addendum updated January 1, 2021 (including the 0.50 hydrant data bonus).

## Audit Log (whole system)
*Main menu → Audit Log* (master admins, or anyone given *Audit log: View* in User Management → Permissions): every entry
from every section in one place, newest first. Filter by dates, section, person, or words in the action or detail; page
through it, print a page, or download CSV. Entries can't be edited or deleted. The Audit Log tab inside Procurement still
opens on Procurement's own entries.

## Training

*Main menu → Training* (everyone). Access section **Training**: view = everyone's hours and today's crew; edit = import
from FireWorks and enter hours; manage = requirements, content list and the apparatus list.

- **My training**: each requirement that applies to you, hours done / required, what's left, and whether you're behind
  pace for the year (the dark tick on the bar); every class logged this year. Print it.
- **Today's crew** (view): everyone on today's Aladtec schedule, A–Z by last name (people on time off left out), with
  their hours this year and what they're missing. People who aren't in Nexus yet still show, from their FireWorks hours
  by name. Click anyone for their detail. Print it. **Everyone**: the same for every account (filter: missing / behind pace).
- **Import from FireWorks** (edit): the training records report as Excel or CSV, one row per person per class (name or
  employee ID, date, hours; certification, subject and content title when there). **Check the file** shows what will
  come in; importing the same rows again adds nothing. Names link to accounts by employee number, then name ("Last, First"
  works); unmatched names are kept and link later.
- **Enter hours** (edit): for classes not in FireWorks; pick people, and a class from the content list (fills the
  certification, subject and FireWorks' auto-assigned hours).
- **Requirements & settings** (manage):
  - **FireWorks content list**: load "Certification Subjects and Relevant Content Master List" (Excel). It tells Nexus
    which certification and subject each class belongs to. Load it again when classes are added in FireWorks.
  - **FireWorks training categories**: load the "Training Category List" (Excel). Each category gets an ISO credit
    (Company, Facility, Officer, Driver, Hazmat, or not ISO), changeable per category. A class's subject from the content list
    decides first; the category decides when there's no subject. Archived categories are hidden unless classes use them.
  - **Requirements** (built in, all editable): ISO / PIAL company 192 h a year (max 16 a month counted), facility 18,
    officer 12 (officers), driver/operator 12 (engineers/operators), hazmat 6, all for Suppression/Operations; Louisiana
    ethics, sexual harassment prevention and cybersecurity each year; NREMT EMT 40 / AEMT 50 / Paramedic 60 hours every
    2 years (only for people with hours under that certification). ISO credit comes from the FireWorks subject (Company,
    Facility (Drills), Officer, Driver, Hazmat). Add department requirements by words to look for (e.g. "scba, air pack"),
    who they're for (job titles / divisions) and the period. **Check the state and NREMT defaults against your own rules.**

### Drills, proficiency, company and shift views
- **Log a drill** (company officers, battalion chiefs, Training): topic (or pick from the FireWorks content list), date,
  start/end (hours fill in), station/shift, units, location, ISO credit, how it was delivered, objectives. The crew comes
  from the company (home station on the directory card + shift work pattern) with today's on-duty members (Aladtec)
  already checked; change anyone's hours if they left early. Optionally mark who showed which skills to standard.
  **Sign and submit**. Officers can log for their own company, battalion chiefs for their shift.
- The crew gets a message and a Your Day item to **confirm** (or say what's wrong, which goes to the officer).
- **Training verifies** (Drills › Waiting for Training): the hours then count for everyone on the list, marked
  "Drill (verified)". **Send back** with a note when something needs fixing. Someone else has to verify your own drill.
- **Verified drills for FireWorks (CSV)**: one row per person for entering them in FireWorks. When the FireWorks export
  comes back in (Import), each drill hour that's now in FireWorks (same person, day and hours) is replaced by the
  FireWorks record, so nothing counts twice.
- **Proficiency** (separate from hours): a matrix of people × skills: Current, Due soon, Overdue, Retrain (last check not
  met) or Not on record. Each skill stays current for its interval (e.g. SCBA every 6 months). Checks come from verified
  drills or **Record a check** (officers for their crew, Training for anyone). Skills, intervals and who each applies to
  are in **Skills & roles** (manage); the starting list is a suggestion to edit.
- **My company / Companies**: each member's company training against pace, what's missing, proficiency, and the company's
  drills; print it. **My shift / Shifts** (battalion chiefs, Training): every company on the shift side by side.
- **Skills & roles** also sets which job titles count as company officers, battalion chiefs and drivers, and which
  divisions are on the PIAL roster.

### Grading-year roster and PIAL estimate
- **Roster history** (view): who was on the roster in each year. This year's list follows Nexus accounts on its own
  (Suppression/Operations): new members join, deactivated people get an end date, rank/station/shift changes are noted.
  Managers can add people who left before Nexus (with dates) and fix rows; rows edited by hand stay as set.
- **PIAL estimate**: PIAL's training items (580 A–I, IFSAC, 720 IMS) worked out from Nexus training (FireWorks imports +
  verified drills) for that roster, next to what the PIAL tracker shows now. To make the PIAL tracker use this data,
  set **PIAL › Settings › Training items use** to "The Training section".

### Classroom bookings and apparatus
- Rooms are requested with **Forms → Facility & Resource Request**. The form now asks for a start and end time
  (instead of "Times needed"), shows live whether the rooms are free, and **holds the rooms as soon as it's sent**: a
  room can't be double-booked. If it's taken the form says by what, and whether the second choice is free.
- Marking the form **Approved** confirms the booking; **Not available** releases the rooms. Equipment-only requests
  (Apparatus, Props, …) don't hold a room.
- **Training → Classroom bookings**: two weeks at a time. People with **Classroom bookings** edit access can book rooms
  directly, approve, cancel (the person is messaged) and restore. The rooms list is in Bookings manage (default: every
  facility on the form except Apparatus/Equipment/Props/Other).
- **Rotations**: the person who booked it (or bookings editors) picks which apparatus come for which time block:
  Rotation 1 = these units 0800–1000, Rotation 2 = … (every day, or a given day). Out-of-service units aren't offered; a
  unit already in another class's rotation at the same time gets a warning.
- **Your Day → Classroom bookings** widget: today's classes with times, room and rotations, then the coming week.
- **Training → Apparatus**: the department apparatus list (unit, type, station, in service / reserve / out of service).
  Paste a list (`EG613, LD618, SQ605…`) to add many at once; type and station are guessed from the unit name.

## IMT (Incident Action Plans)

*Main menu → IMT.* For incidents run under NIMS/ICS (hurricanes, floods, winter storms, planned events). Access section
**IMT**: view = every incident; edit = fill in forms, start periods, add files; manage = create/close/delete incidents,
approve, start from an IAP PDF. Anyone named in an IAP (203, 204 supervisor, 214) can always open that IAP, and with
"Everyone in Nexus can read this incident's approved IAPs" on, everyone can read approved ones.

- **Incident**: name, number, type, location (**Find on map** looks up the address with the free US Census geocoder and fills
  latitude/longitude, used for the forecast), situation summary.
- **Operational periods**: each one is its own IAP. **New operational period** starts where the last one ended, as a copy of it
  (activity logs, check-ins and messages aren't copied; the forecast is cleared), or blank.
- **Forms**: Cover, ICS 202, 203, 204 (one per branch/division/group), 205, 205A, 206, 207, 208, 211, 213, 214, 220, Weather and
  Attachments, in IAP order (move them up/down). Each form saves as you type ("Saved"). The list shows what's still blank on each form.
  - Names typed on any form offer the roster; picking someone links their account (green dot): they can open the IAP, are notified,
    and their Directory cell phone fills the contact. Outside people are typed in.
  - The Operations Section Chief and phone on each 204 come from the 203; the 207 org chart is drawn from the 203; "Fill from the 203
    and Directory" builds the 205A.
  - 205 channels and 206 hospitals / aid stations / ambulances: **Save for next time** and **Load saved** carry them between incidents.
  - **Weather**: **Get the forecast** saves the National Weather Service forecast (and any alerts) for the incident location into
    the IAP, so the printed copy matches what crews were told.
  - **Attachments**: maps, pictures and PDFs (each PDF page is turned into a picture in your browser so it prints inside the IAP;
    up to 40 pages, 15 MB). Files are kept per incident under **Maps, pictures and files**.
  - **Suggest** (202 objectives, 204 work assignments, 208 safety message): a draft from the incident, period, current objectives,
    assignments and forecast. Nothing changes until you choose **Use these**. Needs `ANTHROPIC_API_KEY` (the requisition autofill key).
- **Approve**: the IC named on the 203 (or an IMT manager) approves, optionally with a drawn signature that prints on the 202.
  Approved IAPs are locked; **Reopen** unlocks (audited).
- **Print IAP**: cover, then every form laid out like the FEMA ICS forms with "IAP Page N"; 205, 207, 211, 220 print landscape.
  Unapproved IAPs print "DRAFT - NOT APPROVED" on the cover. Save as PDF from the print dialog to send it.
- **Notify assigned**: messages everyone named in the IAP who has a Nexus account (push to their phones if they've turned it on).
- **Start from an IAP PDF** (manage): reads an existing IAP's 202, 203, 204s, 205, 206, 208 and 220 into a new period (and a new
  incident, or an existing one). Check everything before approving. Maps and pictures aren't copied: add them as attachments.
- The forecast needs the server to reach `api.weather.gov` (already used by Your Day) and the address lookup `geocoding.geo.census.gov`.

## Evaluations & Simulations

*Main menu → Evaluations.* Evaluation programs at every rank, the 12-month working test periods, and voice simulations.
Access section **Evaluations & simulations**: view = everyone's records (read-only); edit = evaluator for every program
(score and sign, run evaluated simulations, write reviews); manage = programs, scenarios, enrolments, final recommendations.
People named as evaluators on a program or on one candidate can evaluate those without section access. Everyone sees their
own record and can practice. Nobody can evaluate themselves.

- **Programs** (manage) came from SGFD's documents: *Company Officer – Working Test Period* (scenarios A–I with the document's
  weights: A & B 20%, C & D 15%, E 15, F 10, G 10, H 15, I 15; pass = 80% composite and no category under 70%), *Company Officer
  Evaluation (7 categories)*, *Company Officer – Station Evaluation Matrix* (160 points), *Battalion Chief – Working Test Period*
  (A–I, 15/15/10…), *Battalion Chief – Evaluation Matrix* (155 points), *Deputy Chief – Working Test Period* (categories 1–5,
  factors 1–5 with ×2/×1 weights). Each module keeps the document's own text as its **Guide** (scenario, tasks, prompts,
  expected behaviors, deliverables). Two gaps in the documents were filled and marked in the guide: BC module D (Interagency
  Coordination) has no detailed rubric, and DC category 1 has no factor table. Edit anything in **Programs**, and add
  Firefighter, Driver/Operator, Assistant Chief and other forms there (kind *Evaluation form* or *Working test period*).
- **Working test periods** (manage starts one): person, program, start date (end = 12 months later), assigned evaluators. The page
  shows each module's score (formal results averaged; a **retest** replaces earlier scores for that module), the composite, modules
  that are due by quarter and not scored yet, and whether the candidate meets the passing standard.
- **New evaluation** (evaluator): pick the modules, write what you observed, and **Draft scores with AI**: the assistant applies
  that program's rubric and guide to your notes (and the candidate's written submissions), drafts scores with reasons, comments and
  feedback, and **flags** what needs checking. Scores you already set are kept. Every flag must be checked off or removed, every
  element scored, and the evaluator signs before it's official. Signed results are locked (a manager can **Reopen**, audited) and the
  person is messaged. Practice results never count and are private.
- **Written deliverables**: the candidate (or an evaluator) turns in text and/or a file per module.
- **Reviews** at the program's months (3/6/9/12; DC also month 1): summary, achievements, deficiencies, goals, improvement plan;
  the evaluator signs, then the candidate signs that they've seen it (with an optional comment).
- **Final recommendation** (manage): one of the program's outcomes, notes, signature; **Print final report** (scores, evaluations,
  reviews, recommendation, signature lines).

### Voice simulator

*Evaluations → Simulator.* Fireground radio scenarios (from CO scenarios A, B, D and BC module A, plus a Mayday recognition drill)
and leadership conversations (defensive member, crew conflict, difficult feedback, accountability with a former peer).

- Hold **Hold to key up** (or the space bar) and talk; let go to send. The browser records the microphone as a 16 kHz WAV, Whisper
  on the Nexus server transcribes it (the same `tools\whisper` install as Working Fire transcripts; the audio isn't kept), and the
  assistant answers as Dispatch and the other units (or as the member). Replies are read aloud with the browser's voices (turn
  them off with **Voices on/off**). Units report on scene at their arrival times, and timeline injects (scene changes, Mayday and
  safety cues) arrive as the clock runs. Without Whisper you type instead.
- **End and grade**: scores per rubric element with the moment that supports each one; what went well / to work on; for radio, every
  Mayday or safety cue with whether it was caught and how fast, the assignments with times, and key decisions; for conversations,
  what helped, what escalated it, and how well the officer listened, set expectations and planned follow-up. **Replay** reads the
  traffic back; **Print** gives a copy.
- **Practice** runs are private to the person and never count. An evaluator can start an **evaluated run** for a candidate (from the
  candidate's page → **Evaluated simulation**), with the candidate at the microphone. Afterward **Review scores and sign** makes a
  draft evaluation for the linked module with the AI's scores, reasons and flags; the evaluator checks, changes and signs it.
- **Scenarios** (manage): call sign, dispatch, what the officer sees, hidden facts, units with arrival times, timeline injects (mark
  cues and the expected action), or for conversations the member's opening words, hidden background and a good outcome. Link a
  scenario to a program module to grade it with that rubric.
- The microphone needs HTTPS (Nexus already uses it) and the browser's permission for the site. Needs `ANTHROPIC_API_KEY`.

### Strategies & Tactics (scene maps)

A radio scenario can have a **scene map**: an overhead picture of the address. No paid map service or key is needed.

- In **Scenarios → Edit → Scene map**: **Upload a picture** (a Google Earth screenshot with its credit line, a drone photo, a pre-plan
  drawing, parish/Assessor aerials) or type the address and **Load USGS aerial** (free public imagery from USGS The National Map, about
  1-meter resolution, 400–1500 ft across; the scale is set automatically). The server needs to reach `basemap.nationalmap.gov` and the
  Census address lookup (already used by IMT).
- Tools: **Set scale** (click both ends of something you know the length of; uploaded pictures need this), **Hydrant**, **Fire** (when it
  shows), **Hazard** (power lines, which the officer sees; collapse zones, which are hidden and graded; other), **No access** (drag a box:
  parked cars, fences, soft ground), **Building outline** (click the corners), **Erase**, plus wind direction and speed (smoke drifts with it).
- During a run the officer picks a unit that has arrived and clicks the picture to position it (drag to move, rotate buttons). Apparatus
  are drawn to scale. Nexus refuses spots that are blocked or inside the building, and works out what each position means: distance
  to the building, nearest hydrant (engines show a supply line with the distance), whether preconnects (200 ft) reach, whether the
  aerial (about 100 ft) reaches, collapse zones and power lines. Dispatch and the units are told the positions and act within them
  ("we can't reach the roof from here"), and the grader judges placement.
- The debrief has an **Apparatus placement** card: the AI's comments, the map with the collapse zones shown, and a time slider that
  replays where each unit was and how the fire grew.

## Sick Leave
*Main menu → Sick Leave.* Each division logs its people's sick call-outs; Nexus totals the hours and looks for habits.
Permission *Sick leave* (User Management → Permissions, by division): **View** = call-outs, hours and patterns for those
divisions; **Edit** = also log and correct call-outs; **Manage** = settings.
- **Log a call-out:** person, day (or a range: one entry per scheduled shift in it), hours (defaults to their shift: 24 fire,
  12 comms, 8 otherwise), type, doctor's note on file, when they called, a short note. **Don't record diagnoses or symptoms.**
- **Protected leave** (FMLA, on-duty injury / workers' comp, approved medical accommodation) is listed and totaled but never
  counted in patterns or risk.
- **People:** sick hours this year, call-outs (back-to-back shifts count once), Bradford factor (call-outs² × shifts), and
  patterns in plain words, e.g. "15 of 20 call-outs were on or next to a holiday (about 2 expected): 4.5× their normal rate",
  a weekday that stands out, call-outs right before or after their own scheduled leave (from Leave Picks), and the same holiday
  in more than one year.
- **Outlook:** coming holidays and, for each day, the people scheduled to work (and not on their own leave) whose risk score is
  at or above the alert level (default 7).
- **The score (0–10)** comes from each person's usual rate of calling out on a scheduled shift (pulled toward the department's
  rate when they have little history), raised by any of their patterns that fit that day, turned into a chance for that shift.
  Score = 10 × (1 − e^(−chance ÷ 15%)): 10% chance ≈ 4.9, 20% ≈ 7.4, 35% ≈ 9.0. Every score shows the chance and the reasons.
- **Settings:** look-back (default 24 months), holiday window (default the day before, the holiday and the day after), the alert
  score, which holidays count (New Year's, MLK, Super Bowl Sunday, Mardi Gras, Good Friday, Easter, Memorial Day, July 4, Labor
  Day, Halloween, Thanksgiving and the day after, Christmas Eve and Day, New Year's Eve) and your own dates.
- Patterns are a starting point for staffing and a conversation, not proof of misuse; every entry and change is in the audit log.

## Admin duties without full master access
In User Management → People & permissions → Edit a person:
- **Directory admin**: edit anyone's card, stations and contacts; run directory checks; Aladtec setup.
- **Forms admin**: build and edit forms, recipients and progress steps (not who sees all submissions).
- **Accounts admin**: approve/decline account requests and issue temporary passwords (not for master admins).


### Permissions and groups
User Management > **Permissions** has three pages:
- **By person:** everything someone can do beyond the basics, and whether it was given to them directly or comes through a group.
- **By section:** who can view, edit or manage each section, with a "Give access" form. Access can cover all divisions,
  chosen divisions, or "their own division".
- **Groups** (master admins): named sets of people that fill themselves from rules (division, Fire A/B/C shift or Comms
  crew from each person's Time Tracker schedule, role, job title), plus people added or left out by hand. Give a group
  access once and everyone in it has it; people move in and out automatically as their details change.

Master admins can give anything. Someone with **Manage** on a section can give and remove View/Edit in that section
(within the divisions they manage) but can't make other managers. Every change is in the audit log.

## Notifications
Your Day checks for new items every minute while it's open. When something new needs you it plays a
light ding and the browser tab shows the count, e.g. "(2) St. George Fire". Turn the sound on or off
with the 🔔 button on Your Day (remembered per computer). Browsers only play sound after you've clicked
on the page once.

## Security
Built in: passwords hashed with scrypt; 5 wrong tries locks an account for 15 minutes; HttpOnly session
cookies; sign-out after 60 idle minutes (`SESSION_IDLE_MINUTES`) and 12 hours (`SESSION_HOURS`); every
change checked on the server against the person's role; audit log; SSNs and other sensitive answers
encrypted; strict browser security headers (content security policy, no framing).
**Signed-in devices** (side bar footer): see and sign out your devices; master admins see everyone's
and can sign everyone else out.

Do these on the computer running the app (until it moves to the on-premise servers):
1. **HTTPS.** Get a certificate for the server's name from IT (or your internal CA), put the files in
   `D:\sgfd-nexus\certs`, add `HTTPS_CERT_FILE=` and `HTTPS_KEY_FILE=` to `.env`, run `update.ps1`. Without
   HTTPS, passwords cross the network readable.
2. **Firewall.** Only allow the department network to reach the app (admin PowerShell; change the subnet):
   `New-NetFirewallRule -DisplayName "SGFD App" -Direction Inbound -Protocol TCP -LocalPort 3000 -RemoteAddress 192.168.123.0/24 -Action Allow`
   and make sure no other rule opens port 3000 to everyone.
3. **PostgreSQL** listens only on the same computer: `listen_addresses = 'localhost'` in postgresql.conf,
   and a long random password for `sgfd_app`.
4. **Backups.** `scripts\backup.ps1 -Register` schedules a nightly database + uploads backup (kept 30 days).
   Point `-Destination` at another machine or share if you can. Keep a copy of `secrets\forms.key`
   somewhere separate and safe; test a restore once.
5. **The computer itself:** BitLocker on, Windows updates on, sleep off, only admins can sign in to it
   locally, and the `.env` / `secrets` folders readable only by administrators.
6. **Accounts:** keep master admins to 2–3 people; use the admin duties for everyone else; remove people
   who leave (User Management); glance at the audit log now and then.

## Active calls (CentralSquare CAD)
Your Day shows calls open in CAD right now: call type, priority, status, address (map link), units and time
since received. It stays hidden until `CAD_SQL_*` is filled in `.env`.
1. Give `scripts/cad-view-template.sql` to the CAD database admin. It creates the `nexus_reader` login, the view
   `dbo.vw_nexus_active_calls` (they fill in CentralSquare's real table/column names), and grants SELECT on that
   view only. It also has the firewall rule (port 1433 from the Nexus server only).
2. Put the server, database and password in `.env`, then run `update.ps1` (it installs the `mssql` driver).
3. Master admins see connection errors on the Active calls card; everyone else sees "can't be reached".
Each person can turn on a "new-call ding" on the card (off by default). Confirm CJIS sign-off before going live.
For a demo without CAD, set `CAD_TEST_FILE` to a JSON file holding an array of rows with the view's columns.

## Look
The side bar shows the SGFD Nexus emblem (`public/nexus-emblem.png`). The browser tab icon and the home-screen app icon
(Add to Home Screen on a phone, or Install / Create shortcut in Chrome or Edge) come from `public/favicon.ico`,
`icon-*.png`, `apple-touch-icon.png` and `manifest.webmanifest`.
The sign-in page shows the animated emblem (`public/nexus-hero-art.png`, `-bolts.png`, `-ring.png`); every other page shows `public/nexus-watermark.jpg`
as a faint watermark (strength: `opacity` in `src/AppShell.jsx`). Replace either file with the same name to change it.

## Emergency Recall (Policy 1010)

*Main menu → Emergency Recall.* Aladtec stays where members sign up and the Assistant Chief approves and assigns
recall shifts, exactly as the policy says; Nexus runs beside it.

- **Start a recall** (the Assistant Chief on duty and above): title, reason (1010.3.1), the recall day(s), where to report,
  instructions, and who is recalled (groups such as A-Shift or a station, plus people). Everyone recalled gets an important
  message and push notification with the Aladtec link and steps. Still send the Aladtec alert and have Communications send
  the Blackboard message; the board's checklist tracks each policy step.
- **Members** see "EMERGENCY RECALL" at the top of Your Day and answer: **I'm coming** (with an ETA) or **I can't report
  safely** (impairment, 1010.3.4; it goes straight to the Assistant Chief). There's no decline: members may not refuse.
- **The board** (Assistant Chiefs and above; anyone given Emergency recall edit access, e.g. Communications, can operate it;
  view access can watch): counts, each person's answer and phone, their **Aladtec assignment** on the recall days (read from
  Aladtec; "Check Aladtec" refreshes), phoned-in answers, **roll call** (Arrived), release, the **unit staffing** board with
  seat flags (officer seats need an officer title; driver seats a driver title or a passed pumper/aerial evaluation),
  **Placed in service with Comms**, a timeline with notes, and a printable **after-action report**. Close it when it's over.
- **Settings** (Emergency recall manage): who can start recalls (job titles), seat rules, the Aladtec link, and the
  **Special Operations assignments** list from the policy (one button adds those units to a recall's board).


## Fire Prevention (annual inspections and PIAL 1022)
- Tile **Fire Prevention**: for the Fire Prevention division (anyone in a division named Prevention / Arson / Marshal gets
  Edit automatically) and anyone given access (User Management › Permissions, section "Fire Prevention").
- **Import report** (Edit): in FireWorks run **PIAL Annual Periodic Inspection History**, export to Excel (.xlsx) or CSV,
  upload, check the preview, Import. Rows FireWorks repeats for one Property # are merged; each import adds new inspections,
  updates the property list and sets aside properties no longer in the report (history kept). Import as often as you like.
- **Overview**: properties counted, inspected this year, not inspected yet (and how many a week it takes to finish by Dec 31),
  the PIAL 1022 estimate, pace by month, coverage by inspection area and first-due station, and work by inspector.
- **Not inspected** / **Every property**: filter by area, station or search; CSV for assigning. Open a property to see its
  history, record an inspection FireWorks doesn't have yet, or leave it out of the count with a reason (demolished,
  residential, duplicate…).
- **PIAL**: FSRS 1022 = 8 × properties inspected in the graded year ÷ properties, only OSFM-certified inspectors, partial
  records −25%. The PIAL tracker's item 1022 now calculates from this (before the first import it keeps the last grading).
- **Settings** (Manage): which fire districts count (St. George and SG sub-districts by default; Baton Rouge, Prairieville
  etc. don't), whether inspectors are OSFM-certified, partial records, leave vacant properties out.

## Permission profiles and the By person view
- **User Management › Permissions › By person**: every section in one table: whether it shows in their side bar, their
  level (Basic / View / Edit / Manage / Master), what they can do there, and where it comes from (given directly, a group,
  a profile, or automatic: Technology works Help Desk, the Fire Prevention division edits Fire Prevention, job titles for
  recall starters and company officers / BCs in Training). Profiles can be given or removed right there.
- **Profiles** (masters): Basic, Chief Officer, Division Head / Deputy Chief, Fire Chief (view of everything, manages
  nothing), plus your own. Give a profile to people or to a group (e.g. a "Battalion Chiefs" group by job title) so new
  people get it automatically. A profile only adds access; it never takes away what someone already has.
- **Updates keep profiles current**: the built-in profiles are defined in Nexus itself. When an update adds a section, it
  joins the profiles it belongs in (Fire Chief gets the view level of every new section automatically). If you change a
  built-in profile, only your changes are saved, so updates still reach it; **Reset to default** undoes your changes.

## Investigations (arson) and CJIS
- Tile **Investigations** for people given access in User Management (section "Investigations (arson)"): **Edit** = fire
  investigator, **Manage** = Chief of Fire Prevention. Access alone isn't enough; each person also needs:
  1. **The CJIS list** (Investigations › CJIS list, kept by the Chief): fingerprint-based background check date and CJIS
     security awareness training date. Training older than a year closes Investigations for that person automatically.
  2. **An authenticator app** (Microsoft or Google Authenticator): set up the first time they open Investigations. The
     6-digit code is asked again after 30 minutes without activity and every 12 hours. Five wrong codes in 15 minutes lock
     it until the Chief (or a master admin) releases it; the Chief gets a message.
- **Need-to-know**: a case opens only for the investigators on it, the Chief and master admins (who must also be on the
  CJIS list). "Is there already a case?" searches every case but shows only case #, status and lead.
- **Case file**: summary and origin & cause (NFPA 921 classification), people, evidence with chain of custody, photos and
  files, supplements (can't be changed once added), DA and juvenile referrals, printable case file (without criminal history).
- **Criminal history (CJI)**: results of checks you run, with the printout if you like. Encrypted on the server; every view
  is logged; releasing it (printing for the DA, handing it over) goes through **Release / print**, which records who it went
  to and why (dissemination log). The Chief can **purge** an entry with a reason (the record that it existed stays).
- **Access log** (Chief): every list, view, file opened, release and change, with failed sign-ins and authenticator events.
  It can't be edited or deleted. Sign off the weekly review there; Your Day reminds the Chief when it's due.
- Nothing from a case goes into Messages or phone notifications (only "you were added to case 2026-004"), the audit log
  (case numbers only) or the AI features.
- **What the software can't do for you** (Chief of Fire Prevention / IT): name a Local Agency Security Officer, keep
  fingerprint checks and training records on paper too, BitLocker on the server's drives and the backup drives, the server in
  a locked room, monthly patching, report security incidents to the state CJIS office within an hour, and have the state
  police CJIS audit look at this setup. IT staff who are master admins need the background check and training too.

## Comms Statistics: Apparatus
- **Apparatus** page: how many calls each unit ran in one shift (07:00 to 07:00, with the A/B/C shift) or over a date range
  (totals, per-shift average, busiest shift, a unit-by-shift table), arrivals and time committed (assigned to cleared). CSV on each card.
- Needs the units view on the CAD server (`scripts/cad-units-view-sgfd.sql`), `CAD_STATS_UNITS_VIEW=dbo.vw_nexus_unit_responses` in .env,
  and one **Reload all since …** in Data & settings. The unit filter defaults to SGFD units; managers can save a different default.
