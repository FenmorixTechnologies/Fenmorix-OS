// Pass/fail skills evaluations carried over from the Forms module (formSeeds2.js: probationary_eval, lateral_eval,
// operator_pumper, operator_aerial). Same criteria, now scored per critical criterion in Evaluations: 1 = Pass, 0 = Fail.
// Attempt #1 is a Formal evaluation; after re-training, attempt #2 is a Retest. Standing uses the latest signed attempt.
// Seeded once by key (ON CONFLICT DO NOTHING); after that they're edited in the app.

const PASS_FAIL = { min: 0, max: 1, labels: ["Fail", "Pass"] };
const el = (...labels) => labels.map(label => ({ label, mult: 1 }));

const INTRO = "The purpose of this evaluation is to show competency in specific trained and taught skills. The member gets two attempts at each skill, " +
  "with re-training in between. This is a PASS or FAIL evaluation. All skills are performed to the proficiency level of NFPA 1001, Standard for Fire Fighter " +
  "Professional Qualifications 1 & 2, and the St. George Fire Department SOP. Make yourself familiar with and inspect all equipment before beginning; the time " +
  "before hose pulls is for setup. The search evaluation is done as a crew with an assigned officer.";
const HOW = "How to record it in Nexus: score each critical criterion Pass or Fail. Attempt #1 is a Formal evaluation. If any criterion fails, " +
  "write the retrain-by date in the comments, re-train, then record attempt #2 as a Retest. Write times (for example 1:45) in the comments.";

const SKILLS = [
  { title: "Donning/Doffing Drill", crit: "Must be done in a safe and controlled manner. All PPE worn and properly adjusted; SCBA fully on, worn and operating. Must be done within a 2:00 minute time frame.",
    elements: el("Done in a safe and controlled manner", "All PPE worn and properly adjusted", "SCBA fully on, worn and operating", "Completed within 2:00") },
  { title: "Forcible Entry", crit: "Must be done in a safe and controlled manner.",
    elements: el("Entry made in a safe and controlled manner") },
  { title: "Hose Deployment", crit: "Must be done in a safe and controlled manner. No kinks or tangles that impede the proper nozzle discharge GPM or pressure. Positioned for the most direct route into the doorway. Full PPE and on air. Must call for water.",
    elements: el("Done in a safe and controlled manner", "No kinks or tangles that impede nozzle discharge GPM or pressure", "Positioned for the most direct route into the doorway", "Full PPE and on air", "Called for water") },
  { title: "Hose Advancement", crit: "1¾ while flowing a distance of 25 ft; 2½ charged, not flowing, a distance of 75 ft. Must be done in a safe and controlled manner. The 1¾ nozzle must pass the orange cone marking 25 ft. The 2½ nozzle must pass the orange cone marking 75 ft.",
    elements: el("1¾ line advanced while flowing; nozzle passes the 25 ft cone", "2½ line advanced charged, not flowing; nozzle passes the 75 ft cone", "Done in a safe and controlled manner") },
  { title: "Ladders", crit: "Must be done in a safe and controlled manner with PPE donned appropriately. Cannot drop the ladder. Explain ladder components and operation, and explain rescue vs. access.",
    elements: el("Done in a safe and controlled manner with PPE donned appropriately", "Ladder not dropped", "Explains ladder components and operation", "Explains rescue vs. access") },
  { title: "Primary/Secondary Search", crit: "Must be done in a safe and controlled manner. Proper use of search technique, communication, orientation and ability to call MAYDAY or PRIORITY traffic. Victims removed safely and efficiently.",
    elements: el("Done in a safe and controlled manner", "Proper search technique", "Communication", "Orientation", "Able to call MAYDAY or PRIORITY traffic", "Victims removed safely and efficiently") },
  { title: "Water Supply from a Pressurized Source", crit: "Master gate valve WILL be applied IF required by the officer. Supply line free of major kinks or twists and properly wrapped around the hydrant. Hydrant flushed and connected. Proper communication with the operator before opening.",
    elements: el("Master gate valve applied when required by the officer", "Supply line free of major kinks or twists and properly wrapped around the hydrant", "Hydrant flushed and connected", "Proper communication with the operator before opening") },
];
const skillModules = (firstKey, extraNote = {}) => SKILLS.map((s, i) => ({
  key: String.fromCharCode(firstKey.charCodeAt(0) + i), title: s.title, weight: null, quarter: null, competency: "NFPA 1001 FF I & II", sim: false,
  elements: s.elements, guide: `Critical criteria: ${s.crit}\n\n${extraNote[s.title] ? extraNote[s.title] + "\n\n" : ""}${HOW}`,
}));

const OP_HOW = "How to record it in Nexus: score each minimum Pass or Fail (all minimums must pass). Use the comments for anything covered beyond the minimums. " +
  "If a minimum isn't met, record the second attempt as a Retest.";

