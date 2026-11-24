// Form builder (master admins): questions, settings, recipients, approvals,
// and who can see every submission of the form.
import React, { useEffect, useState } from "react";
import { cardStyle, inputStyle, btn } from "./App.jsx";
import { C, FIELD_TYPES, PREFILLS, PeoplePicker } from "./FormFields.jsx";
import { FormFill, formsApi } from "./Forms.jsx";

const TYPE_LABEL = Object.fromEntries(FIELD_TYPES);
const HAS_OPTIONS = new Set(["select", "radio", "checkboxes"]);
const NO_VALUE = new Set(["heading", "paragraph"]);
const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "field";

function uniqueKey(base, fields) {
  let k = /^[a-z]/.test(base) ? base : `q_${base}`;
  let n = 2;
  const taken = new Set(fields.map(f => f.key));
  const start = k;
  while (taken.has(k)) k = `${start}_${n++}`;
  return k;
}

function FieldEditor({ f, index, fields, onChange, onClose }) {
  const set = (k, v) => onChange({ ...f, [k]: v });
  const earlier = fields.slice(0, index).filter(x => ["select", "radio", "yesno", "checkboxes"].includes(x.type));
  const ctl = earlier.find(x => x.key === f.showIf?.field);
  const ctlOptions = ctl ? (ctl.type === "yesno" ? ["Yes", "No"] : ctl.options || []) : [];
  const lab = { fontSize: 12, color: C.INK_SOFT, display: "flex", flexDirection: "column", gap: 3 };
  return (
    <div style={{ background: C.PAPER, border: `1px solid ${C.LINE}`, borderRadius: 7, padding: "12px 14px", margin: "4px 0 10px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
        <label style={lab}>Type
          <select aria-label="Question type" style={inputStyle} value={f.type} onChange={e => set("type", e.target.value)}>
            {FIELD_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        {!NO_VALUE.has(f.type) && (
          <label style={lab}>Pre-fill from
            <select aria-label="Pre-fill from" style={inputStyle} value={f.prefill || ""} onChange={e => set("prefill", e.target.value || undefined)}>
              {PREFILLS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              {f.prefill && !PREFILLS.some(([k]) => k === f.prefill) && <option value={f.prefill}>{f.prefill}</option>}
            </select>
          </label>
        )}
      </div>
      <label style={{ ...lab, marginTop: 10 }}>{f.type === "heading" ? "Heading" : f.type === "paragraph" ? "Text" : "Question"}
        <textarea aria-label="Question text" style={{ ...inputStyle, minHeight: f.type === "paragraph" || f.type === "acknowledge" ? 70 : 38 }} value={f.label} onChange={e => set("label", e.target.value)} />
      </label>
      {!NO_VALUE.has(f.type) && (
        <label style={{ ...lab, marginTop: 10 }}>Help text (optional)
          <input aria-label="Help text" style={inputStyle} value={f.help || ""} onChange={e => set("help", e.target.value || undefined)} />
        </label>
      )}
      {HAS_OPTIONS.has(f.type) && (
        <label style={{ ...lab, marginTop: 10 }}>Choices (one per line)
          <textarea aria-label="Choices" style={{ ...inputStyle, minHeight: 80 }} value={(f.options || []).join("\n")} onChange={e => set("options", e.target.value.split("\n"))} />
        </label>
      )}
      {!NO_VALUE.has(f.type) && !["signature", "acknowledge", "people", "address", "checkboxes"].includes(f.type) && (
        <label style={{ ...lab, marginTop: 10 }}>Default answer (optional)
          <input aria-label="Default answer" style={{ ...inputStyle, maxWidth: 420 }} value={f.default ?? ""} onChange={e => set("default", e.target.value === "" ? undefined : e.target.value)}
            placeholder={f.type === "date" ? "YYYY-MM-DD" : f.type === "time" ? "HH:MM" : ""} />
        </label>
      )}
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 10, fontSize: 13 }}>
        {!NO_VALUE.has(f.type) && (
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={!!f.required} onChange={e => set("required", e.target.checked || undefined)} /> Required</label>
        )}
        {!NO_VALUE.has(f.type) && f.type !== "ssn" && (
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={!!f.sensitive} onChange={e => set("sensitive", e.target.checked || undefined)} /> Sensitive (encrypted; hidden from limited viewers)</label>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 10 }}>
        <label style={lab}>Only show when
          <select aria-label="Only show when" style={{ ...inputStyle, width: "auto", minWidth: 200 }} value={f.showIf?.field || ""}
            onChange={e => set("showIf", e.target.value ? { field: e.target.value, equals: "" } : undefined)}>
            <option value="">Always show</option>
            {earlier.map(x => <option key={x.key} value={x.key}>{x.label.slice(0, 60)}</option>)}
          </select>
        </label>
        {f.showIf?.field && (
          <label style={lab}>is
            <select aria-label="Show when answer is" style={{ ...inputStyle, width: "auto", minWidth: 160 }} value={f.showIf.equals} onChange={e => set("showIf", { field: f.showIf.field, equals: e.target.value })}>
              <option value="">Choose…</option>
              {ctlOptions.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        )}
        <span style={{ fontSize: 11.5, color: C.INK_SOFT, marginLeft: "auto" }}>Field name: {f.key}</span>
        <button style={btn("primary")} onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

export default function FormBuilder({ id, defs, roster, onBack, onSaved, canGrantAccess = true }) {
  const existing = defs.find(d => d.id === id) || null;
  const [title, setTitle] = useState(existing?.title || "");
  const [category, setCategory] = useState(existing?.category || "Employee Forms");
  const [description, setDescription] = useState(existing?.description || "");
  const [active, setActive] = useState(existing ? existing.active : true);
  const [fields, setFields] = useState(existing ? existing.fields : []);
  const [settings, setSettings] = useState(existing ? { ...existing.settings } : { subject: "self", subjectCanView: true, recipients: [] });
  const [caseUsers, setCaseUsers] = useState(() => (existing?.settings?.case?.followUps || []).filter(f => f.assign === "users").map(f => ({ form: f.form, label: f.label, users: f.users || [] })));
  const [open, setOpen] = useState(null);
  const [preview, setPreview] = useState(false);
  const [viewers, setViewers] = useState(null);   // [{userId, formKey}]
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const categories = [...new Set(defs.map(d => d.category))];
  const set = (k, v) => setSettings(s => ({ ...s, [k]: v }));

  useEffect(() => { if (canGrantAccess) formsApi("/access").then(r => setViewers(r.access), () => setViewers([])); }, []);
  const formKey = existing?.key;
  const withAccess = viewers ? viewers.filter(v => v.formKey === formKey).map(v => v.userId) : [];
  const allAccess = viewers ? viewers.filter(v => v.formKey === "*").map(v => v.userId) : [];
  async function changeAccess(next) {
    // Update each person whose access to this form changed
    const changed = [...new Set([...next, ...withAccess])].filter(u => next.includes(u) !== withAccess.includes(u));
    try {
      for (const userId of changed) {
        const keys = viewers.filter(v => v.userId === userId && v.formKey !== formKey).map(v => v.formKey);
        if (next.includes(userId)) keys.push(formKey);
        await formsApi("/access", { method: "POST", body: JSON.stringify({ userId, formKeys: keys }) });
      }
      setViewers((await formsApi("/access")).access);
    } catch (e) { setError(e.message); }
  }

  const move = (i, d) => setFields(fs => { const n = [...fs]; const j = i + d; if (j < 0 || j >= n.length) return fs; [n[i], n[j]] = [n[j], n[i]]; return n; });
  function addField(type = "text") {
    const label = type === "heading" ? "New section" : "New question";
    setFields(fs => [...fs, { key: uniqueKey(slug(label), fs), type, label, _new: true, ...(HAS_OPTIONS.has(type) ? { options: ["Option 1", "Option 2"] } : {}) }]);
    setOpen(fields.length);
  }
  const usedAsCondition = key => fields.some(x => x.showIf?.field === key);

  async function save(nextActive = active) {
    if (!title.trim()) { setError("Give the form a title."); return; }
    setBusy(true); setError("");
    // New questions get a field name from their text the first time they're saved
    const rename = {};
    const named = [];
    for (const f of fields) {
      if (f._new) {
        const { _new, ...rest } = f;
        const others = [...named, ...fields.filter(x => !x._new && x !== f)];
        const key = uniqueKey(slug(f.label), others);
        rename[f.key] = key;
        named.push({ ...rest, key });
      } else named.push(f);
    }
    const cleaned = named.map(f => ({
      ...f,
      options: f.options ? f.options.map(o => o.trim()).filter(Boolean) : undefined,
      showIf: f.showIf ? { ...f.showIf, field: rename[f.showIf.field] || f.showIf.field } : undefined,
    }));
    try {
      const r = await formsApi("/definitions", {
        method: "POST", body: JSON.stringify({
          id: existing?.id, title: title.trim(), category: category.trim() || "Employee Forms", description, active: nextActive,
          fields: cleaned, settings: { ...settings, caseUsers }, sort: existing?.sort,
        }),
      });
      setActive(nextActive);
      setFields(r.definition.fields);
      onSaved(r.definition);
      if (!existing) onBack();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  if (preview) {
    const me = roster[0];
    return <FormFill def={{ key: formKey || "preview", title, description, fields, settings }} me={me} roster={roster} preview onCancel={() => setPreview(false)} onDone={() => {}} context={settings.followUpOnly ? { subjectName: "(member)", date: "", time: "", location: "", initial: {} } : undefined} />;
  }

  const lab = { fontSize: 12, color: C.INK_SOFT, display: "flex", flexDirection: "column", gap: 3 };
  return (
    <div style={{ maxWidth: 1000 }}>
      <button style={{ ...btn("ghost"), paddingLeft: 0 }} onClick={onBack}>‹ All forms</button>
      <div style={{ ...cardStyle, marginTop: 6 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>{existing ? "Edit form" : "New form"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          <label style={lab}>Title<input aria-label="Form title" style={inputStyle} value={title} onChange={e => setTitle(e.target.value)} /></label>
          <label style={lab}>Section
            <input aria-label="Section" list="form-categories" style={inputStyle} value={category} onChange={e => setCategory(e.target.value)} />
            <datalist id="form-categories">{categories.map(c => <option key={c} value={c} />)}</datalist>
          </label>
        </div>
        <label style={{ ...lab, marginTop: 10 }}>Description (shown at the top of the form)
          <textarea aria-label="Description" style={{ ...inputStyle, minHeight: 50 }} value={description} onChange={e => setDescription(e.target.value)} />
        </label>

        <div style={{ fontSize: 13, fontWeight: 700, margin: "18px 0 6px" }}>Who it's about, and who gets it</div>
        {settings.followUpOnly ? (
          <div style={{ fontSize: 13, color: C.INK_SOFT }}>This form is part of a case: it's filed with the case's member and requested from the case page.</div>
        ) : (
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13 }}>
            {[["self", "The person filling it out"], ["choose", "A person they choose (e.g. an officer for a member)"], ["none", "No one (not filed in a personnel file)"]].map(([k, l]) => (
              <label key={k} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="radio" name="subject" checked={(settings.anonymous ? "none" : settings.subject) === k} disabled={settings.anonymous} onChange={() => set("subject", k)} /> {l}
              </label>
            ))}
          </div>
        )}
        {settings.subject === "choose" && !settings.anonymous && (
          <label style={{ ...lab, marginTop: 8, maxWidth: 420 }}>Question shown for choosing the person
            <input aria-label="Choose-person question" style={inputStyle} value={settings.subjectLabel || ""} placeholder="Who is this form about?" onChange={e => set("subjectLabel", e.target.value)} />
          </label>
        )}
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13, marginTop: 8 }}>
          {!settings.followUpOnly && (
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={!!settings.anonymous} onChange={e => setSettings(s => ({ ...s, anonymous: e.target.checked, subject: e.target.checked ? "none" : (s.subject === "none" ? "self" : s.subject) }))} /> Anonymous (never records who submitted it)
            </label>
          )}
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={settings.subjectCanView !== false} onChange={e => set("subjectCanView", e.target.checked)} /> The person it's about can see it
          </label>
        </div>

        <div style={{ ...lab, marginTop: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.INK }}>Required recipients</span>
          <span>Notified of every submission and asked to mark it reviewed. They can see all submissions of this form.</span>
          <PeoplePicker roster={roster} value={settings.recipients || []} onChange={v => set("recipients", v)} label="Required recipients" />
        </div>
        {existing && canGrantAccess && (
          <div style={{ ...lab, marginTop: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.INK }}>Can see all submissions (not notified)</span>
            <span>{settings.case ? "For a form that opens a case, they see the whole case, including sensitive details." : "Includes sensitive details."}{allAccess.length ? ` Also: ${allAccess.map(u => roster.find(x => x.id === u)?.name).filter(Boolean).join(", ")} (all forms).` : ""} Master admins always can.</span>
            {viewers ? <PeoplePicker roster={roster} value={withAccess} onChange={changeAccess} label="Can see all submissions" /> : <span>Loading…</span>}
          </div>
        )}
        {!settings.followUpOnly && (
          <div style={{ marginTop: 12 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, fontWeight: 600 }}>
              <input type="checkbox" checked={!!settings.approval?.enabled} onChange={e => set("approval", e.target.checked ? { enabled: true, label: "Supervisor", help: "" } : null)} /> Needs approval
            </label>
            {settings.approval?.enabled && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10, marginTop: 6 }}>
                <label style={lab}>Who approves (label)<input aria-label="Approver label" style={inputStyle} value={settings.approval.label || ""} onChange={e => set("approval", { ...settings.approval, label: e.target.value })} /></label>
                <label style={lab}>Instructions<input aria-label="Approver instructions" style={inputStyle} value={settings.approval.help || ""} onChange={e => set("approval", { ...settings.approval, help: e.target.value })} placeholder="The person submitting picks who approves." /></label>
              </div>
            )}
          </div>
        )}
        {!settings.followUpOnly && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Progress steps</div>
            <div style={{ fontSize: 12, color: C.INK_SOFT, margin: "2px 0 6px" }}>
              Optional. People who handle this form mark each submission's progress (for example Ordered, Ready for pickup, Picked up). The person who sent it sees the progress, and is told on their Your Day screen at steps marked "Tell them". A submission stays in the handlers' Waiting list until it reaches a step marked "Finished" (or the last step).
            </div>
            {(settings.stages || []).map((st, i) => {
              const upd = patch => set("stages", settings.stages.map((x, j) => j === i ? { ...x, ...patch } : x));
              return (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                  <input aria-label={`Step ${i + 1}`} style={{ ...inputStyle, maxWidth: 260 }} value={st.label} onChange={e => upd({ label: e.target.value })} placeholder={`Step ${i + 1}`} />
                  <label style={{ fontSize: 12.5, display: "flex", gap: 4, alignItems: "center" }}><input type="checkbox" checked={!!st.notify} onChange={e => upd({ notify: e.target.checked })} /> Tell them</label>
                  <label style={{ fontSize: 12.5, display: "flex", gap: 4, alignItems: "center" }}><input type="checkbox" checked={!!st.done} onChange={e => upd({ done: e.target.checked })} /> Finished</label>
                  <button type="button" style={{ ...btn("ghost"), color: C.BRICK, padding: "4px 8px" }} aria-label={`Remove step ${i + 1}`} onClick={() => set("stages", settings.stages.filter((_, j) => j !== i))}>Remove</button>
                </div>
              );
            })}
            {(settings.stages || []).length < 10 && <button type="button" style={{ ...btn("outline"), padding: "4px 12px" }} onClick={() => set("stages", [...(settings.stages || []), { label: "", notify: false, done: false }])}>+ Add step</button>}
          </div>
        )}
        {settings.limits?.length > 0 && (
          <div style={{ fontSize: 12.5, color: C.INK_SOFT, marginTop: 10 }}>
            Yearly limits shown to people filling this out: {settings.limits.map(l => `${l.label} ${l.max}`).join(", ")}. Keep the item choices and quantity questions unchanged so the counts still work.
          </div>
        )}
        {caseUsers.length > 0 && (
          <div style={{ marginTop: 14, padding: "10px 12px", background: C.PAPER, borderRadius: 7 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>When a case is opened</div>
            {caseUsers.map((cu, i) => (
              <div key={cu.form} style={{ ...lab, marginTop: 8 }}>
                <span style={{ fontSize: 13, color: C.INK }}>{cu.label} is requested from</span>
                <PeoplePicker roster={roster} value={cu.users} onChange={v => setCaseUsers(list => list.map((x, j) => j === i ? { ...x, users: v } : x))} label={cu.label} />
                <span>One person: it's assigned to them. Several: any of them can complete it.</span>
              </div>
            ))}
          </div>
        )}
        {settings.pdf && <div style={{ fontSize: 12.5, color: C.INK_SOFT, marginTop: 10 }}>Fills the official PDF <b>{settings.pdf.template}</b>. Keep field names unchanged so the PDF still fills; set district details (address, IDs, insurer) as default answers.</div>}
      </div>

      <div style={{ ...cardStyle, marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Questions ({fields.filter(f => !NO_VALUE.has(f.type)).length})</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={btn("outline")} onClick={() => addField("heading")}>+ Section</button>
            <button style={btn("primary")} onClick={() => addField("text")}>+ Question</button>
          </div>
        </div>
        {fields.length === 0 && <div style={{ color: C.INK_SOFT, fontSize: 13, marginTop: 10 }}>No questions yet.</div>}
        <div style={{ marginTop: 8 }}>
          {fields.map((f, i) => (
            <div key={f.key + i}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 4px", borderBottom: `1px solid ${C.LINE}`, background: f.type === "heading" ? "#F8F9FB" : "transparent" }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: C.BRASS, width: 110, flexShrink: 0, textTransform: "uppercase" }}>{TYPE_LABEL[f.type] || f.type}</span>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: f.type === "heading" ? 700 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {f.label}{f.required && <span style={{ color: C.BRICK }}> *</span>}
                  {f.showIf && <span style={{ color: C.INK_SOFT, fontSize: 12 }}> · only if {fields.find(x => x.key === f.showIf.field)?.label?.slice(0, 30) || f.showIf.field} = {f.showIf.any?.length ? f.showIf.any.join(" or ") : f.showIf.equals}</span>}
                  {(f.sensitive || f.type === "ssn") && <span style={{ color: C.AMBER, fontSize: 12 }}> · sensitive</span>}
                </span>
                <button aria-label={`Move ${f.label} up`} style={{ ...btn("ghost"), padding: "2px 7px" }} onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                <button aria-label={`Move ${f.label} down`} style={{ ...btn("ghost"), padding: "2px 7px" }} onClick={() => move(i, 1)} disabled={i === fields.length - 1}>↓</button>
                <button aria-label={`Edit ${f.label}`} style={{ ...btn("outline"), padding: "3px 10px", fontSize: 12.5 }} onClick={() => setOpen(open === i ? null : i)}>{open === i ? "Close" : "Edit"}</button>
                <button aria-label={`Delete ${f.label}`} style={{ ...btn("ghost"), padding: "3px 8px", color: C.BRICK }} disabled={usedAsCondition(f.key)}
                  title={usedAsCondition(f.key) ? "Another question depends on this one" : "Delete"}
                  onClick={() => { if (window.confirm(`Delete "${f.label}"? Past submissions keep their answers.`)) { setFields(fs => fs.filter((_, j) => j !== i)); setOpen(null); } }}>✕</button>
              </div>
              {open === i && (
                <FieldEditor f={f} index={i} fields={fields} onClose={() => setOpen(null)}
                  onChange={nf => setFields(fs => fs.map((x, j) => j === i ? nf : x))} />
              )}
            </div>
          ))}
        </div>
        {error && <div role="alert" style={{ color: C.BRICK, fontWeight: 600, fontSize: 13.5, marginTop: 12 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          <button style={btn("primary")} onClick={() => save()} disabled={busy}>{busy ? "Saving…" : "Save form"}</button>
          <button style={btn("outline")} onClick={() => setPreview(true)}>Preview</button>
          {existing && <button style={{ ...btn("ghost"), color: active ? C.BRICK : C.SAGE, marginLeft: "auto" }} onClick={() => save(!active)}>{active ? "Archive (hide from the list)" : "Restore"}</button>}
        </div>
        <div style={{ fontSize: 12, color: C.INK_SOFT, marginTop: 8 }}>Changes apply to new submissions; forms already submitted keep the questions they were filled out with.</div>
      </div>
    </div>
  );
}
