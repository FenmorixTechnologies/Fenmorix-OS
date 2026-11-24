// Evaluation programs seeded from SGFD's documents (Company Officer Evaluation, Battalion Chief Testing & Evaluation
// Strategy, Deputy Chief Working Test Evaluation). Generated once; after seeding, programs are edited in the app.
// `guide` is the document's own text for that module (scenario, tasks, prompts, expected behaviors, deliverables).
export const PROGRAM_SEEDS = [
{
"key": "co-wtp",
"name": "Company Officer – Working Test Period",
"rank": "Lieutenant / Captain",
"kind": "wtp",
"sort": 30,
"description": "12-month Civil Service Working Test Period for Lieutenants and Captains: scenarios A–I, scored 0–5 per element.",
"data": {
"scale": {
"min": 0,
"max": 5
},
"passComposite": 80,
"passModule": 70,
"months": 12,
"reviews": [
3,
6,
9,
12
],
"evaluators": "Chief of Training, Battalion Chiefs, and designated evaluators certified to at least Fire Officer III.",
"signatures": [
"Battalion Chief",
"Chief of Training",
"Assistant Chief / Fire Chief"
],
"outcomes": [
"Recommend permanent status",
"Extend the working test period",
"Do not recommend"
],
"overview": "Assistant Chief / Fire Chief: | ______________________________  Date: ___________\nThis evaluation aligns with NFPA 1021 (2020 Edition) JPRs for Fire Officer I–II and supports ISO/PIAL documentation requirements.\nSt. George Fire Protection District – Company Officer Testing Strategy\nPurpose\nTo establish a fair, transparent, and cost-neutral testing and evaluation process for Company Officers that:\nOccurs entirely on-duty, requiring no overtime.\nSpans the full 1-year Working Test Period (WTP).\nMeasures readiness, leadership, and administrative capability in alignment with NFPA 1021 (2020 Ed.), ISO/PIAL, and Louisiana Civil Service Law.\n1. Program Overview:\nElement | Description\nPositions Evaluated | Lieutenant and Captain (Promotional & Developmental)\nDuration | 12 months (one full Civil Service Working Test Period)\nScheduling | All tasks completed during normal shift hours (24/48 schedule); each scenario is embedded in training, station management, or incident activity.\nEvaluator Group | Chief of Training, Battalion Chiefs, and designated evaluators certified to at least Fire Officer III.\nFramework | Scenarios A–I evaluate technical, tactical, administrative, and leadership domains.\nCompliance | LA R.S. 33:2471–2495 (Civil Service Law); SGFD SOP #100-06 (Training & Evaluation).\n2. Testing Structure\nQuarter | Evaluation Focus | Scenario Alignment | Delivery Mode\nQ1 | Foundational Officer Skills | A – Size-Up & Initial Command – Engine Company Operations | On-duty tactical drills & incident observations\nQ2 | Multi-Company Coordination | C – Ladder Operations – Incident Command System | Tabletop / live-fire scenarios; evaluated by Training Division\nQ3 | Personnel & Administrative Skills | E – Personnel Management – Daily Inbox Decision-Making – NERIS Report Writing | Station-based simulations & administrative submissions\nQ4 | Strategic & Leadership Readiness | H – Budget Proposal & Presentation – Professionalism & Readiness | Formal presentation + live behavioral observation day\n3. Scheduling & No-Overtime Implementation\nA. Integration into Duty Schedule\nEvaluations occur during normal shift hours, coordinated by Training Division and Battalion Command.\nTactical scenarios (A–D) are scheduled within regular company drill blocks or live incident responses.\nAdministrative and written tasks (E–H) are assigned with multi-day completion windows so no call-backs or extra pay occur.\nPresentation (Scenario H) delivered on a regular A-, B-, C-Shift rotation day, scheduled during daytime training block.\nB. Evaluator Rotations\nTraining Division staff rotate across shifts for impartiality (no overtime).\nWhen cross-shift presence is required, an evaluator on duty for another assignment conducts review and documents findings electronically.\nC. Digital Evaluation Platform\nAll submissions (memos, NERIS reports, proposals) are uploaded through the SGFD intranet.\nEvaluations and scoring rubrics completed digitally; eliminates after-hours review or manual form handling.\n4. Weight & Scoring\nCategory | Scenarios | Weight (%)\nTactical Operations | A & B | 20\nStrategic Command | C & D | 15\nPersonnel & Leadership | E | 15\nAdministrative Decision-Making | F | 10\nReport Writing & Documentation | G | 10\nBudget & Presentation | H | 15\nProfessionalism & Readiness | I | 15\nTotal | A–I | 100 %\nPassing Requirement:\nMinimum 80 % composite average across all sections.\nNo individual category below 70 %.\nScores are compiled quarterly, allowing early feedback and remediation if a candidate falls below benchmarks.\n5. Feedback & Development Cycle\nTime | Action\nAt 3 months | Initial feedback meeting with Battalion Chief and Training Division.\nAt 6 months | Mid-term performance review: remediation plan if required.\nAt 9 months | Targeted leadership or administrative assignments (mentorship, project lead).\nAt 12 months | Final composite evaluation and written recommendations for Civil Service certification or extension of WTP.\nAll evaluations and feedback are signed, dated, and filed per Civil Service recordkeeping requirements.\n6. Civil Service Compliance – Working Test Period (1 Year)\nThe Working Test Period (WTP) begins the day the officer is officially promoted or provisionally assigned to the higher rank.\nPer R.S. 33:2490, the WTP serves as a probationary evaluation year, not to exceed 12 months.\nEvaluations through Scenarios A–I form the performance record used to confirm permanent status or recommend further development.\nIf deficiencies persist after remediation, the appointing authority may request an extension or reversion under Civil Service law.\n7. Documentation & ISO / PIAL Integration\nAll training and evaluations produce documentation applicable for:\nISO/PIAL Training Credit: Officer development, ICS drills, facility training, administrative management.\nNERIS Data Quality: Accurate incident reporting and after-action documentation.\nAccreditation & QA: Supports SGFD Training Division metrics for professional development.\nEach scenario completion sheet and rubric is uploaded under:\nAbsorb\n8. Program Completion & Certification\nAt the conclusion of the 12-month cycle:\nTraining Division compiles all scenario scores and narrative feedback.\nBattalion Chief and Chief of Training sign the Final Officer Evaluation Report.\nReport is forwarded to the Fire Chief and Civil Service Board for official certification of permanent status.\nOfficer receives documentation for personnel file and ISO training credit.\n9. Key Benefits\nZero overtime cost: All activities embedded within shift operations.",
"modules": [
{
"key": "A",
"title": "Size-Up & Initial Command",
"weight": 10,
"quarter": 1,
"competency": "Tactical operations",
"elements": [
{
"label": "Completeness of radio report",
"mult": 1
},
{
"label": "Accuracy of size-up (construction, occupancy, fire location)",
"mult": 1
},
{
"label": "Clarity of command establishment",
"mult": 1
},
{
"label": "Risk/benefit and safety awareness",
"mult": 1
},
{
"label": "Prioritization of actions and resource requests",
"mult": 1
}
],
"guide": "Scenario A – Size-Up & Initial Command\nScenario Type:\nResidential Structure Fire – Single Family Dwelling\nScenario Narrative:\nAt 07:36 hours, your company is dispatched to 6843 Brookshire Drive for a report of a house on fire. Dispatch advises multiple callers report flames visible from the rear of the structure. The weather is 92°F with high humidity, and wind from the southeast at 10 mph.\nOn arrival, you find a one-story, single-family, wood-frame dwelling (approx. 1,800 sq ft) with moderate smoke showing from the eaves and visible fire from a rear bedroom window on the Bravo-Charlie corner. A vehicle is in the driveway. Neighbors report the occupants are possibly still inside.\nYour unit is EG 623, first due, with a crew of four personnel (Officer, Driver, Nozzle, and Back-Up). AR 618 and EG 653 are en route, approximately 3 and 6 minutes out respectively.\nHydrants are located 150 feet west of the structure on Brookshire Drive. Power lines cross the Alpha-Bravo corner near the roofline.\nOfficer Expectations / Evaluation Criteria\nThe officer shall:\nProvide a complete and structured initial radio report, including:\nUnit designation and arrival (“Engine 623 is on scene…”)\nDescription of the building (size, construction, occupancy)\nConditions found (smoke, fire, exposures)\nActions to be taken\nStrategic mode (offensive/defensive)\nCommand establishment and location\nIdentify critical hazards (power lines, wind direction, potential collapse, victim survivability).\nIdentify initial tactical priorities (rescue, fire attack, water supply, etc.) and assign crew objectives.\nRequest additional resources if warranted.\nMaintain calm, clear, and concise radio communications.\nEvaluator Observations\nPerformance Element | Rating (0–5) | Comments\nCompleteness of radio report |\nAccuracy of size-up (construction, occupancy, fire location) |\nClarity of command establishment |\nRisk/benefit and safety awareness |\nPrioritization of actions and resource requests |\nEvaluator Notes",
"sim": true
},
{
"key": "B",
"title": "Engine Company Operations",
"weight": 10,
"quarter": 1,
"competency": "Tactical operations",
"elements": [
{
"label": "Initial radio report & command establishment (completeness & clarity)",
"mult": 1
},
{
"label": "Urgentness of priority decision (Search vs Water vs Hybrid)",
"mult": 1
},
{
"label": "Attack line selection & water supply plan (flow, feasibility)",
"mult": 1
},
{
"label": "Flexibility & reaction to changing fire behavior (T+2–T+4)",
"mult": 1
},
{
"label": "Accountability & safety measures for interior crews (RIT/back-up)",
"mult": 1
},
{
"label": "Written justification (150–300 words; scored separately in the document)",
"mult": 1
}
],
"guide": "Scenario B (Advanced) — Engine Company Operations (Decision-Making Under Stress)\nScenario Type:\nWorking Residential Fire — Rescue vs. Fire Control Decision-Making\nScenario Narrative (brief)\nAt 14:22 hours, Engine 633 (Officer + 3) is dispatched to 4115 Magnolia View Drive for a reported structure fire. Dispatch updates: “multiple callers — heavy smoke and possible occupant trapped.” AR 638 and Engine 663 are en route (ETA 3 and 6 minutes). SG7 is responding.\nOn arrival (Engine 633 — first due) you find:\nA one-story, 2,200 sq ft wood-frame residence with brick veneer.\nMedium to heavy smoke pushing from multiple eaves; visible fire through a first-floor kitchen window on the Delta side.\nNo obvious entry point designated; front door is set back behind a porch and not immediately visible from apparatus parking.\nHydrant located ~75 ft from Alpha side but the roadway is narrow — apparatus placement will affect lay options.\nA neighbor shouts that a single elderly occupant (approx. 70 y/o) lives alone and “may be in the back bedroom.” Another bystander reports hearing a faint noise from inside but can’t confirm location.\nOverhead power lines run close to the roofline on the Bravo side. Wind is light; temperature 88°F.\nYour crew reports: one firefighter is cross-trained and can perform rapid search; the driver can perform a forward lay or reverse lay depending on orders. You have one 1¾\" crosslay (preconnected), one spare 2½\" on board (uncharged), and an 50' extra length of 1¾\" can be deployed. Engine pump can supply two 1¾\" lines or one 2½\" handline with a blitz line configuration but doing both will delay interior entry.\nInjected Timeline (simulated time progression — use during evaluation)\nT+0 (Arrival): Conditions as described above. Officer must give an initial radio report and set command.\nT+1 minute: Neighbor becomes more insistent that the occupant may still be in the rear bedroom; faint banging heard from Delta-2 window.\nT+2 minutes: Fire begins to push from the kitchen window; heat increases; smoke darkens and begins to show from a second vent on the Charlie side.\nT+4 minutes: A flash of orange briefly blows out an upstairs dormer vent (indicates rapid fire progression toward ventilation-limited behavior). Visibility at the doorway drops to zero; thermal indicators rising.\nT+5–6 minutes: Truck 61 reports being 90 seconds out; Engine 653 minutes out. Hydrant operations would take roughly 90–120 seconds to get a charged secondary line if a forward lay is selected.\nOfficer Tasks (what the evaluated officer must do)\nGive a complete initial radio report that communicates conditions, actions, command location, and an immediate plan. (Include explicit decision whether to commit to an immediate search or delay until water/backup arrives.)\nDecide priority:\nOption A — Immediate search/rescue: order an aggressive fast search/entry with the crew’s 1¾\" line (or no line) to attempt rescue now.\nOption B — Establish water supply and fire control first: order the driver to secure the hydrant and charge a 2½\" or dual 1¾\" attack so interior crews can operate with adequate flow.\nOption C — Hybrid: commit one rapid intervention/search team while driver secures water and requests a second handline/engine, balancing risk.\nChoose attack line size(s) and explain why (1¾\" vs 2½\"; single vs dual handline; nozzle type and expected GPM).\nDetermine entry point(s) (not specified in scenario) and justify based on size-up (Alpha door, Delta kitchen window, or lateral).\nCommunicate tactical benchmarks to update command (e.g., “Fire under control,” “Primary search complete,” “Water on fire”) and request additional resources if needed.\nReact to changing fire behavior (T+4 flashover indicators): either withdraw, change tactic (vent-enter-isolate-search vs. transitional attack), or order rapid ventilation-coordination.\nDocument rationale in a short after-action summary (1–2 paragraphs) explaining the key decision points and why the chosen course minimized risk while maximizing survivability.\nEvaluator Guidance & Scoring Prompts\nUse the following prompts to guide the observed evaluation and to ask the officer during/after the drill:\nWhy did you select that attack line(s)? What flow (GPM) did you expect to achieve? How does that match your expected interior fire load?\nExplain the decision to search now (or delay). What indicators suggested victim survivability? What were the risk/benefit considerations?\nHow did your apparatus placement influence your decision on forward vs reverse lay? How did you mitigate narrow-road limitations?\nWhen you observed the flash of orange from the dormer (T+4), what did you perceive was happening (ventilation-limited, rapid-fire progression, ventilation-induced flashover)? What immediate order did you give and why?\nIf you chose a hybrid option, how did you maintain accountability and safety for both search and water-supply crews simultaneously?\nIf you ordered a rapid search and a nozzle crew took a 1¾\" in, how did you ensure their survival margin (backup line, backup crew, On Deck/RIT?\nWhat would you have done differently if the occupant was confirmed as unconscious vs. not inside?\nPerformance Elements (0–5 scale each — maximum 25 pts)\nElement | Max pts | Evaluator Notes\nInitial radio report & command establishment (completeness & clarity) | 5 |\nUrgentness of priority decision (Search vs Water vs Hybrid) | 5 |\nAttack line selection & water supply plan (flow, feasibility) | 5 |\nFlexibility & reaction to changing fire behavior (T+2–T+4) | 5 |\nAccountability & safety measures for interior crews (RIT/back-up) | 5 |\nTotal (out of 25): _______\nExpected Acceptable Actions / Examples\n(Use these only statements for scoring — evaluator should prioritize sound rationale over a single “correct” action.)\nAcceptable aggressive rescue option: If officer can justify immediate search because of credible occupant confirmation, limited travel distance to bedroom, and plan to commit a charged 1¾\" with a dedicated backup line or close-in water source — full points if executed safely and with accountability.\nAcceptable water-first option: If officer justifies that current lines cannot supply required flow, victim survivability is unlikely without controlling fire progression, and immediate water will improve survival odds — full points if water is established quickly and interior crews are controlled.\nHigh-risk, low-justification: Ordering an entry without any line or backup when flashover indicators are present — score low and note safety deficiency.\nBest-practice hybrid: Commit a small immediate search team with a hose line while driver establishes a supply; assign the second crew to line protection/backup and designate RIT — high score if communicated and executed cleanly.\nEvaluator After-Action Requirement (for candidate)\nWithin 10 minutes of scenario conclusion, the officer must provide a concise written justification (150–300 words) addressing:\nWhy they chose search/water/hybrid.\nWhy did they select the attack line and entry point.\nWhat indicators drove their tactical pivot at T+4;\nOne lesson learned and one improvement they would implement next time.\nScore the written justification for clarity, tactical awareness, and adherence to safety (0–5 pts, separate from the 25 above).",
"sim": true
},
{
"key": "C",
"title": "Ladder Company Operations",
"weight": 7.5,
"quarter": 2,
"competency": "Strategic command",
"elements": [
{
"label": "Aerial placement & hazard recognition",
"mult": 1
},
{
"label": "Crew task assignment / resource balance",
"mult": 1
},
{
"label": "Ventilation type & timing coordination",
"mult": 1
},
{
"label": "Reaction to roof compromise / change in conditions",
"mult": 1
},
{
"label": "Communication & accountability",
"mult": 1
}
],
"guide": "Scenario C – Ladder Company Operations (Advanced Tactical Coordination)\nScenario Type:\nTwo-Story Residential Fire – Aerial Placement, Ventilation, and Coordinated Search\nScenario Narrative (brief)\nAt 01:48 hours, AR 618 (Officer + 3) is dispatched to 1734 Oak Haven Court for a reported structure fire with people trapped on the second floor.\nEG 613 is on scene reporting:\n“Heavy smoke showing Alpha side, visible fire from the Bravo-Charlie corner, Engine 613 laying in and advancing a 1¾″ interior line for fire attack.”\nAs AR 618 turns onto the cul-de-sac:\nThe residence is a two-story wood frame with attached garage, approximately 2,800 sq ft.\nFlames are impinging on the second-floor Bravo windows; heavy smoke is pushing from the eaves across the attic.\nPower lines cross the Alpha-Bravo corner near the driveway.\nOccupants on scene shout that two teenagers may still be upstairs.\nEngine 653 is two minutes out; SG6 has assumed command from a distant position and gives you “AR 618 – primary search and ventilation.”\nWind is 12 mph from the Bravo side; ambient temp 82°F; humidity 70%.\nEvolving Fire Behavior Timeline\nT+0 (Arrival): Heavy smoke, moderate fire on Bravo-Charlie; interior crews advancing.\nT+1 min: Heat vents from the roofline; Engine 63 reports “fire extending into attic.”\nT+2 min: A window fails on the Alpha side; visible rollover inside upper hallway.\nT+3 min: Conditions worsen; smoke turns turbulent; Engine 63 requests vertical ventilation.\nT+4–5 min: Sudden partial roof sag over Bravo side; fire transitions through attic; exposure threat to adjacent Bravo structure 15 ft away.\nOfficer Tasks / Decision Points\nThe Truck Officer must:\nSelect aerial placement under limited space and electrical hazards.\nDetermine scrub area, spotting angle, and stabilization sequence.\nChoose between Alpha-side rescue positions or Bravo-Charlie roof access for venting.\nAssign crew tasks among four personnel:\nOne operator, one roof/vent team, one interior search, one tool/firefighter.\nPrioritize rescue, vertical or horizontal vent, and exposure protection.\nDecide on ventilation method and timing relative to EG 613’s interior attack.\nRisk of premature vent vs. flashover relief.\nCoordinate secondary search and roof operations while maintaining accountability.\nReact to partial roof compromise at T+4 – T+5:\nOrder roof withdrawal? Re-position aerial for defensive vent cut?\nReassign search or establish exterior master stream if collapse imminent.\nCommunicate clearly with Command and Engine crews regarding benchmarks:\n“Primary search complete,” “Roof opened,” “All personnel accounted for.”\nSubmit after-action justification: placement rationale, vent timing, and life-safety trade-offs.\nEvaluator Observations\nPerformance Element | Max Pts (0–5) | Evaluator Comments\nAerial placement & hazard recognition | 5 |\nCrew task assignment / resource balance | 5 |\nVentilation type & timing coordination | 5 |\nReaction to roof compromise / change in conditions | 5 |\nCommunication & accountability | 5 |\nTotal (25 pts) __________\nEvaluator Discussion Prompts\nWhy was your chosen spotting position optimal despite limited space and overhead lines?\nHow did you ensure coordination between vertical ventilation and interior line advancement?\nWhat tactical indicators triggered your decision to pull roof crews or reposition?\nIf victims had been confirmed in Bravo bedrooms at T+3, would you alter vent priority or commit personnel differently?\nDescribe how wind direction affected your vent pattern and interior conditions.\nExpected Officer Behaviors (High-Scoring Examples)\nSelects Alpha-Bravo corner for aerial due to overhead hazards, allowing both rescue reach and roof access.\nInitiates coordinated horizontal vent prior to vertical cut once Engine 63 confirms water on fire.\nOrders immediate withdrawal upon roof sag, re-positions aerial for defensive trench cut, notifies Command.\nMaintains radio discipline; reports PAR after every benchmark.\nDocuments rationale emphasizing risk-vs-gain balance and NFPA 1500 compliance.\nPost-Scenario Written Justification (Candidate)\nWithin 10 minutes, provide a 200–300-word summary covering:\nWhy you placed the aerial where you did.\nYour ventilation decision and coordination timing.\nHow you mitigated changing fire behavior and maintained crew safety.\nWhat you would adjust in future similar incidents.\nTraining Objective Reference\nNFPA 1021 (2020 Ed.) 4.2.3 / 4.3.2 / 4.4.1\nNFPA 1001 (2019 Ed.) 5.3.10 – Control a structure fire | 5.3.17 – Perform overhaul | 6.3.2 – Ventilate building.",
"sim": true
},
{
"key": "D",
"title": "Incident Command System Application",
"weight": 7.5,
"quarter": 2,
"competency": "Strategic command",
"elements": [
{
"label": "Establishment of Command & initial size-up",
"mult": 1
},
{
"label": "Organization & assignment of Divisions/Groups",
"mult": 1
},
{
"label": "Clarity and feasibility of IAP (strategic priorities)",
"mult": 1
},
{
"label": "Resource management & communication discipline",
"mult": 1
},
{
"label": "Safety / accountability / structural awareness",
"mult": 1
}
],
"guide": "Scenario D – Incident Command System (ICS) Application & Strategic Coordination\nScenario Type:\nMulti-Company Residential Fire – Expanding Incident Requiring Divisions/Groups\nScenario Narrative\nAt 19:56 hours, you are the first-arriving Company Officer (EG 643) responding to a reported house fire with exposure risk at 12912 Cypress Ridge Drive, a cul-de-sac subdivision of attached garden-style townhomes.\nUpon arrival, you find:\nA two-story, lightweight wood-frame townhouse (Unit 4) with heavy fire showing from the second floor and roofline.\nAdjacent units B and D are threatened by radiant heat.\nCivilians on scene report one occupant still possibly inside Unit C, rear bedroom.\nPower lines across the Alpha side and parked vehicles block direct apparatus access to the front of Units B–D.\nWind 15 mph from Charlie toward Alpha.\nYour initial assignment includes:\nEG 643 (you – Officer + 3)\nAR 638 (ETA 2 minutes)\nEG 633 (ETA 3 minutes)\nSQ 605 (special operations – ETA 5 minutes)\nSG7 (delayed, responding from another incident – ETA 7 minutes)\nCommand will rest with you for the first several minutes.\nEvolving Fire Conditions (Simulated Timeline)\nTime | Conditions / Injects\nT+0 (Arrival) | Heavy fire in Unit 4 second floor and attic; radiant heat impinging on Delta-side exposure. Occupant possibly trapped in Unit 4’s-rear bedroom.\nT+2 min | AR 638 reports on scene from Alpha-Bravo side; access blocked by cars; roof involvement increasing.\nT+4 min | EG 633 arrives, reports hydrant at entrance of subdivision. Wind intensifies, pushing fire into attic void of Unit 6.\nT+5 min | SQ 605 advises heavy smoke conditions at rear (Charlie) with visible fire from eaves; possible extension into Unit 5’s attic space.\nT+6–7 min | SG7 announces arrival and requests situation status and assignments. A firefighter from your crew reports interior heat spike and weakening floor near stairwell.\nOfficer Tasks / Decision Points\nEstablish Command:\nName and announce A scene size up, and establishing command\nIdentify command mode (Investigative / Fast-Attack / Command).\nOrganize Initial Assignments:\nDetermine if  Rescue or Fire Attack  takes priority.\nAssign arriving units to Divisions (Alpha, Charlie) or Groups (Fire Attack, Ventilation, Search) if needed.\nImplement accountability and confirm PAR reporting structure.\nDevelop an Initial Action Plan (IAP):\nSet tactical priorities: life safety, incident stabilization, property conservation.\nDecide on offensive vs. defensive mode for Unit 4.\nIdentify immediate exposures (Units Bravo & Delta) and coordinate protection lines.\nManage Resource Requests & Staging:\nDetermine when to request a 2nd Alarm or additional suppression/EMS units.\nEstablish a staging area and RIT assignment.\nCommunicate & Maintain Span of Control:\nDeliver progress reports (conditions, tactical benchmarks) as needed.\nDelegate sectors and clearly define supervisor roles (e.g., Division Charlie, Vent Group).\nReact to Structural Compromise (T+6):\nOrder interior withdrawal if indicated, account for all crews.\nTransition from offensive to defensive operations and re-establish collapse zones.\nTransfer of Command:\nProvide incoming SG7 with a concise situation update and full tactical summary.\nMaintain continuity of operations through clear, structured turnover.\nEvaluator Observations\nPerformance Element | Max Pts (0–5) | Comments\nEstablishment of Command & initial size-up | 5 |\nOrganization & assignment of Divisions/Groups | 5 |\nClarity and feasibility of IAP (strategic priorities) | 5 |\nResource management & communication discipline | 5 |\nSafety / accountability / structural awareness | 5 |\nTotal (25 pts) _______\nEvaluator Discussion Prompts\nWhy did you choose to remain in “Command Mode” versus going fast-attack?\nWhich unit received your first tactical assignment, and why?\nHow did you balance rescue potential in Unit 4 with the need to protect exposures and 6?\nWhat benchmarks did you communicate before transferring Command?\nAt what point did fire conditions dictate a strategy change, and how did you execute that safely?\nWhat communications structure (Div/Grp) did you use to maintain span of control with five companies?\nExpected Officer Behaviors (High-Scoring Examples)\nEstablishes Cypress Ridge Command clearly with complete initial report.\nImmediately requests 2nd alarm due to attached structures and delay in BC response.\nAssigns AR 638 to Vent/Search Group, EG 633 to Division Delta for exposure protection, SQ 605 as Ondeck/RIT.\nOrders withdrawal upon floor compromise, confirm PAR, re-positions crews for defensive attack.\nProvides SG7 with concise transfer report covering resources, assignments, hazards, and current strategy.\nPost-Scenario Written Justification (Candidate)\nWithin 10 minutes of scenario completion, the officer will prepare a 250–350-word summary including:\nThe organizational structure established (Divisions/Groups).\nKey decision factors behind the IAP and any strategy shift.\nResource requests and span of control considerations.\nLessons learned regarding early command decisions under dynamic conditions.\nTraining Objective Reference\nNFPA 1021 (2020 Ed.) 4.2.3, 4.3.1, 4.3.2, 4.4.1, 4.6.1\nNFPA 1561 (2020 Ed.) – Emergency Services Incident Management System.\nISO/PIAL Credit: Supports documentation for strategic command performance, ICS implementation, and officer readiness.",
"sim": true
},
{
"key": "E",
"title": "Personnel Management, Leadership & Civil Service",
"weight": 15,
"quarter": 3,
"competency": "Personnel & leadership",
"elements": [
{
"label": "Control of incident / professional conduct",
"mult": 1
},
{
"label": "Accuracy & fairness of investigation",
"mult": 1
},
{
"label": "Correct identification & completion of proper forms",
"mult": 1
},
{
"label": "Policy & Civil Service compliance",
"mult": 1
},
{
"label": "Leadership & follow-through (plan and communication)",
"mult": 1
}
],
"guide": "Scenario E (Advanced) – Personnel Management, Leadership, and Civil Service Compliance\nScenario Type:\nDisciplinary & Administrative Decision-Making Under Policy and Time Pressure\nScenario Narrative\nIt’s Friday 07:20 hours at Station 62. You are the Captain overseeing a crew of four (Lieutenant Martin, Firefighter Duval, Firefighter Landry, and Driver Foster).\nOver the past two months, you’ve received recurring minor issues with Firefighter Duval — tardiness, attitude toward training, and resistance to supervision. The Lieutenant has counseled him twice verbally but has not submitted documentation.\nAt lineup, the following events occur simultaneously:\nLieutenant Martin informs you that Duval arrived 12 minutes late again and refused to participate in morning PT, stating, “You’re not my boss.”\nBattalion Chief emails the station that Duval’s monthly training entries are missing from FireWorks for two consecutive months and requests immediate correction by noon today.\n“Need written documentation today. Handle at your level — but make sure its Civil Service compliant. CC me when you send it up.”\nWhen you begin addressing the issue, Duval becomes defensive, claiming he “never got a fair shake” and that the Lieutenant “targets” him.\nThe Lieutenant is visibly angry and states in front of the crew, “I’m done dealing with him. You handle it.”\nYou have until 1600 hours to:\nCorrect the training record,\nAddress the behavior,\nDocument all actions properly, and\nForward necessary personnel paperwork through channels.\nOfficer Tasks / Decision Points\nImmediate Control & Professional Conduct\nSeparate the two employees. Maintain decorum and privacy.\nAddress the crew to reinforce professionalism expectations.\nFact Finding & Documentation Review\nVerify training entries in FireWorks and attendance logs.\nInterview both parties individually and record statements.\nDetermine if this constitutes misconduct, insubordination, or performance deficiency.\nLocate and Complete Required Forms\nIdentify and access the correct documentation location:\nFill out a TrackIt, or Locate the PIR in the J/Drive\nComplete all required fields:\nEmployee Name / ID # / Assignment / Date of Incident\nDescription of Incident (objective only)\nAction Taken (verbal / written / recommendation for formal review)\nPolicy(s) that were broken\nSignatures: Employee, Supervisor, Battalion Chief\nAttach supporting documents: training printouts, attendance records, witness statements.\nDetermine Appropriate Action Level\nDecide between:\nWritten Counseling Form (informal / developmental)\nPersonnel Action Form – Corrective Action (formal record)\nRecommend Formal Disciplinary Review (forward to HR/Chief)\nApply Louisiana R.S. 33:2473–2495 progressive discipline framework (Verbal → Written → Suspension → Termination).\nConduct the Counseling Session\nMeet privately, present facts, not accusations.\nReview SGFD SOP #200-03 (Employee Conduct & Corrective Action).\nEnsure the employee signs acknowledging receipt (not necessarily agreement).\nOutline performance expectations and timeline for improvement.\nSubmit and Communicate\nEmail completed documentation via chain-of-command before 1600 hrs.\nCC Battalion Chief Davis.\nFile copies in station binder and digital folder per SGFD Record Retention Policy 2023-07.\nFollow-Up Plan\nSchedule a 14-day follow-up meeting to review compliance.\nPrepare a short memorandum for Battalion Chief summarizing outcome.\nEvaluator Observations\nPerformance Element | Max Pts (0–5) | Evaluator Comments\nControl of incident / professional conduct | 5 |\nAccuracy & fairness of investigation | 5 |\nCorrect identification & completion of proper forms | 5 |\nPolicy & Civil Service compliance | 5 |\nLeadership & follow-through (plan and communication) | 5 |\nTotal (30 pts) |\nEvaluator Discussion Prompts\nWhich SGFD policy and Civil Service article guided your decision on which form to use?\nWhere are the official personnel action forms located, and who is responsible for maintaining their current versions?\nDescribe how you ensured confidentiality and avoided bias during documentation.\nWhat distinguishes “counseling” from “disciplinary action” under Civil Service law?\nHow would you handle refusal to sign the counseling form?\nWhat are the timelines for forwarding personnel documents to HR and how long must they be retained?\nExpected Officer Behaviors (High-Scoring Examples)\nStops conflict immediately; conduct separate, professional interviews.\nRetrieves Personnel Action Form from SGFD Intranet and completes all sections correctly, including summary of facts and supervisor statement.\nAttaches FireWorks printout showing missing training entries.\nSelects Written Counseling rather than formal disciplinary action (first documented offense).\nObtains signatures; emails scanned PAF to BC Davis and HR before deadline.\nDocuments scheduled follow-up in Outlook and include note in shift log.\nPost-Scenario Written Justification (Candidate)\nWithin 15 minutes, submit a 300-word summary explaining:\nThe facts verified and documentation completed.\nThe decision process used to determine action level.\nWhere you found the correct form and how you routed it.\nWhat Civil Service statute or SGFD SOP applied.\nHow you ensured fairness and preserved morale.\nTraining Objective Reference\nNFPA 1021 (2020 Ed.) 4.2.4 / 4.4.2 / 4.6.1 – Supervise personnel, apply policy, document performance.\nSGFD SOP #200-03 Employee Conduct & Corrective Action.\nLouisiana Municipal Fire & Police Civil Service Law (R.S. 33:2471 et seq.)."
},
{
"key": "F",
"title": "Daily Inbox & Administrative Decision-Making",
"weight": 10,
"quarter": 3,
"competency": "Administration",
"elements": [
{
"label": "Task Prioritization & Time Management",
"mult": 1
},
{
"label": "Application of Policies & Use of Correct Forms",
"mult": 1
},
{
"label": "Written Communication & Professional Tone",
"mult": 1
},
{
"label": "Delegation & Crew Utilization",
"mult": 1
},
{
"label": "Administrative Accountability & Follow-Through",
"mult": 1
}
],
"guide": "Scenario F – Daily Inbox & Administrative Decision-Making\nScenario Type:\nMulti-Task Prioritization | Written Communication | Policy Application\nScenario Narrative\nIt’s Thursday, 08:05 hours, and you’ve just come on duty as the Company Lieutenant at Station 65.\nWhen you open your email, text messages, and inbox folders, you find the following waiting for you — all requiring attention before 1600 hours:\nInbox Summary (15 Items)\n# | Item | Description | Deadline / Impact\n1 | Training Division Email | Monthly driver/operator hours report missing for your crew. Due noon today. | Immediate – affects ISO compliance.\n2 | Apparatus Deficiency Report | Engine 653’s abs sensor malfunctioned last night. Needs input not PsTrax and notification to Maintenance. | Within 1 hour – safety issue.\n3 | Shift Swap Request | Firefighter Boudreaux requests to swap Saturday with Firefighter Price (next pay period). | End of day – requires BC approval.\n4 | Budget Memo from Assistant Chief | “Provide input for FY 2026 small-equipment budget (≤ $2,000 per station) by Friday noon.” | 24 hrs.\n5 | Citizen Complaint | Resident emailed about Engine 653 blocking her driveway during a medical call; forwarded from Admin for officer follow-up and written response. | 48 hrs. – potential PR issue.\n6 | Training Assignment | Battalion requesting confirmation of your company’s attendance at next week’s 2-day HazMat refresher. | Today – course roster closes.\n7 | Lieutenant’s Daily Log | Previous shift’s log incomplete: FireWorks still shows “pending.” | Must close before 1000 hrs.\n8 | Personnel Issue | Firefighter Duval (yes, same one) still hasn’t submitted his corrected training entries. | Ongoing; requires action plan.\n9 | Fire Prevention Request | Inspector asks if your crew can assist with a hydrant survey tomorrow. | Optional – depends on manpower.\n10 | Supply Request | Station 65 low on absorbent pads and fuel cards are expired. | 48 hrs.\n11 | EMS Run Report Correction | QA Officer flagged missing narrative from your unit’s last call. | Must correct before 1700 hrs.\n12 | Battalion Chief Text | “Reminder—submit company-level training plan for Q1 2026 by COB Friday.” | 24 hrs.\n13 | Personnel File Audit Notice | HR requests verification of driver qualifications (copies of D/O certifications) for your crew. | 72 hrs.\n14 | Weather Alert | Severe-storm potential later today; check generators and update readiness form. | 1200 hrs.\n15 | Voicemail from Chief of Training | Wants confirmation of dates for your next Officer III mentorship block. | End of day.\nOfficer Tasks / Decision Points\nPrioritize & Sequence Tasks\nIdentify which items require immediate operational response, which can be delegated, and which require formal documentation.\nEstablish realistic time frames and note policy justifications.\nDelegate & Communicate\nAssign tasks to crew members (e.g., FireWorks entry, generator check).\nUse correct SGFD email and documentation.\nCompose Critical Communications\nDraft:\nA one-paragraph email to Maintenance reporting the abs issue (safety priority).\nA professional response to the citizen complaint suitable for forwarding to Admin.\nA summary memo to Battalion Chief outlining which tasks were completed, and which are pending.\nReference Policy & Systems\nIdentify where to find:\nApparatus and Equipment Forms: PSTrax\nSupply Requests: PSTrax\nTraining Logs: FireWorks\nApply deadlines from SOP #100-06 (Administrative Timeliness & Records Submission).\nManage Overlap & Stress\nExplain how you prevent tasks from falling through when simultaneous deadlines occur.\nDemonstrate email flagging, task-list use, or delegation strategies.\nEnd-of-Day Report\nBy 1600 hrs, submit an email to Battalion Chief summarizing:\nCompleted actions (e.g., Form 701 submitted 0900 hrs).\nDelegated items and responsible personnel.\nOutstanding items with expected completion times.\nEvaluator Observations\nPerformance Element | Max Pts (0–5) | Comments\nTask Prioritization & Time Management | 5 |\nApplication of Policies & Use of Correct Forms | 5 |\nWritten Communication & Professional Tone | 5 |\nDelegation & Crew Utilization | 5 |\nAdministrative Accountability & Follow-Through | 5 |\nTotal (25 pts) _________\nEvaluator Discussion Prompts\nWhat were your top three priorities and why?\nWhich items did you delegate versus handle personally?\nHow did SGFD SOP #100-06 guide your response timelines?\nHow would you communicate a delayed task to your Battalion Chief?\nProvide the exact subject line and tone you’d use for the citizen-complaint email.\nExpected Officer Behaviors (High-Scoring Examples)\nImmediately addresses apparatus safety issue and notifies Maintenance.\nDelegates generator check and supply inventory to crew, reports completion.\nSends polished citizen-response email copied to Admin.\nUploads FireWorks training correction and closes log by 1000 hrs.\nUses Outlook tasks to track pending budget input and personnel-file audit.\nSubmits EOD summary to Battalion Chief with clear bullet format and timestamps.\nPost-Scenario Written Task (Candidate)\nWithin 20 minutes, submit:\nA prioritized task list showing order of completion and justification.\nA sample email to Maintenance and one to Admin for the citizen complaint.\nA brief summary paragraph (≤ 200 words) explaining your triage logic and delegation choices.\nTraining Objective Reference\nNFPA 1021 (2020 Ed.) 4.2.5 – Manage administrative functions.\nSGFD SOP #100-06 – Administrative Timeliness & Records Submission."
},
{
"key": "G",
"title": "Report Writing & Documentation (NERIS)",
"weight": 10,
"quarter": 3,
"competency": "Report writing",
"elements": [
{
"label": "Accuracy & Clarity of NERIS Narrative",
"mult": 1
},
{
"label": "Completeness of Facts / Timeline",
"mult": 1
},
{
"label": "Correct Memo & Form Usage",
"mult": 1
},
{
"label": "Budget Rationale & Justification",
"mult": 1
},
{
"label": "Professional Tone & Grammar",
"mult": 1
}
],
"guide": "Scenario G – Report Writing & Documentation (Advanced / NERIS Edition)\nScenario Type:\nIncident Narrative | Administrative Memo | Budget Justification | Data System Transition Awareness\nScenario Narrative\nAt 23:45 hours, EG 613 and AR 628 respond to a commercial structure fire at 9802 Cloverland Avenue.\nCrews find moderate smoke from a rear storage room of a laundromat with minor extension into an adjacent dry-cleaning business.\nNo injuries occur, but one 1¾″ attack line is destroyed and a rear door forced off its hinges.\nThe business owner requests written documentation for insurance and fire investigation.\nThe next morning, Battalion Chief Davis emails:\n“Please submit all reports and supporting documentation by 1400 hrs using NERIS templates. Do not use the legacy NFIRS forms.”\nOfficer Tasks / Deliverables\n1. NERIS-Compliant Incident Narrative (250–350 words)\nPrepare the report following SGFD’s NERIS format:\nArrival conditions (size, construction, occupancy, fire location).\nTactical actions (attack line placement, ventilation, search, salvage).\nOutcomes (containment time, damage assessment, injuries if any).\nUnits operating and total on-scene time.\nInteraction with occupant / owner / investigator.\nTraining Note: The National Emergency Response Information System (NERIS) replaces NFIRS beginning 2026. Officers must use current NERIS data fields for Incident Type, Property Use, and Action Taken codes. All future narratives must comply with NERIS schema and terminology.\n2. Administrative Memo\nSubject: Incident Damage Report – Cloverland Avenue Fire\nFormat requirements:\nParagraph 1 – Incident summary and damage overview.\nParagraph 2 – Equipment losses and immediate needs.\nParagraph 3 – Insurance communication and recommendations.\n3. Budget Justification Attachment\nComplete a budget request to replace the damaged equipment\n1 × 1¾″ attack line replacement\n2 × forcible-entry tool sets\nInclude fields: Item Description, Quantity, Unit Cost, Operational Benefit, Priority.\nAdd 100–150-word narrative explaining necessity and cost efficiency.\n4. Submission Procedure\nBundle files as Station61_CloverlandFire_Report_<date>.pdf.\nEmail to BC Davis with subject line:\n“Cloverland Fire – NERIS Report and Budget Packet.”\nCC Chief of Training for records per SGFD Policy #100-06 (Records Submission).\nEvaluator Observations\nPerformance Element | Max Pts (0–5) | Comments\nAccuracy & Clarity of NERIS Narrative | 5 |\nCompleteness of Facts / Timeline | 5 |\nCorrect Memo & Form Usage | 5 |\nBudget Rationale & Justification | 5 |\nProfessional Tone & Grammar | 5 |\nTotal (25 pts) |\nEvaluator Discussion Prompts\nWhich NERIS fields replace NFIRS Incident Type and Action Taken codes?\nHow does accurate data entry impact state and federal fire reporting metrics?\nWhere can officers locate current NERIS templates?\nHow does documentation quality affect ISO / PIAL scoring and transparency?\nExpected Officer Behaviors (High-Scoring Examples)\nUses NERIS format accurately with updated terminology.\nSubmits clear and objective narrative (chronological order, no opinion that states who, what, when, and where).\nFollows memo and budget templates exactly and meets deadline.\nCommunicate professionally and proofread all attachments.\nPost-Scenario Written Task (Candidate)\nWithin 30 minutes, submit:\nNERIS-formatted incident narrative (250–350 words).\nAdministrative memo.\nBudget justification paragraph (100–150 words).\nScreenshot or note of file path and email submission.\nTraining Objective Reference\nNFPA 1021 (2020 Ed.) 4.2.5 – Manage administrative functions.\nNFPA 1021 (2020 Ed.) 4.4.1 – Prepare written communications.\nSGFD SOP #100-06 – Records Submission & NERIS Implementation.\nUSFA NERIS Transition Bulletin #2025-03 – Reporting Standards Change."
},
{
"key": "H",
"title": "Budget Proposal & Presentation",
"weight": 15,
"quarter": 4,
"competency": "Budget & presentation",
"elements": [
{
"label": "Identification of Justified Need",
"mult": 1
},
{
"label": "Cost Accuracy & Data Support",
"mult": 1
},
{
"label": "Operational Benefit / Safety Impact",
"mult": 1
},
{
"label": "Professional Writing & Format",
"mult": 1
},
{
"label": "Presentation Clarity & Confidence",
"mult": 1
}
],
"guide": "Scenario H – Budget Proposal & Presentation (Advanced)\nScenario Type:\nCapital Request | Strategic Financial Planning | Oral/Visual Presentation\nScenario Narrative\nYou are the Captain at Station 65, and the Chief of Administration has issued an email to all company officers:\n“As we begin building the FY2026 capital budget, each company shall identify one or two needs that directly improve operational capability, firefighter safety, or community risk reduction.\nPlease submit your formal proposal—including justification, cost data, and benefit statement—by Friday 1200 hrs.\nCaptains will present highlights of their request at next week’s Budget Review Roundtable.\nRequests exceeding $5,000 must include vendor quotes and clear prioritization.”\nScenario Context\nYour crew and officers identify multiple potential needs:\nThermal Imaging Camera (TIC) Replacement – Current model outdated, unreliable. Estimated cost: $6,500.\nDecontamination Equipment Kit – For gross decon after structure and vehicle fires. Estimated cost: $4,200.\nTraining Division Laptop Upgrade – Used for online learning integration (Absorb LMS). Estimated cost: $2,100.\nYou must select one or two of these requests to submit and prepare a formal justification.\nThe proposal must be clear, data-driven, and demonstrate benefit-to-cost ratio, operational priority, and ISO relevance.\nOfficer Tasks / Deliverables\nFormal Written Proposal (500–750 words, memo or report format)\nHeader: “FY2026 Capital Budget Proposal – Station 65”\nSections:\nExecutive Summary: One paragraph overview of what and why.\nOperational Need: Define deficiency (e.g., safety, performance, risk).\nCost Estimate & Vendor Data: Include at least one legitimate quote or researched price.\nOperational Benefit: Explain how it improves safety, performance, or compliance.\nAlignment: Reference NFPA, ISO, or SGFD Strategic Plan.\nPriority Level: Rank within your station or division.\nFunding Impact: Demonstrate cost efficiency (life cycle, maintenance, shared use).\n(Attach completed Excel form with your narrative as a PDF packet.)\nPresentation Preparation (5–7 minutes)\nDevelop a 3–slide PowerPoint or talking outline covering:\nProblem / Operational Deficiency\nProposed Solution & Cost\nBenefits, Compliance, and Risk Mitigation\nBe prepared to answer questions about:\nAlternative funding sources (grants, cost-sharing)\nJustification hierarchy (why this before other requests)\nReturn on investment or efficiency gains\nSubmission & Routing\nSubmit to Assistant Chief of Administration and Chief of Training.\nCC your Battalion Chief for review and endorsement.\nTitle file as: Station65_CapitalProposal_<Item>_FY2026.pdf.\nEvaluator Observations\nPerformance Element | Max Pts (0–5) | Comments\nIdentification of Justified Need | 5 |\nCost Accuracy & Data Support | 5 |\nOperational Benefit / Safety Impact | 5 |\nProfessional Writing & Format | 5 |\nPresentation Clarity & Confidence | 5 |\nTotal (25 pts) |\nEvaluator Discussion Prompts\nWhy did you prioritize this request over the others?\nHow does this purchase align with ISO categories (Equipment / Training / Water Supply / Communications)?\nWhat NFPA standards or SGFD SOPs support the need?\nHow did you verify your cost data and vendor reliability?\nWhat measurable improvement or reduction in risk will this provide?\nExpected Officer Behaviors (High-Scoring Examples)\nSubmits proposal on time in SGFD-approved format with complete justification and vendor quote.\nUses quantitative language (e.g., “reduces scene turnaround time by 15%”).\nReferences applicable NFPA standards (e.g., NFPA 1401, 1581, 1720).\nDelivers confident, concise presentation using visual aids and structured reasoning.\nClearly articulates operational benefit and fiscal responsibility.\nPost-Scenario Written Task (Candidate)\nWithin 60 minutes, prepare and submit:\nFormal written proposal (500–750 words).\nCompleted FY2026 budget request form.\nPowerPoint outline or talking notes (3–slide summary).\nPDF proof of submission (email or shared-drive notation).\nTraining Objective Reference\nNFPA 1021 (2020 Ed.)\n4.2.5: Manage administrative functions.\n4.4.1: Prepare written communications.\n4.4.2: Prepare and deliver oral presentations.\nSGFD SOP #100-06: Administrative Records & Budget Submissions."
},
{
"key": "I",
"title": "Professionalism & Readiness (Capstone)",
"weight": 15,
"quarter": 4,
"competency": "Professionalism",
"elements": [
{
"label": "Professional Appearance & Bearing",
"mult": 1
},
{
"label": "Ethical Conduct & Integrity",
"mult": 2
},
{
"label": "Communication & Interaction",
"mult": 2.5
},
{
"label": "Decision-Making & Readiness",
"mult": 2.5
},
{
"label": "Leadership Presence & Crew Development",
"mult": 2
}
],
"guide": "Scenario I – Professionalism & Readiness Evaluation (Capstone)\nScenario Type:\nObservation-Based | Conduct, Ethics, Appearance, and Situational Leadership\nScenario Narrative\nYou have completed the Company Officer Evaluation process.\nDuring the following shift, your Battalion Chief and Training Division staff will conduct a real-world observation day designed to assess your professionalism, situational readiness, and leadership composure across multiple contexts.\nYou will not receive advance notice of which events will be scored.\nThroughout the day, you may be evaluated in the following settings:\nMorning lineup and shift change\nPublic or administrative interaction (e.g., citizen inquiry, station tour, or media question)\nDrill facilitation or crew meeting\nAdministrative decision (email, documentation, or scheduling conflict)\nIncident response or post-incident critique\nOfficer Tasks / Evaluation Domains\n1. Professional Appearance & Bearing (10%)\nPresents in full, clean, compliant uniform.\nMaintains professional posture, grooming, and respectful demeanor.\nProjects confidence and command presence appropriate to rank.\n2. Ethical Conduct & Integrity (20%)\nMakes decisions consistent with SGFD values.\nDisplays honesty, accountability, and transparency when questioned.\nAvoids gossip, favoritism, or inappropriate commentary.\nDemonstrates confidentiality with personnel or disciplinary matters.\n3. Communication & Interaction (25%)\nCommunicate clearly and respectfully with subordinates, peers, and supervisors.\nDemonstrates emotional intelligence and active listening.\nHandles stress or disagreement without visible frustration or sarcasm.\nUse command radio etiquette during incidents and administrative channels appropriately.\n4. Decision-Making & Readiness (25%)\nMakes timely and sound decisions under pressure.\nBalances policy compliance with operational practicality.\nDemonstrates resourcefulness, prioritization, and delegation.\nExhibits awareness of SGFD SOPs, NFPA standards, and PIAL/ISO documentation implications.\n5. Leadership Presence & Crew Development (20%)\nLeads by example; sets expectations and follows through.\nProvides coaching or mentorship moments during the shift.\nMotivates personnel through recognition and fairness.\nReinforces safety culture and accountability.\nEvaluator Observations\nCategory | Weight | Score (0–5) | Weighted Total\nProfessional Appearance & Bearing | 10% |\nEthical Conduct & Integrity | 20% |\nCommunication & Interaction | 25% |\nDecision-Making & Readiness | 25% |\nLeadership Presence & Crew Development | 20% |\nOverall Weighted Total | 100% |\nEvaluator Discussion Prompts\nDescribe a moment today when you made a decision that balanced policy and practicality.\nHow did you handle a challenging interaction or personnel issue?\nIn what ways do you model ethical and professional behavior for your crew?\nHow do you ensure you’re maintaining readiness—mentally, physically, and administratively—across all shifts?\nIf your crew were asked to describe your leadership in one word, what do you think they’d say—and why?\nExpected Officer Behaviors (High-Scoring Examples)\nDemonstrates composure and discipline even when frustrated.\nConsistently communicates with clarity, humility, and confidence.\nModels ethical behavior and fairness in all decisions.\nSupports department mission, enforces policy, and provides guidance without micromanagement.\nUpholds SGFD’s professional image in public and internal settings.\nPost-Scenario Reflection (Candidate Task)\nWithin 24 hours of completion:\nSubmit a Professional Readiness Reflection Memo (250–400 words) summarizing:\nOne strength demonstrated during the evaluation period.\nOne area identified for personal improvement.\nOne action you will take to enhance leadership effectiveness in the next 6 months.\nEmail to the Chief of Training and your Battalion Chief with the subject line:\n“Company Officer Evaluation – Professional Readiness Reflection.”\nTraining Objective Reference\nNFPA 1021 (2020 Ed.)\n4.2.1: Supervise and direct assigned members during operations.\n4.2.2: Apply departmental policies and procedures.\n4.4.4: Demonstrate effective interpersonal communication.\n4.6.1: Model professional development and ethical leadership.\nSGFD SOP #100-04: Uniform & Professional Appearance.\nSGFD Code of Conduct (2024 Edition).\nISO / PIAL Credit: Supports evaluation of officer leadership, professionalism, and department representation."
}
]
}
},
{
"key": "co-eval",
"name": "Company Officer Evaluation (7 categories)",
"rank": "Lieutenant / Captain",
"kind": "form",
"sort": 31,
"description": "One score (0–5) per category, weighted to a final total out of 5. NFPA 1021 Fire Officer I–II.",
"data": {
"scale": {
"min": 0,
"max": 5
},
"passComposite": 80,
"passModule": 70,
"signatures": [
"Officer evaluated",
"Immediate Supervisor",
"Chief of Training",
"Assistant Chief / Fire Chief"
],
"overview": "# St. George Fire Protection District\nCompany Officer Evaluation – Lieutenants and Captains\nCommitted to Professionalism, Leadership, and Operational Excellence\nOfficer Name: | Rank: | Station / Shift:\nEvaluator Name: | Evaluation Date: | Evaluation Period:\n## I. Tactical Operations (Engine & Ladder) – 25%\nEvaluate ability to conduct effective tactical operations including initial size-up, IAP development, tactical assignments, and PAR/accountability. Scenario-based assessment of both engine and ladder company operations.\nScoring (0–5): 5 = Exemplary command/tactics, 3 = Meets expectations, 1 = Ineffective/unsafe\n## II. Strategic & Administrative Command – 20%\nAssesses ability to manage multi-company incidents, allocate resources, and maintain ICS/NIMS compliance. Includes evaluation of situational awareness, mutual aid coordination, and post-incident critique participation.\n## III. Personnel Management & Leadership – 20%\nEvaluates leadership, mentorship, conflict resolution, and crew development. Includes documentation of personnel issues, scheduling, counseling, and station morale.\n## IV. Administrative Duties (Daily Inbox) – 15%\nSimulated daily administrative tasks: logs, leave requests, training schedules, and email correspondence. Assesses prioritization, timeliness, and professionalism.\n## V. Report Writing & Documentation – 10%\nEvaluates clarity, completeness, and professionalism in incident reports, memos, and other written communications. Must align with SGFD standards.\n## VI. Budgeting / Proposal Development – 10%\nAssesses ability to create realistic and well-justified budget or equipment proposals aligned with department goals and operational efficiency.\n## VII. Professionalism & Readiness – 5%\nAppearance, punctuality, composure, communication, and receptiveness to feedback.\n## Evaluation Summary\nCategory | Weight | Score (0–5) | Weighted Total\nTactical Operations | 25% |\nStrategic Command | 20% |\nPersonnel Management | 20% |\nAdministrative Inbox | 15% |\nReport Writing | 10% |\nBudget Proposal | 10% |\nProfessionalism | 5% |\nFinal Weighted Total: _____________ / 5.0\n## Evaluator Notes & Recommendations\n## Signatures\nOfficer Evaluated: | ______________________________  Date: ___________\nImmediate Supervisor: | ______________________________  Date: ___________\nChief of Training: | ______________________________  Date: ___________",
"modules": [
{
"key": "I",
"title": "Tactical Operations (Engine & Ladder)",
"weight": 25,
"quarter": null,
"competency": "Tactical Operations (Engine & Ladder)",
"elements": [
{
"label": "Tactical Operations (Engine & Ladder)",
"mult": 1
}
],
"guide": "## I. Tactical Operations (Engine & Ladder) – 25%\nEvaluate ability to conduct effective tactical operations including initial size-up, IAP development, tactical assignments, and PAR/accountability. Scenario-based assessment of both engine and ladder company operations.\nScoring (0–5): 5 = Exemplary command/tactics, 3 = Meets expectations, 1 = Ineffective/unsafe"
},
{
"key": "II",
"title": "Strategic & Administrative Command",
"weight": 20,
"quarter": null,
"competency": "Strategic & Administrative Command",
"elements": [
{
"label": "Strategic & Administrative Command",
"mult": 1
}
],
"guide": "## II. Strategic & Administrative Command – 20%\nAssesses ability to manage multi-company incidents, allocate resources, and maintain ICS/NIMS compliance. Includes evaluation of situational awareness, mutual aid coordination, and post-incident critique participation."
},
{
"key": "III",
"title": "Personnel Management & Leadership",
"weight": 20,
"quarter": null,
"competency": "Personnel Management & Leadership",
"elements": [
{
"label": "Personnel Management & Leadership",
"mult": 1
}
],
"guide": "## III. Personnel Management & Leadership – 20%\nEvaluates leadership, mentorship, conflict resolution, and crew development. Includes documentation of personnel issues, scheduling, counseling, and station morale."
},
{
"key": "IV",
"title": "Administrative Duties (Daily Inbox)",
"weight": 15,
"quarter": null,
"competency": "Administrative Duties (Daily Inbox)",
"elements": [
{
"label": "Administrative Duties (Daily Inbox)",
"mult": 1
}
],
"guide": "## IV. Administrative Duties (Daily Inbox) – 15%\nSimulated daily administrative tasks: logs, leave requests, training schedules, and email correspondence. Assesses prioritization, timeliness, and professionalism."
},
{
"key": "V",
"title": "Report Writing & Documentation",
"weight": 10,
"quarter": null,
"competency": "Report Writing & Documentation",
"elements": [
{
"label": "Report Writing & Documentation",
"mult": 1
}
],
"guide": "## V. Report Writing & Documentation – 10%\nEvaluates clarity, completeness, and professionalism in incident reports, memos, and other written communications. Must align with SGFD standards."
},
{
"key": "VI",
"title": "Budgeting / Proposal Development",
"weight": 10,
"quarter": null,
"competency": "Budgeting / Proposal Development",
"elements": [
{
"label": "Budgeting / Proposal Development",
"mult": 1
}
],
"guide": "## VI. Budgeting / Proposal Development – 10%\nAssesses ability to create realistic and well-justified budget or equipment proposals aligned with department goals and operational efficiency."
},
{
"key": "VII",
"title": "Professionalism & Readiness",
"weight": 5,
"quarter": null,
"competency": "Professionalism & Readiness",
"elements": [
{
"label": "Professionalism & Readiness",
"mult": 1
}
],
"guide": "## VII. Professionalism & Readiness – 5%\nAppearance, punctuality, composure, communication, and receptiveness to feedback."
}
]
}
},
{
"key": "co-matrix",
"name": "Company Officer – Station Evaluation Matrix",
"rank": "Lieutenant / Captain",
"kind": "form",
"sort": 32,
"description": "Station-based matrix scored 1–5 with multipliers (160 points). 90–100% outstanding, 80–89% proficient, 70–79% meets, 60–69% needs improvement.",
"data": {
"scale": {
"min": 1,
"max": 5
},
"passComposite": 70,
"passModule": 0,
"points": true,
"bands": [
[
90,
"Outstanding / Promotion-Ready"
],
[
80,
"Proficient / Fully Effective"
],
[
70,
"Meets Expectations / Continued Growth"
],
[
60,
"Needs Improvement"
],
[
0,
"Unsatisfactory / Development Plan Required"
]
],
"signatures": [
"Evaluator",
"Battalion Chief Review",
"Assistant Chief Review"
],
"overview": "St. George Fire Protection District – Company Officer Evaluation Matrix\nEvaluation Period: 12-Month Working Test / Assessment Year\nEvaluator: ____________________  Candidate: ____________________\nRank: Lieutenant ☐ Captain ☐  Station: ________  Date: ________\nEvaluation Overview\nThis evaluation measures the Company Officer’s ability to lead their crew, manage station operations, maintain training and documentation standards, and operate safely and effectively on the fireground.\nScore | Descriptor | Definition\n5 | Exceptional | Performs above expectations; ready for next-level command.\n4 | Proficient | Consistent and effective; fully meets expectations.\n3 | Developing | Meets minimum standard; requires continued growth.\n2 | Deficient | Below standard; needs significant coaching.\n1 | Unacceptable | Fails to meet minimum expectations.\nPerformance Rating Guide:\n145–160 (90–100%) – Outstanding / Promotion-Ready\n128–144 (80–89%) – Proficient / Fully Effective\n112–127 (70–79%) – Meets Expectations / Continued Growth\n96–111 (60–69%) – Needs Improvement\n≤95 (<60%) – Unsatisfactory / Development Plan Required\nEvaluator Narrative Summary\nEvaluator Notes:\nEvaluator Signature: __________________________  Date: ___________\nBattalion Chief Review: __________________________  Date: ___________\nAssistant Chief Review: __________________________  Date: ___________\nNFPA & Policy Alignment\nStandard / Policy | Description\nNFPA 1021 (Fire Officer I–II) | Supervision, administration, and tactical operations.\nNFPA 1001 (Firefighter II) | Tactical and safety foundation.\nSGFD Policy 104 | Chain of Command & Officer Responsibilities.\nSGFD Policy 301 / 302 | Training & Daily Staffing Documentation.\nSGFD Policy 900 / 902 | Records Management & Data Integrity.\nISO / PIAL Credit | Station-level documentation and training hours.\nOutcome\nSuccessful completion demonstrates that the Company Officer: Leads their crew effectively in both routine and emergency operations.\nMaintains full compliance with SGFD policy, NFPA standards, and ISO documentation.\nDemonstrates initiative, discipline, and professionalism.",
"modules": [
{
"key": "A",
"title": "Tactical Operations (Engine / Ladder Company)",
"weight": 35,
"quarter": null,
"competency": "Tactical Operations (Engine / Ladder Company)",
"elements": [
{
"label": "Size-Up & Initial Radio Report",
"mult": 2
},
{
"label": "Tactical Decision-Making & Line Selection",
"mult": 2
},
{
"label": "Crew Deployment & Safety Management",
"mult": 1
},
{
"label": "Coordination with Incoming Units / BC",
"mult": 1
},
{
"label": "Situational Adaptability (Fire Behavior Changes)",
"mult": 1
}
],
"guide": "Module A – Tactical Operations (Engine / Ladder Company)\nScenario: First-arriving company on a working fire, vehicle accident, or rescue incident.\nEvaluation Element | Weight | Score (0–5) | Weighted\nSize-Up & Initial Radio Report | ×2 |\nTactical Decision-Making & Line Selection | ×2 |\nCrew Deployment & Safety Management | ×1 |\nCoordination with Incoming Units / BC | ×1 |\nSituational Adaptability (Fire Behavior Changes) | ×1 |\nModule A Total (Max 35) |"
},
{
"key": "B",
"title": "Station Management & Daily Operations",
"weight": 35,
"quarter": null,
"competency": "Station Management & Daily Operations",
"elements": [
{
"label": "Organization of Daily Schedule / Priorities",
"mult": 2
},
{
"label": "Accountability for Apparatus & Equipment Readiness",
"mult": 2
},
{
"label": "Facility Cleanliness & Station Inspections",
"mult": 1
},
{
"label": "Documentation Accuracy (Daily Log / Reports)",
"mult": 1
},
{
"label": "Communication with BC / Peers",
"mult": 1
}
],
"guide": "Module B – Station Management & Daily Operations\nScenario: Routine shift operations—crew assignments, inspections, apparatus checks, and documentation.\nEvaluation Element | Weight | Score | Weighted\nOrganization of Daily Schedule / Priorities | ×2 |\nAccountability for Apparatus & Equipment Readiness | ×2 |\nFacility Cleanliness & Station Inspections | ×1 |\nDocumentation Accuracy (Daily Log / Reports) | ×1 |\nCommunication with BC / Peers | ×1 |\nModule B Total (Max 35) |"
},
{
"key": "C",
"title": "Training, Documentation & ISO Compliance",
"weight": 30,
"quarter": null,
"competency": "Training, Documentation & ISO Compliance",
"elements": [
{
"label": "Conduct & Quality of Company-Level Drills",
"mult": 2
},
{
"label": "Accuracy of Training Documentation (FireWorks / Records)",
"mult": 1
},
{
"label": "Pre-Incident Planning & Hydrant Familiarity",
"mult": 1
},
{
"label": "Adherence to SGFD Policy 301 / 302",
"mult": 1
},
{
"label": "Integration of ISO / PIAL Requirements",
"mult": 1
}
],
"guide": "Module C – Training, Documentation & ISO Compliance\nScenario: Company-level training management and documentation of drills, preplans, and inspections.\nEvaluation Element | Weight | Score | Weighted\nConduct & Quality of Company-Level Drills | ×2 |\nAccuracy of Training Documentation (FireWorks / Records) | ×1 |\nPre-Incident Planning & Hydrant Familiarity | ×1 |\nAdherence to SGFD Policy 301 / 302 | ×1 |\nIntegration of ISO / PIAL Requirements | ×1 |\nModule C Total (Max 30) |"
},
{
"key": "D",
"title": "Personnel Management & Leadership",
"weight": 30,
"quarter": null,
"competency": "Personnel Management & Leadership",
"elements": [
{
"label": "Leadership & Crew Cohesion",
"mult": 2
},
{
"label": "Communication & Mentorship",
"mult": 1
},
{
"label": "Enforcement of Safety & Policy Standards",
"mult": 1
},
{
"label": "Handling of Minor Discipline / Counseling",
"mult": 1
},
{
"label": "Initiative, Attitude, and Professional Example",
"mult": 1
}
],
"guide": "Module D – Personnel Management & Leadership\nScenario: Leading a crew, handling minor personnel issues, and promoting professionalism.\nEvaluation Element | Weight | Score | Weighted\nLeadership & Crew Cohesion | ×2 |\nCommunication & Mentorship | ×1 |\nEnforcement of Safety & Policy Standards | ×1 |\nHandling of Minor Discipline / Counseling | ×1 |\nInitiative, Attitude, and Professional Example | ×1 |\nModule D Total (Max 30) |"
},
{
"key": "E",
"title": "Administrative Readiness & Communication",
"weight": 30,
"quarter": null,
"competency": "Administrative Readiness & Communication",
"elements": [
{
"label": "Timeliness and Accuracy of NFIRS / NERIS Reports",
"mult": 2
},
{
"label": "Communication with Battalion Chief / Training",
"mult": 1
},
{
"label": "Understanding of SGFD Policies & SOPs",
"mult": 1
},
{
"label": "Participation in Inter-Division Operations / Drills",
"mult": 1
},
{
"label": "Professionalism in Written & Verbal Communication",
"mult": 1
}
],
"guide": "Module E – Administrative Readiness & Communication\nScenario: Documentation, reports, and coordination with upper command and other divisions.\nEvaluation Element | Weight | Score | Weighted\nTimeliness and Accuracy of NFIRS / NERIS Reports | ×2 |\nCommunication with Battalion Chief / Training | ×1 |\nUnderstanding of SGFD Policies & SOPs | ×1 |\nParticipation in Inter-Division Operations / Drills | ×1 |\nProfessionalism in Written & Verbal Communication | ×1 |\nModule E Total (Max 30) |"
}
]
}
},
{
"key": "bc-wtp",
"name": "Battalion Chief – Working Test Period",
"rank": "Battalion Chief",
"kind": "wtp",
"sort": 40,
"description": "12-month Working Test Period for Battalion Chiefs: modules A–I, 0–5 per element. NFPA 1021 Fire Officer IV, NFPA 1561.",
"data": {
"scale": {
"min": 0,
"max": 5
},
"passComposite": 80,
"passModule": 70,
"months": 12,
"reviews": [
3,
6,
9,
12
],
"evaluators": "Assistant Chiefs, Chief of Training, Fire Chief.",
"signatures": [
"Chief of Training",
"Assistant Chief",
"Fire Chief"
],
"outcomes": [
"Recommend permanent status",
"Extend the working test period",
"Do not recommend"
],
"overview": "St. George Fire Protection District – Battalion Chief Testing & Evaluation Strategy\nPurpose\nTo establish a comprehensive, performance-based evaluation and testing program for Battalion Chiefs that:\nIt is conducted entirely on duty (no overtime or callback).\nCovers the 1-year Civil Service Working Test Period (WTP).\nAligns with NFPA 1021 (Fire Officer IV), NFPA 1561, ISO/PIAL, and Louisiana Civil Service Law (R.S. 33:2471–2495).\nEvaluates operational command, personnel management, strategic planning, and professional leadership.\n1. Program Overview\nElement | Description\nPosition Evaluated | Battalion Chief (Operational & Administrative)\nDuration | 12 Months (Civil Service Working Test Period)\nEvaluator Group | Assistant Chiefs, Chief of Training, Fire Chief\nFramework | 9 evaluation modules (A–I) integrated into daily command functions\nCompliance | Civil Service Rule XIII; SGFD SOP #100-06; NFPA 1021, Level IV\nMethod | On-duty observation, command simulations, administrative tasks, and strategic deliverables\n2. Testing Structure (Modules A–I)\nQuarter | Evaluation Focus | Scenario Alignment | Delivery Mode\nQ1 | Command Foundations & Multi-Company Operations | A – Advanced Incident Command / B – Multi-Alarm Strategy | Live incident observation + command simulations\nQ2 | Division & Section Leadership | C – Personnel Management / D – Interagency Coordination | Station visits, HR cases, and joint agency tabletop\nQ3 | Administrative Excellence | E – Budget Management / F – Policy & SOP Development / G – NERIS Data Integrity & Reporting Oversight | Office days, admin tasks, and data audits\nQ4 | Executive Readiness & Professional Development | H – Strategic Planning & Presentation / I – Professionalism & Command Readiness | Written plan + oral presentation + field observation\n3. Scheduling & No-Overtime Implementation\nA. Integration into Duty Command Schedule\nAll evaluations occur while on-duty as part of normal BC administrative and command responsibilities.\nCommand simulations (A–B) conducted during daytime training blocks or actual working incidents.\nAdministrative assignments (E–H) are completed in existing office time or between calls.\nPresentations (Scenario H) delivered during regular workday meetings—no callbacks or extended shifts.\nB. Evaluator Coverage\nAssistant Chiefs rotate as evaluators by shift, preventing off-duty evaluation.\nWritten deliverables reviewed digitally (no in-person overtime grading).\nC. Documentation Platform\nAll rubrics and reports submitted via the SGFD Intranet:\nS:/Training/BattalionChief_Evaluation/WorkingTestPeriod_<Year>/BC_<Name>/\n4. Evaluation Modules (A–I Overview)\nModule | Title | Focus Area | Weight\nA | Advanced Incident Command | Multi-company strategy, span of control, communications | 15%\nB | Multi-Alarm / Large-Scale Event | Complex incident management, resource coordination | 15%\nC | Personnel Management & Corrective Action | Supervision, discipline, coaching, documentation | 10%\nD | Interagency Coordination | Mutual aid, EOC operations, outside agency relations | 10%\nE | Budget & Resource Management | Division spending, apparatus allocation, cost tracking | 10%\nF | Policy & SOP Development | Drafting, revising, and implementing policy updates | 10%\nG | NERIS Oversight & Data Quality | Reviewing reports, data accuracy, analytics | 10%\nH | Strategic Planning & Presentation | Long-range program or division initiative | 10%\nI | Professionalism & Command Readiness | Ethical conduct, composure, communication, mentorship | 10%\nTOTAL |  | 100%\n5. Evaluation & Scoring\nGrading Scale:\n0–5 per element; 5 = Exemplary, 3 = Meets Expectations, 1 = Needs Improvement.\nPassing Requirement:\nMinimum 80% composite average.\nNo single module below 70%.\nMidterm remediation opportunities are provided at 6 months.\n6. Example Module Descriptions\nA. Advanced Incident Command (Q1)\nCommand 2+ company incident or simulation.\nEstablish full ICS structure (Operations, Divisions, Safety, Accountability).\nDemonstrate risk analysis, IAP development, and clear communication.\nEvaluated by Chief of Training/ and Chief officer using SGFD ICS Rubric (NFPA 1561 alignment).\nB. Multi-Alarm Strategy (Q1–Q2)\nCoordinate multiple stations and mutual aid.\nManage staging, resource accountability, and radio discipline.\nConduct after-action review (AAR) and document lessons learned.\nC. Personnel Management & Corrective Action (Q2)\nHandle real or simulated personnel issues (e.g., attendance, behavior, injury).\nDemonstrate Civil Service documentation compliance and confidentiality.\nComplete Personnel Action Form correctly and route per SOP #200-03.\nD. Interagency Coordination (Q2–Q3)\nLead a joint tabletop (Law Enforcement, EMS, OEM).\nEvaluate communications, unified command, and mutual-aid resource deployment.\nE. Budget & Resource Management (Q3)\nOversee budget line items for assigned stations/divisions.\nIdentify cost trends and submit a corrective efficiency proposal.\nPrepare quarterly fiscal report using S:/Admin/Budget/BC_Template.xlsx.\nF. Policy & SOP Development (Q3)\nDraft or revise one department SOP aligned with NFPA or ISO standards.\nPresent to Assistant Chiefs for review and recommendation to Fire Chief.\nG. NERIS Oversight & Data Quality (Q3)\nAudit 10 recent incidents under command for NERIS accuracy.\nCorrect deficiencies and provide recommendations to Training & Admin.\nH. Strategic Planning & Presentation (Q4)\nDevelop a 2–3-year plan (e.g., Training, Recruitment, Apparatus Lifecycle).\nWrite a formal 3-page proposal and present (10 min) to command staff.\nI. Professionalism & Command Readiness (Ongoing)\nContinuous evaluation of demeanor, decision-making, and ethics.\nIncludes observation during calls, meetings, and public interactions.\n7. Quarterly Timeline (No Overtime)\nQuarter | Key Evaluations | Deliverables\nQ1 (Months 1–3) | Modules A & B | Command simulations, AAR submission\nQ2 (Months 4–6) | Modules C & D | Personnel documentation, interagency tabletop\nQ3 (Months 7–9) | Modules E, F, G | Budget report, SOP draft, NERIS audit\nQ4 (Months 10–12) | Modules H & I | Strategic plan + presentation; professionalism review\n8. Feedback & Development Cycle\nMonth | Activity\n3 | Initial performance check-in\n6 | Midpoint review and corrective coaching\n9 | Strategic leadership assignment\n12 | Final composite evaluation and certification recommendation\nEvaluations are reviewed by the Chief of Training/Training Division/Their Battalion and Assistant Chief and then signed by the Fire Chief.\nIf no real incidents occur, the training simulations automatically substitute without penalty.\n9. Working Test Period (1 Year) – Civil Service Compliance\nBegins on date of official promotion or appointment.\nEvaluations throughout the year serve as the legal performance record under Civil Service Rule XIII.\nSatisfactory completion → permanent appointment.\nUnsatisfactory performance → possible extension or reversion, per LA R.S. 33:2490.\n10. ISO / PIAL & Administrative Integration\nAll tasks align with ISO/PIAL categories for documentation credit:\nTraining (Command, Multi-Company, Officer Development).\nEquipment / Apparatus Management.\nAdministrative Reports (NERIS, Budget, SOPs).\nStrategic Planning and Organizational Readiness.\nDigital archive path:\nS:/Training/BC_Evaluations/<Year>/Records/\n11. Key Benefits\nNo overtime – all integrated on-duty.\nYear-long progressive development and evaluation.\nAligns directly with NFPA 1021 Level III competencies.\nStrengthens SGFD leadership succession and administrative capability.\nCreates permanent Civil Service documentation and ISO/PIAL value.\nSt. George Fire Protection District – Battalion Chief Evaluation Matrix\nEvaluation Period: 12-Month Working Test / Assessment Year\nEvaluator: ____________________  Candidate: ____________________\nBattalion Assignment: SG6 ☐ SG7 ☐ Date: ____________________\nEvaluation Overview\nThis evaluation measures the Battalion Chief’s ability to manage multi-company operations, enforce policy compliance, mentor Captains, and maintain readiness throughout the battalion.\nScoring is consistent with the SGFD Assistant Chief matrix for seamless progression.\nScore | Descriptor | Definition\n5 | Exceptional | Performs above expectations; ready for higher-level command.\n4 | Proficient | Fully competent and consistent performance.\n3 | Developing | Meets minimum standard; needs refinement in one or more areas.",
"modules": [
{
"key": "A",
"title": "Advanced Incident Command",
"weight": 15,
"quarter": 1,
"competency": "Incident command",
"elements": [
{
"label": "Accurate Size-Up & Command Declaration",
"mult": 1
},
{
"label": "IAP Development & Tactical Priorities",
"mult": 1
},
{
"label": "ICS Structure / Span of Control",
"mult": 1
},
{
"label": "Communications Discipline & Benchmark Reporting",
"mult": 1
},
{
"label": "Safety Management / Command Transition",
"mult": 1
}
],
"guide": "Module A – Advanced Incident Command (Urban Multi-Company Fire)\nPurpose\nEvaluate a Battalion Chief’s ability to assume command of a rapidly expanding structural fire, establish an effective ICS framework, direct multi-company operations, and transition command to higher authority—all while maintaining firefighter safety and clear tactical priorities.\nScenario Overview\nScenario Title:\n“Oak Ridge Apartments – Multi-Company Fire”\nIncident Conditions:\nAt 01:42 hrs., multiple calls report smoke and fire showing from the second floor of Oak Ridge Apartments, a two-story garden-style complex with lightweight truss roof construction.\nFirst-due Engine 633 reports heavy fire from Side C extending into the attic.\nMultiple occupants are still exiting the structure.\nHigh winds threaten adjacent Building Bravo (20 ft exposure).\nSecond and third alarms are requested on dispatch.\nYou, Battalion Chief (SG7) on C-Shift, arrive as the first-arriving command officer.\nYou must ensure an orderly transfer of command, and you as, battalion chief, shall function as an Incident Commander and organize the fireground.\nInitial Conditions (Dispatch Log Extract)\nTime | Event\n01:42 | 911 calls report apartment fire; multiple trapped\n01:44 | E-633 reports working fire, 2-story center hallway, heavy fire rear\n01:46 | T-646 en route; hydrant issues reported\n01:48 | E-643 arrives; exposure line in place\n01:50 | Battalion Chief SG7 (Candidate) on scene; assumes Command\n01:52 | Evacuation order possible for partial roof collapse on the Charlie side\nOfficer Tasks / Decision Points\nSize-Up & Command Establishment\nIdentify who has Command,\nDetermine what units are on scene and their assignments\nObtain conditions, actions, and needs (CAN report) from the initial incident commander.\nAssume command, location, and mode (offensive/defensive).\nAssign divisions and functional groups as resources arrive.\nIncident Action Plan (IAP)\nEstablish three tactical priorities: Life Safety, Incident Stabilization, Property Conservation.\nIdentify critical tasks: primary search, fire attack, exposure protection, ventilation, and water supply.\nImplement accountability, and on-deck assignments.\nBlueCard/ICS Organization\nAssign and supervise:\nDivision Alpha (Fire Attack)\nDivision Charlie (Exposure)\nVentilation Group (Ar-618)\nWater Supply Group (E-623)\nOn Deck (Squad 605)\nMaintain span of control ≤ 5.\nCommunications & Command Presence\nDeliver clear CAN reports every 10–15 minutes during an active working incident\nDivision/Group Supervisors should prompt internal CANs from companies about every 5–10 minutes under heavy interior operations.\nDirect radio traffic, prevent freelancing, maintain command discipline.\nManage Mayday or collapse events through established channels.\nRisk / Safety Management\nApply “OODA (Observe, Orient, Decide, Act) Loop” model.\nIdentify collapse zones; initiate defensive transition if needed.\nEnsure PAR after any major tactical change.\nCommand Transition\nBrief incoming Assistant Chief as a senior adviser:\nIncident Name / Location\nResources assigned\nCurrent Objectives\nHazards / Exposures / Needs\nAssigns operation section chief, division, branch, etc.\nDocumentation\nComplete ICS-201 and ICS-214 logs.\nSubmit an After-Action Memo summarizing strategy, benchmarks, and outcomes.\nEvaluator Observations\nPerformance Element | Max Pts (0–5) | Comments\nAccurate Size-Up & Command Declaration | 5 |\nIAP Development & Tactical Priorities | 5 |\nICS Structure / Span of Control | 5 |\nCommunications Discipline & Benchmark Reporting | 5 |\nSafety Management / Command Transition | 5 |\nTotal (25 pts) |\nEvaluator Discussion Prompts\nWhat were your first three tactical priorities and why?\nHow did you determine when to change operational modes?\nWhat hazards influenced your strategy or sector assignments?\nWhat benchmarks did you use to evaluate incident progress?\nExpected Battalion Chief Behaviors (High-Scoring Examples)\nEstablishes “Oak Ridge Command” immediately with concise radio report.\nAssigns divisions/groups early, requests 2nd alarm proactively.\nDevelops IAP prioritizing life safety and exposures.\nMaintains radio discipline; provides clear benchmarks (“Fire under control 01:58”).\nDemonstrates calm, structured command presence; completes ICS forms accurately.\nTransitions command professionally and remain as Operations Section Chief.\nDeliverables (Candidate)\nWithin 24 hours:\nCompleted ICS-201 / 214 forms.\nAfter-Action Memo (1 page) summarizing:\nInitial strategy & tactical priorities\nResource deployment summary\nLessons learned & recommendations\nUpload to:\nAbsorb\nTraining Objective Reference\nNFPA 1021 (2020 Ed.) 5.2.3 / 5.3.3 – Manage multi-unit emergency operations.\nNFPA 1561 (2020 Ed.) – Emergency Services IMS.\nSGFD SOP #200-02 – Incident Command Operations.\nISO / PIAL Credit: Company & command-level training documentation.",
"sim": true
},
{
"key": "B",
"title": "Multi-Alarm / Large-Scale Event",
"weight": 15,
"quarter": 1,
"competency": "Incident command",
"elements": [
{
"label": "Establishment of Field Command & Comms",
"mult": 1
},
{
"label": "Resource Organization / Prioritization",
"mult": 1
},
{
"label": "Integration with Remote IC & Agencies",
"mult": 1
},
{
"label": "Safety / Accountability Under Dynamic Conditions",
"mult": 1
},
{
"label": "Documentation & Planning Cycle Awareness",
"mult": 1
}
],
"guide": "Module B – District Flood Operations (Type 4 / Area Command Integration)\nPurpose\nTo evaluate the Battalion Chief’s ability to independently manage a district-wide, multi-site flood emergency under remote Incident Command, functioning as both Operations Section Chief and Division/Group Supervisor until additional command resources arrive.\nScenario Overview\nScenario Title:\n“Amite River/Jones Creek Crest – SG7 Flood Operations”\nIncident Conditions:\nAt 03:15 hrs., after two days of heavy rainfall, the following conditions are reported:\nBayou Manchac, Ward Creek, and Jones Creek have exceeded flood stage.\nStations 63, 64, and 66 are operating in isolation, multiple roads impassable.\nDozens of residents are trapped in subdivisions along Tiger Bend, Jones Creek, Hoo Shoo Too.\nMOSEP activates parish wide emergency plan.\nFire Chief and Assistant Chiefs establish Unified Command at SGFD Administration HQ with EBR Sheriff and Public Works.\nYou, the on-duty Battalion Chief, are assigned as North Ops Division, responsible for all field operations in the SGFD north district for the next 4–6 hours.\nNo additional command officers are expected on scene until conditions improve.\nExpected ICS Configuration (Type 4 / Hybrid)\nPosition | Filled By | Responsibilities\nIncident Commander (Unified) | Asst. Fire Chief (On-Duty)/EBRSO/EBREMS | Strategic objectives & resource allocation\nOperations Section Chief (Field) | Evaluated Battalion Chief | District-level tactical control & coordination\nDivision Alpha | Station 66 OIC | Jones Creek – High-Water Rescues\nDivision Bravo | Station 64 OIC | Coursey Corridor – Evacuations / Downed Lines\nDivision Charlie | Medic 667 OIC | Medical Evac / Shelter Support\nPlanning / Situation Unit | ??? | SitReps / NERIS updates\nLogistics Unit | Admin Logistics Officer | Fuel / boats / equipment tracking\nPIO / Liaison | Admin HQ | Public information / agency coordination\nOfficer Tasks / Decision Points\nInitial Assessment & Command Establishment\nDeclare “North Ops Division”; identify safe CP location.\nGather status from each station via radio or text if repeaters down.\nPrioritize life threats, critical infrastructure, and accessible routes.\nResource Organization & Tasking\nAssign companies by geographic division or mission type (Rescue / Evac / Power Lines / Medical).\nForm Task Forces combining engine, boat, and medical resources.\nMaintain status board and personnel accountability under flooded conditions.\nCommunications & Coordination with Remote IC\nEstablish primary and secondary channels.\nProvide CAN or SitRep updates to HQ.\nReport resource needs and evacuation numbers via ICS 209-Short.\nMulti-Operational Period Planning\nForecast next 12 hours: fuel needs, crew relief, apparatus re-positioning.\nIdentify staging and shelter locations for residents.\nRecommend priorities for incoming mutual aid.\nSafety / Risk Management\nEnforce “no driving through water > hub height” policy.\nTrack crews by GPS / radio; conduct hourly PARs.\nCoordinate rehab and rotations in dry areas.\nInteragency Integration\nWork directly with EBR Sheriff, Public Works, and Entergy field teams.\nUse Unified Command principles while retaining SGFD discipline.\nDemobilization / Transition\nCompile ICS 214, 215A, and 209-Short for handoff.\nBrief incoming Battalion or IMT Ops Chief upon relief.\nEvaluator Observations\nPerformance Element | Max Pts (0–5) | Comments\nEstablishment of Field Command & Comms | 5 |\nResource Organization / Prioritization | 5 |\nIntegration with Remote IC & Agencies | 5 |\nSafety / Accountability Under Dynamic Conditions | 5 |\nDocumentation & Planning Cycle Awareness | 5 |\nTotal (25 pts) |\nEvaluator Discussion Prompts\nHow did you prioritize limited resources for multiple simultaneous rescues?\nWhat was your method for maintaining contact with isolated companies?\nHow did you balance tactical control with strategic reporting to HQ?\nWhat ICS forms did you generate and how were they shared?\nIf conditions worsened overnight, what would your next operational objectives be?\nExpected Battalion Chief Behaviors (High-Scoring Examples)\nEstablishes North Ops Division within minutes of arrival.\nDivides district into manageable geographic areas and deploys task forces.\nSends timed SitReps to Admin HQ with resource and life-safety updates.\nUses ICS-214/215A/209 accurately and retains copies for handoff.\nMaintains safety awareness and clear radio discipline under stress.\nCoordinates smoothly with law enforcement and public works personnel.\nDeliverables (Candidate)\nSubmit electronically to Chief of Training within 24 hours:\nICS-214 (Activity Log) and ICS-215 / 215A (Resource Tracking)\nICS-209-Short (Situation Report)\nAfter-Action Memo (1 page) summarizing priorities, decisions, and lessons learned.\nUpload to:\nAbsorb\nTraining Objective Reference\nNFPA 1021 (2020 Ed.) 5.3.3 / 5.4.1 / 5.4.3 – Manage large-scale incidents & coordinate agencies.\nNFPA 1561 (2020 Ed.) – Emergency Services Incident Management System.\nICS 300/400 (Type 3 IMT Standards).\nISO / PIAL Credit: Major incident documentation and district readiness.\nEvaluation Scheduling (On Duty)\nConduct during annual Severe Weather / Flood Response Tabletop or spring operational drill.\nEvaluator (Assistant Chief / Training Division) monitors on-duty or remotely.\nDebrief completed during regular tour; documentation uploaded before shift end.\nOutcome\nSuccessful completion demonstrates that the Battalion Chief:\nCan function as an Operations Section Chief / Division Supervisor under remote Incident Command.\nCan command a district-wide Type 4 incident with multi-agency integration.\nMaintains safety, documentation, and strategic awareness throughout a prolonged emergency.",
"sim": true
},
{
"key": "C",
"title": "Personnel Management & Corrective Action",
"weight": 10,
"quarter": 2,
"competency": "Personnel & leadership",
"elements": [
{
"label": "Accuracy of Assessment & Data Review",
"mult": 1
},
{
"label": "Fairness & Consistency of Corrective Plan",
"mult": 1
},
{
"label": "Compliance with SGFD Policy & Civil Service Law",
"mult": 1
},
{
"label": "Leadership Tone & Communication Quality",
"mult": 1
},
{
"label": "Documentation & Follow-Up Control",
"mult": 1
}
],
"guide": "Module C – Personnel Management & Corrective Action (District-Level Oversight)\nPurpose\nTo evaluate a Battalion Chief’s ability to identify and correct district-level performance deficiencies through accurate data verification, fair application of the St. George Fire Protection District Policy Manual, and consistent leadership across multiple stations.\nThis module measures Officer III-level competencies in managing subordinate company officers, maintaining documentation standards, and enforcing accountability while preserving morale and Civil-Service compliance.\nScenario Overview\nScenario Title:\n“District 5 Performance Variance – Officer Accountability and Corrective Action”\nScenario Conditions:\nIt is Monday 07:30 hours, and you are the Battalion Chief for District 5, supervising Stations 61, 62, and 63.\nThe Training Division forwards the following performance summary:\nCategory | District Average | Department Standard | Comments\nCompany Training Hours | 74 hrs | 120 hrs | Two stations below standard\nHaz-Mat Refresher Completion | 65 % | 100 % | Incomplete rosters\nNERIS Incident Accuracy | 92 % | 98 % | Missing narratives / miscoding\nSick Leave Usage (YTD) | 12 days avg | ≤ 6 days | Two members exceed limit\nOfficer Daily Logs On Time | 68 % | 95 % | Repeated late submissions\nAdditional context\nCaptain Duval (Sta 61) has repeatedly delayed daily log uploads.\nCaptain Martin (Sta 62) reports chronic short-staffing and claims training goals are unrealistic.\nStation 63 meets or exceeds all expectations.\nThe Assistant Chief has directed you to determine causes, apply appropriate policy, and document corrective guidance.\nOfficer Tasks / Decision Points\n1 – Assessment & Verification\nValidate Training Division data in FireWorks and NERIS for accuracy.\nIdentify whether deficiencies are systemic (district-wide) or station-specific.\nConfirm completion records and leave data through Administrative Services.\n2 – Personnel Interviews & Observation\nConduct private discussions with Captains Duval and Martin.\nObserve morning briefings at each affected station.\nDetermine root causes: workload, supervision, or procedural neglect.\n3 – Policy Application & Reference\nApply and cite the following SGFD policies:\n• 200.5 – Chain of Command\n• 1020 – Grievance Procedure\n• 1054 – Discipline Policy and Guidelines\n• 1052 – Leave (Attendance and Modified Sick Leave)4 – Corrective Action Plan (Required)\nDraft a District-Wide Improvement Memo outlining verified deficiencies and measurable corrective goals.\nIssue Written Counseling Forms (not disciplinary) to Captains Duval and Martin referencing Policies 204 & 205.\nEstablish 30-day objectives such as:\n100 % training entries submitted within 7 days.\nDaily logs uploaded within 24 hours.\nHaz-Mat rosters validated and updated weekly.\n5 – Communication & Follow-Up\nEmail summary memo and attachments to the Assistant Chief of Operations (cc: Chief of Training).\nConduct 30-day follow-up and document compliance progress.\nArchive all materials under: TrackIt (Tenzinga)\nEvaluator Observations\nPerformance Element | Max Pts (0–5) | Comments\nAccuracy of Assessment & Data Review | 5 |\nFairness & Consistency of Corrective Plan | 5 |\nCompliance with SGFD Policy & Civil Service Law | 5 |\nLeadership Tone & Communication Quality | 5 |\nDocumentation & Follow-Up Control | 5 |\nTotal (25 pts) |\nEvaluator Discussion Prompts\nHow did you confirm the performance data before issuing counseling?\nWhat distinguishes counseling from disciplinary action under Policy 204.00?\nHow did you balance accountability with officer morale and trust?\nWhat metrics define success for the 30-day improvement period?\nIf deficiencies persist, what progressive action would follow?\nExpected Battalion Chief Behaviors (High-Scoring Examples)\nConfirm all quantitative data before action is taken.\nReferences SGFD policy sections accurately in memos and counseling forms.\nIssues clear, achievable, and measurable improvement goals.\nMaintains confidentiality and Civil-Service due process (Policies 1105 & 1110 – Records Management, Data Integrity, and Confidentiality).\nDemonstrates even enforcement and professional tone across all companies.\nProvides written 30-day follow-up showing measurable improvement.\nDeliverables (Candidate)\nSubmit the following within 48 hours of scenario completion:\nDistrict Performance Assessment Memo (1–2 pages)\nWritten Counseling Forms for Captains Duval and Martin\n30-Day Improvement Plan (checklist or Gantt chart)\nEmail Summary to Assistant Chief of Operations (cc Chief of Training)\nUpload to: Absorb\nTraining Objective References\nNFPA 1021 (2020) – Chapter 6 (6.3 & 6.6): Manage personnel and administrative functions.\nLA R.S. 33:2471 et seq. – Municipal Fire & Police Civil Service Law.\nSGFD Policy Manual:\n• 200.5 – Chain of Command\n• 1020 – Grievance Procedure\n• 1054 – Discipline Policy and Guidelines\n• 1052 – Leave (Attendance and Modified Sick Leave)4 – Corrective Action Plan (Required)\n1105-Records Management,\n1110-Data Integrity and Confidentiality\nISO / PIAL Credit: Leadership & Administrative Management Documentation.\nEvaluation Scheduling (Within Shift)\nConduct scenario and document review during normal administrative hours.\nEvaluator (Assistant Chief or Chief of Training) reviews submissions on duty.\nDebrief and scoring completed before end of shift — no overtime authorized.\nOutcome\nSuccessful completion demonstrates that the Battalion Chief:\nValidates data and applies corrective measures fairly and consistently.\nEnforces SGFD Policy Manual standards accurately.\nExecutes personnel management in compliance with Civil Service law.\nStrengthens district accountability through structured follow-up and documentation."
},
{
"key": "D",
"title": "Interagency Coordination",
"weight": 10,
"quarter": 2,
"competency": "Interagency coordination",
"elements": [
{
"label": "Unified command establishment with Law Enforcement, EMS and OEM",
"mult": 1
},
{
"label": "Interagency communications & radio interoperability",
"mult": 1
},
{
"label": "Mutual-aid resource request and deployment",
"mult": 1
},
{
"label": "Liaison, EOC coordination & outside-agency relations",
"mult": 1
},
{
"label": "After-action review & documentation",
"mult": 1
}
],
"guide": "D. Interagency Coordination (Q2–Q3)\nLead a joint tabletop (Law Enforcement, EMS, OEM).\nEvaluate communications, unified command, and mutual-aid resource deployment.",
"note": "The document has no detailed Module D rubric; these five elements were written from its description. Edit them in Programs."
},
{
"key": "E",
"title": "Budget & Resource Management",
"weight": 10,
"quarter": 3,
"competency": "Budget & resources",
"elements": [
{
"label": "Thoroughness of Facility Assessment",
"mult": 1
},
{
"label": "Policy 212 Compliance & Bid Awareness",
"mult": 1
},
{
"label": "Clarity & Professionalism of RFP Memo",
"mult": 1
},
{
"label": "Fiscal Responsibility & Prioritization",
"mult": 1
},
{
"label": "Communication & Leadership",
"mult": 1
}
],
"guide": "Module D – Budget & Resource Management (Facility and Capital Improvement Identification)\nPurpose\nTo evaluate a Battalion Chief’s ability to assess facility conditions, identify operational improvement needs, and prepare justified RFP-style requests in accordance with Policy 212 – Purchasing and Procurement and Louisiana R.S. 38:2212.\nThis module measures Officer III competencies in fiscal accountability, prioritization, and facility management awareness at the district level.\nScenario Overview\nScenario Title:\n“SG7’s Facility and Capital Improvement Assessment – FY 2026 Budget Cycle”\nScenario Conditions:\nIt is May 15, and the Assistant Chief of Administration has directed each Battalion Chief to submit a station facility needs assessment and FY 2026 improvement request package.\nYou supervise Stations 63, 64, and 66, each showing minor wear and aging infrastructure. The Finance Division will use your submissions to prioritize next year’s maintenance and capital allocations.\nStation | Current Issue | Notes from Personnel\nStation 63 | Interior walls showing paint deterioration and moisture staining. | Crews report peeling paint and bubbling near apparatus bay doors.\nStation 64 | Kitchen cabinets are delaminated and drawers broken. | Company suggests replacing all cabinetry and hardware for safety and durability.\nStation 66 | Stove and refrigerator are 14 years old; oven intermittently fails. | Personnel request replacement of outdated appliances with energy-efficient models.\nThe Assistant Chief has instructed that all proposed repairs or replacements be accompanied by written justification, estimated cost, and quotes or bid documentation following Policy 212.\nApplicable SGFD Policies\n• 200.5 – Chain of Command\n• 1100 – Budget Development and Fiscal Control\n• 1115 – Purchasing and Procurement\n• 1116 – Supply Requisitions, Bid Thresholds, and Approval Process\n• Special Services Directive (SD-FM-01) – Facility Maintenance and Repair\nOfficer Tasks / Decision Points\n1 – Facility Assessment\nConduct walkthroughs of Stations 63–65 with each Captain.\nIdentify and document cosmetic, safety, and functional deficiencies (painting, cabinetry, flooring, HVAC reliability, electrical outlets, etc.).\nTake photographs and notes for submission.\n2 – Prioritization and Cost Estimation\nCategorize each issue as:\nRoutine Maintenance (< $1,000) – e.g., patch & repaint walls.\nMinor Capital ($1,000–$10,000) – e.g., replace cabinetry or flooring.\nMajor Capital (> $10,000) – e.g., appliance suite replacement or plumbing remodel.\nObtain at least three written/ quotations per Policy 212.5 for any request between $10,000 and $30,000.\nThis includes any scope of work totally over $10,000, not any individual project or item less than $10,000.\nCoordinate with Administration for any larger projects requiring formal advertisement and sealed bids.\n3 – RFP-Style Justification Memo\nPrepare a 1–2-page memorandum to the Assistant Chief of Administration that includes:\nStation-by-station summary of identified issues.\nJustification for each project (safety, morale, longevity, energy efficiency, or compliance).\nEstimated cost and procurement path under Policy 212.\nSupporting photos or quotes.\n4 – Budget Worksheet Completion\nBudget worksheet will be provided in Absorb\nLabel each entry as Facility Maintenance or Capital Improvement (CI).\nEnsure requisition forms reflect accurate approval routing and documentation.\n5 – Communication & Leadership\nReview findings with Captains, explaining the RFP process and expectations for future reporting.\nReinforce accountability in documenting facility issues early to reduce emergency expenditures.\nEvaluator Observations\nPerformance Element | Max Pts (0–5) | Comments\nThoroughness of Facility Assessment | 5 |\nPolicy 212 Compliance & Bid Awareness | 5 |\nClarity & Professionalism of RFP Memo | 5 |\nFiscal Responsibility & Prioritization | 5 |\nCommunication & Leadership | 5 |\nTotal (25 pts) |\nEvaluator Discussion Prompts\nHow did you determine which projects qualified as capital vs. maintenance?\nHow did you ensure compliance with Policy 212 thresholds?\nWhat criteria did you use to prioritize limited funding?\nHow will you track completion and accountability once approved?\nHow could early identification of these issues reduce long-term costs?\nExpected Battalion Chief Behaviors (High-Scoring Examples)\nAccurately assesses and documents station facility needs.\nReferences Policy 212 correctly for each purchase category.\nSubmits professional, well-justified RFP-style memo and supporting documentation.\nPromotes transparency and fiscal accountability.\nEngages Captains in proactive facility management.\nDeliverables (Candidate)\nSubmit within 72 hours of scenario assignment:\nFacility & Capital Improvement RFP Memo (1–2 pages)\nCompleted FY2026_BC_Request_Template.xlsx\nQuotes or Cost Estimates (≥ $10,000 items require 3 quotes).\nEmail Summary to Assistant Chief of Administration (cc Chief of Operations & Chief of Training).\nUpload to: Absorb\nTraining Objective Reference\nNFPA 1021 (2020 Ed.) 6.9 – Develop and Manage Budgets\nNFPA 1021 (2020 Ed.) 6.3 – Manage Administrative Functions\nSGFD Policy 212 – Purchasing and Procurement\nISO/PIAL Credit: Administrative Oversight & Facility Documentation\nEvaluation Scheduling (No Overtime)\nConduct during regular administrative work hours.\nEvaluator (Assistant Chief of Administration or Chief of Training) reviews submissions on-duty.\nFeedback provided during next district leadership meeting.\nOutcome\nSuccessful completion demonstrates the Battalion Chief:\nIdentifies and prioritizes facility improvements responsibly.\nApplies Policy 212 and state procurement law accurately.\nDemonstrates fiscal transparency and documentation discipline.\nPromotes operational efficiency and safety through proactive facility management."
},
{
"key": "F",
"title": "Policy & SOP Development",
"weight": 10,
"quarter": 3,
"competency": "Policy",
"elements": [
{
"label": "Accuracy of NFPA Gap Analysis",
"mult": 1
},
{
"label": "Clarity & Professionalism of Draft Policy",
"mult": 1
},
{
"label": "Compliance with SGFD Format & Policy 103.00",
"mult": 1
},
{
"label": "Communication & Routing Effectiveness",
"mult": 1
},
{
"label": "Implementation / Rollout Strategy",
"mult": 1
}
],
"guide": "Module E – Policy & SOP Development\nPurpose\nTo evaluate the Battalion Chief’s ability to identify gaps or deficiencies in existing SGFD policies, draft or revise standard operating procedures (SOPs) using NFPA and ISO/PIAL references and navigate the department’s formal policy approval and publication process in compliance with SGFD administrative standards.\nScenario Overview\nScenario Title:\n“Revision of Incident Rehabilitation Policy – NFPA 1584 Compliance”\nScenario Conditions:\nFollowing a recent structure fire involving multiple companies, several firefighters exhibited signs of heat stress.\nThe post-incident review revealed inconsistent application of rehabilitation procedures between shifts and lack of documentation in NERIS.\nThe Fire Chief directs each Battalion Chief to review existing SGFD policy and recommend updates to ensure compliance with NFPA 1584 (Standard on Rehabilitation Process for Members During Emergency Operations and Training Exercises).\nYour task is to review, revise, and formally submit a proposed policy update.\nApplicable SGFD Policies\n• 1000 – Policy Development and Revision\n• 200.5 – Chain of Command\n• 1054 – Discipline Policy and Guidelines\n• 401.3 – Emergency Scene Safety and Accountability\n• 408.1 – Rehabilitation (Rehab) Operations\n• 1105 – Records Management and Retention\nOfficer Tasks / Decision Points\nGap Analysis & Policy Review\nRetrieve existing Policy 408.00 – Rehabilitation Operations.\nCompare content to NFPA 1584 (2022 Edition).\nIdentify missing elements such as:\nMedical monitoring criteria.\nHydration and nutrition standards.\nEnvironmental considerations.\nDocumentation and tracking requirements.\nDraft Policy Revision\nRevise Policy 408.00 using SGFD Policy Format (Policy #, Purpose, Scope, Procedure, References).\nAdd a “Revision Control” section citing NFPA 1584, NFPA 1561, and SGFD 406.00.\nEnsure clarity, uniformity, and actionable directives for all companies.\nAdministrative Routing & Review\nSubmit draft revision with a Policy Revision Summary Memo explaining:\nThe identified deficiency.\nProposed change.\nExpected operational or safety improvement.\nFiscal or training impacts, if any.\nRoute through:\nAssistant Chief of Training (technical review)\nAssistant Chief of Operations (implementation review)\nFire Chief (final approval).\nCommunication & Implementation Plan\nDevelop a rollout plan for company officers.\nInclude training or awareness requirements.\nCoordinate publication with the Administrative Office under Policy 900.00.\nEvaluator Observations\nPerformance Element | Max Pts (0–5) | Comments\nAccuracy of NFPA Gap Analysis | 5 |\nClarity & Professionalism of Draft Policy | 5 |\nCompliance with SGFD Format & Policy 103.00 | 5 |\nCommunication & Routing Effectiveness | 5 |\nImplementation / Rollout Strategy | 5 |\nTotal (25 pts) |\nEvaluator Discussion Prompts\nWhat specific deficiencies did you identify compared to NFPA 1584?\nHow did you ensure the revised policy fits the SGFD manual format?\nHow should policy changes be communicated to all shifts?\nWhat role does the Battalion Chief play in verifying compliance once implemented?\nHow do policy revisions impact ISO/PIAL documentation?\nExpected Battalion Chief Behaviors (High-Scoring Examples)\nConducts structured gap analysis referencing NFPA and SGFD policy sections.\nDrafts concise, actionable, and professionally formatted SOP.\nDemonstrates understanding of routing and approval per Policy 103.00.\nCommunicates proposed changes effectively across the chain of command.\nConsiders training, cost, and cultural implications of the new policy.\nSubmits both digital (Word) and PDF final drafts to Admin and Training.\nDeliverables (Candidate)\nSubmit within 7 calendar days:\nPolicy Revision Summary Memo (1 page).\nRevised SGFD Policy 408.00 – Rehabilitation Operations (Draft).\nImplementation / Rollout Plan (short outline or Gantt chart).\nReference Matrix linking updated content to NFPA 1584 requirements.\nUpload to: Absorb\nTraining Objective Reference\nNFPA 1021 (2020 Ed.) 5.4.5 – Develop and implement policies and procedures.\nNFPA 1584 (2022 Ed.) – Rehabilitation standards.\nNFPA 1561 (2020 Ed.) – Incident Management and Safety.\nSGFD Policy Manual:\n103.00 Policy Development and Revision\n104.00 Chain of Command & Officer Responsibilities\n205.00 Employee Performance Expectations\n406.00 Emergency Scene Safety\n408.00 Rehabilitation Operations\n900.00 Policy Review & Records Management\nISO / PIAL Credit: Administrative and Safety Policy Compliance Documentation.\nEvaluation Scheduling (No Overtime)\nConduct during standard administrative hours or policy review meetings.\nEvaluator (Assistant Chief of Training or Chief of Administration) reviews submissions on duty.\nFeedback and scoring during next staff meeting.\nOutcome\nSuccessful completion demonstrates that the Battalion Chief:\nCan independently draft and revise SGFD policies to meet national standards.\nUnderstands the administrative routing, revision control, and publication process.\nCommunicates procedural changes effectively across the organization.\nEnsures SGFD policy framework remains NFPA-, ISO-, and Civil Service-compliant."
},
{
"key": "G",
"title": "NERIS Oversight & Data Quality",
"weight": 10,
"quarter": 3,
"competency": "Report oversight",
"elements": [
{
"label": "Accuracy of Audit Sampling Method",
"mult": 1
},
{
"label": "Identification & Correction of Errors",
"mult": 1
},
{
"label": "Application of Policies (104, 205, 301, 902)",
"mult": 1
},
{
"label": "Quality of Summary Memo & Recommendations",
"mult": 1
},
{
"label": "Initiative in Training & Follow-Up",
"mult": 1
}
],
"guide": "Module F– NERIS Oversight & Data Quality\nPurpose\nTo evaluate the Battalion Chief’s ability to audit, correct, and ensure the accuracy of emergency-response data entered into the National Emergency Response Information System (NERIS), verify that station officers maintain compliance with SGFD reporting standards, and apply administrative accountability in line with departmental policy and NFPA 1221/950 requirements.\nScenario Overview\nScenario Title:\n“Data Integrity Audit – Quarter 3 NERIS Compliance”\nScenario Conditions:\nThe Assistant Chief of Administration has directed each Battalion Chief to perform a quarterly quality-control audit of NERIS entries for their assigned stations.\nDuring the July 1 – September 30 period, District 5 produced 214 incidents.\nThe Training & Analytics Division notes:\nCategory | Acceptable Standard | District 5 Result | Comment\nNERIS Incident Completion Rate | 100 % | 93 % | 15 missing incident closures\nNarrative Accuracy (checklist) | ≥ 95 % | 88 % | Missing arrival & actions details\nProperty Use & Action Codes | ≥ 98 % | 91 % | Several obsolete NFIRS codes used\nMutual-Aid Documentation | 100 % | 80 % | Two incidents lacking aid received/sent\nApparatus Run Time Consistency | ≤ 2 min variance | Up to 6 min | CAD times not synced with reports\nYou must perform an on-duty audit, correct deficiencies, identify officer training needs, and report findings to the Assistant Chief of Administration.\nApplicable SGFD Policies\n• 200.5 – Chain of Command\n• 1054 – Discipline Policy and Guidelines\n• 1105 – Records Management and Retention\n• 1110 – Information Technology and Data Integrity\n• (Optional) 301.00 – Training Records and Documentation (if still used for NERIS report timelines)\nOfficer Tasks / Decision Points\nData Sampling & Verification\nPull 10 % random sample (≈ 20 incidents).\nCheck for completeness, accuracy of property use/action codes, and proper narrative formatting.\nError Categorization & Correction\nClassify errors (narrative omission, code error, timing discrepancy).\nCoordinate corrections with company officers; document who made each fix.\nTraining Need Analysis\nIdentify patterns of officer misunderstanding.\nDevelop a 30-minute refresher outline for NERIS entry accuracy.\nReport Development\nPrepare a District 5 NERIS Audit Summary Memo including:\nStatistical results and compliance rate.\nTop 3 error types.\nRecommended corrective actions.\nTraining plan and follow-up date.\nDocumentation & Submission\nAttach: sample audit log, error matrix, and corrected reports summary.\nSubmit electronically to Assistant Chief of Administration and Chief of Training.\nEvaluator Observations\nPerformance Element | Max Pts (0–5) | Comments\nAccuracy of Audit Sampling Method | 5 |\nIdentification & Correction of Errors | 5 |\nApplication of Policies (104, 205, 301, 902) | 5 |\nQuality of Summary Memo & Recommendations | 5 |\nInitiative in Training & Follow-Up | 5 |\nTotal (25 pts) |\nEvaluator Discussion Prompts\nHow did you select your audit sample and ensure objectivity?\nWhich NERIS fields caused the most recurring errors?\nHow will you verify that corrections were made?\nWhat documentation do you retain per Policy 900.00?\nHow can improved NERIS accuracy influence ISO/PIAL scoring?\nExpected Battalion Chief Behaviors (High-Scoring Examples)\nUses systematic random-sampling method; calculates compliance percentages.\nCoordinates corrections without assigning blame, maintaining professionalism.\nReferences specific SGFD policy sections in correspondence.\nSubmits polished memo with graphs or tables summarizing results.\nDevelop short, actionable refresher training for company officers.\nFiles audit materials properly for future ISO review.\nDeliverables (Candidate)\nSubmit within 10 calendar days of assignment:\nDistrict 5 NERIS Audit Summary Memo (1–2 pages)\nError Tracking Worksheet (Excel or PDF)\nCorrected Incident List & Officer Training Plan\nSupporting Attachments (e.g., screen captures or NERIS audit log)\nUpload to:\nAbsorb\nTraining Objective Reference\nNFPA 1021 (2020 Ed.) 5.4.6 – Evaluate and report departmental performance data.\nNFPA 950/951 – Data Exchange and Information Management Standards.\nNFPA 1221 (2022 Ed.) – Data Accuracy for Dispatch and Incident Records.\nSGFD Policy Manual:\n104.00 Chain of Command & Officer Responsibilities\n205.00 Employee Performance Expectations\n301.00 Training Records & Documentation\n902.00 Information Management & Data Integrity\n900.00 Policy Review & Records Management\nISO / PIAL Credit: Administrative Documentation & Data Quality Verification."
},
{
"key": "H",
"title": "Strategic Planning & Presentation",
"weight": 10,
"quarter": 4,
"competency": "Strategic planning",
"elements": [
{
"label": "Alignment with SGFD Mission & Policies",
"mult": 1
},
{
"label": "Clarity of Goals and Measurable Outcomes",
"mult": 1
},
{
"label": "Fiscal Realism & Integration with Policy 503/506",
"mult": 1
},
{
"label": "Quality of Written Plan & Professional Formatting",
"mult": 1
},
{
"label": "Presentation Delivery & Executive Communication",
"mult": 1
}
],
"guide": "Module G – Strategic Planning & Presentation\nPurpose\nTo evaluate the Battalion Chief’s ability to develop a multi-year strategic or capital improvement plan that aligns with SGFD’s mission, policies, and fiscal constraints, and to communicate that plan clearly to executive leadership in both written and oral formats.\nScenario Overview\nScenario Title:\n“Three-Year Strategic Plan – SG7 Readiness and Expansion”\nScenario Conditions:\nThe Fire Chief has directed each Battalion Chief to produce a 3-year strategic plan (FY 2026–FY 2028) outlining district priorities for:\nStaffing & professional development\nApparatus and equipment replacement\nStation maintenance or expansion\nCommunity risk-reduction and outreach initiatives\nTraining and certification improvements\nYou must prepare a comprehensive written plan and 10-minute executive presentation for the Command Staff meeting.\nApplicable SGFD Policies\n• 200.5 – Chain of Command\n• 1054 – Discipline Policy and Guidelines\n• 1100 – Budget Development and Fiscal Control\n• 1115 – Capital Improvement Planning and Procurement\n• 1200 – Strategic Planning and Program Evaluation\n• 1105 – Records Management and Retention\nOfficer Tasks / Decision Points\nNeeds Assessment\nReview district response trends, staffing, training, and apparatus maintenance.\nUse NERIS and FireWorks data to identify coverage or performance gaps.\nGoal Development (3-Year Horizon)\nDefine three primary goals and two supporting objectives per goal.\nExamples: “Reduce response times by 10 %,” “Replace Engine 63,” “Certify 100 % officers to Fire Officer III.”\nResource & Budget Integration\nEstimate costs using FY 2026 baseline budget (Policy 503.00).\nIdentify funding pathways (grants, capital improvement plan, internal reallocation).\nImplementation Plan\nCreate a timeline or Gantt chart showing milestones and responsible parties.\nInclude performance indicators (KPIs) for evaluation.\nPresentation Development\nPrepare a PowerPoint or PDF with the following sections:\nExecutive Summary\nCurrent State Analysis\nStrategic Goals\nFinancial Impact\nImplementation Roadmap\nClosing & Discussion Points\nFormal Presentation & Submission\nDeliver 10-minute presentation at Command Staff.\nSubmit written plan and digital presentation file within 48 hours.\nEvaluator Observations\nPerformance Element | Max Pts (0–5) | Comments\nAlignment with SGFD Mission & Policies | 5 |\nClarity of Goals and Measurable Outcomes | 5 |\nFiscal Realism & Integration with Policy 503/506 | 5 |\nQuality of Written Plan & Professional Formatting | 5 |\nPresentation Delivery & Executive Communication | 5 |\nTotal (25 pts) |\nEvaluator Discussion Prompts\nWhat data informed your district priorities?\nHow does your plan support SGFD’s 5-Year Organizational Strategy?\nWhich initiatives can be achieved with existing funding versus new allocations?\nHow will progress be measured and reported annually?\nWhat challenges or resistance do you anticipate, and how will you mitigate them?\nExpected Battalion Chief Behaviors (High-Scoring Examples)\nDemonstrates analytical use of NERIS, training, and budget data.\nSets achievable, time-bound, measurable goals tied to SGFD’s mission.\nIncorporates policy, fiscal, and staffing considerations holistically.\nCommunicates confidently and concisely to command staff.\nSubmits a polished, professional written plan and slide deck.\nDeliverables (Candidate)\nSubmit within 14 calendar days of assignment:\nSG7’s Strategic Plan (3 Years) – 5-7 pages max.\nPresentation Slides (PowerPoint or PDF, 10 min runtime).\nSupporting Data Appendix (run data, budget projections, training stats).\nEmail Summary to Assistant Chief of Operations and Chief of Training.\nUpload to: Absorb\nTraining Objective Reference\nNFPA 1021 (2020 Ed.) 5.4.2 – Develop long-range plans for the organization.\nNFPA 1201 (2020 Ed.) – Standard for Providing Fire and Emergency Services to the Public.\nSGFD Policy Manual:\n• 200.5 – Chain of Command\n• 1054 – Discipline Policy and Guidelines\n• 1100 – Budget Development and Fiscal Control\n• 1115 – Capital Improvement Planning and Procurement\n• 1200 – Strategic Planning and Program Evaluation\n• 1105 – Records Management and Retention\nISO / PIAL Credit: Administrative and Planning Documentation (Training & Capital Sections).\nEvaluation Scheduling (No Overtime)\nConduct during normal administrative week.\nEvaluator (Assistant Chief or Fire Chief) observes presentation during Command Staff Meeting.\nWritten plan reviewed on duty; feedback documented within 72 hours."
},
{
"key": "I",
"title": "Professionalism & Command Readiness",
"weight": 10,
"quarter": 4,
"competency": "Professionalism",
"elements": [
{
"label": "Ethical Judgment & Policy Application",
"mult": 1
},
{
"label": "Professional Composure Under Stress",
"mult": 1
},
{
"label": "Accuracy & Tone of Written Communication",
"mult": 1
},
{
"label": "Correct Handling of Personnel Accountability",
"mult": 1
},
{
"label": "Leadership & Mentorship Effectiveness",
"mult": 1
}
],
"guide": "Module H – Professionalism & Command Readiness\nPurpose\nTo evaluate the Battalion Chief’s demonstration of professional integrity, ethical decision-making, leadership composure, and readiness to represent the St. George Fire Protection District (SGFD) in all internal and external capacities.\nThis module emphasizes leadership presence, ethical accountability, and organizational stewardship throughout the 1-year working test period.\nScenario Overview\nScenario Title:\n“Professional Conduct Under Pressure – Command Decision Evaluation”\nScenario Conditions:\nDuring a multiple-alarm commercial fire, the Battalion Chief (you) observes a Captain on scene making unapproved tactical decisions and providing conflicting radio traffic to dispatch.\nSimultaneously, a council member observing from the perimeter begins filming the incident and publicly questions SGFD’s response on social media, tagging the department and the Fire Chief.\nAfter the incident, the Fire Chief instructs you to:\nEvaluate the officer’s performance,\nAddress the communication breakdown, and\nPrepare a written response plan for public and internal accountability.\nYour approach will demonstrate leadership, ethics, composure, and communication discipline under scrutiny.\nApplicable SGFD Policies\n• 200.5 – Chain of Command\n• 1002 – Code of Conduct and Ethics\n• 1054 – Discipline Policy and Guidelines\n• 1052 – Leave Policy (Attendance & Reliability)\n• 400.1 – Incident Command System: General Command Procedures\n• 1110 – Information Technology and Data Integrity\nOfficer Tasks / Decision Points\nIncident Debrief & Personnel Evaluation\nConduct an after-action review with the Captain involved.\nEvaluate behavior, decision-making, and communication per Policy 105.00.\nDocument findings using the SGFD Performance Counseling Form.\nPublic Accountability Response\nDraft a Professional Conduct Summary Memo to the Fire Chief explaining:\nWhat occurred,\nActions taken with the officer, and\nA plan for communication discipline going forward.\nCoordinate with the Public Information Officer (PIO) to ensure consistent messaging under Policy 902.00.\nEthical Decision-Making Evaluation\nIdentify the ethical obligations of command in this situation (truthfulness, fairness, integrity, loyalty, respect).\nExplain what you would do if a command-level peer had acted inappropriately.\nLeadership & Mentorship Follow-Up\nMeet privately with the Captain to coach professional communication expectations.\nDocument follow-up per Policy 104.00 and retain records under Policy 900.00.\nEvaluator Observations\nPerformance Element | Max Pts (0–5) | Comments\nEthical Judgment & Policy Application | 5 |\nProfessional Composure Under Stress | 5 |\nAccuracy & Tone of Written Communication | 5 |\nCorrect Handling of Personnel Accountability | 5 |\nLeadership & Mentorship Effectiveness | 5 |\nTotal (25 pts) |\nEvaluator Discussion Prompts\nHow did you balance public perception with internal accountability?\nWhich SGFD policies guided your actions most directly?\nHow would you respond if the captain challenged your authority publicly?\nWhat steps ensure the department’s reputation remains intact during public scrutiny?\nHow do you mentor subordinate officers to maintain professionalism during high-visibility incidents?\nExpected Battalion Chief Behaviors (High-Scoring Examples)\nApplies SGFD Code of Conduct (Policy 105.00) consistently and impartially.\nMaintains composure and focus despite external pressure or criticism.\nCommunicates respectfully and transparently through proper channels.\nDocuments counseling and follow-up per Civil Service and SGFD standards.\nServes as a role model in ethical leadership and personal accountability.\nDeliverables (Candidate)\nSubmit within 72 hours of scenario completion:\nProfessional Conduct Summary Memo (1 page).\nCompleted Counseling Form for the officer involved.\nEthical Decision-Making Reflection (300–500 words).\nFollow-Up Mentorship Plan (short outline or checklist).\nUpload to: Absorb\nTraining Objective Reference\nNFPA 1021 (2020 Ed.) 5.4.7 – Demonstrate ethical conduct and leadership integrity.\nNFPA 1021 (2020 Ed.) 5.2.4 – Manage personnel and administrative functions.\nSGFD Policy Manual:\n• 200.5 – Chain of Command\n• 1002 – Code of Conduct and Ethics\n• 1054 – Discipline Policy and Guidelines\n• 1052 – Leave Policy (Attendance & Reliability)\n• 400.1 – Incident Command System: General Command Procedures\n• 1110 – Information Technology and Data Integrity\nCivil Service Rule XIII – Working Test Period Evaluation."
}
]
}
},
{
"key": "bc-matrix",
"name": "Battalion Chief – Evaluation Matrix",
"rank": "Battalion Chief",
"kind": "form",
"sort": 41,
"description": "Battalion matrix scored 1–5 with multipliers (155 points).",
"data": {
"scale": {
"min": 1,
"max": 5
},
"passComposite": 70,
"passModule": 0,
"points": true,
"bands": [
[
90,
"Outstanding"
],
[
80,
"Proficient"
],
[
70,
"Meets Expectations"
],
[
60,
"Needs Improvement"
],
[
0,
"Unsatisfactory"
]
],
"signatures": [
"Evaluator",
"Assistant Chief",
"Fire Chief"
],
"overview": "Creates permanent Civil Service documentation and ISO/PIAL value.\nSt. George Fire Protection District – Battalion Chief Evaluation Matrix\nEvaluation Period: 12-Month Working Test / Assessment Year\nEvaluator: ____________________  Candidate: ____________________\nBattalion Assignment: SG6 ☐ SG7 ☐ Date: ____________________\nEvaluation Overview\nThis evaluation measures the Battalion Chief’s ability to manage multi-company operations, enforce policy compliance, mentor Captains, and maintain readiness throughout the battalion.\nScoring is consistent with the SGFD Assistant Chief matrix for seamless progression.\nScore | Descriptor | Definition\n5 | Exceptional | Performs above expectations; ready for higher-level command.\n4 | Proficient | Fully competent and consistent performance.\n3 | Developing | Meets minimum standard; needs refinement in one or more areas.\n2 | Deficient | Below expected performance; requires coaching and correction.\n1 | Unacceptable | Fails to meet expectations; unsuitable for continued assignment.",
"modules": [
{
"key": "A",
"title": "Tactical Command & Multi-Company Operations",
"weight": 35,
"quarter": null,
"competency": "Tactical Command & Multi-Company Operations",
"elements": [
{
"label": "Initial Size-Up & Risk Assessment",
"mult": 2
},
{
"label": "Tactical Plan Development & Implementation",
"mult": 2
},
{
"label": "Communication with IC / Dispatch",
"mult": 1
},
{
"label": "Safety & Accountability Management",
"mult": 1
},
{
"label": "Transition to Command Support (AC arrival)",
"mult": 1
}
],
"guide": "Module A – Tactical Command & Multi-Company Operations\nScenario: First-arriving BC on a working structure fire, major vehicle accident, or special operation.\nMust demonstrate command presence, tactical decision-making, and coordination with the IC or AC.\nEvaluation Element | Weight | Score (0–5) | Weighted\nInitial Size-Up & Risk Assessment | ×2 |\nTactical Plan Development & Implementation | ×2 |\nCommunication with IC / Dispatch | ×1 |\nSafety & Accountability Management | ×1 |\nTransition to Command Support (AC arrival) | ×1 |\nModule A Total (Max 35) |"
},
{
"key": "B",
"title": "Shift Management & Staffing",
"weight": 30,
"quarter": null,
"competency": "Shift Management & Staffing",
"elements": [
{
"label": "Awareness of Staffing & Resource Readiness",
"mult": 2
},
{
"label": "Application of staffing policies (1004, 1005, 1052, 200.5)",
"mult": 1
},
{
"label": "Decision-Making on Training vs. Coverage",
"mult": 1
},
{
"label": "Communication & Coordination with AC / Captains",
"mult": 1
},
{
"label": "Documentation Accuracy & Timeliness",
"mult": 1
}
],
"guide": "Module B – Shift Management & Staffing\nScenario: Routine shift operations — managing vacancies, move-ups, maintenance, and company distribution.\nEvaluation Element | Weight | Score | Weighted\nAwareness of Staffing & Resource Readiness | ×2 |\nApplicable SGFD Policies: / • 1004 – Work Schedules and Shift Staffing / • 1005 – Call-Back and Overtime Procedures / • 1052 – Leave Policy (Attendance and Modified Sick Leave) / • 200.5 – Chain of Command | ×1 |\nDecision-Making on Training vs. Coverage | ×1 |\nCommunication & Coordination with AC / Captains | ×1 |\nDocumentation Accuracy & Timeliness | ×1 |\nModule B Total (Max 30) |"
},
{
"key": "C",
"title": "Company Oversight & Policy Compliance",
"weight": 30,
"quarter": null,
"competency": "Company Oversight & Policy Compliance",
"elements": [
{
"label": "Quality of Company Report Review / QC",
"mult": 2
},
{
"label": "Enforcement of SGFD Policies: 200.5 Chain of Command / 1020 Grievance Procedure, 1052 Leave Policy (Attendance and Modified Sick Leave), 1054 Discipline Policy and Guidelines",
"mult": 1
},
{
"label": "Training & Drill Hour Verification",
"mult": 1
},
{
"label": "PPE / Apparatus / Station Readiness Inspections",
"mult": 1
},
{
"label": "Follow-Up & Corrective Documentation",
"mult": 1
}
],
"guide": "Module C – Company Oversight & Policy Compliance\nScenario: Routine station audits, company training verification, and FireWorks / NERIS review.\nEvaluation Element | Weight | Score | Weighted\nQuality of Company Report Review / QC | ×2 |\nEnforcement of SGFD Policies: 200.5 Chain of Command / 1020 Grievance Procedure, 1052 Leave Policy (Attendance and Modified Sick Leave), 1054 Discipline Policy and Guidelines | ×1 |\nTraining & Drill Hour Verification | ×1 |\nPPE / Apparatus / Station Readiness Inspections | ×1 |\nFollow-Up & Corrective Documentation | ×1 |\nModule C Total (Max 30) |"
},
{
"key": "D",
"title": "Personnel & Leadership Management",
"weight": 30,
"quarter": null,
"competency": "Personnel & Leadership Management",
"elements": [
{
"label": "Coaching & Mentorship of Company Officers",
"mult": 2
},
{
"label": "Consistency in Discipline & Documentation",
"mult": 1
},
{
"label": "Conflict Resolution / Professional Conduct",
"mult": 1
},
{
"label": "Morale & Team Cohesion within Battalion",
"mult": 1
},
{
"label": "Communication Up & Down Chain of Command",
"mult": 1
}
],
"guide": "Module D – Personnel & Leadership Management\nScenario: Managing Captains, resolving personnel conflicts, and enforcing expectations.\nEvaluation Element | Weight | Score | Weighted\nCoaching & Mentorship of Company Officers | ×2 |\nConsistency in Discipline & Documentation | ×1 |\nConflict Resolution / Professional Conduct | ×1 |\nMorale & Team Cohesion within Battalion | ×1 |\nCommunication Up & Down Chain of Command | ×1 |\nModule D Total (Max 30) |"
},
{
"key": "E",
"title": "Strategic Support & Inter-Division Coordination",
"weight": 30,
"quarter": null,
"competency": "Strategic Support & Inter-Division Coordination",
"elements": [
{
"label": "Collaboration with AC, Special Operation, & Training",
"mult": 2
},
{
"label": "Readiness for Extended or Complex Incidents",
"mult": 1
},
{
"label": "Policy Compliance During Multi-Agency Operations",
"mult": 1
},
{
"label": "Quality of Strategic Feedback to AC",
"mult": 1
},
{
"label": "Professionalism & Executive Presence",
"mult": 1
}
],
"guide": "Module E – Strategic Support & Inter-Division Coordination\nScenario: Participating in large-scale or multi-division operations or supporting AC/Deputy Chiefs with planning and readiness.\nEvaluation Element | Weight | Score | Weighted\nCollaboration with AC, Special Operation, & Training | ×2 |\nReadiness for Extended or Complex Incidents | ×1 |\nPolicy Compliance During Multi-Agency Operations | ×1 |\nQuality of Strategic Feedback to AC | ×1 |\nProfessionalism & Executive Presence | ×1 |\nModule E Total (Max 30) |"
}
]
}
},
{
"key": "dc-wtp",
"name": "Deputy Chief – Working Test Period",
"rank": "Deputy Chief",
"kind": "wtp",
"sort": 60,
"description": "12-month Working Test Period for Deputy Chiefs: five categories, each factor scored 1–5. Final average of 80% or more required.",
"data": {
"scale": {
"min": 1,
"max": 5
},
"passComposite": 80,
"passModule": 0,
"months": 12,
"reviews": [
1,
3,
6,
9,
12
],
"evaluators": "Fire Chief, peer chiefs; final review by the Fire Chief / Board.",
"signatures": [
"Fire Chief"
],
"outcomes": [
"Recommendation for Permanent Appointment",
"Recommendation Extension / Development Plan",
"Do Not Recommend Appointment"
],
"requirements": [
[
"Leadership Development",
"Attend one executive leadership or ICS course (NFA, FETA, LAFC or equivalent)."
],
[
"Policy / SOP Contribution",
"Draft or revise one departmental policy related to their division(s)."
],
[
"Budget / Fiscal Project",
"Prepare annual budget or special project justification."
],
[
"Operational Exercise",
"Lead one multi-division exercise or after-action review."
],
[
"Performance Presentation",
"Deliver end-of-year presentation summarizing division(s) performance metrics."
]
],
"overview": "Deputy Chief Working Test Evaluation\nSt. George Fire Protection District\n1. Purpose and Scope\nThis evaluation process ensures that Deputy Chiefs demonstrate the professional, operational, and executive competencies required to serve as senior leaders of the St. George Fire Protection District (SGFD).\nThe evaluation measures performance over the 12-month working test period as defined by Louisiana State Civil Service Law (Title 11). It aligns with NFPA 1021 Fire Officer IV, NFPA 1561.\nThe purpose is not just to grade, but to mentor, measure readiness, and document performance for Civil Service certification and succession planning.\n2. Evaluation Structure\nEvaluation Phase | Timeline | Evaluator(s) | Purpose\nOrientation & Goal Setting | Month 1 | Fire Chief | Define role expectations, objectives, and project assignments.\nQuarterly Evaluations (Q1–Q3) | Months 3, 6, 9 | Fire Chief / Peer Chiefs | Document progress, leadership effectiveness, and division performance.\nFinal Comprehensive Evaluation | Month 12 | Fire Chief / Board Review | Summative assessment based on matrix, deliverables, and leadership outcomes.\nScoring Reference:\nEach competency in the evaluation matrix is scored 1–5.\nEach module (A–E) is weighted based on its strategic importance.\nFinal average ≥80% is required for successful completion of the working test year.\n3. Performance Evidence and Deliverables\nDeputy Chiefs must produce documented evidence demonstrating mastery of key areas. Evaluators will assess both outcomes and leadership behaviors.\nCategory | Evidence Examples | Evaluation Considerations\nStrategic Leadership & Planning | Division goals, annual plan, executive summaries | Alignment with SGFD mission and Fire Chief’s strategic directives.\nOperational Readiness | Readiness reports, resource plans, after-action reviews | Coordination and sustainability of district operations.\nCompliance & Documentation | ISO data, NFPA audit checklists, SOP updates | Accuracy, timeliness, and policy adherence.\nFiscal & Resource Management | Budget proposals, cost analysis, procurement documentation | Fiscal responsibility and justification quality.\nPersonnel & Leadership | Coaching records, training plans, promotion documentation | Leadership consistency and morale impact.\nCommunity & Interagency Relations | Meeting summaries, OEM coordination, public statements | Professionalism, collaboration, and transparency.\nInnovation & Data Use | Performance dashboards, data reports, process improvements | Initiative and strategic use of technology and analytics.\n4. Performance Standards\nRating | Descriptor | Performance Expectation\n5 – Exceptional | Exceeds expectations in multiple areas; serves as model for SGFD leadership; innovative and proactive. |\n4 – Proficient | Fully meets expectations; division performs at high level with consistent compliance and initiative. |\n3 – Developing | Meets core requirements but requires continued improvement in one or more key areas. |\n2 – Deficient | Below standard; requires written performance plan and follow-up evaluation within 60 days. |\n1 – Unacceptable | Fails to meet expectations or exhibits significant deficiencies in leadership, compliance, or conduct. |\n5. Evaluator Guidance\nA. Evaluation Approach\nUse observable evidence — not impressions — when rating.\nReference specific deliverables (plans, reports, audits, communications).\nConsider the complexity of assignments and external constraints.\nEvaluate both results and behaviors (e.g., fairness, decision quality, professionalism).\nIncorporate input from Assistant Chiefs, peers, and subordinate officers when applicable.\nB. Quarterly Review Requirements\nEach quarterly review should include:\nOne paragraph summarizing performance\nNotable achievements and deficiencies\nSpecific development goals for next quarter\nSignature of evaluator and Deputy Chief\n6. Professional Development Expectations\nDuring their working test year, each Deputy Chief shall complete or demonstrate:\nArea | Requirement | Verification\nLeadership Development | Attend one executive leadership or ICS course (NFA, FETA, LAFC or equivalent). | Certificate copy filed.\nPolicy / SOP Contribution | Draft or revise one departmental policy related to their division(s). | Submitted draft to Fire Chief.\nBudget / Fiscal Project | Prepare annual budget or special project justification. | Budget submission review.\nOperational Exercise | Lead one multi-division exercise or after-action review. | AAR on file.\nPerformance Presentation | Deliver end-of-year presentation summarizing division(s) performance metrics. | Presentation copy filed.\n7. Remediation and Development Plan\nIf deficiencies are noted during quarterly evaluations:\nA Performance Improvement Plan (PIP) will be issued within 10 business days.\nThe Deputy Chief will be given 30–60 days to address deficiencies.\nThe Fire Chief will conduct a follow-up assessment and document progress.\nRepeated deficiencies may extend the working test period per Civil Service Rule 9.1.\n8. Final Evaluation and Certification\nAt the end of the 12-month working test year:\nThe Fire Chief will conduct a final interview and review of all documentation.\nThe evaluation matrix will be completed and scored.\nA Final Recommendation Summary will be signed and forwarded to Civil Service.\nFinal Recommendation | Description | Signature\nRecommendation for Permanent Appointment | Candidate has demonstrated consistent, effective leadership at or above expected level. |\nRecommendation Extension / Development Plan | Candidate has potential but requires improvement in one or more areas. |\nDo Not Recommend Appointment | Candidate failed to meet performance or conduct standards. |\n9. Record Retention\nAll evaluation documents, evidence, and related communications will be stored in the SGFD HR and Civil Service Personnel File under: J-Drive - Certifications Folder\nRetention period: 5 years minimum, per SGFD Policy 900 (Records Management).\n10. Integration with SGFD Leadership System\nThis evaluation ties directly into SGFD’s leadership continuum:\nRank | Evaluation Focus | Next-Level Readiness\nCompany Officer (Lt./Capt.) | Tactical & administrative leadership | Battalion Chief\nBattalion Chief | Operational command & multi-company leadership | Assistant Chief\nAssistant Chief | Shift management & district coordination | Deputy Chief\nDeputy Chief | Executive leadership & strategic oversight | Fire Chief",
"modules": [
{
"key": "1",
"title": "Strategic Leadership & Organizational Alignment",
"weight": 20,
"quarter": null,
"competency": "Strategic leadership",
"elements": [
{
"label": "Strategic goals: developed, communicated and executed",
"mult": 2
},
{
"label": "Alignment with SGFD objectives and the Fire Chief's direction",
"mult": 1
},
{
"label": "Anticipation of challenges & proactive solutions",
"mult": 1
},
{
"label": "Leadership through influence",
"mult": 1
},
{
"label": "Senior advisor role & representation of SGFD",
"mult": 1
}
],
"guide": "Category 1: Strategic Leadership & Organizational Alignment\nDefinition / Purpose\nEvaluates the Deputy Chief’s ability to lead assigned divisions and major programs in alignment with the SGFD mission, values, and long-term strategic objectives.\nFocus is placed on foresight, planning, initiative, and leadership consistency across the organization.\nScenario Title\n“Organizational Drift – Re-Aligning Division Priorities to Executive Direction”\nScenario Conditions\nIt is February 1, 2026, six months into SGFD’s Strategic Plan 2025-2028. Each Deputy Chief has submitted their division’s first semi-annual progress report. The Fire Chief notes widening gaps between intended outcomes and actual progress:\nDivision | Intended Goal (per Strategic Plan) | Current Performance | Concern\nOperations | Implement 100 % Blue Card certification by end of 2025 | 72 % certified / inconsistent enforcement | Focus drift due to staffing shortages\nTraining | Deliver 192 hrs annual company-level training per PIAL | 64 % completion / data inaccuracies in NERIS | Record verification and accountability issues\nAdministration | Roll out new performance evaluation system | Pilot stalled after grievances on scoring fairness | Policy clarity & communications gaps\nSpecial Services | Complete Station 66 renovation / RFP for 67 | Design delayed; procurement bottleneck | Lack of coordination between divisions\nMorale surveys indicate confusion among Battalion Chiefs about departmental priorities and who has authority for overlapping initiatives.\nThe Fire Chief directs you (as Deputy Chief of Administration) to:\nConduct a root-cause analysis of the misalignment.\nFacilitate an inter-division leadership session to realign goals.\nSubmit a written Strategic Alignment Plan with corrective actions, measurable outcomes, and communication strategies.\nKey Performance Behaviors\nThe Deputy Chief:\nDevelops, communicates, and executes clear strategic goals for assigned divisions.\nAligns programs and policies with SGFD’s long-term objectives and Fire Chief’s direction.\nAnticipates emerging challenges and recommends proactive solutions.\nLeads through influence, not authority—encouraging innovation and ownership among subordinate chiefs.\nDemonstrates a comprehensive understanding of SGFD’s operational capabilities, limitations, and priorities.\nActs as a senior advisor to the Fire Chief during executive planning sessions.\nRepresents SGFD with professionalism at internal and external meetings.\nEvaluation Indicators\nEvidence that demonstrates performance includes:\nDivision(s) annual goals, reports, or planning documents.\nImplementation of new programs or policy updates.\nQuality of communication and coordination with other Deputy and Assistant Chiefs.\nDocumentation of decisions and follow-up on strategic initiatives.\nFeedback from subordinates and peers regarding leadership clarity and consistency.\nRating Guidance\nRating | Descriptor | Behavioral Indicators\n5 – Exceptional | Demonstrates visionary leadership; initiatives show measurable improvement in district efficiency or readiness; actively mentors’ other leaders in strategic thinking. |\n4 – Proficient | Consistently aligns divisional goals with SGFD objectives; maintains clear communication with Fire Chief; effectively anticipates and mitigates issues. |\n3 – Developing | Meets expectations; goals are defined and generally aligned, but execution or communication needs refinement. |\n2 – Deficient | Strategic goals are unclear or reactive; fails to coordinate plans effectively with executive staff; limited initiative. |\n1 – Unacceptable | Demonstrates poor leadership judgment; decisions conflict with department objectives or create operational risk. |",
"note": "Category 1 has no factor table in the document; these factors were written from its Key Performance Behaviors. Edit them in Programs."
},
{
"key": "2",
"title": "Operational Readiness & Inter-Divisional Coordination",
"weight": 20,
"quarter": null,
"competency": "Operational readiness",
"elements": [
{
"label": "Situational Awareness & Forecasting",
"mult": 2
},
{
"label": "Inter-Divisional Communication",
"mult": 1
},
{
"label": "Decision-Making Under Stress",
"mult": 1
},
{
"label": "Documentation & Reporting",
"mult": 1
},
{
"label": "Executive Presence & Command Confidence",
"mult": 1
}
],
"guide": "Category 2: Operational Readiness & Inter-Divisional Coordination\nDefinition / Purpose\nEvaluates the Deputy Chief’s ability to ensure SGFD-wide readiness and sustain operations when multiple divisions must function together under stress.\nFocus is placed on leadership presence, coordination, resource prioritization, and maintenance of district-wide coverage during large or prolonged incidents.\nKey Performance Behaviors\nThe Deputy Chief:\nMaintains proactive awareness of conditions impacting staffing, weather, and district response capability.\nCoordinates between Suppression (SG6/SG7), Special Operations (SG82), Training, EMS, and Administration to ensure unity of effort.\nCommunicates clearly, assigns priorities, and delegates authority effectively.\nImmediate Balances support with maintaining district coverage.\nKeeps accurate situational awareness and documentation for the Fire Chief and Parish EOC.\nDemonstrates composure, leadership, and cross-divisional respect.\nScenario – “Powerless District”\nSituation\nA severe frontal storm has moved through the parish overnight, producing widespread power outages and communications disruptions across portions of the SGFD district.\nHere’s the operational picture at 0600 hrs:\nStations 62 and 64 operate on generator power; Station 61 has no power and intermittent radio connectivity.\nDispatch CAD is offline; companies are using portable radios and paper run logs.\nAT&T cell service is degraded in the southern portion of the district.\nSpecial Operations (SG82) has been activated for a structure collapse in a neighboring jurisdiction and is short on available rescue personnel.\nEMS Division has requested suppression crews to assist with calls due to increased medical volume.\nTraining Division reports three instructors and one reserve pumper available to assist if reassigned.\nThe Fire Chief is at the EBR Parish Emergency Operations Center managing regional coordination.\nYou are the Deputy Chief of Operations, functioning as the District Executive Coordinator for the next 8-hour operational period.\nYour Responsibilities\nEstablish Unified Coordination\nConvene a conference call or in-person command briefing with SG6, SG7, SG82, Training, and EMS leaders.\nAssign an Incident Liaison Officer (ILO) to coordinate with the EOC through the Fire Chief.\nRestore District Awareness\nIdentify current coverage gaps, equipment limitations, and communication outages.\nDevelop a District Status Snapshot using available resources.\nResource Allocation\nPrioritize apparatus and personnel coverage, ensuring the ability to handle simultaneous structure fires and rescues.\nDecide which administrative or training personnel can be temporarily reassigned to operations support.\nContinuity and Documentation\nPrepare an Operational Situation Report (OSR) within 90 minutes including:\nCurrent status of stations, communications, and coverage\nPersonnel availability and critical needs\nActions taken and resource reassignments\nAnticipated issues for next 6 hours\nEvaluator Focus Points\nCoordination: Did the Deputy Chief effectively unify all divisions and communicate priorities clearly?\nDecision Quality: Were resource reallocations logical and risk-balanced?\nSituational Awareness: Did they maintain a clear operational picture despite limited information?\nDocumentation: Was the OSR concise, accurate, and actionable?\nLeadership Presence: Did they maintain confidence and control throughout the event?\nExpected Deliverables\nOperational Situation Report (1–2 pages) – summarizing status, resource allocations, and objectives.\nVerbal After-Action Summary (10 minutes) – debriefing the Fire Chief and other Deputy Chiefs once normal operations resume.\nEvaluator Scoring Emphasis\nFactor | Weight | Focus\nSituational Awareness & Forecasting | ×2 | Rapid identification of operational weaknesses.\nInter-Divisional Communication | ×1 | Coordination of all divisions with clarity and timeliness.\nDecision-Making Under Stress | ×1 | Logical and justifiable resource prioritization.\nDocumentation & Reporting | ×1 | Completeness and clarity of OSR.\nExecutive Presence & Command Confidence | ×1 | Maintains professionalism and calm authority.\nRating Guidance\nRating | Descriptor | Behavioral Indicators\n5 – Exceptional | Executes unified coordination flawlessly; anticipates cascading issues; documentation immediately useful to the EOC. |\n4 – Proficient | Maintains control and accurate reporting; strong but not seamless coordination. |\n3 – Developing | Manages event competently but reacts more than leads; communication or foresight needs polish. |\n2 – Deficient | Coordination gaps cause inefficiencies or coverage risks. |\n1 – Unacceptable | Fails to maintain situational awareness or operational control; communication breakdown. |"
},
{
"key": "3",
"title": "Policy, Compliance & Accreditation Management",
"weight": 20,
"quarter": null,
"competency": "Compliance",
"elements": [
{
"label": "Identification & Analysis of Deficiencies",
"mult": 2
},
{
"label": "Corrective Action & Documentation",
"mult": 1
},
{
"label": "Policy & Legal Compliance",
"mult": 1
},
{
"label": "Inter-Divisional Coordination",
"mult": 1
},
{
"label": "Professionalism Under Pressure",
"mult": 1
}
],
"guide": "Category 3: Policy, Compliance & Accreditation Management\nDefinition / Purpose\nEvaluates the Deputy Chief’s ability to manage departmental compliance programs, enforce policy standards, and maintain readiness for external audits (ISO/PIAL, State Fire Marshal, EMS, or Civil Service).\nFocuses on accuracy, consistency, and documentation quality across all divisions.\nKey Performance Behaviors\nThe Deputy Chief:\nMaintains comprehensive understanding of SGFD policy systems and administrative law.\nOversees internal audits for NFPA, ISO/PIAL, and accreditation metrics.\nHolds Assistant and Battalion Chiefs accountable for documentation integrity.\nCoordinates with Administration, Training, and EMS to ensure data consistency.\nDetects and corrects systemic compliance gaps before they appear in external audits.\nEnsures all reports, forms, and rosters meet Civil Service and SGFD standards.\nDemonstrates fairness, transparency, and consistency in enforcement.\nScenario – “The Data Gap”\nSituation\nTwo weeks before SGFD’s ISO reclassification review, the Fire Chief directs you — as Deputy Chief of Operations — to verify that all suppression, training, and inspection documentation is audit-ready.\nUpon review, you discover:\nCompany training records for the past quarter are incomplete — 22% of companies have not logged their hours in FireWorks.\nHydrant testing data from SG6’s district has mismatched date stamps and missing flow documentation.\nPreplan inspections from the Prevention Bureau are not linked properly to NERIS incident data.\nThe Training Division’s burn hours were entered but not validated by instructor signature (ISO point deduction risk).\nCivil Service HR files show two members acting in higher positions without signed appointment memos.\nThe ISO auditor will be onsite in five business days, and the Fire Chief is in meetings with the Parish Administrator.\nYou are tasked with ensuring that all deficiencies are identified, corrected, and documented before the audit.\nYour Responsibilities\nConduct Rapid Compliance Audit\nConvene a meeting with Training, Administration, and Prevention.\nIdentify gaps, assign corrective tasks, and create a timeline.\nVerify policies 301, 302, 304, 900, and 902 for documentation expectations.\nImplement Correction Plan\nReassign staff or adjust schedules to complete missing entries.\nCoordinate with IT or data management staff to correct FireWorks and NERIS link errors.\nEnsure appointment memos and training logs are updated and signed.\nPrepare Audit Briefing\nDevelop a Compliance Correction Summary that documents:\nEach deficiency identified\nCorrective action taken\nResponsible person\nVerification evidence (sign-off, attachments, etc.)\nDeliver briefing to the Fire Chief within 72 hours.\nEvaluator Focus Points\nAccountability: Did the Deputy Chief assign ownership and ensure follow-through?\nAccuracy: Were discrepancies correctly identified and resolved?\nDocumentation: Were corrections properly validated and archived?\nLeadership: Did they maintain professionalism and composure under audit pressure?\nCompliance Integrity: Did solutions align with SGFD policy and Civil Service law?\nExpected Deliverables\nCompliance Correction Summary (2–3 pages)\nOverview of findings, actions taken, and verification methods.\nISO/Accreditation Readiness Briefing\nShort verbal update to Fire Chief and Administrative Staff summarizing SGFD’s preparedness.\nEvaluator Scoring Emphasis\nFactor | Weight | Focus\nIdentification & Analysis of Deficiencies | ×2 | Thorough audit and accurate root cause analysis.\nCorrective Action & Documentation | ×1 | Timeliness and completeness of correction efforts.\nPolicy & Legal Compliance | ×1 | Adherence to SGFD and Civil Service standards.\nInter-Divisional Coordination | ×1 | Collaboration across divisions and Administration.\nProfessionalism Under Pressure | ×1 | Calm, detail-oriented leadership throughout process.\nRating Guidance\nRating | Descriptor | Behavioral Indicators\n5 – Exceptional | Rapid, organized compliance recovery; audit-ready documentation exceeds expectations; no ISO findings. |\n4 – Proficient | Successfully corrected deficiencies; minor administrative gaps remain. |\n3 – Developing | Completed most corrections; still reactive and dependent on others for accuracy checks. |\n2 – Deficient | Missed key deficiencies or provided incomplete documentation. |\n1 – Unacceptable | Failed to meet compliance deadlines; audit exposed uncorrected errors. |"
},
{
"key": "4",
"title": "Personnel Leadership & Organizational Culture",
"weight": 20,
"quarter": null,
"competency": "Personnel leadership",
"elements": [
{
"label": "Strategic Communication & Message Clarity",
"mult": 2
},
{
"label": "Leadership Influence & Culture Repair",
"mult": 1
},
{
"label": "Problem Analysis & Solution Development",
"mult": 1
},
{
"label": "Policy Knowledge & Organizational Loyalty",
"mult": 1
},
{
"label": "Professional Composure & Integrity",
"mult": 1
}
],
"guide": "Category 4: Personnel Leadership & Organizational Culture\nDefinition / Purpose\nEvaluates the Deputy Chief’s ability to sustain morale, trust, and alignment when policy changes originate from administration but are met with resistance in the field.\nMeasures judgment, communication skill, and the capacity to turn top-down directives into understood, supported operational change.\nKey Performance Behaviors\nThe Deputy Chief …\nTranslates executive intent into clear, meaningful context for subordinate chiefs and company officers.\nAnticipates cultural resistance and plans communication proactively.\nCoaches Assistant and Battalion Chiefs to lead through ownership, not deflection.\nMaintains unity of command and loyalty to the organization’s decisions while addressing legitimate feedback.\nDemonstrate diplomacy, empathy, and professionalism under tension.\nBalances administrative fidelity with advocacy for field perspective.\nScenario – “The Rollout Problem”\nSituation\nSGFD Administration issues a new personnel accountability policy that changes how companies log on scene and transmit PARs.\nThe intent is to align with the latest NFPA 1561 requirements and PIAL documentation standards, but the policy memo was distributed directly by Administration — without prior discussion at the Assistant or Battalion Chief level.\nWithin 48 hours:\nAssistant and Battalion Chiefs are frustrated that they “weren’t consulted.”\nSeveral officers enter stations saying:\n“Admin wants you to start doing this … I don’t agree, but it’s what they want.”\nCrews begin following the new procedure inconsistently.\nA few Captains email Training and Operations asking whether this is “temporary.”\nLine personnel view the rollout as another “disconnect from the top.”\nThe Fire Chief, preparing for a parish wide safety briefing, tells you:\n“I need this fixed before the weekend. We can’t look divided. Make sure everyone understands why this matters — and that our command staff owns it.”\nYou are the Deputy Chief of Operations tasked with stabilizing the rollout and repairing trust between Administration and field leadership.\nYour Responsibilities\nInformation Gathering & Context Validation\nMeet with the originating Administrative Section (Training / Safety / Chief of Admin) to clarify why the policy was created and what specific compliance gaps it addresses.\nIdentify messaging or rollout deficiencies (lack of explanation, missing training component, poor timing).\nLeadership Engagement\nConvene an emergency meeting with all Assistant and Battalion Chiefs.\nExplain the strategic purpose of the policy using facts — NFPA, ISO, liability, and firefighter-safety data.\nSolicit constructive input on implementation challenges and document feedback.\nCultural Repair & Ownership\nCoach subordinate chiefs on how to communicate the change to their companies:\nEliminate “us vs them” language.\nReinforce unified leadership.\nAddress concerns openly but present a consistent message.\nDevelop talking points or a short leadership memo they can read at roll call.\nStrategic Communication\nDraft an Operations Alignment Bulletin summarizing:\nPolicy purpose and benefits (“why”).\nImplementation of the timeline and expectations.\nPoints of contact for questions.\nA closing statement from the Fire Chief reaffirming leadership unity.\nFollow-Up and Feedback\nWithin two weeks, survey Captains or station officers on understanding and compliance.\nReport back to the Fire Chief with outcomes, remaining friction points, and recommendations for future policy rollout protocols.\nEvaluator Focus Points\nLeadership Ownership: Did the Deputy Chief transform resistance into cooperation?\nCommunication Skill: Was the “why” clarified effectively across all levels?\nTeam Alignment: Were Assistant and Battalion Chiefs re-engaged and unified?\nProfessional Composure: Did the Deputy Chief model loyalty and transparency simultaneously?\nLong-Term Cultural Effect: Did morale and trust measurably improve?\nExpected Deliverables\nOperations Alignment Bulletin (1–2 pages) – official explanatory communication for the entire department.\nLeadership After-Action Report (2–3 pages) – documents meetings held, issues identified, corrective strategies, and follow-up feedback results.\nEvaluator Scoring Emphasis\nFactor | Weight | Focus\nStrategic Communication & Message Clarity | ×2 | Explains policy purpose convincingly; creates shared ownership.\nLeadership Influence & Culture Repair | ×1 | Rebuilds unity and accountability across command staff.\nProblem Analysis & Solution Development | ×1 | Accurately identifies why rollout failed and corrects it.\nPolicy Knowledge & Organizational Loyalty | ×1 | Supports Chief’s intent while addressing field concerns.\nProfessional Composure & Integrity | ×1 | Demonstrates calm authority and balanced empathy.\nRating Guidance\nRating | Descriptor | Behavioral Indicators\n5 – Exceptional | Converts widespread resistance into active support; establishes new communication model adopted for all future rollouts. |\n4 – Proficient | Restores alignment and understanding; minor lingering resistance resolved quickly. |\n3 – Developing | Achieves compliance but limited cultural improvement; message still viewed as administrative. |\n2 – Deficient | Addresses symptoms, not cause; leadership remains divided or cynical. |\n1 – Unacceptable | Deepens disconnect; fails to unify leadership or articulate the “why.” |"
},
{
"key": "5",
"title": "Fiscal Responsibility & Resource Management",
"weight": 20,
"quarter": null,
"competency": "Fiscal",
"elements": [
{
"label": "Fiscal Analysis & Prioritization",
"mult": 2
},
{
"label": "Strategic Risk Management",
"mult": 1
},
{
"label": "Communication & Advocacy",
"mult": 1
},
{
"label": "Innovation & Problem Solving",
"mult": 1
},
{
"label": "Leadership Integrity & Team Impact",
"mult": 1
}
],
"guide": "Category 5: Fiscal Responsibility & Resource Management\nDefinition / Purpose\nEvaluates the Deputy Chief’s ability to develop, justify, and manage division-level budgets and resource allocations that support SGFD’s operational and strategic goals.\nMeasures fiscal judgment, analytical skill, political awareness, and ability to advocate for resources while demonstrating stewardship of taxpayer funds.\nKey Performance Behaviors\nThe Deputy Chief:\nDemonstrates a strong understanding of SGFD’s overall budget structure and constraints.\nDevelops accurate, data-driven justifications for personnel, equipment, and capital needs.\nBalances competing priorities between readiness, safety, and cost control.\nCommunicates fiscal impacts clearly to both internal and external stakeholders.\nAnticipates long-term implications of funding decisions (maintenance, staffing, ISO).\nOperates transparently and collaboratively with Administration and Finance.\nUpholds SGFD’s reputation for fiscal responsibility and integrity.\nScenario – “The Hard Choice”\nSituation\nYou are the Deputy Chief of Operations, and SGFD’s FY2026 preliminary budget has just been released by the Fire Chief.\nDue to rising insurance costs and reduced millage revenue, the Fire Chief announces that $850,000 must be cut from next year’s projected expenditures.\nYou are directed to submit a revised operations budget within five business days that achieves this reduction without jeopardizing core service delivery or ISO compliance.\nHere’s the situation snapshot:\nItem | Cost | Notes\nNew Ladder 61 replacement | $1,200,000 | Chassis ordered; due for completion in Q2 FY26\nFirefighter overtime (unbudgeted) | +$340,000 | Driven by minimum staffing requirements\nSCBA replacement program | $410,000 | Phase 2 of 3-year plan (current units aging)\nFacility maintenance (Station 63 & 68) | $220,000 | Roof repairs, mold remediation pending\nTraining Division simulation equipment | $125,000 | Approved but not yet purchased\nPart-time EMS liaison position | $82,000 | Proposed addition to improve QA/QI reviews\nThe Fire Chief provides you with the following guidance:\n“I need your best professional recommendation — not just where to cut, but how to do it smartly.\nRemember, ISO review and NFPA 1852 compliance are due next year.\nWe can’t lose credibility or readiness, but the Board expects visible belt-tightening.”\nMeanwhile, word of potential cuts has already reached the Captains, and the Union is watching closely.\nYour Responsibilities\nConduct Fiscal Impact Analysis\nReview all operational line items and categorize by mission-critical, deferable, or discretionary.\nDetermine downstream impacts of deferring each project (ISO points, maintenance costs, safety risk).\nDevelop Three Budget Scenarios\nOption A: Preserve apparatus replacement; defer non-critical projects.\nOption B: Defer apparatus purchase; maintain safety and personnel priorities.\nOption C: Hybrid — partial deferrals with internal cost-savings measures (e.g., overtime mitigation, contract renegotiation).\nPrepare Justification Materials\nDevelop a 1-page Executive Summary and a 3–5-page Fiscal Impact Brief outlining each option, tradeoffs, and your professional recommendation.\nInclude relevant data from ISO, NFPA, and historical run-volume trends to support your case.\nPresent to Fire Chief and Administrative Panel\nDeliver a 10-minute presentation defending your recommendation and responding to counterarguments.\nAddress morale implications and public transparency considerations.\nEvaluator Focus Points\nFiscal Judgment: Were recommendations balanced and data-driven?\nStrategic Awareness: Did the Deputy Chief anticipate operational, ISO, and political effects?\nCommunication Skill: Could they justify decisions clearly and confidently?\nInnovation: Did they identify internal savings or creative solutions instead of simple cuts?\nLeadership Impact: Did they consider personnel morale and trust during fiscal change?\nExpected Deliverables\nFiscal Impact Brief (3–5 pages) – problem statement, options, fiscal and operational impacts, and recommendation.\nExecutive Summary (1 page) – concise, Board-ready overview.\nBudget Presentation (10 minutes) – to the Fire Chief and/or Administrative Review Board.\nEvaluator Scoring Emphasis\nFactor | Weight | Focus\nFiscal Analysis & Prioritization | ×2 | Demonstrates clear logic and understanding of SGFD financial structure.\nStrategic Risk Management | ×1 | Anticipates operational and ISO implications.\nCommunication & Advocacy | ×1 | Persuasive, transparent, and credible.\nInnovation & Problem Solving | ×1 | Identifies creative cost-control strategies.\nLeadership Integrity & Team Impact | ×1 | Maintains morale and trust during fiscal change.\nRating Guidance\nRating | Descriptor | Behavioral Indicators\n5 – Exceptional | Provides realistic, well-supported fiscal solution that preserves readiness and earns Board confidence; recommendations adopted. |\n4 – Proficient | Produces solid options with defensible logic; minor detail or communication gaps only. |\n3 – Developing | Meets expectations; identifies savings but limited strategic or morale consideration. |\n2 – Deficient | Produces unbalanced cuts or fails to anticipate operational/fiscal impacts. |"
}
]
}
}
];
