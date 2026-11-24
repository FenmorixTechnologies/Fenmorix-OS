// Interdepartmental directory: people by division, stations and facilities (with who's on
// duty), outside contacts, favorites, one search box, print, save-to-phone (vCard), the
// "last verified" stamp and directory checks. Server: server/directory.js.
import React, { useEffect, useMemo, useState } from "react";
import { BRAND } from "./brand.js";
import { Star, Users, Building2, Home as HomeIcon, Phone, Printer, Download, Pencil, ShieldCheck, RefreshCw, User, MapPin, BookOpen, Trash2 } from "lucide-react";
import AppShell from "./AppShell.jsx";
import { cardStyle, inputStyle, btn, sectionTitle, printDocument, letterhead } from "./App.jsx";
import { fireShift, commsShifts, todayISO } from "./shifts.js";
import { DutyBoard, matchStation } from "./DutyBoard.jsx";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", PAPER = "#F3F5F8", BRICK = "#C8102E";
const SAGE = "#2E7D4F", AMBER = "#B26A00", BLUE = "#1D5FA8";
const OUTSIDE_CATEGORIES = ["Hospital", "EMS", "Law enforcement", "Parish / government", "Utility", "Mutual aid", "Vendor", "Other"];

async function api(path, opts = {}) {
  const res = await fetch(`/api/directory${path}`, { ...opts, headers: { "Content-Type": "application/json", "X-SGFD": "1", ...(opts.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}
const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body || {}) });
const tel = p => "tel:" + String(p || "").replace(/[^\d+]/g, "");
const sms = p => "sms:" + String(p || "").replace(/[^\d+]/g, "");
const mapUrl = a => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a)}`;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const when = iso => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const dateOnly = iso => iso ? new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "";

// ---------------------------------------------------------------------
// Save to phone contacts (vCard 3.0)
// ---------------------------------------------------------------------
const vEsc = s => String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
function personVcard(p) {
  const [first, ...rest] = p.name.split(" ");
  return ["BEGIN:VCARD", "VERSION:3.0", `N:${vEsc(rest.join(" "))};${vEsc(first)};;;`, `FN:${vEsc(p.name)}`,
    `ORG:${vEsc(BRAND.org)};` + vEsc(p.division), p.jobTitle && `TITLE:${vEsc(p.jobTitle)}`,
    p.cellPhone && `TEL;TYPE=CELL:${p.cellPhone}`, p.homePhone && `TEL;TYPE=HOME:${p.homePhone}`,
    p.email && `EMAIL;TYPE=WORK:${p.email}`, p.extension && `NOTE:Extension ${vEsc(p.extension)}`, "END:VCARD"].filter(Boolean).join("\r\n");
}
function placeVcard(p) {
  return ["BEGIN:VCARD", "VERSION:3.0", `N:${vEsc(p.name)};;;;`, `FN:${vEsc(p.name)}`,
    `ORG:${p.kind === "outside" ? vEsc(p.name) : vEsc(BRAND.org)}`,
    p.phone && `TEL;TYPE=WORK,VOICE:${p.phone}`, p.fax && `TEL;TYPE=WORK,FAX:${p.fax}`, p.email && `EMAIL;TYPE=WORK:${p.email}`,
    p.address && `ADR;TYPE=WORK:;;${vEsc(p.address)};;;;`,
    (p.extension || p.notes) && `NOTE:${vEsc([p.extension && `Extension ${p.extension}`, p.notes].filter(Boolean).join(" — "))}`, "END:VCARD"].filter(Boolean).join("\r\n");
}
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/vcard" }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------
const iconBtn = { border: "none", background: "none", cursor: "pointer", padding: 4, color: INK_SOFT, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontFamily: "inherit" };
function Line({ label, children, privateField }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "78px 1fr", gap: 8, padding: "3px 0", fontSize: 13, alignItems: "baseline" }}>
      <span style={{ color: INK_SOFT, fontSize: 12 }}>{label}{privateField && <span title="Only you and directory admins see this" style={{ marginLeft: 3 }}>🔒</span>}</span>
      <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{children}</span>
    </div>
  );
}
const PhoneLink = ({ n, text }) => n ? (
  <span><a href={tel(n)} style={{ color: BLUE, fontWeight: 600, textDecoration: "none" }}>{n}</a>{text && <a href={sms(n)} style={{ color: INK_SOFT, fontSize: 12, marginLeft: 8 }}>text</a>}</span>
) : <span style={{ color: "#9AA3B2" }}>—</span>;

function FavButton({ on, onToggle, name }) {
  return (
    <button type="button" onClick={onToggle} aria-label={on ? `Remove ${name} from favorites` : `Add ${name} to favorites`} aria-pressed={on}
      style={{ ...iconBtn, color: on ? "#E0A800" : "#9AA3B2", fontSize: 18 }}>{on ? "★" : "☆"}</button>
  );
}

function PersonCard({ p, fav, onFav, canEdit, onEdit, isMe }) {
  return (
    <div style={{ ...cardStyle, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{p.name}{isMe && <span style={{ color: INK_SOFT, fontWeight: 500, fontSize: 12.5 }}> (you)</span>}</div>
          <div style={{ fontSize: 12.5, color: INK_SOFT }}>{[p.jobTitle, p.division].filter(Boolean).join(" · ")}</div>
        </div>
        <FavButton on={fav} onToggle={onFav} name={p.name} />
      </div>
      <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 6 }}>
        <Line label="Station">{p.station ? (/^\d+$/.test(p.station) ? `Station ${p.station}` : p.station) : <span style={{ color: "#9AA3B2" }}>—</span>}</Line>
        <Line label="Cell"><PhoneLink n={p.cellPhone} text /></Line>
        {"homePhone" in p && <Line label="Home" privateField><PhoneLink n={p.homePhone} /></Line>}
        <Line label="Email">{p.email ? <a href={`mailto:${p.email}`} style={{ color: BLUE }}>{p.email}</a> : <span style={{ color: "#9AA3B2" }}>—</span>}</Line>
        <Line label="Extension">{p.extension ? <b>{p.extension}</b> : <span style={{ color: "#9AA3B2" }}>—</span>}</Line>
        {p.callSign && <Line label="Call sign"><b>{p.callSign}</b></Line>}
      </div>
      {p.emergency && (
        <div style={{ background: "#FFF6F6", border: "1px solid #F3D3D7", borderRadius: 7, padding: "6px 10px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: BRICK, textTransform: "uppercase", letterSpacing: 0.4 }}>Emergency contact 🔒</div>
          {p.emergency.name ? (
            <div style={{ fontSize: 13 }}>{p.emergency.name}{p.emergency.relationship ? ` (${p.emergency.relationship})` : ""} · <PhoneLink n={p.emergency.phone} /></div>
          ) : <div style={{ fontSize: 12.5, color: INK_SOFT }}>None on file.</div>}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: "auto", paddingTop: 4, flexWrap: "wrap" }}>
        <button type="button" style={iconBtn} onClick={() => download(`${p.name}.vcf`, personVcard(p))} aria-label={`Save ${p.name} to phone contacts`}><Download size={13} /> Save contact</button>
        {canEdit && <button type="button" style={{ ...iconBtn, color: BLUE, fontWeight: 600 }} onClick={onEdit} aria-label={`Edit ${p.name}'s card`}><Pencil size={13} /> Edit</button>}
      </div>
    </div>
  );
}

