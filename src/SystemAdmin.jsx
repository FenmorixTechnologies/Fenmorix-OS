// User Management › System (master admins): install an update from the zip, restart the service, roll back, back up, and read
// the logs, without remote desktop. Server: server/system.js; the work is done by scripts/apply-update.ps1 through the
// "SGFD Nexus Update" task (scripts/install-updater.ps1, once). Install / restart / rollback / backup need an authenticator code.
import React, { useEffect, useRef, useState } from "react";
import { UploadCloud, RotateCw, Power, Undo2, DatabaseBackup, FileText, CheckCircle2, AlertTriangle } from "lucide-react";
import { cardStyle, inputStyle, btn } from "./App.jsx";
import { PN } from "./brand.js";
import BrandingCard from "./BrandingAdmin.jsx";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", BRICK = "#C8102E", AMBER = "#B26A00", SAGE = "#2E7D4F", PAPER = "#F3F5F8";
export async function call(path, body) {
  const r = await fetch(`/api/system${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || "That didn't work."), { need: j.need, status: r.status });
  return j;
}
const size = n => (n == null ? "" : n > 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
const when = d => (d ? new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const uptime = s => (s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${(s / 3600).toFixed(1)} h` : `${Math.floor(s / 86400)} d ${Math.round((s % 86400) / 3600)} h`);
const toBase64 = file => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = () => bad(new Error("Couldn't read that file.")); r.readAsDataURL(file); });
const LABEL = { install: "Install the update", restart: "Restart the service", rollback: "Go back to the previous version", backup: "Back up now" };
const DOWN = { install: PN + " will be down for about a minute while it installs.", restart: PN + " will be down for a few seconds.", rollback: PN + " will be down for about a minute.", backup: "" };

