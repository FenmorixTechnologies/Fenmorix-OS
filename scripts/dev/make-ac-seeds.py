#!/usr/bin/env python3
"""Builds server/evalSeedsAC.js from the Assistant Chief Evaluation & Testing Framework (.docx converted to text):
   pandoc framework.docx -t plain --wrap=none -o ac.txt
   python3 make-ac-seeds.py ac.txt ../../server/evalSeedsAC.js
Two programs: ac-wtp (12-month working test period, modules A-F, five elements each, 0-5) and ac-matrix (the evaluation
matrix, modules A-E with x1/x2 multipliers, 170 points)."""
import sys, re, json

src = open(sys.argv[1], encoding="utf-8").read().replace("\r", "")
lines = src.split("\n")

def tidy(block):
    out = []
    for l in block.split("\n"):
        if re.fullmatch(r"\s*-{3,}[\s-]*", l):            # table rules
            continue
        l = l.rstrip()
        if re.match(r"^\s{2,}\S", l) and re.search(r"\S\s{3,}\S", l):   # table row: columns -> " | "
            l = " | ".join(c for c in re.split(r"\s{3,}", l.strip()) if c)
        out.append(l.strip() if not l.lstrip().startswith("-") else l)
    text = "\n".join(out)
    return re.sub(r"\n{3,}", "\n\n", text).strip()

def between(start, end):
    i = src.index(start)
    j = src.index(end, i + len(start)) if end else len(src)
    return src[i:j]

def elements_from(block):
    els, on = [], False
    for row in tidy(block).split("\n"):
        if row.startswith("Performance Element") or row.startswith("Evaluation Element"):
            on = True; continue
        if on:
            if row.startswith("Total") or row.startswith("Module ") and "Total" in row: break
            cells = [c.strip() for c in row.split("|")]
            if not cells[0]: continue
            mult = 1
            m = re.search(r"×\s*(\d+(?:\.\d+)?)", row)
            if m: mult = float(m.group(1)); mult = int(mult) if mult == int(mult) else mult
            els.append({"label": cells[0], "mult": mult})
    return els

MATRIX_HEAD = "St. George Fire Protection District – Assistant Chief Evaluation Matrix"
overview = tidy(src[:src.index("Module A – Strategic Oversight & District Continuity (Senior Advisor Role)")])
heads = [("A", "Module A – Strategic Oversight & District Continuity (Senior Advisor Role)", "Strategic Oversight & District Continuity", 1),
         ("B", "Module B – Shift Operations & Staffing Control (Expanded Real-World Scenario)", "Shift Operations & Staffing Control", 1),
         ("C", "Module C – Battalion Oversight & Policy-Compliance Quality Control", "Battalion Oversight & Policy-Compliance Quality Control", 2),
         ("D", "Module D – Personnel & Leadership Management", "Personnel & Leadership Management", 2),
         ("E", "Module E – Strategic Coordination & Inter-Divisional Operations", "Strategic Coordination & Inter-Divisional Operations", 3)]
mods = []
for n, (key, head, title, q) in enumerate(heads):
    end = heads[n + 1][1] if n + 1 < len(heads) else MATRIX_HEAD
    block = between(head, end)
    mods.append({"key": key, "title": title, "weight": None, "quarter": q, "competency": title, "sim": False,
                 "elements": elements_from(block), "guide": tidy(block)})
# Module F is listed in the framework (Professionalism & Command Readiness: reflective essay + evaluator observation) but has
# no write-up; it uses the framework's own five-criteria rubric until one is added.
mods.append({"key": "F", "title": "Professionalism & Command Readiness", "weight": None, "quarter": 3, "competency": "Professionalism & Command Presence", "sim": False,
  "elements": [{"label": l, "mult": 1} for l in ["Operational Decision-Making", "Policy Compliance", "Leadership & Communication", "Documentation & Reporting", "Professionalism & Command Presence"]],
  "guide": "Module F – Professionalism & Command Readiness\nFocus: Evaluate ethics, conduct, and decision-making under pressure.\nDeliverable: Reflective Essay & Evaluator Observation.\n\nThe framework lists this module but doesn't write out a scenario; it is scored with the framework's five-criteria rubric (0–5 each, 25 points): Operational Decision-Making, Policy Compliance, Leadership & Communication, Documentation & Reporting, Professionalism & Command Presence.",
  "note": "No scenario in the framework document yet: scored with the framework's five-criteria rubric."})

