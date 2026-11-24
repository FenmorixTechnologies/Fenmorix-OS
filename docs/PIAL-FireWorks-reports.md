# FireWorks Ad-Hoc reports for the SGFD Nexus PIAL tracker

Build these reports in FireWorks (Ad-Hoc or custom reports) and export each one as **Excel (.xlsx) or CSV**; report title
lines above the column headings are fine. Then import them in Nexus under
PIAL Tracker > FireWorks imports. Each import shows a preview first, so a wrong column is caught before anything is saved.

- Column names don't have to match exactly. The names below work, and so do common alternatives (for example "Emp ID",
  "Employee Number" or "Member ID").
- Extra columns are ignored.
- **Leave out SSNs, home addresses, phone numbers and dates of birth.** PIAL tells departments to remove them too.

| Report | Run it for | Re-importing |
|---|---|---|
| 1. Membership roster | Everyone who was a member at any time in the graded year | Replaces the whole roster |
| 2. Certifications | All current certifications | Replaces all certifications |
| 3. Training hours | The graded year so far (or any date range) | Replaces rows between the file's first and last date |
| 4. Structure fire incidents | The graded year | Updates by incident number |
| 5. Test and review records | Everything on file (3+ years) | Skips exact duplicates |

## 1. Membership roster
| Column | Required | Notes |
|---|---|---|
| Employee ID | recommended | Used to match training and certifications to people |
| Name (or First Name + Last Name) | yes | |
| Rank, Position | | Officers (Captain, Lieutenant, Chief) and drivers (Driver, Engineer, Operator) are recognized from these |
| Date Entered Rank, Hire Date, End Date | | Hire date in the graded year = recruit; end date before the year = left out |
| Shift | | |
| Officer, Driver | | Y/N; overrides the rank-based guess |
| Driver Since | | A date in the graded year = new driver/operator (60-hour program) |
| Suppression | | N for members who don't respond to fires (default Y) |

## 2. Certifications
One row per certification: **Employee ID or Name**, **Certification** (title), Date, and optionally IFSAC (Y/N).
IFSAC is recognized from the title (Firefighter I/II, Instructor, Driver/Operator, Aerial, Fire Officer, HazMat). Pro Board
isn't credited by PIAL. Include **NIMS / ICS-100** certificates, which count toward IMS credit.

## 3. Training hours
One row per member per class: **Employee ID or Name**, **Date**, **Hours** (decimal or h:mm), **Category / Training Type**,
Course Title, Location, Delivery Method.
- **Category** is matched to PIAL's categories: company, officer, driver, new driver, HazMat, recruit, IMS, or not creditable
  (EMS, admin). Nexus guesses each new category, and Training can correct the mapping on the Training page.
- **Location**: "Training Ground", "Burn Building" or "Drill Tower" (or Y in an "At Facility" column) counts toward the 18
  hrs/member at a training facility.
- **Delivery Method**: In-House / Virtual (interactive Zoom, Teams or Google Meet, full credit) / Online (self-paced CBT,
  up to 8 of the 16 monthly company hours) / Outside (e.g. LSU FETI, counted at half).

## 4. Structure fire incidents
Every structure fire alarm in the district, working and non-working: **Incident Number**, **Alarm Date**, Alarm Time,
Property Type (Commercial/Residential), Working Fire / Hose Used (Y/N), Personnel (members of this department who responded),
First Engine Seconds and Full Complement Seconds (from dispatch to on scene, as seconds or m:ss).
NFIRS incident types 111-123 are structure fires. "Hose used" can come from Actions Taken (e.g. 11 Extinguishment).

## 5. Test and review records
**Type** (Pump, Hose, Aerial, Hydrant inspection, Hydrant flow test, Preplan, EPSS / Generator, SOP), **Date**, Unit / Subject
(E61, L61, a generator site, an SOP name, or a label like "All hose"), Result (Pass/Fail).
These can also be entered by hand under Testing & reviews.

## 6. Alarm processing (420-A-2)
FireWorks' **Alarm Processing Custom Report**, exported to Excel as it is: IncidentDate, **CADNumber**, CAD Address, PSAPTime,
Entered Queue, **AlarmTime**, Call Talking, SG Processing, Total Processing. Run it for the graded year (or year to date).
Addresses are not kept. Re-importing replaces the calls between the first and last date in the file.
The preview shows both measures against 64 s / 106 s: entered queue → alarm ("SG Processing") and PSAP → alarm ("Total
Processing"). PIAL Settings picks which one counts (default: entered queue → alarm, which matches the November 2025 grading).
The same file can be uploaded to Comms Statistics (Data & settings), or tick *Also add these calls to Comms Statistics*.

