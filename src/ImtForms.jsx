// ICS form editors for the IMT section (one per kind), and what's still missing on each.
// Each editor gets { d (form data), set(next data), ctx } where ctx = { incident, period, forms, people, files, apparatus,
// readOnly, ai(task, formId) -> draft, uploadFile(file) -> {id, pages}, refreshFiles() }.
import React, { useMemo, useState } from "react";
import { Plus, Trash2, Sparkles, ArrowUp, ArrowDown, CloudSun, Image as ImageIcon, Users } from "lucide-react";
import { PN } from "./brand.js";

export const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", PAPER = "#F3F5F8", BRICK = "#C8102E", SAGE = "#2E7D4F", AMBER = "#B26A00", BLUE = "#1D5FA8";
const FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const input = { width: "100%", boxSizing: "border-box", border: `1px solid ${LINE}`, borderRadius: 6, padding: "6px 8px", fontSize: 13.5, fontFamily: FONT, background: "#fff", color: INK };
const lab = { fontSize: 12, color: INK_SOFT, fontWeight: 700, display: "block", marginBottom: 3 };
const btnS = (kind = "outline") => ({ border: kind === "primary" ? "none" : `1px solid ${kind === "ghost" ? "transparent" : LINE}`, background: kind === "primary" ? INK : kind === "ghost" ? "transparent" : "#fff",
  color: kind === "primary" ? "#fff" : INK, borderRadius: 6, padding: "5px 10px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: FONT, display: "inline-flex", gap: 5, alignItems: "center" });
export const SECTION_LABEL = { command: "Command staff", agency: "Agency / organization representatives", planning: "Planning Section", logistics: "Logistics Section",
  operations: "Operations Section", air: "Air Operations Branch", finance: "Finance/Administration Section" };

// ---- Small building blocks ---------------------------------------------------------------------------
export function Field({ label, value, onChange, rows, placeholder, type, style, aria }) {
  const common = { "aria-label": aria || label, value: value ?? "", placeholder, onChange: e => onChange(e.target.value), style: { ...input, ...(rows ? { resize: "vertical", lineHeight: 1.45 } : {}) } };
  return (
    <label style={{ display: "block", ...style }}>
      {label && <span style={lab}>{label}</span>}
      {rows ? <textarea rows={rows} {...common} /> : <input type={type || "text"} {...common} />}
    </label>
  );
}
function Box({ title, children, extra }) {
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 9, padding: 12, marginBottom: 12, background: "#fff" }}>
      {(title || extra) && <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ fontWeight: 800, color: INK, fontSize: 13.5, flex: 1 }}>{title}</div>{extra}</div>}
      {children}
    </div>
  );
}
// A name from the roster (links the account, so they're notified and can open the IAP) or typed in for outside people
export function PersonField({ label, value, onChange, people, aria }) {
  const id = useMemo(() => `pl-${Math.random().toString(36).slice(2)}`, []);
  const v = value || {};
  return (
    <label style={{ display: "block" }}>
      {label && <span style={lab}>{label}{v.userId ? <span title={"Linked to a " + PN + " account"} style={{ color: SAGE, marginLeft: 4 }}>●</span> : null}</span>}
      <input aria-label={aria || label} list={id} value={v.name || ""} style={input} placeholder="Name"
        onChange={e => { const name = e.target.value; const p = (people || []).find(x => x.name.toLowerCase() === name.trim().toLowerCase()); onChange({ ...v, name, userId: p ? p.id : null, ...(p && !v.contact && p.phone ? { contact: p.phone } : {}) }); }} />
      <datalist id={id}>{(people || []).map(p => <option key={p.id} value={p.name}>{p.title}</option>)}</datalist>
    </label>
  );
}
// Editable rows (table on wide screens)
export function Rows({ rows, cols, onChange, add, min = 0, aria }) {
  const list = rows || [];
  const set = (i, k, v) => onChange(list.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const blankRow = Object.fromEntries(cols.map(c => [c.key, c.type === "check" ? false : ""]));
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: cols.length > 5 ? 760 : 0 }}>
        <thead><tr>{cols.map(c => <th key={c.key} style={{ textAlign: "left", fontSize: 11.5, color: INK_SOFT, padding: "3px 4px", width: c.width }}>{c.label}</th>)}<th style={{ width: 66 }} /></tr></thead>
        <tbody>
          {list.map((r, i) => (
            <tr key={i}>
              {cols.map(c => (
                <td key={c.key} style={{ padding: "2px 3px", verticalAlign: "top" }}>
                  {c.type === "check" ? <input type="checkbox" aria-label={`${aria || "Row"} ${i + 1} ${c.label}`} checked={!!r[c.key]} onChange={e => set(i, c.key, e.target.checked)} />
                    : c.type === "select" ? <select aria-label={`${aria || "Row"} ${i + 1} ${c.label}`} style={input} value={r[c.key] || ""} onChange={e => set(i, c.key, e.target.value)}>
                      <option value="" />{c.options.map(o => <option key={o}>{o}</option>)}</select>
                    : c.rows ? <textarea aria-label={`${aria || "Row"} ${i + 1} ${c.label}`} rows={c.rows} style={{ ...input, resize: "vertical" }} value={r[c.key] || ""} onChange={e => set(i, c.key, e.target.value)} />
                    : <input aria-label={`${aria || "Row"} ${i + 1} ${c.label}`} list={c.list} type={c.type || "text"} style={input} value={r[c.key] || ""} onChange={e => set(i, c.key, e.target.value)} />}
                </td>
              ))}
              <td style={{ whiteSpace: "nowrap", verticalAlign: "top" }}>
                <button type="button" aria-label={`Move ${aria || "row"} ${i + 1} up`} style={{ ...btnS("ghost"), padding: 3 }} disabled={i === 0} onClick={() => { const n = [...list]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n); }}><ArrowUp size={13} /></button>
                <button type="button" aria-label={`Remove ${aria || "row"} ${i + 1}`} style={{ ...btnS("ghost"), padding: 3, color: BRICK }} disabled={list.length <= min} onClick={() => onChange(list.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" style={{ ...btnS(), marginTop: 6 }} onClick={() => onChange([...list, blankRow])}><Plus size={13} /> {add || "Add a row"}</button>
    </div>
  );
}
function Prepared({ v, onChange, label = "Prepared by", position, people }) {
  const val = v || {};
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8, marginTop: 6 }}>
      <PersonField label={`${label}: name`} value={val} people={people} onChange={x => onChange({ ...val, ...x })} />
      <Field label="Position/title" value={val.position} placeholder={position} onChange={x => onChange({ ...val, position: x })} />
      <Field label="Date/time" type="datetime-local" value={val.at} onChange={x => onChange({ ...val, at: x })} />
    </div>
  );
}
function AiButton({ ctx, task, formId, onDraft, label }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (ctx.readOnly) return null;
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <button type="button" style={btnS()} disabled={busy} onClick={async () => { setBusy(true); setError(""); try { onDraft(await ctx.ai(task, formId)); } catch (e) { setError(e.message); } setBusy(false); }}>
        <Sparkles size={13} color={BLUE} /> {busy ? "Drafting…" : label}</button>
      {error && <span role="alert" style={{ fontSize: 12, color: BRICK, maxWidth: 360 }}>{error}</span>}
    </span>
  );
}
function Draft({ draft, onUse, onClose, render }) {
  if (!draft) return null;
  return (
    <div role="region" aria-label="Suggested draft" style={{ border: `1.5px dashed ${BLUE}`, borderRadius: 9, padding: 10, background: "#F4F8FE", marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: BLUE, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Suggested draft (check it before using it)</div>
      <div style={{ fontSize: 13, whiteSpace: "pre-wrap", color: INK }}>{render(draft)}</div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>{onUse.map(([label, fn]) => <button key={label} type="button" style={btnS("primary")} onClick={() => { fn(draft); onClose(); }}>{label}</button>)}
        <button type="button" style={btnS("ghost")} onClick={onClose}>Discard</button></div>
    </div>
  );
}

// ---- What's missing (for the checklist and the left list) ----------------------------------------------
export function missing(kind, d, ctx) {
  const m = [];
  const has = v => String(v ?? "").trim() !== "";
  const prepared = (p, what = "Prepared by") => { if (!has(p?.name)) m.push(`${what}`); };
  switch (kind) {
    case "202": if (!(d.objectives || []).some(has)) m.push("Objectives"); prepared(d.prepared); if (!has(d.approved?.name)) m.push("Approved by (IC)"); break;
    case "203": {
      const rows = d.rows || [];
      const need = [["command", /^IC/], ["operations", /^Chief$/], ["planning", /^Chief$/], ["logistics", /^Chief$/]];
      for (const [s, re] of need) if (!rows.some(r => r.section === s && re.test(r.role) && has(r.name))) m.push(`${s === "command" ? "Incident Commander" : `${s[0].toUpperCase()}${s.slice(1)} Section Chief`}`);
      if (!rows.some(r => r.section === "command" && /Safety/.test(r.role) && has(r.name))) m.push("Safety Officer");
      prepared(d.prepared); break;
    }
    case "204": if (!has(d.division) && !has(d.group) && !has(d.branch)) m.push("Branch, division or group");
      if (!(d.resources || []).some(r => has(r.ident))) m.push("Resources assigned"); if (!has(d.work)) m.push("Work assignments"); prepared(d.prepared); break;
    case "205": if (!(d.channels || []).some(c => has(c.name) || has(c.rxFreq))) m.push("Radio channels"); prepared(d.prepared); break;
    case "205a": if (!(d.rows || []).some(r => has(r.name))) m.push("Contacts"); break;
    case "206": if (!(d.hospitals || []).some(h => has(h.name))) m.push("Hospitals"); if (!(d.transport || []).some(h => has(h.name))) m.push("Ambulance / transport");
      if (!has(d.procedures)) m.push("Medical emergency procedures"); prepared(d.prepared, "Prepared by (Medical Unit)"); if (!has(d.approved?.name)) m.push("Approved by (Safety Officer)"); break;
    case "208": if (!has(d.message)) m.push("Safety message"); prepared(d.prepared); break;
    case "214": if (!has(d.name)) m.push("Name"); if (!(d.log || []).some(l => has(l.text))) m.push("Activity entries"); break;
    case "213": if (!has(d.to?.name)) m.push("To"); if (!has(d.message)) m.push("Message"); break;
    case "220": if (!(d.aircraft || []).length && !(d.frequencies || []).length) m.push("Aircraft or frequencies"); break;
    case "weather": if (!d.snapshot && !has(d.notes)) m.push("Forecast"); break;
    case "attachment": if (!d.fileId) m.push("File"); break;
    case "cover": break;
    default: break;
  }
  return m;
}
export const formLabel = (f, kinds) => {
  const d = f.data || {};
  if (f.kind === "204") return `ICS 204 · ${[d.branch && `Br ${d.branch}`, d.division && `Div ${d.division}`, d.group].filter(Boolean).join(" / ") || "new assignment"}`;
  if (f.kind === "214") return `ICS 214 · ${d.name || "activity log"}`;
  if (f.kind === "213") return `ICS 213 · ${d.subject || "message"}`;
  if (f.kind === "attachment") return `Attachment · ${d.title || "untitled"}`;
  return (kinds[f.kind] || f.kind).replace(/^ICS (\w+) /, "ICS $1 · ");
};

// ---- The editors -------------------------------------------------------------------------------------
function Cover({ d, set, ctx }) {
  const images = (ctx.files || []).filter(f => /^image\//.test(f.mime));
  return (
    <>
      <Box title="Cover page">
        <div style={{ display: "grid", gap: 8 }}>
          <Field label="Title" value={d.title} onChange={v => set({ ...d, title: v })} />
          <Field label="Subtitle (location, day)" value={d.subtitle} onChange={v => set({ ...d, subtitle: v })} />
          <label><span style={lab}>Photo</span>
            <select aria-label="Cover photo" style={input} value={d.photo || ""} onChange={e => set({ ...d, photo: e.target.value || null })}>
              <option value="">No photo</option>{images.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
          {!ctx.readOnly && <UploadButton ctx={ctx} accept="image/*" label="Upload a photo" onDone={r => set({ ...d, photo: r.id })} />}
          {d.photo && <img alt="Cover" src={`/api/imt/files/${d.photo}`} style={{ maxWidth: 320, maxHeight: 220, borderRadius: 6, border: `1px solid ${LINE}` }} />}
          <Field label="Note under the period (optional)" value={d.note} onChange={v => set({ ...d, note: v })} />
        </div>
      </Box>
      <div style={{ fontSize: 12.5, color: INK_SOFT }}>The incident name, number and operational period come from the incident and period automatically.</div>
    </>
  );
}

function F202({ d, set, ctx }) {
  const [draft, setDraft] = useState(null);
  const objectives = d.objectives?.length ? d.objectives : [""];
  const setObj = list => set({ ...d, objectives: list });
  const included = ctx.forms.map(f => f.kind);
  return (
    <>
      <Draft draft={draft} onClose={() => setDraft(null)} render={x => [(x.objectives || []).map((o, i) => `${i + 1}. ${o}`).join("\n"), x.emphasis && `\nCommand emphasis:\n${x.emphasis}`, x.awareness && `\nSituational awareness:\n${x.awareness}`].filter(Boolean).join("\n")}
        onUse={[["Use these", x => set({ ...d, objectives: x.objectives || d.objectives, emphasis: x.emphasis || d.emphasis, awareness: x.awareness || d.awareness })],
          ["Add the objectives to mine", x => set({ ...d, objectives: [...objectives.filter(o => o.trim()), ...(x.objectives || [])] })]]} />
      <Box title="3. Objective(s)" extra={<AiButton ctx={ctx} task="objectives" label="Suggest objectives" onDraft={setDraft} />}>
        {objectives.map((o, i) => (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 6 }}>
            <b style={{ width: 22, paddingTop: 7, color: INK_SOFT }}>{i + 1}.</b>
            <textarea aria-label={`Objective ${i + 1}`} rows={2} style={{ ...input, flex: 1, resize: "vertical" }} value={o} onChange={e => setObj(objectives.map((x, j) => (j === i ? e.target.value : x)))} />
            <button type="button" aria-label={`Remove objective ${i + 1}`} style={{ ...btnS("ghost"), color: BRICK }} onClick={() => setObj(objectives.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
          </div>
        ))}
        <button type="button" style={btnS()} onClick={() => setObj([...objectives, ""])}><Plus size={13} /> Add an objective</button>
        <div style={{ fontSize: 11.5, color: INK_SOFT, marginTop: 6 }}>SMART: specific, measurable, action-oriented, realistic, time-bound. Life safety first, then incident stabilization, then property and the environment.</div>
      </Box>
      <Box title="4. Operational period command emphasis">
        <Field rows={5} aria="Command emphasis" value={d.emphasis} onChange={v => set({ ...d, emphasis: v })} />
        <div style={{ marginTop: 8 }}><Field label="General situational awareness" rows={5} value={d.awareness} onChange={v => set({ ...d, awareness: v })} /></div>
      </Box>
      <Box title="5. Site safety plan">
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5 }}><input type="checkbox" checked={!!d.siteSafety?.required} onChange={e => set({ ...d, siteSafety: { ...d.siteSafety, required: e.target.checked } })} /> Site safety plan required</label>
        {d.siteSafety?.required && <Field label="Approved site safety plan(s) located at" value={d.siteSafety?.location} onChange={v => set({ ...d, siteSafety: { ...d.siteSafety, location: v } })} style={{ marginTop: 6 }} />}
      </Box>
      <Box title="6. Incident Action Plan contents">
        <div style={{ fontSize: 13, color: INK_SOFT, marginBottom: 6 }}>Checked from the forms in this IAP: {["203", "204", "205", "205a", "206", "207", "208", "220"].filter(k => included.includes(k)).map(k => `ICS ${k.toUpperCase()}`).join(", ") || "none yet"}
          {included.includes("attachment") ? ", Map/Chart" : ""}{included.includes("weather") ? ", Weather forecast" : ""}.</div>
        <span style={lab}>Other attachments</span>
        <Rows aria="Attachment" rows={d.other} cols={[{ key: "label", label: "Attachment" }, { key: "included", label: "Included", type: "check", width: 70 }]} add="Add an attachment line" onChange={v => set({ ...d, other: v })} />
      </Box>
      <Box title="7-8. Prepared / approved">
        <Prepared v={d.prepared} people={ctx.people} position="PSC" onChange={v => set({ ...d, prepared: v })} />
        <div style={{ marginTop: 8, maxWidth: 360 }}><PersonField label="Approved by Incident Commander" value={d.approved} people={ctx.people} onChange={v => set({ ...d, approved: v })} /></div>
        <div style={{ fontSize: 11.5, color: INK_SOFT, marginTop: 4 }}>The IC's signature is added when the IAP is approved.</div>
      </Box>
    </>
  );
}

function F203({ d, set, ctx }) {
  const rows = d.rows || [];
  const update = (i, patch) => set({ ...d, rows: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const add = (section, role) => set({ ...d, rows: [...rows, { section, role, label: "", name: "", userId: null, agency: "", contact: "" }] });
  const remove = i => set({ ...d, rows: rows.filter((_, j) => j !== i) });
  const bySection = s => rows.map((r, i) => [r, i]).filter(([r]) => r.section === s);
  const sectionBox = s => (
    <Box key={s} title={SECTION_LABEL[s]} extra={!ctx.readOnly && (
      s === "operations" ? <span style={{ display: "flex", gap: 4 }}><button type="button" style={btnS()} onClick={() => add(s, "Branch")}><Plus size={12} /> Branch</button>
        <button type="button" style={btnS()} onClick={() => add(s, "Division/Group")}><Plus size={12} /> Division/Group</button></span>
        : <button type="button" style={btnS()} onClick={() => add(s, s === "agency" ? "Agency Representative" : s === "planning" ? "Technical Specialist" : "Position")}><Plus size={12} /> {s === "agency" ? "Agency" : "Position"}</button>)}>
      {bySection(s).map(([r, i]) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: s === "agency" ? "1fr 1fr 28px" : "minmax(130px, 0.8fr) minmax(110px, 0.7fr) 1fr 28px", gap: 6, alignItems: "end", marginBottom: 5 }}>
          {s === "agency"
            ? <Field aria={`Agency ${i}`} value={r.agency} placeholder="Agency / organization" onChange={v => update(i, { agency: v })} />
            : <Field aria={`Role ${i}`} value={r.role} onChange={v => update(i, { role: v })} />}
          {s !== "agency" && (/^(Division\/Group|Division|Group|Branch|Technical Specialist|Position)$/.test(r.role)
            ? <Field aria={`${r.role} ${i} name`} value={r.label} placeholder={/Branch/.test(r.role) ? "Branch name" : /Specialist/.test(r.role) ? "Specialty" : "e.g. Div A, AIR SAR"} onChange={v => update(i, { label: v })} />
            : <span />)}
          <PersonField aria={`${SECTION_LABEL[s]} ${r.role}${r.label ? ` ${r.label}` : ""}`} value={r} people={ctx.people} onChange={v => update(i, { name: v.name, userId: v.userId, ...(v.contact && !r.contact ? { contact: v.contact } : {}) })} />
          <button type="button" aria-label={`Remove ${r.role}`} style={{ ...btnS("ghost"), color: BRICK, padding: 4 }} onClick={() => remove(i)}><Trash2 size={13} /></button>
        </div>
      ))}
      {!bySection(s).length && <div style={{ fontSize: 12.5, color: INK_SOFT }}>None.</div>}
    </Box>
  );
  return (
    <>
      <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 10, display: "flex", gap: 6 }}><Users size={15} style={{ flexShrink: 0 }} />
        Pick people from the roster (green dot = {PN} account): they can open this IAP, get notified, and their Directory phone fills the 205A. Type any other name for outside personnel.</div>
      {["command", "agency", "planning", "logistics", "operations", "air", "finance"].map(sectionBox)}
      <Box title="Prepared by"><Prepared v={d.prepared} people={ctx.people} position="Resources Unit Leader" onChange={v => set({ ...d, prepared: v })} /></Box>
    </>
  );
}