function PlaceCard({ p, fav, onFav, canEdit, onEdit, duty, today }) {
  const station = p.kind === "station";
  return (
    <div style={{ ...cardStyle, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0, borderTop: station ? `4px solid ${BRICK}` : undefined }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        {station && p.number && <span style={{ background: BRICK, color: "#fff", fontWeight: 800, borderRadius: 8, padding: "4px 9px", fontSize: 15 }}>{p.number}</span>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{p.name}</div>
          {p.category && <div style={{ fontSize: 12.5, color: INK_SOFT }}>{p.category}</div>}
        </div>
        <FavButton on={fav} onToggle={onFav} name={p.name} />
      </div>
      <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 6 }}>
        <Line label="Address">{p.address ? <a href={mapUrl(p.address)} target="_blank" rel="noreferrer" style={{ color: BLUE }}>{p.address}</a> : <span style={{ color: "#9AA3B2" }}>—</span>}</Line>
        <Line label="Phone"><PhoneLink n={p.phone} /></Line>
        <Line label="Fax">{p.fax || <span style={{ color: "#9AA3B2" }}>—</span>}</Line>
        <Line label="Short code">{p.extension ? <b style={{ fontSize: 14 }}>{p.extension}</b> : <span style={{ color: "#9AA3B2" }}>—</span>}</Line>
        {p.email && <Line label="Email"><a href={`mailto:${p.email}`} style={{ color: BLUE }}>{p.email}</a></Line>}
        {p.notes && <Line label="Notes"><span style={{ whiteSpace: "pre-wrap" }}>{p.notes}</span></Line>}
      </div>
      {station && (
        <div style={{ background: PAPER, borderRadius: 7, padding: "8px 10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.4 }}>On duty</span>
            <span style={{ background: BRICK, color: "#fff", borderRadius: 999, fontSize: 11.5, fontWeight: 800, padding: "1px 8px" }}>{fireShift(today)} shift</span>
          </div>
          {duty.configured ? (
            duty.people.length ? duty.people.map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 8, fontSize: 13, padding: "2px 0", alignItems: "baseline" }}>
                <span style={{ color: INK_SOFT, fontSize: 12, minWidth: 0, flex: "0 1 45%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.positionLabel || a.scheduleName}</span>
                <span style={{ fontWeight: 700 }}>{a.name}</span>
              </div>
            )) : <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 4 }}>No one from Aladtec matches this station{p.aladtecMatch ? "" : " (set its Aladtec match)"}.</div>
          ) : <div style={{ fontSize: 12, color: INK_SOFT, marginTop: 4 }}>Names appear here once Aladtec is connected.</div>}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: "auto", paddingTop: 4, flexWrap: "wrap" }}>
        <button type="button" style={iconBtn} onClick={() => download(`${p.name}.vcf`, placeVcard(p))} aria-label={`Save ${p.name} to phone contacts`}><Download size={13} /> Save contact</button>
        {canEdit && <button type="button" style={{ ...iconBtn, color: BLUE, fontWeight: 600 }} onClick={onEdit} aria-label={`Edit ${p.name}`}><Pencil size={13} /> Edit</button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Editors (shown as a panel over the page)
// ---------------------------------------------------------------------
function Modal({ title, onClose, children }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} style={{ position: "fixed", inset: 0, background: "rgba(10,18,34,0.45)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 14px", overflowY: "auto" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ ...cardStyle, width: "min(620px, 100%)", padding: "18px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{title}</div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ ...iconBtn, fontSize: 20 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
const Field = ({ label, children, wide }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, color: INK_SOFT, fontWeight: 600, gridColumn: wide ? "1 / -1" : undefined }}>{label}{children}</label>
);
const grid2 = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 };

