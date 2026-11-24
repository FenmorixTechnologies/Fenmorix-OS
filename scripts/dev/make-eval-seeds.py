#!/usr/bin/env python3
# Builds server/evalSeeds.js from the three SGFD evaluation documents (text extracted from the .docx files).
import json, re, sys, glob, os
# usage: python3 make-eval-seeds.py <folder with the three documents as .txt (docx text, one paragraph or table row per line)> server/evalSeeds.js
D = sys.argv[1]
def load(prefix):
    f = glob.glob(os.path.join(D, "*" + prefix + "*.txt"))[0]
    return open(f, encoding="utf-8").read().split("\n")
CO, BC, DC = load("Company_Officer"), load("Battalion_Chief"), load("Deputy_Chief")

def text(lines, a, b):  # 1-based inclusive line range
    out = [l.strip().lstrip("🚒").strip() for l in lines[a - 1:b]]
    return "\n".join(l for l in out if l)

ROW = re.compile(r"^(.+?) \| (?:(\d+)|×(\d+(?:\.\d+)?))\s*\|")
def elements(lines, a, b, max_pts=5):
    els = []
    for l in lines[a - 1:b]:
        m = ROW.match(l.strip())
        if not m: continue
        label = m.group(1).strip()
        if re.match(r"^(Total|Module|Category|Performance Element|Element|Factor|Subcategory)\b", label): continue
        if label.startswith("Applicable SGFD Policies"):   # a pasted cell in the BC matrix: it's the staffing-policy element
            label = "Application of staffing policies (1004, 1005, 1052, 200.5)"
        mult = float(m.group(3)) if m.group(3) else 1
        els.append({"label": label, "mult": mult if mult != int(mult) else int(mult)})
    return els

def section(lines, a, b, start_words):
    """Split a module's text into guide parts by heading words."""
    return text(lines, a, b)

def mod(key, title, weight, quarter, lines, a, b, els, competency, **extra):
    m = {"key": key, "title": title, "weight": weight, "quarter": quarter, "competency": competency,
         "elements": els, "guide": text(lines, a, b)}
    m.update(extra)
    return m

# ---------------- Company Officer: Working Test Period (scenarios A-I) ----------------
co_A = [{"label": l, "mult": 1} for l in ["Completeness of radio report", "Accuracy of size-up (construction, occupancy, fire location)",
        "Clarity of command establishment", "Risk/benefit and safety awareness", "Prioritization of actions and resource requests"]]
co_B = elements(CO, 191, 250) + [{"label": "Written justification (150–300 words; scored separately in the document)", "mult": 1}]
co_I = [{"label": "Professional Appearance & Bearing", "mult": 1}, {"label": "Ethical Conduct & Integrity", "mult": 2},
        {"label": "Communication & Interaction", "mult": 2.5}, {"label": "Decision-Making & Readiness", "mult": 2.5},
        {"label": "Leadership Presence & Crew Development", "mult": 2}]
co_mods = [
    mod("A", "Size-Up & Initial Command", 10, 1, CO, 162, 190, co_A, "Tactical operations", sim=True),
    mod("B", "Engine Company Operations", 10, 1, CO, 191, 250, co_B, "Tactical operations", sim=True),
    mod("C", "Ladder Company Operations", 7.5, 2, CO, 251, 316, elements(CO, 251, 316), "Strategic command", sim=True),
    mod("D", "Incident Command System Application", 7.5, 2, CO, 317, 396, elements(CO, 317, 396), "Strategic command", sim=True),
    mod("E", "Personnel Management, Leadership & Civil Service", 15, 3, CO, 397, 482, elements(CO, 397, 482), "Personnel & leadership"),
    mod("F", "Daily Inbox & Administrative Decision-Making", 10, 3, CO, 483, 560, elements(CO, 483, 560), "Administration"),
    mod("G", "Report Writing & Documentation (NERIS)", 10, 3, CO, 561, 625, elements(CO, 561, 625), "Report writing"),
    mod("H", "Budget Proposal & Presentation", 15, 4, CO, 626, 698, elements(CO, 626, 698), "Budget & presentation"),
    mod("I", "Professionalism & Readiness (Capstone)", 15, 4, CO, 699, 773, co_I, "Professionalism"),
]
CO_WTP = {"key": "co-wtp", "name": "Company Officer – Working Test Period", "rank": "Lieutenant / Captain", "kind": "wtp", "sort": 30,
    "description": "12-month Civil Service Working Test Period for Lieutenants and Captains: scenarios A–I, scored 0–5 per element.",
    "data": {"scale": {"min": 0, "max": 5}, "passComposite": 80, "passModule": 70, "months": 12, "reviews": [3, 6, 9, 12],
        "evaluators": "Chief of Training, Battalion Chiefs, and designated evaluators certified to at least Fire Officer III.",
        "signatures": ["Battalion Chief", "Chief of Training", "Assistant Chief / Fire Chief"],
        "outcomes": ["Recommend permanent status", "Extend the working test period", "Do not recommend"],
        "overview": text(CO, 36, 110), "modules": co_mods}}

