// Shared pieces for forms: field inputs, signature pad, pre-fill, display and printing.
import React, { useEffect, useRef, useState } from "react";
import { inputStyle, btn } from "./App.jsx";

// Local colors (values used outside components can't come from App.jsx: circular import)
export const C = { INK: "#13233F", INK_SOFT: "#4B5565", LINE: "#DDE2EA", PAPER: "#F3F5F8", BRICK: "#C8102E", BRASS: "#1D5FA8", SAGE: "#2E7D4F", AMBER: "#B26A00" };

export const FIELD_TYPES = [
  ["heading", "Section heading"], ["paragraph", "Paragraph (text only)"], ["text", "Short answer"], ["textarea", "Long answer"],
  ["number", "Number"], ["date", "Date"], ["time", "Time (24-hour)"], ["select", "Dropdown"], ["radio", "Multiple choice"],
  ["checkboxes", "Checkboxes"], ["yesno", "Yes / No"], ["phone", "Phone"], ["email", "Email"], ["address", "Address"],
  ["person", "Person (from roster)"], ["people", "People (from roster)"], ["ssn", "Social Security number (encrypted)"],
  ["acknowledge", "Acknowledgment checkbox"], ["signature", "Signature"], ["file", "File or photo upload"],
];
export const PREFILLS = [
  ["", "Nothing"], ["subject:name", "Person it's about: name"], ["subject:email", "Person it's about: email"],
  ["subject:phone", "Person it's about: phone"], ["subject:jobTitle", "Person it's about: job title"],
  ["subject:hireDate", "Person it's about: hire date"], ["subject:employeeNumber", "Person it's about: employee #"],
  ["subject:station", "Person it's about: station"], ["subject:address", "Person it's about: address"],
  ["me:name", "Person filling it out: name"], ["me:email", "Person filling it out: email"], ["me:phone", "Person filling it out: phone"],
  ["me:jobTitle", "Person filling it out: job title"], ["me:division", "Person filling it out: division"], ["today", "Today's date"], ["now", "Current time"],
  ["case:subjectName", "Case: injured member"], ["case:date", "Case: date"], ["case:time", "Case: time"], ["case:location", "Case: location"],
];
const NO_VALUE = new Set(["heading", "paragraph"]);

export function isVisible(f, values) {
  if (!f.showIf || !f.showIf.field) return true;
  const v = values[f.showIf.field];
  const want = Array.isArray(f.showIf.any) && f.showIf.any.length ? f.showIf.any : [f.showIf.equals];
  return Array.isArray(v) ? v.some(x => want.includes(x)) : want.includes(String(v ?? ""));
}

const todayISO = () => new Date().toLocaleDateString("en-CA");
const nowHM = () => new Date().toTimeString().slice(0, 5);

// Value for a pre-fill source. ctx = { me, subject (roster entries), context (case facts) }
export function prefillValue(src, ctx) {
  if (!src) return undefined;
  if (src === "today") return todayISO();
  if (src === "now") return nowHM();
  const [scope, ...rest] = src.split(":");
  const name = rest.join(":");
  const person = scope === "subject" ? ctx.subject : scope === "me" ? ctx.me : null;
  if (person) {
    if (name === "name") return person.name;
    if (name === "address") return person.address && (person.address.street || person.address.city) ? { ...person.address } : undefined;
    const v = person[name];
    return v === "" ? undefined : v;
  }
  if (scope === "case" && ctx.context) {
    if (name.startsWith("initial.")) return ctx.context.initial?.[name.slice(8)];
    return ctx.context[name] || undefined;
  }
  if (scope === "task" && ctx.context) return ctx.context.assigneeName || ctx.me?.name;
  return undefined;
}
export function initialValues(fields, ctx) {
  const v = {};
  for (const f of fields) {
    if (NO_VALUE.has(f.type)) continue;
    let p = prefillValue(f.prefill, ctx);
    if (["select", "radio"].includes(f.type) && !(f.options || []).includes(p)) p = undefined;   // only a listed choice
    if (p !== undefined && p !== null && p !== "") v[f.key] = p;
    else if (f.default !== undefined) v[f.key] = f.default;
  }
  return v;
}