function F204({ d, set, ctx, formId }) {
  const [draft, setDraft] = useState(null);
  const osc = (ctx.forms.find(f => f.kind === "203")?.data.rows || []).find(r => r.section === "operations" && r.role === "Chief");
  const apparatusList = `ap-${formId}`;
  return (
    <>
      <Box title="3. Branch / division / group">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
          <Field label="Branch" value={d.branch} onChange={v => set({ ...d, branch: v })} />
          <Field label="Division" value={d.division} onChange={v => set({ ...d, division: v })} />
          <Field label="Group" value={d.group} onChange={v => set({ ...d, group: v })} />
          <Field label="Staging area" value={d.staging} onChange={v => set({ ...d, staging: v })} />
        </div>
      </Box>
      <Box title="4. Operations personnel">
        <div style={{ fontSize: 13, marginBottom: 6 }}>Operations Section Chief: <b>{osc?.name || "— (set on the 203)"}</b>{osc?.contact ? ` · ${osc.contact}` : ""}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
          <PersonField label="Branch Director" value={d.branchDirector} people={ctx.people} onChange={v => set({ ...d, branchDirector: { ...d.branchDirector, ...v } })} />
          <Field label="Branch Director contact" value={d.branchDirector?.contact} onChange={v => set({ ...d, branchDirector: { ...d.branchDirector, contact: v } })} />
          <PersonField label="Division/Group Supervisor" value={d.supervisor} people={ctx.people} onChange={v => set({ ...d, supervisor: { ...d.supervisor, ...v } })} />
          <Field label="Supervisor contact" value={d.supervisor?.contact} onChange={v => set({ ...d, supervisor: { ...d.supervisor, contact: v } })} />
        </div>
      </Box>
      <Box title="5. Resources assigned">
        <datalist id={apparatusList}>{(ctx.apparatus || []).map(a => <option key={a.id} value={a.unit}>{a.kind}</option>)}</datalist>
        <Rows aria="Resource" rows={d.resources} onChange={v => set({ ...d, resources: v })} add="Add a resource"
          cols={[{ key: "ident", label: "Resource identifier", list: apparatusList, width: "20%" }, { key: "leader", label: "Leader", width: "18%" }, { key: "persons", label: "# of persons", width: 70 },
            { key: "contact", label: "Contact (phone, radio)", width: "20%" }, { key: "notes", label: "Reporting location, special equipment, remarks" }]} />
      </Box>
      <Draft draft={draft} onClose={() => setDraft(null)} render={x => `Work assignments:\n${x.work || ""}\n\nSpecial instructions:\n${x.special || ""}`}
        onUse={[["Use these", x => set({ ...d, work: x.work || d.work, special: x.special || d.special })]]} />
      <Box title="6. Work assignments" extra={<AiButton ctx={ctx} task="work" formId={formId} label="Suggest" onDraft={setDraft} />}>
        <Field rows={6} aria="Work assignments" value={d.work} onChange={v => set({ ...d, work: v })} />
      </Box>
      <Box title="7. Special instructions"><Field rows={4} aria="Special instructions" value={d.special} onChange={v => set({ ...d, special: v })} /></Box>
      <Box title="8. Communications">
        <Rows aria="Communication" rows={d.comms} onChange={v => set({ ...d, comms: v })} add="Add a contact"
          cols={[{ key: "name", label: "Name / function" }, { key: "contact", label: "Primary contact: cell, pager or radio (frequency/system/channel)" }]} />
      </Box>
      <Box title="9. Prepared by"><Prepared v={d.prepared} people={ctx.people} position="OSC" onChange={v => set({ ...d, prepared: v })} /></Box>
    </>
  );
}

