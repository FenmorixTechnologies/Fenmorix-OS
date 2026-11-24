// Patterns people type into settings (job titles, call types, unit filters) run on the server. A pattern with nested
// repeats like (a+)+ can take so long on some text that the whole server stalls, so those are refused up front.
export function risky(p) {
  const s = String(p || "");
  if (s.length > 300) return true;
  if (/\\[1-9]/.test(s)) return true;                                            // back-references
  // a group that repeats something inside it, itself repeated: (x+)+  (x*)*  (x+){2,}  (a|aa)+
  const groups = /\(([^()]*)\)\s*(\*|\+|\{\d*,?\d*\})/g;
  let m;
  while ((m = groups.exec(s))) if (/[*+]|\{\d*,/.test(m[1]) || /\|/.test(m[1])) return true;
  return false;
}
export function patternError(p, what = "pattern") {
  try { new RegExp(p, "i"); } catch { return `That ${what} isn't valid.`; }
  return risky(p) ? `That ${what} is too complicated (repeats inside repeats). Use plain words separated by |.` : "";
}