# ---------------- Company Officer: periodic evaluation (7 categories, one 0-5 score each) ----------------
co_form = []
cats = [("I", "Tactical Operations (Engine & Ladder)", 25, 6, 8), ("II", "Strategic & Administrative Command", 20, 9, 10),
        ("III", "Personnel Management & Leadership", 20, 11, 12), ("IV", "Administrative Duties (Daily Inbox)", 15, 13, 14),
        ("V", "Report Writing & Documentation", 10, 15, 16), ("VI", "Budgeting / Proposal Development", 10, 17, 18),
        ("VII", "Professionalism & Readiness", 5, 19, 20)]
for k, t, w, a, b in cats:
    co_form.append(mod(k, t, w, None, CO, a, b, [{"label": t, "mult": 1}], t))
CO_FORM = {"key": "co-eval", "name": "Company Officer Evaluation (7 categories)", "rank": "Lieutenant / Captain", "kind": "form", "sort": 31,
    "description": "One score (0–5) per category, weighted to a final total out of 5. NFPA 1021 Fire Officer I–II.",
    "data": {"scale": {"min": 0, "max": 5}, "passComposite": 80, "passModule": 70,
        "signatures": ["Officer evaluated", "Immediate Supervisor", "Chief of Training", "Assistant Chief / Fire Chief"],
        "overview": text(CO, 1, 35), "modules": co_form}}

# ---------------- Company Officer: station evaluation matrix (A-E, multipliers, 160 pts) ----------------
def matrix(lines, defs):
    return [mod(k, t, None, None, lines, a, b, elements(lines, a, b), t) for k, t, a, b in defs]
co_mx = matrix(CO, [("A", "Tactical Operations (Engine / Ladder Company)", 786, 794), ("B", "Station Management & Daily Operations", 795, 803),
                     ("C", "Training, Documentation & ISO Compliance", 804, 812), ("D", "Personnel Management & Leadership", 813, 821),
                     ("E", "Administrative Readiness & Communication", 822, 830)])
for m in co_mx: m["weight"] = sum(e["mult"] for e in m["elements"]) * 5
CO_MX = {"key": "co-matrix", "name": "Company Officer – Station Evaluation Matrix", "rank": "Lieutenant / Captain", "kind": "form", "sort": 32,
    "description": "Station-based matrix scored 1–5 with multipliers (160 points). 90–100% outstanding, 80–89% proficient, 70–79% meets, 60–69% needs improvement.",
    "data": {"scale": {"min": 1, "max": 5}, "passComposite": 70, "passModule": 0, "points": True,
        "bands": [[90, "Outstanding / Promotion-Ready"], [80, "Proficient / Fully Effective"], [70, "Meets Expectations / Continued Growth"], [60, "Needs Improvement"], [0, "Unsatisfactory / Development Plan Required"]],
        "signatures": ["Evaluator", "Battalion Chief Review", "Assistant Chief Review"], "overview": text(CO, 774, 785) + "\n" + text(CO, 839, 861), "modules": co_mx}}

# ---------------- Battalion Chief: WTP (overview A-I, detailed modules mapped by title) ----------------
bc_D = [{"label": l, "mult": 1} for l in ["Unified command establishment with Law Enforcement, EMS and OEM",
        "Interagency communications & radio interoperability", "Mutual-aid resource request and deployment",
        "Liaison, EOC coordination & outside-agency relations", "After-action review & documentation"]]
bc_mods = [
    mod("A", "Advanced Incident Command", 15, 1, BC, 198, 291, elements(BC, 198, 291), "Incident command", sim=True),
    mod("B", "Multi-Alarm / Large-Scale Event", 15, 1, BC, 292, 385, elements(BC, 292, 385), "Incident command", sim=True),
    mod("C", "Personnel Management & Corrective Action", 10, 2, BC, 386, 480, elements(BC, 386, 480), "Personnel & leadership"),
    mod("D", "Interagency Coordination", 10, 2, BC, 67, 69, bc_D, "Interagency coordination",
        note="The document has no detailed Module D rubric; these five elements were written from its description. Edit them in Programs."),
    mod("E", "Budget & Resource Management", 10, 3, BC, 481, 569, elements(BC, 481, 569), "Budget & resources"),
    mod("F", "Policy & SOP Development", 10, 3, BC, 570, 664, elements(BC, 570, 664), "Policy"),
    mod("G", "NERIS Oversight & Data Quality", 10, 3, BC, 665, 747, elements(BC, 665, 747), "Report oversight"),
    mod("H", "Strategic Planning & Presentation", 10, 4, BC, 748, 834, elements(BC, 748, 834), "Strategic planning"),
    mod("I", "Professionalism & Command Readiness", 10, 4, BC, 835, 911, elements(BC, 835, 911), "Professionalism"),
]
BC_WTP = {"key": "bc-wtp", "name": "Battalion Chief – Working Test Period", "rank": "Battalion Chief", "kind": "wtp", "sort": 40,
    "description": "12-month Working Test Period for Battalion Chiefs: modules A–I, 0–5 per element. NFPA 1021 Fire Officer IV, NFPA 1561.",
    "data": {"scale": {"min": 0, "max": 5}, "passComposite": 80, "passModule": 70, "months": 12, "reviews": [3, 6, 9, 12],
        "evaluators": "Assistant Chiefs, Chief of Training, Fire Chief.", "signatures": ["Chief of Training", "Assistant Chief", "Fire Chief"],
        "outcomes": ["Recommend permanent status", "Extend the working test period", "Do not recommend"],
        "overview": text(BC, 1, 130), "modules": bc_mods}}