export const MORE_PROGRAM_SEEDS = [
  {
    key: "ff-probation", name: "Probationary Firefighter", rank: "Firefighter (probationary)", kind: "wtp", sort: 10,
    description: "Probationary skills evaluations at 3, 6 and 9 months: seven NFPA 1001 skills, pass/fail on each critical criterion, two attempts with re-training in between.",
    data: {
      scale: PASS_FAIL, standing: "latest", passComposite: 100, passModule: 100, months: 12, reviews: [3, 6, 9],
      outcomes: ["Recommend permanent status", "Extend probation", "Do not recommend"],
      signatures: ["Evaluator", "Firefighter"],
      evaluators: "Assigned officer, accompanying officer and designated evaluators.",
      overview: `${INTRO}\n\nSkills evaluations are done at 3, 6 and 9 months. If every skill requirement is met at the 6-month evaluation, a third evaluation is not needed.\n\n${HOW}`,
      modules: skillModules("A", { "Hose Advancement": "Probationary evaluations always record two attempts at hose advancement." }).map(m => ({ ...m, quarter: 1 })),
    },
  },
  {
    key: "ff-lateral", name: "Lateral Firefighter", rank: "Firefighter (lateral hire)", kind: "form", sort: 11,
    description: "Skills evaluation for lateral hires: an aerobic test and seven NFPA 1001 skills, pass/fail on each critical criterion.",
    data: {
      scale: PASS_FAIL, standing: "latest", passComposite: 100, passModule: 100, months: 12, reviews: [], outcomes: [],
      signatures: ["Evaluator", "Firefighter"],
      overview: `${INTRO}\n\n${HOW}`,
      modules: [
        { key: "A", title: "Aerobic Exercise", weight: null, quarter: null, competency: "Fitness", sim: false,
          elements: el("Finished the chosen exercise within 16:00 (run 1.5 miles, row 3000 m, or bike 180 calories)"),
          guide: `Critical criteria: choose one. Run 1.5 miles in 16 minutes, row 3000 meters in 16 minutes, or bike 180 calories in 16 minutes.\n\nWrite which exercise and the time in the comments.\n\n${HOW}` },
        ...skillModules("B"),
      ],
    },
  },
  {
    key: "op-pumper", name: "Equipment Operator: Pumper", rank: "Driver/Operator (pumper)", kind: "form", sort: 20,
    description: "Pump operator evaluation: the apparatus and equipment, and operating the pump. Pass/fail on each minimum.",
    data: {
      scale: PASS_FAIL, standing: "latest", passComposite: 100, passModule: 100, months: 12, reviews: [], outcomes: [],
      signatures: ["Candidate", "Company officer", "Training officer"],
      overview: `Scenario: You arrive on scene to find a two-story residential structure. Pull a 1¾ attack line and determine the operating pressure.\n\n${OP_HOW}`,
      modules: [
        { key: "A", title: "The apparatus and equipment", weight: null, quarter: null, competency: "NFPA 1002 pumper", sim: false,
          elements: el("Names and communicates all equipment on the apparatus and how it is used", "States the hose sizes, lengths and pressures currently on the engine",
            "Calculates simple hydraulics and friction loss", "Discusses moving from automatic pump mode to manual and back"),
          guide: "Scenario: You arrive on scene to find a two-story residential structure. Pull a 1¾ attack line and determine the operating pressure.\n\n" +
            "Covers pump types, the equipment on the apparatus, hose sizes and pressures, hydraulics, FDC connections, daily truck checks, moving from automatic to manual pump mode, and foam system operation.\n\n" +
            "Minimums to pass:\n• Name and communicate all equipment on the apparatus and how it is used.\n• What size(s) of hose, lengths and pressure(s) are currently on the engine.\n• Calculate simple hydraulics and friction loss.\n• Discuss how to move from automated pump mode to manual and back.\n\n" + OP_HOW },
        { key: "B", title: "Operating the pump", weight: null, quarter: null, competency: "NFPA 1002 pumper", sim: false,
          elements: el("Engages the pump", "Transitions the supply from an internal to an external source before running out of water",
            "Performs or discusses the ways to supply an aerial waterway at the proper pressures", "Demonstrates or discusses when and how to relay pump"),
          guide: "Covers apparatus placement, engaging the pump, supply transitions, dry hydrants, supplying an aerial waterway, and relay pumping.\n\n" +
            "Minimums to pass:\n• Engage the pump.\n• Transition the supply from an internal to an external source before running out of water.\n• Perform or discuss the different ways to supply an aerial waterway with the proper pressures.\n• Demonstrate or discuss when and how to relay pump.\n\n" + OP_HOW },
      ],
    },
  },
  {
    key: "op-aerial", name: "Equipment Operator: Aerial", rank: "Driver/Operator (aerial)", kind: "form", sort: 21,
    description: "Aerial operator evaluation: the apparatus and equipment, and operating the aerial. Must already be signed off as a pump operator. Pass/fail on each minimum.",
    data: {
      scale: PASS_FAIL, standing: "latest", passComposite: 100, passModule: 100, months: 12, reviews: [], outcomes: [],
      signatures: ["Candidate", "Company officer", "Training officer"],
      overview: `The candidate must already be signed off as a pump operator.\n\n${OP_HOW}`,
      modules: [
        { key: "A", title: "The apparatus and equipment", weight: null, quarter: null, competency: "NFPA 1002 aerial", sim: false,
          elements: el("Signed off as a pump operator", "Names and explains every valve and piece of equipment and its use", "Discusses all applicable aerial safety systems"),
          guide: "The candidate drives proficiently and explains aerial vs. pumper limitations; names and explains every valve and piece of equipment and its use; discusses the aerial safety systems; identifies hose sizes, lengths and pressures; calculates basic hydraulics and friction loss; describes the ways to supply the aerial waterway, including the best one; demonstrates daily truck checks and basic maintenance; and discusses apparatus placement and the strengths and weaknesses of back, front, side and short jacking.\n\n" +
            "Minimums to pass:\n• Must be signed off as a pump operator.\n• Name and explain every valve and piece of equipment and its use.\n• Discuss all applicable aerial safety systems.\n\n" + OP_HOW },
        { key: "B", title: "Operating the aerial", weight: null, quarter: null, competency: "NFPA 1002 aerial", sim: false,
          elements: el("Proper apparatus placement (critical)", "Installs pins", "Operates the aerial safely, under control and smoothly",
            "Lowers the aerial, drains the waterway, beds the ladder and works through all safety systems"),
          guide: "The candidate places the apparatus properly (critical with 77-foot ladders); engages the pump transfer and generator; deploys and levels the outriggers with pads within operating limits; installs pins; operates the aerial safely and smoothly; lowers and beds the ladder, drains the waterway and works through all safety systems; performs or discusses the ways to supply the aerial waterway at the correct pressures; and returns the apparatus to road mode.\n\n" +
            "Minimums to pass:\n• Proper apparatus placement (critical).\n• Install pins.\n• Operate the aerial safely, under control and smoothly.\n• Lower the aerial, drain the waterway, bed the ladder and work through all safety systems.\n\n" + OP_HOW },
      ],
    },
  },
  {
    key: "op-confirm", name: "Operator Requirements Confirmation", rank: "Firefighter/Operator (competitive class)", kind: "form", sort: 22,
    description: "Confirms the minimum civil service operator requirements for Firefighter/Operator. Pass/fail on each critical criterion. Does not authorize independent assignment as primary apparatus operator.",
    data: {
      scale: PASS_FAIL, standing: "latest", passComposite: 100, passModule: 100, months: 12, reviews: [], outcomes: [],
      signatures: ["Evaluator", "Assistant Chief", "Member"],
      overview: "Limitation of confirmation (operational authority): this confirms the minimum civil service requirements for Firefighter/Operator only. " +
        "It does not authorize independent assignment as primary apparatus operator.\n\nSkills are evaluated at a basic competency level. All critical criteria must be met for each skill.\n\n" +
        "Evaluator certification: I certify that this member meets the minimum operator requirements for civil service confirmation.\n" +
        "Assistant Chief acknowledgment: I have reviewed this confirmation. It does not qualify the member as primary apparatus operator.\n" +
        "Member acknowledgment: I understand this confirmation does not authorize me to operate as primary apparatus operator.\n\n" + OP_HOW,
      modules: [
        ["A", "Apparatus driving & route selection", "Selects a reasonable route, follows it without continuous direction, and returns the apparatus safely.",
          ["Selects a reasonable route", "Follows the route without continuous direction", "Returns the apparatus safely"]],
        ["B", "Apparatus positioning (verbal)", "Leaves access for other units, supports hose deployment, recognizes water supply access, and follows Company Officer/Command direction.",
          ["Leaves access for other units", "Supports hose deployment", "Recognizes water supply access", "Follows Company Officer / Command direction"]],
        ["C", "Pump operations", "Places one 1.75\" hoseline in service at the correct pressure.", ["Places one 1.75\" hoseline in service at the correct pressure"]],
        ["D", "Water supply operations", "Establishes a water supply before the onboard tank is depleted.", ["Establishes a water supply before the onboard tank is depleted"]],
        ["E", "Basic pump knowledge (verbal)", "Explains basic pump operation concepts.", ["Explains basic pump operation concepts"]],
      ].map(([key, title, crit, els]) => ({ key, title, weight: null, quarter: null, competency: "Civil service operator requirements", sim: false,
        elements: el(...els), guide: `${title}\n\nCritical criteria: ${crit}\n\n${OP_HOW}` })),
    },
  },
];
