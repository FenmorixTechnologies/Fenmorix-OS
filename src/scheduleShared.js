// Small helpers shared by the Work Schedule page, the Your Day card and the TV view (no App.jsx import: Display.jsx uses this).
export const fmtTime = t => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? " am" : " pm"}`;
};
export const fmtRange = (s, e) => `${fmtTime(s)} – ${fmtTime(e)}`;
export const STATUS = {
  working: { label: "Working now", color: "#2E7D4F" },
  later: { label: "Later today", color: "#1E6BD6" },
  left_early: { label: "Left early", color: "#B26A00" },
  done: { label: "Done for the day", color: "#6B7280" },
  out: { label: "Out", color: "#B42318" },
};
// One line for a person's day: "8 am – 4:30 pm · leaving early 2 pm"
export const dayLine = e => `${fmtRange(e.start, e.end)}${e.earlyAt ? ` · leaving early ${fmtTime(e.earlyAt)}` : ""}`;
