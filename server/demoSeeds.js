// Generic starter content for Nexus installs that don't carry a department's own documents (sandboxes, other departments).
// Written for the Nexus suite; nothing here comes from St. George's forms, policies or evaluation documents.
// St. George's own forms and evaluation programs (formSeeds*.js, evalSeeds*.js) are seeded only when DEPARTMENT_CONTENT is on
// (the default outside a sandbox).

import { SGFD_CONTENT } from "./buildFlags.js";
export const departmentContent = () => {
  if (!SGFD_CONTENT) return false;     // a customer package that doesn't carry St. George's documents at all
  const v = String(process.env.DEPARTMENT_CONTENT || "").trim().toLowerCase();
  if (v) return /^(1|on|true|yes)$/.test(v);
  return !/^(1|on|true|yes)$/i.test(String(process.env.SANDBOX || ""));
};

const ACK = "I confirm the information above is accurate to the best of my knowledge.";
export const DEMO_FORM_SEEDS = [
  {
    key: "demo_supply", title: "Station Supply Order", category: "Requests", sort: 1,
    description: "Order cleaning, kitchen and medical supplies for a station. Logistics fills it and marks it delivered.",
    fields: [
      { key: "station", type: "select", required: true, label: "Station", options: ["Station 11", "Station 12", "Station 13", "Station 14", "Headquarters"] },
      { key: "items", type: "checkboxes", required: true, label: "What do you need?", options: ["Paper towels", "Trash bags", "Dish soap", "Disinfectant wipes", "Exam gloves", "Coffee filters", "Other"] },
      { key: "other", type: "text", label: "Other items", showIf: { field: "items", equals: "Other" } },
      { key: "needed_by", type: "date", label: "Needed by" },
      { key: "notes", type: "textarea", label: "Notes" },
    ],
    settings: { subject: "none", subjectCanView: true, recipients: [], stages: [{ label: "Being filled" }, { label: "Delivered", notify: true, done: true }] },
  },
  {
    key: "demo_damage", title: "Equipment Damage Report", category: "Safety", sort: 2,
    description: "Report damaged or lost equipment so it can be repaired or replaced.",
    fields: [
      { key: "when", type: "date", required: true, label: "Date found or damaged", prefill: "today" },
      { key: "unit", type: "text", required: true, label: "Apparatus or location", help: "For example EG111 or Station 12" },
      { key: "item", type: "text", required: true, label: "Equipment" },
      { key: "on_call", type: "yesno", required: true, label: "Did it happen on a call?" },
      { key: "incident", type: "text", label: "Incident number", showIf: { field: "on_call", equals: "Yes" } },
      { key: "what", type: "textarea", required: true, label: "What happened?" },
      { key: "in_service", type: "radio", required: true, label: "Is it still usable?", options: ["Yes", "Limited", "Out of service"] },
      { key: "acknowledge", type: "acknowledge", required: true, label: ACK },
    ],
    settings: { subject: "none", subjectCanView: true, recipients: [], stages: [{ label: "Received" }, { label: "Repair ordered", notify: true }, { label: "Fixed / replaced", notify: true, done: true }] },
  },
  {
    key: "demo_ridealong", title: "Ride-Along Request", category: "Requests", sort: 3,
    description: "Request a ride-along for a student, new hire or visitor.",
    fields: [
      { key: "guest", type: "text", required: true, label: "Guest's name" },
      { key: "why", type: "select", required: true, label: "Purpose", options: ["EMT / paramedic student", "New hire orientation", "Visitor", "Other"] },
      { key: "day", type: "date", required: true, label: "Day requested" },
      { key: "station", type: "select", required: true, label: "Station", options: ["Station 11", "Station 12", "Station 13", "Station 14"] },
      { key: "waiver", type: "yesno", required: true, label: "Has the guest signed the waiver?" },
    ],
    settings: { subject: "none", subjectCanView: true, recipients: [], stages: [{ label: "Under review" }, { label: "Approved", notify: true, done: true }, { label: "Declined", notify: true, done: true }] },
  },
];

// One generic points-based program so Evaluations has something to show
const el = (...labels) => labels.map(label => ({ label, mult: 1 }));
export const DEMO_PROGRAM_SEEDS = [
  {
    key: "demo-officer", name: "Company Officer (demo)", rank: "Lieutenant / Captain", kind: "wtp", sort: 10,
    description: "A sample 12-month working test for new company officers: five modules scored 0–5 per element. Edit or replace it in Programs.",
    data: {
      scale: { min: 0, max: 5 }, passComposite: 70, passModule: 70, months: 12, reviews: [3, 6, 9],
      outcomes: ["Pass", "Extend", "Not passed"], signatures: ["Evaluator", "Candidate"],
      overview: "Sample program for the sandbox. Each module is scored 0 (not shown) to 5 (excellent) per element; the composite must reach 70% with no module under 70%.",
      modules: [
        { key: "A", title: "Size-up and initial command", weight: 25, quarter: 1, competency: "NFPA 1021", sim: true,
          elements: el("Clear initial radio report", "Assumes and names command", "Requests resources early", "Assigns first-arriving units"), guide: "Run a radio simulation or a tabletop. Score what the candidate does, not what they say they'd do." },
        { key: "B", title: "Company operations", weight: 20, quarter: 1, competency: "NFPA 1021", sim: true,
          elements: el("Safe, efficient stretch", "Crew accountability", "Progress reports"), guide: "Observe on a drill or call." },
        { key: "C", title: "Training and documentation", weight: 20, quarter: 2, competency: "NFPA 1021",
          elements: el("Plans and runs a company drill", "Records training accurately", "Follows up on weak skills"), guide: "Review two drills the candidate ran." },
        { key: "D", title: "Leadership and conduct", weight: 20, quarter: 2, competency: "NFPA 1021",
          elements: el("Handles a crew conflict", "Gives clear feedback", "Models policy"), guide: "Use a conversation simulation." },
        { key: "E", title: "Administration", weight: 15, quarter: 3, competency: "NFPA 1021",
          elements: el("Reports on time", "Station and apparatus checks", "Purchasing and inventory"), guide: "Review paperwork for the last month." },
      ],
    },
  },
];