bc_mx = matrix(BC, [("A", "Tactical Command & Multi-Company Operations", 133, 142), ("B", "Shift Management & Staffing", 143, 151),
                     ("C", "Company Oversight & Policy Compliance", 152, 160), ("D", "Personnel & Leadership Management", 161, 169),
                     ("E", "Strategic Support & Inter-Division Coordination", 170, 178)])
for m in bc_mx: m["weight"] = sum(e["mult"] for e in m["elements"]) * 5
BC_MX = {"key": "bc-matrix", "name": "Battalion Chief – Evaluation Matrix", "rank": "Battalion Chief", "kind": "form", "sort": 41,
    "description": "Battalion matrix scored 1–5 with multipliers (155 points).",
    "data": {"scale": {"min": 1, "max": 5}, "passComposite": 70, "passModule": 0, "points": True,
        "bands": [[90, "Outstanding"], [80, "Proficient"], [70, "Meets Expectations"], [60, "Needs Improvement"], [0, "Unsatisfactory"]],
        "signatures": ["Evaluator", "Assistant Chief", "Fire Chief"], "overview": text(BC, 119, 132), "modules": bc_mx}}

# ---------------- Deputy Chief: WTP (categories 1-5, factors with weights, 1-5) ----------------
dc_1 = [{"label": "Strategic goals: developed, communicated and executed", "mult": 2}, {"label": "Alignment with SGFD objectives and the Fire Chief's direction", "mult": 1},
        {"label": "Anticipation of challenges & proactive solutions", "mult": 1}, {"label": "Leadership through influence", "mult": 1},
        {"label": "Senior advisor role & representation of SGFD", "mult": 1}]
dc_mods = [
    mod("1", "Strategic Leadership & Organizational Alignment", 20, None, DC, 79, 119, dc_1, "Strategic leadership",
        note="Category 1 has no factor table in the document; these factors were written from its Key Performance Behaviors. Edit them in Programs."),
    mod("2", "Operational Readiness & Inter-Divisional Coordination", 20, None, DC, 120, 182, elements(DC, 120, 182), "Operational readiness"),
    mod("3", "Policy, Compliance & Accreditation Management", 20, None, DC, 183, 247, elements(DC, 183, 247), "Compliance"),
    mod("4", "Personnel Leadership & Organizational Culture", 20, None, DC, 248, 319, elements(DC, 248, 319), "Personnel leadership"),
    mod("5", "Fiscal Responsibility & Resource Management", 20, None, DC, 320, 387, elements(DC, 320, 387), "Fiscal"),
]
DC_WTP = {"key": "dc-wtp", "name": "Deputy Chief – Working Test Period", "rank": "Deputy Chief", "kind": "wtp", "sort": 60,
    "description": "12-month Working Test Period for Deputy Chiefs: five categories, each factor scored 1–5. Final average of 80% or more required.",
    "data": {"scale": {"min": 1, "max": 5}, "passComposite": 80, "passModule": 0, "months": 12, "reviews": [1, 3, 6, 9, 12],
        "evaluators": "Fire Chief, peer chiefs; final review by the Fire Chief / Board.", "signatures": ["Fire Chief"],
        "outcomes": ["Recommendation for Permanent Appointment", "Recommendation Extension / Development Plan", "Do Not Recommend Appointment"],
        "requirements": [r.split(" | ")[:2] for r in DC[46:53] if " | " in r and not r.startswith("Area")],
        "overview": text(DC, 1, 78), "modules": dc_mods}}

progs = [CO_WTP, CO_FORM, CO_MX, BC_WTP, BC_MX, DC_WTP]
for p in progs:
    for m in p["data"]["modules"]:
        assert m["elements"], (p["key"], m["key"])
        print(p["key"], m["key"], m["weight"], len(m["elements"]), [e["mult"] for e in m["elements"]], file=sys.stderr)
out = sys.argv[2]
with open(out, "w", encoding="utf-8") as f:
    f.write("// Evaluation programs seeded from SGFD's documents (Company Officer Evaluation, Battalion Chief Testing & Evaluation\n"
            "// Strategy, Deputy Chief Working Test Evaluation). Generated once; after seeding, programs are edited in the app.\n"
            "// `guide` is the document's own text for that module (scenario, tasks, prompts, expected behaviors, deliverables).\n")
    f.write("export const PROGRAM_SEEDS = " + json.dumps(progs, ensure_ascii=False, indent=0) + ";\n")