// Ask for an authenticator code, then do `run` (any system change)
export function CodeDialog({ title, note, button, run, onCancel, onDone }) {
  const [code, setCode] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const go = async () => {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/auth/mfa-verify", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify({ code }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "That code didn't work.");
      onDone(await run());
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <div role="dialog" aria-label="Confirm with your authenticator" style={{ position: "fixed", inset: 0, background: "rgba(19,35,63,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
    <div style={{ ...cardStyle, width: "min(420px, 100%)", margin: 0 }}>
      <div style={{ fontWeight: 800, fontSize: 16, color: INK }}>{title}</div>
      <div style={{ fontSize: 13.5, color: INK_SOFT, margin: "6px 0 12px" }}>{note} Enter the 6-digit code from your authenticator to go ahead.</div>
      <input aria-label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} style={{ ...inputStyle, fontSize: 20, letterSpacing: 4, width: 150 }}
        value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} onKeyDown={e => { if (e.key === "Enter" && code.length === 6) go(); }} />
      {error && <div style={{ color: BRICK, fontSize: 13, marginTop: 8 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="button" style={btn("primary")} disabled={busy || code.length !== 6} onClick={go}>{button || title}</button>
        <button type="button" style={btn("ghost")} onClick={onCancel}>Cancel</button></div>
    </div></div>;
}

export default function SystemPanel({ toast }) {
  const [s, setS] = useState(null), [error, setError] = useState(""), [file, setFile] = useState(null), [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(null), [waiting, setWaiting] = useState(null), [log, setLog] = useState(null);
  const fileRef = useRef(null);
  const load = () => call("").then(x => { setS(x); setError(""); return x; });
  // Opened while the updater is still working (e.g. from another device): pick it up
  useEffect(() => { load().then(x => { if (x.pending && Date.now() - new Date(x.pending.at) < 20 * 60e3) setWaiting({ id: x.pending.id, action: x.pending.action, down: false, startedAt: new Date(x.pending.at).getTime(), progress: x.progress }); }, e => setError(e.message)); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // While the updater works the server goes away and comes back: poll until it answers and the job has a result
  useEffect(() => {
    if (!waiting) return;
    let stop = false, wentDown = false;
    const until = Date.now() + 20 * 60e3;
    const tick = async () => {
      if (stop) return;
      if (Date.now() > until) { setWaiting(null); toast("No result after 20 minutes. Open the newest updater log, or check the server."); return; }
      try {
        const x = await call("");
        setS(x);
        if (x.last?.id === waiting.id) { setWaiting(null); toast(x.last.ok ? x.last.message : `Didn't work: ${x.last.message}`); return; }
        setWaiting(w => (w ? { ...w, down: false, progress: x.progress?.id === w.id ? x.progress : w.progress } : w));
      } catch { wentDown = true; setWaiting(w => (w ? { ...w, down: true } : w)); }
      setTimeout(tick, wentDown ? 3000 : 2000);
    };
    const t = setTimeout(tick, 2000);
    return () => { stop = true; clearTimeout(t); };
  }, [waiting?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async () => {
    setBusy(true);
    try { setS(await call("/upload", { fileName: file.name, data: await toBase64(file) })); setFile(null); if (fileRef.current) fileRef.current.value = ""; toast("Checked and ready to install."); }
    catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  const run = async action => {
    try { const x = await call("/run", { action }); started(x); }
    catch (e) { if (e.need === "code") setAsk(action); else toast(e.message); }
  };
  const started = x => { setAsk(null); setWaiting({ id: x.job.id, action: x.job.action, down: false, startedAt: Date.now(), progress: null }); toast(x.down ? "Started. " + PN + " will come back by itself." : "Started."); };
  const showLog = async name => { try { const x = await call(name ? `/update-log/${name}` : "/log?lines=400"); setLog({ name: name || "Service log (last 400 lines)", text: x.text || "(empty)" }); } catch (e) { toast(e.message); } };

  if (error) return <div style={{ ...cardStyle, color: BRICK }}>{error}</div>;
  if (!s) return <div style={{ color: INK_SOFT }}>Loading…</div>;
  const inc = s.incoming, last = s.last;
  const actBtn = (action, icon, style = "outline", disabled = false) => <button type="button" style={btn(style)} disabled={disabled || !!waiting || !s.updater.ready} onClick={() => run(action)}>{icon} {LABEL[action]}</button>;
  return <>
    {!s.updater.ready && <div style={{ ...cardStyle, borderLeft: `4px solid ${AMBER}` }}>
      <div style={{ fontWeight: 800, color: INK }}>One-time setup on the server</div>
      <div style={{ fontSize: 13.5, color: INK, marginTop: 4 }}>{s.updater.why}</div>
      <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 4 }}>After that, updates, restarts and rollbacks happen from this page.</div></div>}

    {waiting && <ProgressCard w={waiting} />}

    {last && !waiting && <div style={{ ...cardStyle, borderLeft: `4px solid ${last.ok ? SAGE : BRICK}`, display: "flex", gap: 10, alignItems: "flex-start" }}>
      {last.ok ? <CheckCircle2 size={20} color={SAGE} /> : <AlertTriangle size={20} color={BRICK} />}
      <div style={{ flex: 1, fontSize: 13.5 }}><b>Last: {LABEL[last.action] || last.action}</b> — {last.message}<div style={{ color: INK_SOFT, fontSize: 12.5 }}>{when(last.at)} · {last.by}</div></div>
      {last.log && <button type="button" style={btn("ghost")} onClick={() => showLog(last.log)}><FileText size={14} /> Log</button>}</div>}

    <section style={cardStyle} aria-label="This server">
      <div style={{ fontWeight: 800, color: INK, marginBottom: 8 }}>This server</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, fontSize: 13.5 }}>
        {[["Version", s.version || "(not stamped)"], ["Running for", uptime(s.uptimeSeconds)], ["Memory", `${s.memoryMb} MB`], ["Database", size(s.dbBytes)],
          ["Disk free", s.disk ? `${size(s.disk.free)} of ${size(s.disk.total)}` : "?"], ["Database updates", String(s.migrations)], ["Node", s.node], ["Server", s.host]]
          .map(([k, v]) => <div key={k} style={{ background: PAPER, borderRadius: 8, padding: "8px 10px" }}><div style={{ fontSize: 11.5, color: INK_SOFT, fontWeight: 700, textTransform: "uppercase" }}>{k}</div><div style={{ color: INK, fontWeight: 600 }}>{v}</div></div>)}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        {actBtn("restart", <Power size={14} />)}
        {actBtn("backup", <DatabaseBackup size={14} />)}
        {actBtn("rollback", <Undo2 size={14} />, "ghost", !s.rollbackReady)}
        <button type="button" style={btn("ghost")} onClick={() => showLog()}><FileText size={14} /> Service log</button>
        <button type="button" style={btn("ghost")} onClick={() => load().catch(e => toast(e.message))}><RotateCw size={14} /> Refresh</button>
      </div>
    </section>

    <UpdatesCard toast={toast} reload={() => call("").then(setS)} />

    <section style={cardStyle} aria-label="Install an update">
      <div style={{ fontWeight: 800, color: INK }}>Install an update</div>
      <div style={{ fontSize: 13, color: INK_SOFT, margin: "2px 0 10px" }}>Pick the update zip made for this server ({s.packageName ? <b>{s.packageName}-&lt;version&gt;.zip</b> : "the zip sent for this install"}), exactly as it was sent; a zip made for another install is refused. It's checked here first; installing backs up the database, keeps the current version for rollback, and puts it back by itself if the new one doesn't start.</div>
      {!inc && <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input ref={fileRef} type="file" aria-label="Release zip" accept=".zip" onChange={e => setFile(e.target.files[0] || null)} />
        <button type="button" style={btn("primary")} disabled={!file || busy} onClick={upload}><UploadCloud size={14} /> {busy ? "Checking…" : "Upload and check"}</button></div>}
      {inc && <div style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: 12 }}>
        <div style={{ fontSize: 14, color: INK }}><b>{inc.fileName}</b>{inc.version ? ` · version ${inc.version}` : ""} · {size(inc.size)} · {inc.files} files</div>
        <div style={{ fontSize: 12.5, color: INK_SOFT }}>Uploaded {when(inc.uploadedAt)} by {inc.uploadedBy} · SHA-256 {inc.sha256.slice(0, 16)}…</div>
        {inc.newMigrations?.length > 0 && <div style={{ fontSize: 13, color: AMBER, marginTop: 6 }}>Database updates in this release: {inc.newMigrations.join(", ")}</div>}
        {inc.notes?.length > 0 && <ul style={{ fontSize: 13.5, color: INK, margin: "8px 0 0", paddingLeft: 20 }}>{inc.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {actBtn("install", <UploadCloud size={14} />, "primary")}
          <button type="button" style={btn("ghost")} disabled={!!waiting} onClick={() => call("/discard", {}).then(setS, e => toast(e.message))}>Discard</button></div></div>}
    </section>

    <section style={cardStyle} aria-label="History">
      <div style={{ fontWeight: 800, color: INK, marginBottom: 6 }}>Updates and backups</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
        <div><div style={{ fontSize: 12, fontWeight: 700, color: INK_SOFT, textTransform: "uppercase", marginBottom: 4 }}>Updater logs</div>
          {!s.updateLogs.length && <div style={{ fontSize: 13, color: INK_SOFT }}>None yet.</div>}
          {s.updateLogs.map(l => <button key={l.name} type="button" onClick={() => showLog(l.name)} style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: `1px solid ${LINE}`, padding: "5px 0", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: INK }}>
            {when(l.at)} · {l.name.replace(/^update-\d{8}-\d{6}-|\.log$/g, "")}</button>)}</div>
        <div><div style={{ fontSize: 12, fontWeight: 700, color: INK_SOFT, textTransform: "uppercase", marginBottom: 4 }}>Latest backups</div>
          {!s.backups.length && <div style={{ fontSize: 13, color: AMBER }}>No backups found in the backups folder.</div>}
          {s.backups.map(b => <div key={b.name} style={{ fontSize: 13, color: INK, borderBottom: `1px solid ${LINE}`, padding: "5px 0" }}>{when(b.at)} · {b.name} · {size(b.size)}</div>)}</div>
      </div>
    </section>

    {log && <div role="dialog" aria-label="Log" style={{ position: "fixed", inset: 0, background: "rgba(19,35,63,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
      <div style={{ ...cardStyle, width: "min(980px, 100%)", margin: 0, maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}><b style={{ color: INK }}>{log.name}</b>
          <button type="button" style={btn("ghost")} onClick={() => setLog(null)}>Close</button></div>
        <pre style={{ flex: 1, overflow: "auto", background: "#0F1B2E", color: "#E6EDF7", fontSize: 12, padding: 12, borderRadius: 8, margin: 0, whiteSpace: "pre-wrap" }}>{log.text}</pre></div></div>}
    {ask && <CodeDialog title={LABEL[ask]} note={DOWN[ask]} run={() => call("/run", { action: ask })} onCancel={() => setAsk(null)} onDone={started} />}
    <LicenseCard toast={toast} restart={() => run("restart")} busy={!!waiting} />
    <BrandingCard toast={toast} />
    <EnvCard toast={toast} restart={() => run("restart")} busy={!!waiting} />
  </>;
}

// The license: who it's for, which modules are on, expiry and users; a new license file from the vendor replaces it (code needed)
// Automatic updates: this server checks in with the vendor's update service (server/updates.js) and downloads signed releases for its
// own download. Installing still asks for a code here, unless night installs are on.
function UpdatesCard({ toast, reload }) {
  const [u, setU] = useState(null), [edit, setEdit] = useState(null), [ask, setAsk] = useState(null), [busy, setBusy] = useState("");
  const load = () => call("/updates").then(setU, e => toast(e.message));
  useEffect(() => { load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!u) return null;
  const a = u.available;
  const go = async (what, msg) => { setBusy(what); try { setU(await call(`/updates/${what}`, {})); if (what === "download") { await reload(); toast("Downloaded and checked (signature and contents). Install it below."); } else toast(msg); } catch (e) { toast(e.message); } finally { setBusy(""); } };
  const save = () => setAsk({ title: "Save update settings", note: edit.key ? "This server will check in with the update service using the key." : "Change how updates arrive.", run: () => call("/updates/settings", edit) });
  return <section style={cardStyle} aria-label="Automatic updates">
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <div><div style={{ fontWeight: 800, color: INK }}>Automatic updates</div>
        <div style={{ fontSize: 13, color: INK_SOFT }}>{u.configured ? `Checks in with ${u.url.replace(/^https?:\/\//, "")} every 6 hours · last ${u.lastCheck ? when(u.lastCheck) : "not yet"}${u.auto ? ` · installs by itself at ${u.autoAt}` : " · you click Install"}` : "Not set up: updates come as zips you upload below."}</div></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {u.configured && <button type="button" style={btn("outline")} disabled={!!busy} onClick={() => go("check", "Checked.")}><RotateCw size={14} /> {busy === "check" ? "Checking…" : "Check now"}</button>}
        {!edit && <button type="button" style={btn("ghost")} onClick={() => setEdit({ url: u.url || "https://office.fenmorix.com", key: "", auto: u.auto, autoAt: u.autoAt })}>{u.configured ? "Settings" : "Set up"}</button>}</div></div>
    {u.lastError && <div role="alert" style={{ color: BRICK, fontSize: 13.5, marginTop: 8 }}><AlertTriangle size={14} style={{ verticalAlign: -2 }} /> {u.lastError}</div>}
    {u.hold && <div style={{ color: AMBER, fontSize: 13.5, marginTop: 8 }}>Updates for this server are on hold at the update service.</div>}
    {a && !a.bad && <div style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: 12, marginTop: 10, background: "#FFF8F1" }}>
      <div style={{ fontWeight: 800, color: INK }}>Version {a.version} is available <span style={{ fontWeight: 500, color: INK_SOFT }}>(this server: {u.current || "not stamped"})</span></div>
      {a.notes?.length > 0 && <ul style={{ margin: "6px 0", paddingLeft: 18, fontSize: 13, color: INK }}>{a.notes.slice(0, 10).map((n, i) => <li key={i}>{n}</li>)}</ul>}
      {u.downloaded === a.version ? <div style={{ fontSize: 13, color: SAGE, fontWeight: 700 }}><CheckCircle2 size={14} style={{ verticalAlign: -2 }} /> Downloaded: install it below.</div>
        : <button type="button" style={btn("primary")} disabled={!!busy} onClick={() => go("download")}><UploadCloud size={14} /> {busy === "download" ? "Downloading…" : "Download and check it"}</button>}</div>}
    {a?.bad && <div role="alert" style={{ color: BRICK, fontSize: 13.5, marginTop: 8 }}>Version {a.version} was offered but its signature didn't check out ({a.bad}). It won't be installed.</div>}
    {u.configured && !a && u.lastCheck && !u.lastError && <div style={{ fontSize: 13, color: SAGE, marginTop: 8 }}><CheckCircle2 size={14} style={{ verticalAlign: -2 }} /> Up to date ({u.current || "not stamped"}).</div>}
    {edit && <div style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: 12, marginTop: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        <label style={{ fontSize: 13 }}>Update service<input aria-label="Update service address" style={{ ...inputStyle, marginTop: 3 }} value={edit.url} onChange={e => setEdit({ ...edit, url: e.target.value })} /></label>
        <label style={{ fontSize: 13 }}>Update key {u.configured && <span style={{ color: INK_SOFT }}>(blank = keep)</span>}<input aria-label="Update key" style={{ ...inputStyle, marginTop: 3 }} value={edit.key} onChange={e => setEdit({ ...edit, key: e.target.value })} placeholder="fxu_…" /></label>
        <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center", marginTop: 18 }}><input type="checkbox" checked={edit.auto} onChange={e => setEdit({ ...edit, auto: e.target.checked })} /> Install new versions by itself at night</label>
        {edit.auto && <label style={{ fontSize: 13 }}>Starting at<input aria-label="Night install time" type="time" style={{ ...inputStyle, marginTop: 3 }} value={edit.autoAt} onChange={e => setEdit({ ...edit, autoAt: e.target.value })} /></label>}
      </div>
      <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 6 }}>Only versions signed by Fenmorix Technologies install, and only the download made for this server. A backup is taken first and the old version comes back by itself if the new one doesn't start.</div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}><button type="button" style={btn("primary")} onClick={save}>Save</button><button type="button" style={btn("ghost")} onClick={() => setEdit(null)}>Cancel</button>
        {u.configured && <button type="button" style={btn("ghost")} onClick={() => setAsk({ title: "Stop checking for updates", note: "Removes the update key from this server.", run: () => call("/updates/forget", {}) })}>Stop checking</button>}</div></div>}
    {ask && <CodeDialog title={ask.title} note={ask.note} run={ask.run} onCancel={() => setAsk(null)} onDone={x => { setAsk(null); setEdit(null); setU(x); toast("Saved."); }} />}
  </section>;
}

function LicenseCard({ toast, restart, busy }) {
  const [l, setL] = useState(null), [ask, setAsk] = useState(null), [installed, setInstalled] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => { call("/license").then(setL, x => toast(x.message)); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!l) return null;
  const p = l.license;
  const pick = async f => {
    if (!f) return;
    const text = await f.text();
    setAsk({ title: "Install the license", note: `Replace this server's license with ${f.name}. The sections it turns on or off change after a restart.`, run: () => call("/license", { text }) });
  };
  const done = x => { setAsk(null); setL(x); setInstalled(true); toast("License installed. Restart the service to apply it."); };
  const groups = [...new Set(l.modules.map(m => m.group))];
  if (l.demo) return <DemoModules l={l} setL={setL} groups={groups} toast={toast} pick={pick} fileRef={fileRef} ask={ask} setAsk={setAsk} done={done} />;
  const modeText = { full: "Every module (no license file: this build doesn't require one)", licensed: "Licensed", core: "Core only" }[l.mode];
  return <section style={cardStyle} aria-label="License">
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <div><div style={{ fontWeight: 800, color: INK }}>License</div>
        <div style={{ fontSize: 13, color: INK_SOFT }}>{modeText}{p ? ` · ${p.customer}` : ""}</div></div>
      <div style={{ display: "flex", gap: 8 }}>
        <input ref={fileRef} type="file" accept=".lic,.txt" hidden aria-label="License file" onChange={x => { pick(x.target.files[0]); x.target.value = ""; }} />
        <button type="button" style={btn("outline")} onClick={() => fileRef.current?.click()}>Install a license file</button>
        {installed && <button type="button" style={btn("primary")} disabled={busy} onClick={restart}><Power size={14} /> Restart now to apply it</button>}</div></div>
    {l.error && <div role="alert" style={{ color: BRICK, fontSize: 13.5, marginTop: 8, fontWeight: 600 }}><AlertTriangle size={14} style={{ verticalAlign: -2 }} /> {l.error}</div>}
    {l.warning && <div role="status" style={{ color: AMBER, fontSize: 13.5, marginTop: 8, fontWeight: 600 }}><AlertTriangle size={14} style={{ verticalAlign: -2 }} /> {l.warning}</div>}
    {p && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, margin: "10px 0", fontSize: 13 }}>
      {[["License", p.id], ["Issued", p.issued], ["Expires", p.expires || "Never"], ["Users", p.seats ? `${l.seatsUsed} of ${p.seats}` : `${l.seatsUsed} (no limit)`],
        ["Environments", (p.environments || []).join(", ") || "Any"], ["For", (p.hosts || []).join(", ") || "Any server"]].map(([k, v]) =>
        <div key={k}><div style={{ fontSize: 11.5, color: INK_SOFT, fontWeight: 700, textTransform: "uppercase" }}>{k}</div><div style={{ color: INK, fontWeight: 600 }}>{v}</div></div>)}</div>}
    <ModuleSwitches key={(p?.id || l.mode) + JSON.stringify(l.modules.map(m => m.licensed))} l={l} setL={setL} groups={groups} toast={toast} />
    {ask && <CodeDialog title={ask.title} note={ask.note} run={ask.run} onCancel={() => setAsk(null)} onDone={done} />}
  </section>;
}

// Licensed modules can be switched off here (and back on) without a new license: the section disappears for everyone, nothing is
// deleted, and it comes back as it was. Modules that need a switched-off one go off with it. Unlicensed ones show greyed.
function ModuleSwitches({ l, setL, groups, toast }) {
  const lic = l.modules.filter(m => m.licensed);
  const [sel, setSel] = useState(() => new Set(lic.filter(m => m.on).map(m => m.key))), [busy, setBusy] = useState(false);
  const byKey = Object.fromEntries(l.modules.map(m => [m.key, m]));
  const current = new Set(lic.filter(m => m.on).map(m => m.key));
  const dirty = sel.size !== current.size || [...sel].some(k => !current.has(k));
  const flip = k => setSel(old => {
    const n = new Set(old);
    if (n.has(k)) { n.delete(k); for (let ch = true; ch;) { ch = false; for (const m of lic) if (n.has(m.key) && m.needs.some(x => byKey[x]?.licensed && !n.has(x))) { n.delete(m.key); ch = true; } } }
    else { const add = x => { if (!byKey[x]?.licensed) return; n.add(x); (byKey[x]?.needs || []).forEach(y => !n.has(y) && add(y)); }; add(k); }
    return n;
  });
  const save = async () => {
    setBusy(true);
    try { const x = await call("/modules-off", { off: lic.filter(m => !sel.has(m.key)).map(m => m.key) }); setL(x); setSel(new Set(x.modules.filter(m => m.licensed && m.on).map(m => m.key))); toast("Saved. Everyone sees the change the next time a page loads."); }
    catch (x) { toast(x.message); } finally { setBusy(false); }
  };
  return <>
    <div style={{ fontSize: 13, color: INK_SOFT, marginTop: 10 }}>Untick a module to switch it off on this server. Nothing is deleted; switch it back on any time and it's as it was. (Background feeds like CAD and transcripts follow at the next restart.)</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10, marginTop: 8 }}>
      {groups.map(g => <div key={g}><div style={{ fontSize: 12, fontWeight: 800, color: INK_SOFT, textTransform: "uppercase", marginBottom: 4 }}>{g}</div>
        {l.modules.filter(m => m.group === g).map(m => m.licensed
          ? <label key={m.key} title={m.desc} style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center", color: sel.has(m.key) ? INK : "#98A2B3", cursor: "pointer" }}>
              <input type="checkbox" aria-label={`${m.name}: ${sel.has(m.key) ? "on" : "off"}`} checked={sel.has(m.key)} onChange={() => flip(m.key)} />{m.name}{m.switchedOff && !dirty ? " (switched off)" : ""}</label>
          : <div key={m.key} aria-label={`${m.name}: not licensed`} title="Not in this license" style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center", color: "#B8C0CC" }}>
              <span style={{ width: 13, height: 13, borderRadius: 3, border: "1.5px solid #D5DBE3", display: "inline-block" }} />{m.name}</div>)}</div>)}</div>
    {dirty && <div style={{ display: "flex", gap: 8, marginTop: 10 }}><button type="button" style={btn("primary")} disabled={busy} onClick={save}><CheckCircle2 size={14} /> {busy ? "Saving…" : "Save module switches"}</button>
      <button type="button" style={btn("ghost")} onClick={() => setSel(current)}>Undo</button></div>}
  </>;
}

// Sandbox (no license file): switch modules on and off for a demo. Saved on the server; everyone sees the change on their next page load.
const DEMO_PRESETS = [
  ["Everything", ms => ms.map(m => m.key)],
  ["Standard (fire department)", ms => ms.filter(m => !m.optIn).map(m => m.key)],
  ["Gold & coin shop", () => ["timeclock", "offwork", "sick", "messaging", "spot", "links"]],
  ["School", () => ["gradebook", "messaging", "forms", "helpdesk", "procurement", "timeclock", "offwork", "sick", "training", "board"]],
  ["Core only", () => []],
];
function DemoModules({ l, setL, groups, toast, pick, fileRef, ask, setAsk, done }) {
  const [sel, setSel] = useState(() => new Set(l.modules.filter(m => m.on).map(m => m.key))), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  const byKey = Object.fromEntries(l.modules.map(m => [m.key, m]));
  const current = new Set(l.modules.filter(m => m.on).map(m => m.key));
  const dirty = sel.size !== current.size || [...sel].some(k => !current.has(k));
  // Turning one on also turns on what it needs; turning one off also turns off what needs it
  const flip = k => setSel(old => {
    const n = new Set(old);
    if (n.has(k)) { n.delete(k); for (let ch = true; ch;) { ch = false; for (const m of l.modules) if (n.has(m.key) && m.needs.some(x => !n.has(x))) { n.delete(m.key); ch = true; } } }
    else { const add = x => { n.add(x); (byKey[x]?.needs || []).forEach(y => !n.has(y) && add(y)); }; add(k); }
    return n;
  });
  const save = async () => {
    setBusy(true);
    try { const x = await call("/demo-modules", { modules: [...sel] }); setL(x); setSel(new Set(x.modules.filter(m => m.on).map(m => m.key))); setSaved(true); toast("Demo modules saved."); }
    catch (x) { toast(x.message); } finally { setBusy(false); }
  };
  return <section style={cardStyle} aria-label="Demo modules">
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <div><div style={{ fontWeight: 800, color: INK }}>Demo modules</div>
        <div style={{ fontSize: 13, color: INK_SOFT, maxWidth: 640 }}>This is a sandbox, so you choose what it shows. Pick the package a visitor would buy; everyone sees the change the next time a page loads. ({sel.size} of {l.modules.length} on)</div></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {dirty && <button type="button" style={btn("ghost")} onClick={() => setSel(new Set(current))}>Undo</button>}
        <button type="button" style={btn("primary")} disabled={!dirty || busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        {saved && !dirty && <button type="button" style={btn("outline")} onClick={() => window.location.reload()}>Reload to see it</button>}</div></div>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0" }}>
      <span style={{ fontSize: 12.5, color: INK_SOFT, alignSelf: "center" }}>Quick picks:</span>
      {DEMO_PRESETS.map(([name, f]) => <button key={name} type="button" style={{ ...btn("outline"), fontSize: 12.5, padding: "4px 10px" }} onClick={() => setSel(new Set(f(l.modules)))}>{name}</button>)}</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
      {groups.map(g => <div key={g}><div style={{ fontSize: 12, fontWeight: 800, color: INK_SOFT, textTransform: "uppercase", marginBottom: 4 }}>{g}</div>
        {l.modules.filter(m => m.group === g).map(m => <label key={m.key} title={m.desc} style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center", color: INK, cursor: "pointer", padding: "2px 0" }}>
          <input type="checkbox" checked={sel.has(m.key)} onChange={() => flip(m.key)} />{m.name}{m.optIn && <span style={{ fontSize: 11, color: INK_SOFT, whiteSpace: "nowrap" }}>(add-on)</span>}</label>)}</div>)}</div>
    <div style={{ marginTop: 10, fontSize: 12.5, color: INK_SOFT }}>Core sections (Home, User Management, notices) are always on. Installing a license file replaces these switches.
      <input ref={fileRef} type="file" accept=".lic,.txt" hidden aria-label="License file" onChange={x => { pick(x.target.files[0]); x.target.value = ""; }} />
      {" "}<button type="button" style={{ ...btn("ghost"), fontSize: 12.5 }} onClick={() => fileRef.current?.click()}>Install a license file</button></div>
    {ask && <CodeDialog title={ask.title} note={ask.note} run={ask.run} onCancel={() => setAsk(null)} onDone={done} />}
  </section>;
}

// Settings (.env): what the server reads at start. Secrets are write-only here (never shown); locked ones only on the server.
function EnvCard({ toast, restart, busy }) {
  const [e, setE] = useState(null), [edits, setEdits] = useState({}), [q, setQ] = useState(""), [ask, setAsk] = useState(null), [saved, setSaved] = useState(false);
  const [nk, setNk] = useState(""), [nv, setNv] = useState(""), [open, setOpen] = useState(false);
  const load = () => call("/env").then(setE, x => toast(x.message));
  useEffect(() => { if (open && !e) load(); }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps
  const changes = Object.entries(edits).map(([key, v]) => (v === null ? { key, remove: true } : { key, value: v }));
  const save = list => setAsk({ title: "Save settings", note: `${list.length} change${list.length === 1 ? "" : "s"} to the server's .env (a copy of the old one is kept).`,
    run: () => call("/env", { changes: list }) });
  const restore = name => setAsk({ title: "Put back earlier settings", note: `Replace .env with the copy ${name}.`, run: () => call("/env/restore", { name }) });
  const done = x => { setAsk(null); setE(x); setEdits({}); setNk(""); setNv(""); setSaved(true); toast("Saved. Restart the service to use the new settings."); };
  const val = en => (edits[en.key] !== undefined ? edits[en.key] : en.value ?? "");
  const shown = (e?.entries || []).filter(en => !q || `${en.key} ${en.desc} ${en.section}`.toLowerCase().includes(q.toLowerCase()));
  const sections = [...new Set(shown.map(x => x.section))];
  return <section style={cardStyle} aria-label="Server settings">
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <div><div style={{ fontWeight: 800, color: INK }}>Server settings (.env)</div>
        <div style={{ fontSize: 13, color: INK_SOFT }}>Passwords and keys can be replaced but are never shown. Changes take effect after a restart.</div></div>
      <button type="button" style={btn("outline")} onClick={() => setOpen(o => !o)}>{open ? "Hide" : "Show settings"}</button></div>
    {open && !e && <div style={{ color: INK_SOFT, marginTop: 8 }}>Loading…</div>}
    {open && e && <>
      {!e.file && <div style={{ color: AMBER, fontSize: 13, marginTop: 8 }}>No .env file was found; saving makes one.</div>}
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 0", flexWrap: "wrap" }}>
        <input aria-label="Find a setting" placeholder="Find a setting…" value={q} onChange={x => setQ(x.target.value)} style={{ ...inputStyle, width: 240 }} />
        {changes.length > 0 && <button type="button" style={btn("primary")} onClick={() => save(changes)}>Save {changes.length} change{changes.length === 1 ? "" : "s"}</button>}
        {changes.length > 0 && <button type="button" style={btn("ghost")} onClick={() => setEdits({})}>Undo changes</button>}
        {saved && !changes.length && <button type="button" style={btn("primary")} disabled={busy} onClick={restart}><Power size={14} /> Restart now to use them</button>}
      </div>
      <div style={{ maxHeight: 520, overflow: "auto", border: `1px solid ${LINE}`, borderRadius: 8 }}>
        {sections.map(sec => <div key={sec}>
          <div style={{ background: PAPER, padding: "6px 10px", fontSize: 12, fontWeight: 800, color: INK_SOFT, textTransform: "uppercase", position: "sticky", top: 0 }}>{sec}</div>
          {shown.filter(x => x.section === sec).map(en => {
            const changed = edits[en.key] !== undefined;
            return <div key={en.key} role="group" aria-label={`${en.key} setting`} style={{ display: "grid", gridTemplateColumns: "minmax(170px, 230px) 1fr", gap: 10, padding: "8px 10px", borderTop: `1px solid ${LINE}`, background: changed ? "#FFF7E6" : "#fff" }}>
              <div><code style={{ fontSize: 12.5, color: INK, fontWeight: 700 }}>{en.key}</code>
                {en.desc && <div style={{ fontSize: 11.5, color: INK_SOFT, marginTop: 2 }}>{en.desc}</div>}</div>
              <div>
                {en.locked ? <div style={{ fontSize: 13, color: INK_SOFT }}>{en.secret ? (en.set ? "set" : "not set") : (en.value || "(not set)")} · <i>change on the server only (a wrong value would stop {PN} from starting)</i></div>
                  : en.secret ? <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, color: en.set ? SAGE : INK_SOFT, minWidth: 54 }}>{changed ? (edits[en.key] === null ? "remove" : "new value") : en.set ? "● set" : "not set"}</span>
                    <input type="password" autoComplete="new-password" aria-label={`New ${en.key}`} placeholder={en.set ? "Type to replace" : "Type to set"} value={changed && edits[en.key] !== null ? edits[en.key] : ""}
                      onChange={x => setEdits(m => { const n = { ...m }; if (x.target.value) n[en.key] = x.target.value; else delete n[en.key]; return n; })} style={{ ...inputStyle, maxWidth: 320 }} /></div>
                  : <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <input aria-label={en.key} value={edits[en.key] === null ? "" : val(en)} placeholder={en.inFile ? "" : en.example ? `not set (e.g. ${en.example})` : "not set"}
                      onChange={x => setEdits(m => { const n = { ...m }; if (x.target.value === (en.value ?? "")) delete n[en.key]; else n[en.key] = x.target.value; return n; })} style={{ ...inputStyle, maxWidth: 420 }} />
                    {en.inFile && !changed && <button type="button" style={{ ...btn("ghost"), fontSize: 12 }} onClick={() => setEdits(m => ({ ...m, [en.key]: null }))}>Remove</button>}
                    {edits[en.key] === null && <span style={{ fontSize: 12.5, color: BRICK }}>will be removed (default used)</span>}</div>}
              </div></div>;
          })}</div>)}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 10, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12.5, color: INK_SOFT }}>Add a setting<br /><input aria-label="New setting name" placeholder="NAME" value={nk} onChange={x => setNk(x.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))} style={{ ...inputStyle, width: 220 }} /></label>
        <label style={{ fontSize: 12.5, color: INK_SOFT }}>Value<br /><input aria-label="New setting value" value={nv} onChange={x => setNv(x.target.value)} style={{ ...inputStyle, width: 280 }} /></label>
        <button type="button" style={btn("outline")} disabled={!nk} onClick={() => save([{ key: nk, value: nv }])}>Add</button></div>
      {e.history.length > 0 && <details style={{ marginTop: 10 }}><summary style={{ cursor: "pointer", fontSize: 13, color: INK }}>Earlier copies ({e.history.length})</summary>
        {e.history.map(h => <div key={h} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, padding: "3px 0" }}><code>{h}</code>
          <button type="button" style={{ ...btn("ghost"), fontSize: 12 }} onClick={() => restore(h)}>Put this back</button></div>)}</details>}
    </>}
    {ask && <CodeDialog title={ask.title} note={ask.note} run={ask.run} onCancel={() => setAsk(null)} onDone={done} />}
  </section>;
}