function PersonEditor({ p, stations, onClose, onSaved }) {
  const [f, setF] = useState({
    jobTitle: p.jobTitle, station: p.station, cellPhone: p.cellPhone, homePhone: p.homePhone || "", email: p.email, extension: p.extension, callSign: p.callSign || "",
    emergency: { name: p.emergency?.name || "", phone: p.emergency?.phone || "", relationship: p.emergency?.relationship || "" },
  });
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const setE = (k, v) => setF(x => ({ ...x, emergency: { ...x.emergency, [k]: v } }));
  async function save() {
    setBusy(true); setError("");
    try { await post(`/people/${p.id}`, f); onSaved("Card saved"); } catch (e) { setError(e.message); setBusy(false); }
  }
  return (
    <Modal title={`${p.name}'s card`} onClose={onClose}>
      <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 10 }}>Name and division are changed in User Management.</div>
      <div style={grid2}>
        <Field label="Title"><input aria-label="Title" style={inputStyle} value={f.jobTitle} onChange={e => set("jobTitle", e.target.value)} /></Field>
        <Field label="Home station">
          <input aria-label="Home station" list="dir-stations" style={inputStyle} value={f.station} onChange={e => set("station", e.target.value)} placeholder="e.g. 61 or Headquarters" />
          <datalist id="dir-stations">{stations.map(s => <option key={s} value={s} />)}</datalist>
        </Field>
        <Field label="Cell phone"><input aria-label="Cell phone" type="tel" style={inputStyle} value={f.cellPhone} onChange={e => set("cellPhone", e.target.value)} /></Field>
        <Field label="Home phone 🔒"><input aria-label="Home phone" type="tel" style={inputStyle} value={f.homePhone} onChange={e => set("homePhone", e.target.value)} /></Field>
        <Field label="Email"><input aria-label="Email" type="email" style={inputStyle} value={f.email} onChange={e => set("email", e.target.value)} /></Field>
        <Field label="Extension / short code"><input aria-label="Extension" style={inputStyle} value={f.extension} onChange={e => set("extension", e.target.value)} /></Field>
        <Field label="Radio call sign (e.g. SG10)"><input aria-label="Call sign" style={inputStyle} value={f.callSign} onChange={e => set("callSign", e.target.value.toUpperCase())} placeholder="Shows who's on the unit in Active calls" /></Field>
      </div>
      <div style={{ fontSize: 13, fontWeight: 800, color: BRICK, margin: "16px 0 6px" }}>Emergency contact 🔒</div>
      <div style={grid2}>
        <Field label="Name"><input aria-label="Emergency contact name" style={inputStyle} value={f.emergency.name} onChange={e => setE("name", e.target.value)} /></Field>
        <Field label="Relationship"><input aria-label="Emergency contact relationship" list="dir-rel" style={inputStyle} value={f.emergency.relationship} onChange={e => setE("relationship", e.target.value)} />
          <datalist id="dir-rel">{["Spouse", "Parent", "Sibling", "Child", "Partner", "Friend"].map(s => <option key={s} value={s} />)}</datalist></Field>
        <Field label="Phone"><input aria-label="Emergency contact phone" type="tel" style={inputStyle} value={f.emergency.phone} onChange={e => setE("phone", e.target.value)} /></Field>
      </div>
      <div style={{ fontSize: 12, color: INK_SOFT, marginTop: 8 }}>🔒 Home phone and emergency contact are only seen by you and directory admins.</div>
      {error && <div role="alert" style={{ color: BRICK, fontWeight: 600, marginTop: 10 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button style={btn("primary")} onClick={save} disabled={busy}>{busy ? "Saving…" : "Save card"}</button>
        <button style={btn("ghost")} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

function PlaceEditor({ p, onClose, onSaved }) {
  const [f, setF] = useState({ ...p });
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const kindLabel = { station: "station", facility: "facility", outside: "outside contact" }[f.kind];
  async function save() {
    setBusy(true); setError("");
    try { await post("/places", f); onSaved(p.id ? "Saved" : "Added"); } catch (e) { setError(e.message); setBusy(false); }
  }
  async function remove() {
    if (!window.confirm(`Remove ${p.name} from the directory?`)) return;
    try { await api(`/places/${p.id}`, { method: "DELETE" }); onSaved("Removed"); } catch (e) { setError(e.message); }
  }
  return (
    <Modal title={p.id ? `Edit ${p.name}` : `Add a ${kindLabel}`} onClose={onClose}>
      <div style={grid2}>
        <Field label="Type">
          <select aria-label="Type" style={inputStyle} value={f.kind} onChange={e => set("kind", e.target.value)}>
            <option value="station">Fire station</option><option value="facility">Facility / office</option><option value="outside">Outside contact</option>
          </select>
        </Field>
        <Field label="Name"><input aria-label="Name" style={inputStyle} value={f.name} onChange={e => set("name", e.target.value)} placeholder={f.kind === "station" ? "Station 61" : ""} /></Field>
        {f.kind === "station" && <Field label="Station number"><input aria-label="Station number" style={inputStyle} value={f.number} onChange={e => set("number", e.target.value)} /></Field>}
        {f.kind === "outside" && (
          <Field label="Category">
            <input aria-label="Category" list="dir-cats" style={inputStyle} value={f.category} onChange={e => set("category", e.target.value)} />
            <datalist id="dir-cats">{OUTSIDE_CATEGORIES.map(c => <option key={c} value={c} />)}</datalist>
          </Field>
        )}
        <Field label="Address" wide><input aria-label="Address" style={inputStyle} value={f.address} onChange={e => set("address", e.target.value)} /></Field>
        <Field label="Phone"><input aria-label="Phone" type="tel" style={inputStyle} value={f.phone} onChange={e => set("phone", e.target.value)} /></Field>
        <Field label="Fax"><input aria-label="Fax" type="tel" style={inputStyle} value={f.fax} onChange={e => set("fax", e.target.value)} /></Field>
        <Field label="Short code / extension"><input aria-label="Short code" style={inputStyle} value={f.extension} onChange={e => set("extension", e.target.value)} /></Field>
        <Field label="Email"><input aria-label="Email" type="email" style={inputStyle} value={f.email} onChange={e => set("email", e.target.value)} /></Field>
        <Field label="Notes" wide><textarea aria-label="Notes" style={{ ...inputStyle, minHeight: 60 }} value={f.notes} onChange={e => set("notes", e.target.value)} /></Field>
        {f.kind === "station" && (
          <Field label="Aladtec match" wide>
            <input aria-label="Aladtec match" style={inputStyle} value={f.aladtecMatch} onChange={e => set("aladtecMatch", e.target.value)} placeholder="e.g. ??61*  or  61, E61, M61" />
            <span style={{ fontWeight: 400, fontSize: 12 }}>Words in Aladtec schedule or position names that belong to this station, separated by commas. In a word, ? = any one letter or digit and * = any number of them, so <code>??61*</code> matches unit codes like EG613 and LD618. See Aladtec setup for the names Aladtec uses.</span>
          </Field>
        )}
        <Field label="Order in list"><input aria-label="Order" type="number" style={inputStyle} value={f.sort} onChange={e => set("sort", e.target.value)} /></Field>
      </div>
      {error && <div role="alert" style={{ color: BRICK, fontWeight: 600, marginTop: 10 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <button style={btn("primary")} onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        <button style={btn("ghost")} onClick={onClose}>Cancel</button>
        {p.id && <button style={{ ...btn("ghost"), color: BRICK, marginLeft: "auto" }} onClick={remove}><Trash2 size={13} /> Remove</button>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Admin pages: directory check, Aladtec setup
// ---------------------------------------------------------------------
function VerificationAdmin({ data, reload, toast }) {
  const [status, setStatus] = useState(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const v = data.verification;
  useEffect(() => { if (v.active) api("/verification/status").then(setStatus, e => setError(e.message)); else setStatus(null); }, [v.active?.id, v.active?.confirmed]);
  const act = async (path, msg) => {
    setError("");
    try { await post(path, { note }); setNote(""); toast(msg); reload(); } catch (e) { setError(e.message); }
  };
  const missing = status ? status.people.filter(p => !p.confirmedAt) : [];
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={cardStyle}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>{v.active ? "Directory check in progress" : "Start a directory check"}</div>
        {!v.active ? (
          <>
            <div style={{ fontSize: 13, color: INK_SOFT, marginBottom: 10 }}>
              Everyone gets "Please confirm your directory card" on their Your Day screen. They fix their card or click "Looks right."
              You'll see who has and hasn't, and when you close the check, the directory is stamped verified with today's date.
            </div>
            <input aria-label="Note" style={{ ...inputStyle, marginBottom: 8 }} placeholder="Note (optional), e.g. Annual directory update" value={note} onChange={e => setNote(e.target.value)} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={btn("primary")} onClick={() => act("/verification/start", "Directory check started")}>Start directory check</button>
              <button style={btn("outline")} onClick={() => act("/verification/stamp", "Directory marked verified")}>Just mark it verified today</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, color: INK_SOFT }}>Started {when(v.active.startedAt)}{v.active.startedBy ? ` by ${v.active.startedBy}` : ""}{v.active.note ? ` · ${v.active.note}` : ""}</div>
            <div style={{ margin: "10px 0", height: 10, background: "#E6EAF0", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ width: `${v.active.total ? (v.active.confirmed / v.active.total) * 100 : 0}%`, height: "100%", background: SAGE }} />
            </div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{v.active.confirmed} of {v.active.total} confirmed</div>
            <input aria-label="Closing note" style={{ ...inputStyle, margin: "10px 0 8px" }} placeholder="Closing note (optional)" value={note} onChange={e => setNote(e.target.value)} />
            <button style={btn("primary")} onClick={() => act("/verification/close", "Directory marked verified")}>Close check and mark verified</button>
          </>
        )}
        {error && <div role="alert" style={{ color: BRICK, fontWeight: 600, marginTop: 8 }}>{error}</div>}
      </div>
      {status && (
        <div style={cardStyle}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Still to confirm ({missing.length})</div>
          {missing.length === 0 && <div style={{ color: SAGE, fontWeight: 600 }}>Everyone has confirmed.</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "2px 16px" }}>
            {missing.map(p => <div key={p.id} style={{ fontSize: 13, padding: "3px 0" }}><b>{p.name}</b> <span style={{ color: INK_SOFT }}>· {p.division}</span></div>)}
          </div>
          <div style={{ fontWeight: 800, margin: "14px 0 6px" }}>Confirmed ({status.people.length - missing.length})</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "2px 16px" }}>
            {status.people.filter(p => p.confirmedAt).map(p => (
              <div key={p.id} style={{ fontSize: 13, padding: "3px 0" }}>{p.name} <span style={{ color: p.changed ? AMBER : SAGE, fontSize: 12 }}>· {p.changed ? "updated" : "looks right"}</span></div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AladtecSetup({ places, toast }) {
  const [snap, setSnap] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = (refresh) => { setBusy(true); (refresh ? post("/aladtec") : api("/aladtec")).then(s => { setSnap(s); setBusy(false); if (refresh) toast("Checked Aladtec"); }, () => setBusy(false)); };
  useEffect(() => { load(false); }, []);
  if (!snap) return <div style={{ color: INK_SOFT }}>Loading…</div>;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={cardStyle}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>Aladtec: {snap.configured ? (snap.error ? <span style={{ color: BRICK }}>problem</span> : <span style={{ color: SAGE }}>connected</span>) : <span style={{ color: AMBER }}>not set up</span>}</div>
        {!snap.configured && (
          <div style={{ fontSize: 13, color: INK_SOFT, marginTop: 6, lineHeight: 1.5 }}>
            Station cards can list who's on duty right now, straight from Aladtec.<br />
            1. Ask Aladtec Support (888-749-5550, support@aladtec.com) for an <b>API profile</b> with access to schedules, scheduled time and members. They'll give you a client ID, a client secret and your API address.<br />
            2. Add them to the app's <code>.env</code> file: <code>ALADTEC_BASE_URL</code>, <code>ALADTEC_CLIENT_ID</code>, <code>ALADTEC_CLIENT_SECRET</code>.<br />
            3. Run <code>update.ps1</code> (or restart the SGFD App service). It checks right after each shift change (07:00 and 19:00) and every 4 hours in between.
          </div>
        )}
        {snap.configured && (
          <div style={{ fontSize: 13, color: INK_SOFT, marginTop: 6 }}>
            {snap.updatedAt ? `Last checked ${when(snap.updatedAt)}.` : "Not checked yet."}{snap.nextCheckAt ? ` Next check ${new Date(snap.nextCheckAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : ""}
            {snap.checkTimes && <div style={{ marginTop: 4 }}>Checks Aladtec at {snap.checkTimes.join(", ")}, and when someone clicks Check now (at most once every 2 minutes).</div>}
            {snap.requests && <div style={{ marginTop: 2 }}>Requests to Aladtec today: <b>{snap.requests.count}</b> of the {snap.requests.limit.toLocaleString()} Aladtec allows (this app stops itself at {snap.requests.cap}).</div>}
            {snap.throttled && <div style={{ marginTop: 2, color: AMBER }}>Checked less than 2 minutes ago; showing that result.</div>} {snap.error && <span style={{ color: BRICK }}>{snap.error}</span>}
            {!snap.error && snap.updatedAt && snap.membersLoaded !== undefined && (snap.membersLoaded > 0
              ? <span> Names loaded for {snap.membersLoaded} members.</span>
              : <span style={{ color: AMBER }}> No member names came back: ask Aladtec Support to give the API profile read access to members.</span>)}
          </div>
        )}
        {snap.configured && <button style={{ ...btn("outline"), marginTop: 10 }} onClick={() => load(true)} disabled={busy}><RefreshCw size={13} /> {busy ? "Checking…" : "Check now"}</button>}
      </div>
      {snap.configured && (
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>On duty ({snap.assignments.length} on right now)</div>
          <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 8 }}>A unit goes on a station's card when its name fits the station's "Aladtec match" (e.g. <code>??68*</code> = EG683, MD687; ? = any one letter or digit, * = any number). Other schedules get a card of their own.</div>
          <DutyBoard snap={snap} places={places} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Print
// ---------------------------------------------------------------------
function printList(title, people, places) {
  const row = (cells) => `<tr>${cells.map(c => `<td>${c}</td>`).join("")}</tr>`;
  let html = letterhead(`Directory — ${title}`) + `<div class="meta">Printed ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>`;
  if (places.length) {
    html += `<h2>Stations and contacts</h2><table><tr><th>Name</th><th>Address</th><th>Phone</th><th>Fax</th><th>Short code</th></tr>` +
      places.map(p => row([`<b>${esc(p.name)}</b>${p.category ? `<div class="meta">${esc(p.category)}</div>` : ""}`, esc(p.address), esc(p.phone), esc(p.fax), `<b>${esc(p.extension)}</b>`])).join("") + `</table>`;
  }
  const byDiv = [...new Set(people.map(p => p.division))].sort();
  for (const d of byDiv) {
    html += `<h2>${esc(d)}</h2><table><tr><th>Name</th><th>Title</th><th>Station</th><th>Cell</th><th>Email</th><th>Ext.</th></tr>` +
      people.filter(p => p.division === d).map(p => row([`<b>${esc(p.name)}</b>`, esc(p.jobTitle), esc(p.station), esc(p.cellPhone), esc(p.email), esc(p.extension)])).join("") + `</table>`;
  }
  printDocument(`Directory — ${title}`, html);
}

// ---------------------------------------------------------------------
export default function DirectoryModule({ onBack, initialView }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [view, setView] = useState(initialView || "all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);   // { person } | { place }
  const [toast, setToast] = useState(null);
  const load = () => api("").then(setData, e => setError(e.message));
  useEffect(() => { load(); }, []);
  const showToast = m => { setToast(m); setTimeout(() => setToast(null), 2400); };
  const today = todayISO();

  const favSet = useMemo(() => new Set((data?.favorites || []).map(f => `${f.type}:${f.id}`)), [data]);
  if (error) return <AppShell section="Directory" onHome={onBack}><div style={{ color: BRICK }}>{error}</div></AppShell>;
  if (!data) return <AppShell section="Directory" onHome={onBack}><div style={{ color: INK_SOFT }}>Loading…</div></AppShell>;

  const me = data.people.find(p => p.id === data.meId);
  const divisions = [...new Set(data.people.map(p => p.division))].sort();
  const stations = data.places.filter(p => p.kind === "station");
  const facilities = data.places.filter(p => p.kind === "facility");
  const outside = data.places.filter(p => p.kind === "outside");
  const favPeople = data.people.filter(p => favSet.has(`person:${p.id}`));
  const favPlaces = data.places.filter(p => favSet.has(`place:${p.id}`));
  const v = data.verification;
  const needsConfirm = !!v.active && !v.active.mine;

  async function toggleFav(type, id) {
    const on = !favSet.has(`${type}:${id}`);
    try { await post("/favorites", { type, id, on }); load(); } catch (e) { showToast(e.message); }
  }
  async function confirmMine() {
    try { await post("/verification/confirm"); showToast("Thanks, your card is confirmed"); load(); } catch (e) { showToast(e.message); }
  }
  const dutyFor = p => ({ configured: data.onDuty.configured, people: data.onDuty.assignments.filter(a => matchStation(a, p.aladtecMatch)) });

  // What to show
  const needle = q.trim().toLowerCase();
  const personText = p => `${p.name} ${p.jobTitle} ${p.division} ${p.station} ${p.cellPhone} ${p.homePhone || ""} ${p.email} ${p.extension}`.toLowerCase();
  const placeText = p => `${p.name} ${p.number} ${p.category} ${p.address} ${p.phone} ${p.fax} ${p.extension} ${p.notes}`.toLowerCase();
  let title, people = [], places = [];
  if (needle) {
    title = `Search: “${q.trim()}”`;
    people = data.people.filter(p => personText(p).includes(needle));
    places = data.places.filter(p => placeText(p).includes(needle));
  } else if (view === "mine") { title = "My card"; people = me ? [me] : []; }
  else if (view === "favorites") { title = "Favorites"; people = favPeople; places = favPlaces; }
  else if (view === "all") { title = "Everyone"; people = data.people; }
  else if (view.startsWith("div:")) { title = view.slice(4); people = data.people.filter(p => p.division === title); }
  else if (view === "stations") { title = "Fire stations"; places = stations; }
  else if (view === "facilities") { title = "Facilities & offices"; places = facilities; }
  else if (view === "outside") { title = "Outside contacts"; places = outside; }
  else if (view === "verify") title = "Directory check";
  else if (view === "aladtec") title = "Aladtec setup";

  // St. George's Nexus and the fire-department sandbox keep the full fire-service directory; other installs get the simple one
  // (My card, Everyone, Outside contacts). Michael, 11/2026.
  const fireDirectory = BRAND.product === "nexus" || BRAND.sandbox;
  const shellNav = !fireDirectory ? [
    { key: "mine", label: "My card", icon: User, badge: needsConfirm ? 1 : 0 },
    { key: "all", label: "Everyone", icon: Users },
    { key: "outside", label: "Outside contacts", icon: BookOpen },
  ] : [
    { key: "mine", label: "My card", icon: User, badge: needsConfirm ? 1 : 0 },
    ...(favPeople.length + favPlaces.length ? [{ key: "favorites", label: "Favorites", icon: Star }] : []),
    { key: "all", label: "Everyone", icon: Users, group: "People" },
    ...divisions.map(d => ({ key: `div:${d}`, label: d, icon: Users, group: "People" })),
    { key: "stations", label: "Fire stations", icon: MapPin, group: "Places" },
    { key: "facilities", label: "Facilities & offices", icon: Building2, group: "Places" },
    { key: "outside", label: "Outside contacts", icon: BookOpen, group: "Places" },
    ...(data.canAdmin ? [
      { key: "verify", label: "Directory check", icon: ShieldCheck, group: "Admin", badge: v.active ? v.active.total - v.active.confirmed : 0 },
      { key: "aladtec", label: "Aladtec setup", icon: RefreshCw, group: "Admin" },
    ] : []),
  ];
  const listPage = !["verify", "aladtec"].includes(view) || needle;
  const sortedPeople = [...people].sort((a, b) => a.name.localeCompare(b.name));
  const outsideGroups = [...new Set(places.filter(p => p.kind === "outside").map(p => p.category || "Other"))].sort();
  const canEditPerson = p => data.canAdmin || p.id === data.meId;
  const addKind = view === "stations" ? "station" : view === "facilities" ? "facility" : view === "outside" ? "outside" : null;
  const cardsGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 290px), 1fr))", gap: 14 };
  const placeCards = list => (
    <div style={cardsGrid}>
      {list.map(p => <PlaceCard key={p.id} p={p} today={today} duty={dutyFor(p)} fav={favSet.has(`place:${p.id}`)} onFav={() => toggleFav("place", p.id)}
        canEdit={data.canAdmin} onEdit={() => setEditing({ place: p })} />)}
    </div>
  );

  return (
    <AppShell section="Directory" nav={shellNav} active={needle ? "" : view} onNav={k => { setQ(""); setView(k); }} onHome={onBack}>
      {/* Last verified + the current check */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14, fontSize: 13, color: INK_SOFT }}>
        <ShieldCheck size={15} />
        {v.lastVerifiedAt
          ? <span>Directory last verified <b style={{ color: INK }}>{dateOnly(v.lastVerifiedAt)}</b>{v.lastVerifiedBy ? ` by ${v.lastVerifiedBy}` : ""}{v.lastNote ? ` · ${v.lastNote}` : ""}</span>
          : <span>The directory hasn't been verified yet.</span>}
      </div>
      {needsConfirm && (
        <div role="status" style={{ ...cardStyle, borderLeft: `4px solid ${AMBER}`, marginBottom: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px" }}>
            <div style={{ fontWeight: 800 }}>Please confirm your directory card</div>
            <div style={{ fontSize: 13, color: INK_SOFT }}>We're checking the whole directory{v.active.note ? ` (${v.active.note})` : ""}. Is your information right?</div>
          </div>
          <button style={btn("primary")} onClick={confirmMine}>Looks right</button>
          <button style={btn("outline")} onClick={() => me && setEditing({ person: me })}>Edit my card</button>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ ...sectionTitle, margin: 0, flex: "1 1 auto" }}>{title}</div>
        <input type="search" aria-label="Search the directory" placeholder="Search names, titles, stations, phone, extensions…" value={q} onChange={e => setQ(e.target.value)}
          style={{ ...inputStyle, width: "min(100%, 340px)" }} />
        {listPage && (people.length > 0 || places.length > 0) && <>
          <button style={btn("outline")} onClick={() => printList(title, sortedPeople, places)}><Printer size={13} /> Print</button>
          <button style={btn("outline")} onClick={() => download(`${BRAND.short} ${title}.vcf`, [...sortedPeople.map(personVcard), ...places.map(placeVcard)].join("\r\n"))}><Download size={13} /> Save all to phone</button>
        </>}
        {!needle && addKind && data.canAdmin && (
          <button style={btn("primary")} onClick={() => setEditing({ place: { kind: addKind, name: "", number: "", category: "", address: "", phone: "", fax: "", extension: "", email: "", notes: "", aladtecMatch: "", sort: 100 } })}>
            + Add {addKind === "outside" ? "contact" : addKind}
          </button>
        )}
      </div>

      {view === "verify" && !needle && data.canAdmin && <VerificationAdmin data={data} reload={load} toast={showToast} />}
      {view === "aladtec" && !needle && data.canAdmin && <AladtecSetup places={data.places} toast={showToast} />}

      {listPage && <>
        {view === "stations" && !needle && (
          <div style={{ fontSize: 13, color: INK_SOFT, marginBottom: 12 }}>
            Today: Fire <b style={{ color: BRICK }}>{fireShift(today)} shift</b> · Communications <b>{commsShifts(today).day}</b> days / <b>{commsShifts(today).night}</b> nights
            {data.onDuty.configured && data.onDuty.updatedAt ? ` · Aladtec as of ${new Date(data.onDuty.updatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}
          </div>
        )}
        {people.length === 0 && places.length === 0 && (
          <div style={{ color: INK_SOFT }}>{needle ? "Nothing matches." : view === "favorites" ? "Star people and places to keep them here." : addKind ? "Nothing here yet." : "No one here."}</div>
        )}
        {places.length > 0 && (needle || view === "favorites") && <div style={{ fontSize: 12.5, fontWeight: 800, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.5, margin: "4px 0 8px" }}>Places</div>}
        {places.length > 0 && view === "outside" && !needle
          ? outsideGroups.map(g => (
            <div key={g} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.5, margin: "4px 0 8px" }}>{g}</div>
              {placeCards(places.filter(p => (p.category || "Other") === g))}
            </div>))
          : places.length > 0 && placeCards(places)}
        {people.length > 0 && places.length > 0 && <div style={{ fontSize: 12.5, fontWeight: 800, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.5, margin: "18px 0 8px" }}>People</div>}
        {people.length > 0 && (view === "all" && !needle
          ? divisions.map(d => (
            <div key={d} style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.5, margin: "4px 0 8px" }}>{d}</div>
              <div style={cardsGrid}>
                {sortedPeople.filter(p => p.division === d).map(p => <PersonCard key={p.id} p={p} isMe={p.id === data.meId} fav={favSet.has(`person:${p.id}`)} onFav={() => toggleFav("person", p.id)} canEdit={canEditPerson(p)} onEdit={() => setEditing({ person: p })} />)}
              </div>
            </div>))
          : <div style={cardsGrid}>
            {sortedPeople.map(p => <PersonCard key={p.id} p={p} isMe={p.id === data.meId} fav={favSet.has(`person:${p.id}`)} onFav={() => toggleFav("person", p.id)} canEdit={canEditPerson(p)} onEdit={() => setEditing({ person: p })} />)}
          </div>)}
      </>}

      {editing?.person && <PersonEditor p={editing.person} stations={[...stations.map(s => s.number || s.name), ...facilities.map(f => f.name)]}
        onClose={() => setEditing(null)} onSaved={m => { setEditing(null); showToast(m); load(); }} />}
      {editing?.place && <PlaceEditor p={editing.place} onClose={() => setEditing(null)} onSaved={m => { setEditing(null); showToast(m); load(); }} />}
      {toast && (
        <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: INK, color: "#FFFFFF", padding: "10px 18px", borderRadius: 7, fontSize: 13.5, fontWeight: 600, zIndex: 200 }}>{toast}</div>
      )}
    </AppShell>
  );
}