// Answers to questions that are showing, in form order: a question that depends on a
// hidden question is hidden too.
export function visibleValues(fields, values) {
  const out = {};
  for (const f of fields) {
    if (NO_VALUE.has(f.type) || !isVisible(f, out)) continue;
    if (values[f.key] !== undefined) out[f.key] = values[f.key];
  }
  return out;
}

export function missingRequired(fields, all) {
  const out = [];
  const values = visibleValues(fields, all);
  for (const f of fields) {
    if (!f.required || NO_VALUE.has(f.type) || !isVisible(f, values)) continue;
    const v = values[f.key];
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length) ||
      (f.type === "acknowledge" && v !== true) || (f.type === "address" && !(v && (v.street || v.city))) ||
      (f.type === "ssn" && String(v).replace(/\D/g, "").length !== 9);
    if (empty) out.push(f.key);
  }
  return out;
}

// ---------------------------------------------------------------------
// Signature pad
// ---------------------------------------------------------------------
export function SignaturePad({ value, onChange, label }) {
  const canvas = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);
  const [empty, setEmpty] = useState(!value);
  useEffect(() => {
    const cv = canvas.current, g = cv.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
    if (value) { const img = new Image(); img.onload = () => g.drawImage(img, 0, 0, cv.width, cv.height); img.src = value; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pos = e => {
    const r = canvas.current.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvas.current.width / r.width), y: (e.clientY - r.top) * (canvas.current.height / r.height) };
  };
  function down(e) { e.preventDefault(); canvas.current.setPointerCapture(e.pointerId); drawing.current = true; last.current = pos(e); }
  function move(e) {
    if (!drawing.current) return;
    const g = canvas.current.getContext("2d"), p = pos(e);
    g.strokeStyle = "#0B1A33"; g.lineWidth = 2.6; g.lineCap = "round"; g.lineJoin = "round";
    g.beginPath(); g.moveTo(last.current.x, last.current.y); g.lineTo(p.x, p.y); g.stroke();
    last.current = p; setEmpty(false);
  }
  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(canvas.current.toDataURL("image/png"));
  }
  function clear() {
    const cv = canvas.current, g = cv.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
    setEmpty(true); onChange("");
  }
  return (
    <div>
      <canvas ref={canvas} width={600} height={160} aria-label={label || "Signature"} role="img"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        style={{ width: "100%", maxWidth: 480, height: 128, border: `1px solid ${C.LINE}`, borderRadius: 6, background: "#fff", touchAction: "none", cursor: "crosshair", display: "block" }} />
      <div style={{ display: "flex", justifyContent: "space-between", maxWidth: 480, fontSize: 12, color: C.INK_SOFT, marginTop: 4 }}>
        <span>{empty ? "Sign above with your mouse or finger." : "Signed."}</span>
        <button type="button" onClick={clear} style={{ border: "none", background: "none", color: C.BRASS, cursor: "pointer", fontSize: 12, padding: 0 }}>Clear</button>
      </div>
    </div>
  );
}