// The updater's progress: step n of total from updates/progress.json, elapsed time, and "Nexus is restarting" while the server is down
function ProgressCard({ w }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const p = w.progress, secs = Math.max(0, Math.round((now - (w.startedAt || now)) / 1000));
  const pct = p ? Math.round(((p.step - (w.down ? 0.5 : 0.7)) / p.total) * 100) : 4;
  const label = w.down ? (p ? `${p.label} — ${PN} is restarting` : PN + " is restarting") : p ? p.label : "Waiting for the updater to start…";
  return <div role="progressbar" aria-label="Updater progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(2, Math.min(100, pct))}
    aria-valuetext={label} style={{ ...cardStyle, borderLeft: `4px solid ${AMBER}` }}>
    <style>{"@keyframes sgfd-stripes { from { background-position: 0 0 } to { background-position: 40px 0 } }"}</style>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 14, color: INK, flexWrap: "wrap" }}>
      <b>{LABEL[w.action]}</b>
      <span style={{ color: INK_SOFT }}>{p ? `Step ${p.step} of ${p.total} · ` : ""}{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span></div>
    <div style={{ height: 12, background: PAPER, border: `1px solid ${LINE}`, borderRadius: 999, overflow: "hidden", margin: "8px 0 6px" }}>
      <div style={{ height: "100%", width: `${Math.max(2, Math.min(100, pct))}%`, borderRadius: 999, transition: "width .6s ease",
        backgroundColor: AMBER, backgroundImage: "linear-gradient(45deg, rgba(255,255,255,.25) 25%, transparent 25%, transparent 50%, rgba(255,255,255,.25) 50%, rgba(255,255,255,.25) 75%, transparent 75%)",
        backgroundSize: "40px 40px", animation: "sgfd-stripes 1s linear infinite" }} /></div>
    <div style={{ fontSize: 13.5, color: INK }}>{label}</div>
    <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 2 }}>{w.down ? "This page catches up by itself when " + PN + " is back." : "You can leave this page open; it updates by itself."}</div>
  </div>;
}