export const CH_COLS = [{ key: "zone", label: "Zone/Grp", width: 70 }, { key: "ch", label: "Ch #", width: 50 }, { key: "func", label: "Function", type: "select", options: ["COMMAND", "TACTICAL", "AIR/GROUND", "AIR/AIR", "SUPPORT", "LOGISTICS", "MEDICAL", "OTHER"], width: 115 },
  { key: "name", label: "Channel name / trunked system", width: 120 }, { key: "assignment", label: "Assignment" }, { key: "rxFreq", label: "RX freq N/W", width: 90 },
  { key: "rxTone", label: "RX tone/NAC", width: 70 }, { key: "txFreq", label: "TX freq N/W", width: 90 }, { key: "txTone", label: "TX tone/NAC", width: 70 },
  { key: "mode", label: "Mode", type: "select", options: ["A", "D", "M"], width: 56 }, { key: "remarks", label: "Remarks" }];
function F205({ d, set, ctx }) {
  return (
    <>
      <Box title="4. Basic radio channel use" extra={!ctx.readOnly && <span style={{ display: "flex", gap: 4 }}>
        <button type="button" style={btnS()} onClick={() => ctx.library("channels").then(x => x?.length && set({ ...d, channels: x }))}>Load saved channels</button>
        <button type="button" style={btnS()} onClick={() => ctx.saveLibrary("channels", d.channels)}>Save for next time</button></span>}>
        <Rows aria="Channel" rows={d.channels} onChange={v => set({ ...d, channels: v })} add="Add a channel" cols={CH_COLS} />
      </Box>
      <Box title="5. Special instructions"><Field rows={3} aria="Special instructions" value={d.special} onChange={v => set({ ...d, special: v })} /></Box>
      <Box title="6. Prepared by (Communications Unit Leader)"><Prepared v={d.prepared} people={ctx.people} position="COML" onChange={v => set({ ...d, prepared: v })} /></Box>
      <div style={{ fontSize: 12, color: INK_SOFT }}>Prints in landscape.</div>
    </>
  );
}
function F205a({ d, set, ctx }) {
  return (
    <Box title="3. Basic local communications information" extra={!ctx.readOnly && <button type="button" style={btnS()} onClick={() => ctx.from203().then(rows => set({ ...d, rows }))}>Fill from the 203 and Directory</button>}>
      <Rows aria="Contact" rows={d.rows} onChange={v => set({ ...d, rows: v })} add="Add a contact"
        cols={[{ key: "position", label: "Incident assigned position" }, { key: "name", label: "Name (alphabetized)" }, { key: "contact", label: "Method(s) of contact (phone, pager, cell, etc.)" }]} />
      <div style={{ marginTop: 8 }}><Prepared v={d.prepared} people={ctx.people} onChange={v => set({ ...d, prepared: v })} /></div>
    </Box>
  );
}
function F206({ d, set, ctx }) {
  const libBtns = kind => !ctx.readOnly && <span style={{ display: "flex", gap: 4 }}>
    <button type="button" style={btnS()} onClick={() => ctx.library(kind).then(x => x?.length && set({ ...d, [kind]: x }))}>Load saved</button>
    <button type="button" style={btnS()} onClick={() => ctx.saveLibrary(kind, d[kind])}>Save for next time</button></span>;
  return (
    <>
      <Box title="3. Medical aid stations" extra={libBtns("stations")}>
        <Rows aria="Aid station" rows={d.stations} onChange={v => set({ ...d, stations: v })} add="Add an aid station"
          cols={[{ key: "name", label: "Name" }, { key: "location", label: "Location" }, { key: "contact", label: "Contact number / frequency" }, { key: "als", label: "Paramedics on site (ALS)", type: "check", width: 90 }]} />
      </Box>
      <Box title="4. Transportation (ambulance, air)" extra={libBtns("transport")}>
        <Rows aria="Transport" rows={d.transport} onChange={v => set({ ...d, transport: v })} add="Add a service"
          cols={[{ key: "name", label: "Ambulance service" }, { key: "location", label: "Location" }, { key: "contact", label: "Contact number / frequency" }, { key: "als", label: "ALS", type: "check", width: 50 }]} />
      </Box>
      <Box title="5. Hospitals" extra={libBtns("hospitals")}>
        <Rows aria="Hospital" rows={d.hospitals} onChange={v => set({ ...d, hospitals: v })} add="Add a hospital"
          cols={[{ key: "name", label: "Hospital" }, { key: "address", label: "Address, lat/long if helipad" }, { key: "contact", label: "Contact / frequency" }, { key: "air", label: "Air time", width: 60 },
            { key: "ground", label: "Ground time", width: 70 }, { key: "trauma", label: "Trauma level", width: 70 }, { key: "burn", label: "Burn", type: "check", width: 45 }, { key: "helipad", label: "Helipad", type: "check", width: 55 }]} />
      </Box>
      <Box title="6. Special medical emergency procedures">
        <Field rows={6} aria="Medical emergency procedures" value={d.procedures} onChange={v => set({ ...d, procedures: v })}
          placeholder='e.g. For an "EMERGENCY MEDICAL", the reporting party gives patient condition to the ICP on COMMAND using the Medical Incident Report (ICS 206 WF / 9-line).' />
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5, marginTop: 6 }}><input type="checkbox" checked={!!d.aviation} onChange={e => set({ ...d, aviation: e.target.checked })} /> Aviation assets are used for rescue (coordinate with Air Operations)</label>
      </Box>
      <Box title="7-8. Prepared / approved">
        <Prepared v={d.prepared} people={ctx.people} label="Prepared by (Medical Unit Leader)" position="MEDL" onChange={v => set({ ...d, prepared: v })} />
        <div style={{ marginTop: 8, maxWidth: 360 }}><PersonField label="Approved by Safety Officer" value={d.approved} people={ctx.people} onChange={v => set({ ...d, approved: v })} /></div>
      </Box>
    </>
  );
}
function F208({ d, set, ctx }) {
  const [draft, setDraft] = useState(null);
  return (
    <>
      <Draft draft={draft} onClose={() => setDraft(null)} render={x => x.message} onUse={[["Use this", x => set({ ...d, message: x.message })], ["Add to mine", x => set({ ...d, message: `${d.message ? `${d.message}\n\n` : ""}${x.message}` })]]} />
      <Box title="3. Safety message / expanded safety message, safety plan, site safety plan" extra={<AiButton ctx={ctx} task="safety" label="Suggest a safety message" onDraft={setDraft} />}>
        <Field rows={16} aria="Safety message" value={d.message} onChange={v => set({ ...d, message: v })} />
      </Box>
      <Box title="4. Site safety plan">
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5 }}><input type="checkbox" checked={!!d.siteSafety?.required} onChange={e => set({ ...d, siteSafety: { ...d.siteSafety, required: e.target.checked } })} /> Site safety plan required</label>
        {d.siteSafety?.required && <Field label="Approved site safety plan(s) located at" value={d.siteSafety?.location} onChange={v => set({ ...d, siteSafety: { ...d.siteSafety, location: v } })} style={{ marginTop: 6 }} />}
      </Box>
      <Box title="5. Prepared by (Safety Officer)"><Prepared v={d.prepared} people={ctx.people} position="SOFR" onChange={v => set({ ...d, prepared: v })} /></Box>
    </>
  );
}
function F211({ d, set, ctx }) {
  return (
    <>
      <Box title="Check-in location"><Field aria="Check-in location" value={d.location} onChange={v => set({ ...d, location: v })} placeholder="Base, ICP, staging area, helibase…" /></Box>
      <Box title="Check-in list">
        <Rows aria="Check-in" rows={d.rows} onChange={v => set({ ...d, rows: v })} add="Check in a resource"
          cols={[{ key: "at", label: "Date/time", type: "datetime-local", width: 150 }, { key: "agency", label: "Agency", width: 90 }, { key: "kind", label: "Kind / type", width: 90 }, { key: "ident", label: "Resource name / ID" },
            { key: "orderNo", label: "Order #", width: 70 }, { key: "leader", label: "Leader", width: 110 }, { key: "persons", label: "# pers.", width: 50 }, { key: "contact", label: "Contact", width: 100 },
            { key: "home", label: "Home unit / departure point" }, { key: "assignment", label: "Incident assignment" }, { key: "notes", label: "Other qualifications / notes" }]} />
      </Box>
      <Box title="Prepared by"><Prepared v={d.prepared} people={ctx.people} onChange={v => set({ ...d, prepared: v })} /></Box>
    </>
  );
}
function F213({ d, set, ctx }) {
  return (
    <Box title="General message">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
        <PersonField label="To (name)" value={d.to} people={ctx.people} onChange={v => set({ ...d, to: { ...d.to, ...v } })} />
        <Field label="To (position)" value={d.to?.position} onChange={v => set({ ...d, to: { ...d.to, position: v } })} />
        <PersonField label="From (name)" value={d.from} people={ctx.people} onChange={v => set({ ...d, from: { ...d.from, ...v } })} />
        <Field label="From (position)" value={d.from?.position} onChange={v => set({ ...d, from: { ...d.from, position: v } })} />
        <Field label="Subject" value={d.subject} onChange={v => set({ ...d, subject: v })} style={{ gridColumn: "span 2" }} />
        <Field label="Date/time" type="datetime-local" value={d.at} onChange={v => set({ ...d, at: v })} />
      </div>
      <Field label="Message" rows={8} value={d.message} onChange={v => set({ ...d, message: v })} style={{ marginTop: 8 }} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
        <PersonField label="Approved by (name)" value={d.approved} people={ctx.people} onChange={v => set({ ...d, approved: { ...d.approved, ...v } })} />
        <Field label="Approved by (position)" value={d.approved?.position} onChange={v => set({ ...d, approved: { ...d.approved, position: v } })} />
      </div>
      <Field label="Reply" rows={5} value={d.reply} onChange={v => set({ ...d, reply: v })} style={{ marginTop: 8 }} />
      <Prepared v={d.replyBy} label="Replied by" people={ctx.people} onChange={v => set({ ...d, replyBy: v })} />
    </Box>
  );
}
function F214({ d, set, ctx }) {
  const now = () => { const x = new Date(); const p = n => String(n).padStart(2, "0"); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`; };
  return (
    <>
      <Box title="Who">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8 }}>
          <PersonField label="3. Name" value={d} people={ctx.people} onChange={v => set({ ...d, name: v.name, userId: v.userId })} />
          <Field label="4. ICS position" value={d.position} onChange={v => set({ ...d, position: v })} />
          <Field label="5. Home agency (and unit)" value={d.agency} onChange={v => set({ ...d, agency: v })} />
        </div>
      </Box>
      <Box title="6. Resources assigned">
        <Rows aria="Assigned" rows={d.resources} onChange={v => set({ ...d, resources: v })} add="Add a person" cols={[{ key: "name", label: "Name" }, { key: "position", label: "ICS position" }, { key: "agency", label: "Home agency (and unit)" }]} />
      </Box>
      <Box title="7. Activity log" extra={!ctx.readOnly && <button type="button" style={btnS("primary")} onClick={() => set({ ...d, log: [...(d.log || []), { at: now(), text: "" }] })}><Plus size={13} /> Log an entry now</button>}>
        <Rows aria="Activity" rows={d.log} onChange={v => set({ ...d, log: v })} add="Add an entry" cols={[{ key: "at", label: "Date/time", type: "datetime-local", width: 170 }, { key: "text", label: "Notable activities", rows: 2 }]} />
      </Box>
      <Box title="8. Prepared by"><Prepared v={d.prepared} people={ctx.people} onChange={v => set({ ...d, prepared: v })} /></Box>
    </>
  );
}
function F220({ d, set, ctx }) {
  return (
    <>
      <Box title="Day and general remarks">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
          <Field label="Sunrise" value={d.sunrise} onChange={v => set({ ...d, sunrise: v })} />
          <Field label="Sunset" value={d.sunset} onChange={v => set({ ...d, sunset: v })} />
        </div>
        <Field label="Remarks (safety notes, hazards, air operations special equipment)" rows={4} value={d.remarks} onChange={v => set({ ...d, remarks: v })} style={{ marginTop: 8 }} />
        <Field label="TFR / medivac information" rows={2} value={d.tfr} onChange={v => set({ ...d, tfr: v })} style={{ marginTop: 8 }} />
      </Box>
      <Box title="Frequencies">
        <Rows aria="Frequency" rows={d.frequencies} onChange={v => set({ ...d, frequencies: v })} add="Add a frequency"
          cols={[{ key: "function", label: "Function (A/G primary, air-to-air…)" }, { key: "rx", label: "RX" }, { key: "tx", label: "TX" }, { key: "tone", label: "Tone/NAC" }]} />
      </Box>
      <Box title="Personnel">
        <Rows aria="Air personnel" rows={d.personnel} onChange={v => set({ ...d, personnel: v })} add="Add a person"
          cols={[{ key: "position", label: "Position (helibase manager, AOBD…)" }, { key: "name", label: "Name" }, { key: "phone", label: "Phone" }]} />
      </Box>
      <Box title="Aircraft">
        <Rows aria="Aircraft" rows={d.aircraft} onChange={v => set({ ...d, aircraft: v })} add="Add an aircraft"
          cols={[{ key: "tail", label: "Tail #", width: 80 }, { key: "callSign", label: "Call sign", width: 80 }, { key: "type", label: "Type", width: 60 }, { key: "makeModel", label: "Make/model", width: 90 },
            { key: "base", label: "Base", width: 80 }, { key: "avail", label: "Available", width: 70 }, { key: "stop", label: "Stop", width: 60 }, { key: "remarks", label: "Remarks" }]} />
      </Box>
      <Box title="Prepared by"><Prepared v={d.prepared} people={ctx.people} position="AOBD" onChange={v => set({ ...d, prepared: v })} /></Box>
      <div style={{ fontSize: 12, color: INK_SOFT }}>Prints in landscape.</div>
    </>
  );
}
function Weather({ d, set, ctx }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const inc = ctx.incident;
  async function get() {
    setBusy(true); setError("");
    try { set({ ...d, snapshot: await ctx.weather() }); } catch (e) { setError(e.message); }
    setBusy(false);
  }
  const s = d.snapshot;
  return (
    <>
      <Box title="National Weather Service forecast" extra={!ctx.readOnly && <button type="button" style={btnS("primary")} disabled={busy} onClick={get}><CloudSun size={14} /> {busy ? "Getting the forecast…" : s ? "Update the forecast" : "Get the forecast"}</button>}>
        {inc.lat == null && <div style={{ fontSize: 13, color: AMBER }}>Set the incident's location (Incident details › Find on map, or latitude/longitude) to get its forecast.</div>}
        {error && <div role="alert" style={{ color: BRICK, fontSize: 13 }}>{error}</div>}
        {s ? <WeatherView s={s} /> : <div style={{ fontSize: 13, color: INK_SOFT }}>No forecast added yet. It's saved with this IAP when you get it, so the printed copy matches what crews were told.</div>}
      </Box>
      <Box title="Notes (spot forecast, tides, river levels…)"><Field rows={5} aria="Weather notes" value={d.notes} onChange={v => set({ ...d, notes: v })} /></Box>
    </>
  );
}
export function WeatherView({ s }) {
  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ color: INK_SOFT, marginBottom: 6 }}>{s.place ? `Near ${s.place}` : ""}{s.station ? ` · station ${s.station}` : ""} · as of {new Date(s.updatedAt).toLocaleString()}</div>
      {s.now && <div style={{ marginBottom: 8 }}><b>Now:</b> {s.now.text} {s.now.tempF != null ? `${s.now.tempF}°F` : ""}{s.now.windMph != null ? `, wind ${s.now.windDir} ${s.now.windMph} mph` : ""}{s.now.gustMph ? ` gusting ${s.now.gustMph}` : ""}{s.now.humidity != null ? `, humidity ${s.now.humidity}%` : ""}</div>}
      {(s.alerts || []).map((a, i) => <div key={i} style={{ background: "#FDECEE", color: BRICK, borderRadius: 6, padding: "6px 8px", marginBottom: 6 }}><b>{a.event}</b>: {a.headline}</div>)}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 6 }}>
        {(s.periods || []).slice(0, 10).map((p, i) => (
          <div key={i} style={{ border: `1px solid ${LINE}`, borderRadius: 7, padding: "6px 8px", background: p.isDaytime ? "#FFFBF0" : "#F4F6FA" }}>
            <div style={{ fontWeight: 700 }}>{p.name}</div>
            <div>{p.short}</div>
            <div style={{ color: INK_SOFT }}>{p.tempF}°F · {p.wind} · {p.pop || 0}% precip</div>
          </div>
        ))}
      </div>
    </div>
  );
}
function Attachment({ d, set, ctx }) {
  const files = ctx.files || [];
  const f = files.find(x => x.id === d.fileId);
  return (
    <Box title="Attachment">
      <div style={{ display: "grid", gap: 8 }}>
        <Field label="Title (printed at the top)" value={d.title} onChange={v => set({ ...d, title: v })} placeholder="e.g. Division map, Travel route to the EOC" />
        <label><span style={lab}>File</span>
          <select aria-label="Attachment file" style={input} value={d.fileId || ""} onChange={e => { const x = files.find(y => y.id === e.target.value); set({ ...d, fileId: e.target.value || null, title: d.title || (x ? x.name.replace(/\.[a-z0-9]+$/i, "") : "") }); }}>
            <option value="">Choose…</option>{files.map(x => <option key={x.id} value={x.id}>{x.name}{x.pages?.length ? ` (${x.pages.length} pages)` : ""}</option>)}</select></label>
        {!ctx.readOnly && <UploadButton ctx={ctx} accept="image/*,application/pdf" label="Upload a map, picture or PDF" onDone={r => set({ ...d, fileId: r.id, title: d.title || r.name.replace(/\.[a-z0-9]+$/i, "") })} />}
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5 }}><input type="checkbox" checked={!!d.landscape} onChange={e => set({ ...d, landscape: e.target.checked })} /> Print in landscape</label>
        {f && /^image\//.test(f.mime) && <img alt={d.title || f.name} src={`/api/imt/files/${f.id}`} style={{ maxWidth: "100%", maxHeight: 420, border: `1px solid ${LINE}`, borderRadius: 6 }} />}
        {f && f.mime === "application/pdf" && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {f.pages?.length ? f.pages.map((p, i) => <img key={p} alt={`Page ${i + 1}`} src={`/api/imt/files/${p}`} style={{ height: 170, border: `1px solid ${LINE}` }} />)
              : <div style={{ fontSize: 13, color: AMBER }}>This PDF has no page pictures, so it can't print inside the IAP. Download it to print separately, or upload it again.</div>}
          </div>
        )}
      </div>
    </Box>
  );
}
function UploadButton({ ctx, accept, label, onDone }) {
  const [busy, setBusy] = useState(""), [error, setError] = useState("");
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <label style={{ ...btnS(), cursor: busy ? "wait" : "pointer" }}><ImageIcon size={13} /> {busy || label}
        <input type="file" aria-label={label} accept={accept} style={{ display: "none" }} disabled={!!busy}
          onChange={async e => { const file = e.target.files[0]; e.target.value = ""; if (!file) return; setError(""); try { onDone(await ctx.uploadFile(file, setBusy)); } catch (x) { setError(x.message); } setBusy(""); }} /></label>
      {error && <span role="alert" style={{ color: BRICK, fontSize: 12.5 }}>{error}</span>}
    </span>
  );
}
function F207({ ctx }) {
  return (
    <Box title="Incident organization chart">
      <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 8 }}>Drawn from the ICS 203. Change people there.</div>
      <OrgChart rows={ctx.forms.find(f => f.kind === "203")?.data.rows || []} />
    </Box>
  );
}
export function orgTree(rows) {
  const named = r => r.name || r.label;
  const pick = (s, re) => rows.filter(r => r.section === s && re.test(r.role) && named(r));
  return {
    ic: pick("command", /^IC/), staff: pick("command", /Safety|Public|Liaison|Deputy/),
    sections: [["Operations", "operations"], ["Planning", "planning"], ["Logistics", "logistics"], ["Finance/Admin", "finance"]].map(([title, s]) => ({
      title, chief: pick(s, /^Chief$/), rest: rows.filter(r => r.section === s && !/^Chief$/.test(r.role) && named(r)),
      air: s === "operations" ? rows.filter(r => r.section === "air" && named(r)) : [],
    })),
  };
}
function OrgChart({ rows }) {
  const t = orgTree(rows);
  const box = (title, people, color = INK) => (
    <div style={{ border: `1.5px solid ${color}`, borderRadius: 7, padding: "5px 8px", background: "#fff", minWidth: 120, fontSize: 12 }}>
      <div style={{ fontWeight: 800, color, fontSize: 11.5 }}>{title}</div>
      {people.length ? people.map((p, i) => <div key={i}>{p.name || "—"}{p.agency ? ` (${p.agency})` : ""}</div>) : <div style={{ color: INK_SOFT }}>—</div>}
    </div>
  );
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, minWidth: 640 }}>
        {box("Incident Commander(s)", t.ic, BRICK)}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>{t.staff.map((p, i) => <React.Fragment key={i}>{box(p.role, [p])}</React.Fragment>)}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, width: "100%" }}>
          {t.sections.map(s => (
            <div key={s.title} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {box(`${s.title} Section Chief`, s.chief, BLUE)}
              {s.rest.map((r, i) => <div key={i} style={{ marginLeft: 12 }}>{box(`${r.role}${r.label ? `: ${r.label}` : ""}`, [r])}</div>)}
              {s.air.length > 0 && <div style={{ marginLeft: 12 }}>{box("Air Operations", s.air.map(a => ({ name: `${a.role}: ${a.name}` })))}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export const EDITORS = { cover: Cover, "202": F202, "203": F203, "204": F204, "205": F205, "205a": F205a, "206": F206, "207": F207, "208": F208,
  "211": F211, "213": F213, "214": F214, "220": F220, weather: Weather, attachment: Attachment };
