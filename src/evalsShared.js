// Shared helpers for Evaluations (Evals.jsx) and the voice simulator (EvalSim.jsx)
export const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", PAPER = "#F3F5F8", BRICK = "#C8102E", SAGE = "#2E7D4F", AMBER = "#B26A00", BLUE = "#1D5FA8";
export async function call(path, body) {
  const r = await fetch(`/api/evals${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || "That didn't work."), { status: r.status });
  return j;
}
export const label = { fontSize: 12.5, color: INK_SOFT, fontWeight: 600, display: "block", marginBottom: 4 };
export const KIND_LABEL = { practice: "Practice", formal: "Formal evaluation", retest: "Retest" };
export const pctColor = (p, min = 70, pass = 80) => p === null || p === undefined ? INK_SOFT : p >= pass ? SAGE : p >= min ? AMBER : BRICK;
export const fmtDay = d => d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
export const fmtWhen = d => d ? new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
export const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
export const fileB64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(f); });
// Same math as server/evals.js modulePct
export function modulePct(mod, scores, scale) {
  let got = 0, max = 0, n = 0;
  (mod.elements || []).forEach((e, i) => {
    const s = scores?.[i];
    if (s === null || s === undefined || s === "" || !Number.isFinite(Number(s))) return;
    const m = Number(e.mult) || 1; got += Number(s) * m; max += scale.max * m; n++;
  });
  return { pct: max ? Math.round((got / max) * 1000) / 10 : null, points: got, complete: n === (mod.elements || []).length && n > 0 };
}
// Pass/fail programs carry scale.labels (["Fail", "Pass"]); points programs don't
export const isPassFail = sc => Array.isArray(sc?.labels) && sc.labels.length === Number(sc.max) - Number(sc.min) + 1;
export const scoreText = (sc, v) => v === null || v === undefined || v === "" ? "" : isPassFail(sc) ? sc.labels[Number(v) - Number(sc.min)] ?? String(v) : String(v);
export const scaleText = sc => isPassFail(sc) ? sc.labels.slice().reverse().join(" / ") : `${sc.min}–${sc.max}`;
// Pass/fail tally for one result: elements failed / not scored over the result's modules
export function tally(mods, r, sc) {
  let failed = 0, missing = 0, total = 0;
  for (const k of r.modules || []) {
    const m = mods.find(x => x.key === k); if (!m) continue;
    (m.elements || []).forEach((e, i) => { total++; const v = r.scores?.[k]?.[i]; if (v === null || v === undefined || v === "") missing++; else if (Number(v) < Number(sc.max)) failed++; });
  }
  return { failed, missing, total };
}
// Same as server/evals.js unitKind / APPARATUS (feet)
export function unitKind(name) {
  const s = String(name || "").trim();
  if (/^(engine|eg|e|pumper)[ -]?\d/i.test(s)) return "engine";
  if (/^(ladder|ar|truck|t|tower|quint|aerial)[ -]?\d/i.test(s)) return "ladder";
  if (/^(squad|sq|rescue|r)[ -]?\d/i.test(s)) return "squad";
  if (/^(medic|md|m|ambulance|ems)[ -]?\d/i.test(s)) return "medic";
  if (/^(tanker|tk|tender)[ -]?\d/i.test(s)) return "tanker";
  if (/^(sg|bc|battalion|chief|car|command)/i.test(s)) return "command";
  return "unit";
}
export const APPARATUS = { engine: { l: 34, w: 9, hose: 200, color: "#C8102E" }, ladder: { l: 45, w: 9, reach: 100, color: "#E2631B" },
  squad: { l: 32, w: 9, color: "#1D5FA8" }, medic: { l: 24, w: 8, color: "#F2F2F2" }, tanker: { l: 34, w: 9, color: "#8E1B1B" },
  command: { l: 18, w: 7, color: "#F5F5F5" }, unit: { l: 28, w: 8, color: "#6B7280" } };