// People picker (chips + dropdown)
export function PeoplePicker({ roster, value, onChange, exclude = [], label }) {
  const chosen = (value || []).map(id => roster.find(u => u.id === id)).filter(Boolean);
  const options = roster.filter(u => !(value || []).includes(u.id) && !exclude.includes(u.id)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: chosen.length ? 6 : 0 }}>
        {chosen.map(u => (
          <span key={u.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 6px 3px 10px", borderRadius: 999, background: "#E6ECF5", fontSize: 13, color: C.INK }}>
            {u.name}
            <button type="button" aria-label={`Remove ${u.name}`} onClick={() => onChange(value.filter(x => x !== u.id))}
              style={{ border: "none", background: "none", cursor: "pointer", color: C.INK_SOFT, fontSize: 15, lineHeight: 1, padding: "0 4px" }}>×</button>
          </span>
        ))}
      </div>
      <select aria-label={label ? `Add to ${label}` : "Add a person"} style={{ ...inputStyle, maxWidth: 340 }} value=""
        onChange={e => e.target.value && onChange([...(value || []), e.target.value])}>
        <option value="">Add a person…</option>
        {options.map(u => <option key={u.id} value={u.id}>{u.name} — {u.division}</option>)}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------
// Attaching files or photos (uploaded right away, linked when the form is sent)
// ---------------------------------------------------------------------
const FILE_MAX = 10 * 1024 * 1024;
const sizeText = n => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
function FileInput({ id, value, onChange, label, readOnly, invalid }) {
  const files = Array.isArray(value) ? value : [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function add(list) {
    setError("");
    const out = [...files];
    for (const file of list) {
      if (file.size > FILE_MAX) { setError(`${file.name} is larger than 10 MB.`); continue; }
      setBusy(true);
      try {
        const dataUrl = await new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fail; r.readAsDataURL(file); });
        const res = await fetch("/api/forms/files", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify({ name: file.name, dataUrl }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Upload failed");
        out.push(body);
      } catch (e) { setError(`${file.name}: ${e.message}`); }
    }
    setBusy(false);
    onChange(out.slice(0, 10));
  }
  return (
    <div>
      {files.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
          {files.map(fl => (
            <div key={fl.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <a href={`/api/forms/files/${fl.id}`} target="_blank" rel="noreferrer" style={{ color: C.INK }}>{fl.name}</a>
              <span style={{ color: C.INK_SOFT }}>{sizeText(fl.size)}</span>
              {!readOnly && <button type="button" aria-label={`Remove ${fl.name}`} onClick={() => onChange(files.filter(x => x.id !== fl.id))}
                style={{ border: "none", background: "none", cursor: "pointer", color: C.BRICK, fontSize: 13 }}>Remove</button>}
            </div>
          ))}
        </div>
      )}
      {!readOnly && files.length < 10 && (
        <label style={{ ...btn("outline"), display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", ...(invalid ? { borderColor: C.BRICK } : {}) }}>
          {busy ? "Uploading…" : files.length ? "Add another file" : "Choose file or photo"}
          <input id={id} type="file" multiple aria-label={label} style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
            onChange={e => { const l = [...e.target.files]; e.target.value = ""; if (l.length) add(l); }} disabled={busy} />
        </label>
      )}
      {error && <div style={{ fontSize: 12, color: C.BRICK, marginTop: 4 }}>{error}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------
// One field
// ---------------------------------------------------------------------
export function FieldInput({ f, value, onChange, roster, invalid, readOnly }) {
  const id = `fld-${f.key}`;
  const border = invalid ? { borderColor: C.BRICK, boxShadow: `0 0 0 1px ${C.BRICK}` } : {};
  const inp = { ...inputStyle, ...border };
  const req = f.required ? { "aria-required": true } : {};
  if (f.type === "heading") {
    return <div style={{ fontSize: 15, fontWeight: 700, color: C.INK, borderBottom: `2px solid ${C.BRICK}`, paddingBottom: 4, margin: "18px 0 4px" }}>{f.label}</div>;
  }
  if (f.type === "paragraph") return <div style={{ fontSize: 13.5, color: C.INK_SOFT, whiteSpace: "pre-wrap", margin: "6px 0" }}>{f.label}</div>;

  const labelEl = (
    <label htmlFor={id} style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: C.INK, marginBottom: 5 }}>
      {f.label}{f.required && <span aria-hidden="true" style={{ color: C.BRICK }}> *</span>}
    </label>
  );
  const help = f.help && <div style={{ fontSize: 12, color: C.INK_SOFT, marginTop: 4 }}>{f.help}</div>;
  const err = invalid && <div style={{ fontSize: 12, color: C.BRICK, marginTop: 4 }}>This is required.</div>;
  const choice = (name, type, options, isOn, toggle) => (
    <div role={type === "radio" ? "radiogroup" : "group"} aria-labelledby={`${id}-l`} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {options.map(o => (
        <label key={o} style={{
          display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 12px", borderRadius: 7, cursor: "pointer", fontSize: 13.5,
          border: `1px solid ${isOn(o) ? C.INK : (invalid ? C.BRICK : C.LINE)}`, background: isOn(o) ? "#E6ECF5" : "#fff", fontWeight: isOn(o) ? 600 : 400,
        }}>
          <input type={type} name={name} checked={isOn(o)} onChange={() => toggle(o)} disabled={readOnly} style={{ margin: 0 }} />{o}
        </label>
      ))}
    </div>
  );

  let control;
  switch (f.type) {
    case "textarea":
      control = <textarea id={id} {...req} style={{ ...inp, minHeight: 90, resize: "vertical" }} value={value || ""} onChange={e => onChange(e.target.value)} readOnly={readOnly} />; break;
    case "number":
      control = <input id={id} {...req} type="number" style={{ ...inp, maxWidth: 200 }} value={value ?? ""} onChange={e => onChange(e.target.value === "" ? "" : e.target.value)} readOnly={readOnly} />; break;
    case "date":
      control = <input id={id} {...req} type="date" style={{ ...inp, maxWidth: 200 }} value={value || ""} onChange={e => onChange(e.target.value)} readOnly={readOnly} />; break;
    case "time":
      control = <input id={id} {...req} type="time" style={{ ...inp, maxWidth: 160 }} value={value || ""} onChange={e => onChange(e.target.value)} readOnly={readOnly} />; break;
    case "phone":
      control = <input id={id} {...req} type="tel" style={{ ...inp, maxWidth: 260 }} value={value || ""} onChange={e => onChange(e.target.value)} placeholder="(225) 555-0123" readOnly={readOnly} />; break;
    case "email":
      control = <input id={id} {...req} type="email" style={{ ...inp, maxWidth: 360 }} value={value || ""} onChange={e => onChange(e.target.value)} readOnly={readOnly} />; break;
    case "ssn":
      control = <input id={id} {...req} inputMode="numeric" autoComplete="off" style={{ ...inp, maxWidth: 200, letterSpacing: 1 }} value={value || ""} placeholder="123-45-6789"
        onChange={e => {
          const d = e.target.value.replace(/\D/g, "").slice(0, 9);
          onChange(d.length > 5 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d);
        }} readOnly={readOnly} />; break;
    case "select":
      control = (
        <select id={id} {...req} style={{ ...inp, maxWidth: 420 }} value={value || ""} onChange={e => onChange(e.target.value)} disabled={readOnly}>
          <option value="">Choose…</option>
          {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>); break;
    case "radio":
      control = choice(id, "radio", f.options || [], o => value === o, o => onChange(o)); break;
    case "yesno":
      control = choice(id, "radio", ["Yes", "No"], o => value === o, o => onChange(o)); break;
    case "checkboxes": {
      const arr = Array.isArray(value) ? value : [];
      control = choice(id, "checkbox", f.options || [], o => arr.includes(o), o => onChange(arr.includes(o) ? arr.filter(x => x !== o) : [...arr, o])); break;
    }
    case "address": {
      const a = value || {};
      const set = (k, v) => onChange({ ...a, [k]: v });
      control = (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) 70px 100px", gap: 6, maxWidth: 680 }}>
          <input aria-label={`${f.label}: street`} style={inp} placeholder="Street" value={a.street || ""} onChange={e => set("street", e.target.value)} readOnly={readOnly} />
          <input aria-label={`${f.label}: city`} style={inp} placeholder="City" value={a.city || ""} onChange={e => set("city", e.target.value)} readOnly={readOnly} />
          <input aria-label={`${f.label}: state`} style={inp} placeholder="State" value={a.state || ""} onChange={e => set("state", e.target.value)} readOnly={readOnly} />
          <input aria-label={`${f.label}: zip`} style={inp} placeholder="Zip" value={a.zip || ""} onChange={e => set("zip", e.target.value)} readOnly={readOnly} />
        </div>); break;
    }
    case "person":
      control = (
        <select id={id} {...req} style={{ ...inp, maxWidth: 360 }} value={value || ""} onChange={e => onChange(e.target.value)} disabled={readOnly}>
          <option value="">Choose a person…</option>
          {[...roster].sort((a, b) => a.name.localeCompare(b.name)).map(u => <option key={u.id} value={u.id}>{u.name} — {u.division}</option>)}
        </select>); break;
    case "people":
      control = <PeoplePicker roster={roster} value={value || []} onChange={onChange} label={f.label} />; break;
    case "acknowledge":
      return (
        <div style={{ margin: "12px 0" }} data-field={f.key}>
          <label style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 13.5, color: C.INK, cursor: "pointer", padding: "10px 12px", border: `1px solid ${invalid ? C.BRICK : C.LINE}`, borderRadius: 7, background: "#fff" }}>
            <input type="checkbox" checked={value === true} onChange={e => onChange(e.target.checked)} disabled={readOnly} style={{ marginTop: 3 }} />
            <span>{f.label}{f.required && <span aria-hidden="true" style={{ color: C.BRICK }}> *</span>}</span>
          </label>
          {err}
        </div>
      );
    case "signature":
      control = <SignaturePad value={value} onChange={onChange} label={f.label} />; break;
    case "file":
      control = <FileInput id={id} value={value} onChange={onChange} label={f.label} readOnly={readOnly} invalid={invalid} />; break;
    default:
      control = <input id={id} {...req} style={inp} value={value || ""} onChange={e => onChange(e.target.value)} readOnly={readOnly} />;
  }
  return (
    <div style={{ margin: "14px 0" }} data-field={f.key}>
      <div id={`${id}-l`}>{labelEl}</div>
      {control}{help}{err}
    </div>
  );
}

// ---------------------------------------------------------------------
// Showing answers
// ---------------------------------------------------------------------
const pretty = d => d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
export function displayValue(f, v, roster) {
  if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) return "";
  const who = id => roster.find(u => u.id === id)?.name || "(former member)";
  switch (f.type) {
    case "date": return v === "Hidden" ? v : pretty(v);
    case "checkboxes": return v.join(", ");
    case "address": return [v.street, [v.city, v.state].filter(Boolean).join(", "), v.zip].filter(Boolean).join(" ");
    case "person": return who(v);
    case "people": return v.map(who).join(", ");
    case "acknowledge": return v === true ? "Acknowledged" : "";
    case "file": return Array.isArray(v) ? v.map(x => x.name).join(", ") : "";
    default: return String(v);
  }
}
export const STATUS_LABEL = { submitted: "Submitted", pending_approval: "Waiting for approval", approved: "Approved", denied: "Denied" };
export const STATUS_COLOR = { submitted: C.BRASS, pending_approval: C.AMBER, approved: C.SAGE, denied: C.BRICK };

// HTML for printing a submission (used by print and the case packet)
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export function submissionHtml(sub, roster) {
  const rows = [];
  for (const f of sub.fields) {
    if (!isVisible(f, sub.data)) continue;
    if (f.type === "heading") { rows.push(`<tr><td colspan="2" class="sec">${esc(f.label)}</td></tr>`); continue; }
    if (f.type === "paragraph") { rows.push(`<tr><td colspan="2" class="para">${esc(f.label)}</td></tr>`); continue; }
    const v = sub.data[f.key];
    if (f.type === "signature") {
      rows.push(`<tr><td class="lbl">${esc(f.label)}</td><td>${v ? `<img src="${esc(v)}" style="height:56px">` : ""}</td></tr>`);
      continue;
    }
    rows.push(`<tr><td class="lbl">${esc(f.label)}</td><td>${esc(displayValue(f, v, roster)).replace(/\n/g, "<br>")}</td></tr>`);
  }
  const approvals = (sub.approvals || []).map(a => `${esc(a.name)}: ${a.decision === "pending" ? "pending" : `${a.decision} ${a.decidedAt ? new Date(a.decidedAt).toLocaleString() : ""}`}${a.note ? ` — ${esc(a.note)}` : ""}`).join("<br>");
  return `
    <h2 style="margin:4px 0 2px">${esc(sub.formTitle)}</h2>
    <div style="font-size:12px;color:#4B5565;margin-bottom:10px">
      ${sub.subjectName ? `About: <b>${esc(sub.subjectName)}</b> · ` : ""}${sub.anonymous ? "Submitted anonymously" : `Submitted by ${esc(sub.submittedByName)}`}
      on ${new Date(sub.submittedAt).toLocaleString()} · Status: ${esc(STATUS_LABEL[sub.status] || sub.status)}
    </div>
    <style>
      table.f{width:100%;border-collapse:collapse;font-size:12.5px} table.f td{border-bottom:1px solid #DDE2EA;padding:5px 6px;vertical-align:top}
      td.lbl{width:42%;color:#4B5565} td.sec{font-weight:700;font-size:13.5px;padding-top:12px;border-bottom:2px solid #C8102E} td.para{color:#4B5565;font-style:italic}
    </style>
    <table class="f">${rows.join("")}</table>
    ${approvals ? `<p style="font-size:12px;margin-top:10px"><b>Approvals</b><br>${approvals}</p>` : ""}`;
}

// HTML for printing a form from the fill-out screen: answers so far, with
// blank lines and boxes for anything not filled in (works for blank forms too).
export function formPrintHtml(def, all, roster, subjectName) {
  const values = visibleValues(def.fields, all);
  const box = on => (on ? "&#9746;" : "&#9744;");
  const line = '<div style="border-bottom:1px solid #8892A0;height:18px"></div>';
  const rows = [];
  for (const f of def.fields) {
    if (!isVisible(f, values)) continue;
    if (f.type === "heading") { rows.push(`<tr><td colspan="2" class="sec">${esc(f.label)}</td></tr>`); continue; }
    if (f.type === "paragraph") { rows.push(`<tr><td colspan="2" class="para">${esc(f.label)}</td></tr>`); continue; }
    const v = values[f.key];
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length) || v === false;
    let cell;
    if (["select", "radio", "checkboxes"].includes(f.type) && (empty || f.type !== "select")) {
      const picked = Array.isArray(v) ? v : [v];
      cell = (f.options || []).map(o => `<span style="margin-right:14px;white-space:nowrap">${box(picked.includes(o))} ${esc(o)}</span>`).join(" ");
    } else if (f.type === "yesno") {
      cell = `${box(v === "Yes")} Yes &nbsp; ${box(v === "No")} No`;
    } else if (f.type === "acknowledge") {
      cell = `${box(v === true)} ${esc(f.help || "I acknowledge")}`;
    } else if (f.type === "signature") {
      cell = v ? `<img src="${esc(v)}" style="height:56px">` : '<div style="border-bottom:1px solid #8892A0;height:40px"></div>';
    } else if (f.type === "ssn") {
      const d = String(v || "").replace(/\D/g, "");
      cell = d.length >= 4 ? `&bull;&bull;&bull;-&bull;&bull;-${d.slice(-4)}` : line;
    } else if (empty) {
      cell = f.type === "textarea" ? line + line + line : f.type === "address" ? line + line : line;
    } else {
      cell = esc(displayValue(f, v, roster)).replace(/\n/g, "<br>");
    }
    rows.push(`<tr><td class="lbl">${esc(f.label)}${f.required ? " *" : ""}</td><td>${cell}</td></tr>`);
  }
  return `
    <h2 style="margin:4px 0 2px">${esc(def.title)}</h2>
    ${subjectName ? `<div style="font-size:12px;color:#4B5565;margin-bottom:4px">About: <b>${esc(subjectName)}</b></div>` : ""}
    ${def.description ? `<div style="font-size:12px;color:#4B5565;margin-bottom:10px;white-space:pre-wrap">${esc(def.description)}</div>` : ""}
    <style>
      table.f{width:100%;border-collapse:collapse;font-size:12.5px} table.f td{border-bottom:1px solid #DDE2EA;padding:7px 6px;vertical-align:top}
      td.lbl{width:42%;color:#4B5565} td.sec{font-weight:700;font-size:13.5px;padding-top:12px;border-bottom:2px solid #C8102E} td.para{color:#4B5565;font-style:italic}
    </style>
    <table class="f">${rows.join("")}</table>
    <p style="font-size:11px;color:#4B5565;margin-top:10px">* Required</p>`;
}