matrix = between(MATRIX_HEAD, None)
mhead = tidy(matrix[:matrix.index("Module A – Strategic Oversight & District Continuity")])
mm = []
mheads = [("A", "Module A – Strategic Oversight & District Continuity", "Strategic Oversight & District Continuity", 35),
          ("B", "Module B – Shift Operations & Staffing Control", "Shift Operations & Staffing Control", 35),
          ("C", "Module C – Battalion Oversight & Policy Compliance", "Battalion Oversight & Policy Compliance", 30),
          ("D", "Module D – Personnel & Leadership Management", "Personnel & Leadership Management", 35),
          ("E", "Module E – Strategic Coordination & Inter-Divisional Operations", "Strategic Coordination & Inter-Divisional Operations", 35)]
for n, (key, head, title, pts) in enumerate(mheads):
    end = mheads[n + 1][1] if n + 1 < len(mheads) else "Final Scoring Summary"
    block = between(head, end) if head in matrix else ""
    i = matrix.index(head); j = matrix.index(end, i + len(head))
    block = matrix[i:j]
    mm.append({"key": key, "title": title, "weight": pts, "quarter": None, "competency": title, "elements": elements_from(block), "guide": tidy(block)})
summary = tidy(matrix[matrix.index("Final Scoring Summary"):])

wtp = {"key": "ac-wtp", "name": "Assistant Chief – Working Test Period", "rank": "Assistant Chief (Shift Commander)", "kind": "wtp", "sort": 50,
  "description": "12-month Civil Service Working Test Period for Assistant Chiefs (Shift Commanders): modules A–F, two each quarter, 0–5 per element (25 points per module).",
  "data": {"scale": {"min": 0, "max": 5}, "passComposite": 70, "passModule": 70, "months": 12, "reviews": [3, 6, 9, 12],
           "evaluators": "Deputy Chief of Operations or Fire Chief.", "signatures": ["Deputy Chief of Operations", "Fire Chief"],
           "outcomes": ["Recommend permanent appointment", "Extend the working test period", "Do not recommend"],
           "overview": overview, "modules": mods}}
mat = {"key": "ac-matrix", "name": "Assistant Chief – Evaluation Matrix", "rank": "Assistant Chief (Shift Commander)", "kind": "form", "sort": 51,
  "description": "Assistant Chief matrix scored 0–5 with multipliers (170 points).",
  "data": {"scale": {"min": 0, "max": 5}, "passComposite": 70, "passModule": 0, "points": True,
           "bands": [[90, "Outstanding / Ready for Deputy Chief role"], [80, "Highly Proficient / Fully Effective"], [70, "Meets Expectations / Continued Growth"],
                     [60, "Needs Improvement / Coaching Required"], [0, "Unsatisfactory / Reassignment or Development Plan"]],
           "signatures": ["Evaluator", "Deputy Chief of Operations"], "overview": mhead + "\n\n" + summary, "modules": mm}}
for p in (wtp, mat):
    for m in p["data"]["modules"]:
        assert m["elements"], (p["key"], m["key"])
head = ("// Assistant Chief programs, GENERATED by scripts/dev/make-ac-seeds.py from SGFD's \"Assistant Chief Evaluation & Testing\n"
        "// Framework\". Seeded once by key; after that they're edited in the app.\n")
open(sys.argv[2], "w", encoding="utf-8").write(head + "export const AC_PROGRAM_SEEDS = " + json.dumps([wtp, mat], ensure_ascii=False, indent=1) + ";\n")
for p in (wtp, mat):
    print(p["key"], [(m["key"], m["title"], [(e["label"], e["mult"]) for e in m["elements"]], len(m["guide"])) for m in p["data"]["modules"]])
