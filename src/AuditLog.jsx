// System audit log: every section's entries (server/audit.js). Master admins and "Audit log: View".
import React, { useEffect, useState } from "react";
import { History, Download, Printer, Search } from "lucide-react";
import AppShell from "./AppShell.jsx";
import { cardStyle, inputStyle, btn, printDocument, letterhead } from "./App.jsx";
import { PN } from "./brand.js";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", PAPER = "#F3F5F8", BRICK = "#C8102E";
const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const when = v => new Date(v).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
const get = async path => { const r = await fetch(`/api/audit${path}`, { credentials: "same-origin" }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Couldn't load the audit log."); return j; };

export default function AuditLogModule({ onBack }) {
  const [meta, setMeta] = useState(null), [data, setData] = useState(null), [error, setError] = useState("");
  const [f, setF] = useState({ from: "", to: "", module: "", actor: "", q: "" }), [applied, setApplied] = useState(f);
  const [page, setPage] = useState(1), [size, setSize] = useState(50);
  const qs = (extra = {}) => new URLSearchParams(Object.fromEntries(Object.entries({ ...applied, ...extra }).filter(([, v]) => v !== "" && v !== null))).toString();
  useEffect(() => { get("/meta").then(setMeta, e => setError(e.message)); }, []);
  useEffect(() => { setData(null); get(`?${qs({ page, size })}`).then(setData, e => setError(e.message)); }, [applied, page, size]);   // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const apply = e => { e?.preventDefault(); setPage(1); setApplied(f); };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1;
  const ctl = { ...inputStyle, width: "auto", padding: "6px 9px", fontSize: 13 };
  const print = () => printDocument("Audit log", `${letterhead("System audit log")}
    <div style="font-size:12px;margin-bottom:6px">${esc([applied.module, applied.actor, applied.q && `"${applied.q}"`, applied.from && `from ${applied.from}`, applied.to && `to ${applied.to}`].filter(Boolean).join(" · ") || "All entries")} · page ${data.page} of ${pages}</div>
    <table><thead><tr><th>When</th><th>Person</th><th>Section</th><th>Action</th><th>Detail</th></tr></thead><tbody>
    ${data.rows.map(r => `<tr><td>${esc(when(r.at))}</td><td>${esc(r.actor)}</td><td>${esc(r.module)}</td><td>${esc(r.action)}</td><td>${esc(r.detail)}</td></tr>`).join("")}</tbody></table>`);
  return (
    <AppShell section="Audit Log" nav={[{ key: "log", label: "All entries", icon: History }]} active="log" onNav={() => {}} onHome={onBack} wide>
      <div style={{ fontSize: 24, fontWeight: 800, color: INK }}>System audit log</div>
      <div style={{ fontSize: 13.5, color: INK_SOFT, marginBottom: 12 }}>Every change in every section of {PN}: who did it, what, and when. Entries can't be edited or deleted.
        {meta?.n ? ` ${meta.n.toLocaleString()} entries since ${new Date(meta.first).toLocaleDateString()}.` : ""}</div>
      {error && <div role="alert" style={{ ...cardStyle, color: BRICK }}>{error}</div>}
      <form onSubmit={apply} style={{ ...cardStyle, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ fontSize: 12, color: INK_SOFT, fontWeight: 600 }}>From<input aria-label="From" type="date" style={{ ...ctl, display: "block" }} value={f.from} onChange={e => set("from", e.target.value)} /></label>
        <label style={{ fontSize: 12, color: INK_SOFT, fontWeight: 600 }}>To<input aria-label="To" type="date" style={{ ...ctl, display: "block" }} value={f.to} onChange={e => set("to", e.target.value)} /></label>
        <label style={{ fontSize: 12, color: INK_SOFT, fontWeight: 600 }}>Section<select aria-label="Section" style={{ ...ctl, display: "block" }} value={f.module} onChange={e => set("module", e.target.value)}>
          <option value="">All sections</option>{(meta?.modules || []).map(m => <option key={m.module} value={m.module}>{m.module} ({m.n.toLocaleString()})</option>)}</select></label>
        <label style={{ fontSize: 12, color: INK_SOFT, fontWeight: 600 }}>Person<select aria-label="Person" style={{ ...ctl, display: "block", maxWidth: 220 }} value={f.actor} onChange={e => set("actor", e.target.value)}>
          <option value="">Everyone</option>{(meta?.people || []).map(m => <option key={m.name} value={m.name}>{m.name}</option>)}</select></label>
        <label style={{ fontSize: 12, color: INK_SOFT, fontWeight: 600, flex: "1 1 200px" }}>Search action or detail<input aria-label="Search the audit log" style={{ ...ctl, display: "block", width: "100%" }} value={f.q} onChange={e => set("q", e.target.value)} placeholder="e.g. requisition title, a name, 'deleted'" /></label>
        <button type="submit" style={btn("primary")}><Search size={14} /> Show</button>
        <button type="button" style={btn("ghost")} onClick={() => { const z = { from: "", to: "", module: "", actor: "", q: "" }; setF(z); setPage(1); setApplied(z); }}>Clear</button>
      </form>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "4px 0 8px" }}>
        <span style={{ fontSize: 13, color: INK_SOFT }}>{data ? `${data.total.toLocaleString()} entr${data.total === 1 ? "y" : "ies"}${data.total ? `, showing ${(data.page - 1) * data.size + 1}–${Math.min(data.total, data.page * data.size)}` : ""}` : "Loading…"}</span>
        <span style={{ display: "flex", gap: 8 }}>
          <select aria-label="Rows per page" style={ctl} value={size} onChange={e => { setSize(Number(e.target.value)); setPage(1); }}>{[25, 50, 100, 250].map(n => <option key={n} value={n}>{n} per page</option>)}</select>
          <a href={`/api/audit/export.csv?${qs()}`} download style={{ ...btn("outline"), textDecoration: "none" }}><Download size={14} /> CSV</a>
          <button type="button" style={btn("outline")} disabled={!data} onClick={print}><Printer size={14} /> Print page</button>
        </span>
      </div>
      <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <table aria-label="Audit log" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: PAPER, textAlign: "left", color: INK_SOFT, fontSize: 12 }}>{["When", "Person", "Section", "Action", "Detail"].map(h => <th key={h} style={{ padding: "8px 10px" }}>{h}</th>)}</tr></thead>
          <tbody>{(data?.rows || []).map(r => (
            <tr key={r.id} style={{ borderTop: `1px solid ${LINE}`, verticalAlign: "top" }}>
              <td style={{ padding: "7px 10px", whiteSpace: "nowrap", color: INK_SOFT }}>{when(r.at)}</td>
              <td style={{ padding: "7px 10px", whiteSpace: "nowrap" }}><b>{r.actor}</b><div style={{ fontSize: 11.5, color: INK_SOFT }}>{r.role}</div></td>
              <td style={{ padding: "7px 10px", whiteSpace: "nowrap" }}>{r.module}</td>
              <td style={{ padding: "7px 10px" }}>{r.action}</td>
              <td style={{ padding: "7px 10px", color: INK_SOFT, wordBreak: "break-word", minWidth: 220 }}>{r.detail}</td>
            </tr>))}
            {data && !data.rows.length && <tr><td colSpan={5} style={{ padding: 16, color: INK_SOFT }}>No entries match.</td></tr>}</tbody>
        </table>
      </div>
      {data && pages > 1 && <div style={{ display: "flex", gap: 8, justifyContent: "center", alignItems: "center", marginTop: 10 }}>
        <button type="button" style={btn("outline")} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹ Newer</button>
        <span style={{ fontSize: 13, color: INK_SOFT }}>Page {page} of {pages.toLocaleString()}</span>
        <button type="button" style={btn("outline")} disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Older ›</button>
      </div>}
    </AppShell>
  );
}
