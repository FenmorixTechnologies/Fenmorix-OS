// Update service pages in Clients & Quotes (vendor office only): Installations (every customer server that checks in: its version, when
// it last checked in, automatic updates on/off, last update result) and Releases (upload signed zips; one upload can carry every
// customer's package at once = a broadcast). Server: server/hub.js. Never shipped to customers (packaging/owners.json).
import React, { useEffect, useRef, useState } from "react";
import { Plus, Copy, Trash2, KeyRound, UploadCloud, Pause, Play, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cardStyle, btn } from "./App.jsx";

const INK = "#13233F", SOFT = "#4B5565", LINE = "#DDE2EA", ORANGE = "#C94D00", GREEN = "#1F8A4C", RED = "#B42318";
const inp = { width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${LINE}`, background: "#fff", fontSize: 14, color: INK, boxSizing: "border-box", fontFamily: "inherit", margin: 0 };
const lbl = { fontSize: 12, fontWeight: 700, color: SOFT, display: "block", marginBottom: 3 };
const th = { textAlign: "left", fontSize: 11.5, color: SOFT, padding: "6px 8px", borderBottom: `2px solid ${LINE}`, whiteSpace: "nowrap" };
const td = { padding: "7px 8px", borderBottom: `1px solid ${LINE}`, fontSize: 13.5, verticalAlign: "top" };
const ago = t => { if (!t) return "never"; const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 2 ? "just now" : m < 120 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
const newer = (a, b) => { const x = String(a || "").split(/[.-]/).map(Number), y = String(b || "").split(/[.-]/).map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; } return false; };
async function api(path, body) {
  const r = await fetch(`/api/hub${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work.");
  return j;
}
const KNOWN = [["sgfd", "St. George (SGFD Nexus)"], ["lgc", "Louisiana Gold & Coins"], ["sandbox", "Demo sandbox"], ["office", "This office portal"]];
const Card = ({ title, actions, children }) => <section style={{ ...cardStyle, marginBottom: 14 }}>
  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}><h2 style={{ margin: 0, fontSize: 16, color: INK }}>{title}</h2><span style={{ flex: 1 }} />{actions}</div>{children}</section>;

export function Installations({ clients, toast }) {
  const [d, setD] = useState(null), [add, setAdd] = useState(null), [shown, setShown] = useState(null);
  const load = () => api("").then(setD, e => toast(e.message));
  useEffect(() => { load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div style={{ color: SOFT }}>Loading…</div>;
  const save = async () => { try { const r = await api("/installs", add); setAdd(null); setShown({ name: add.name, key: r.key }); load(); } catch (e) { toast(e.message); } };
  const rekey = async i => { if (!window.confirm(`Make a new update key for ${i.name}? The old one stops working right away.`)) return; try { const r = await api(`/installs/${i.id}/rekey`, {}); setShown({ name: i.name, key: r.key }); } catch (e) { toast(e.message); } };
  const hold = async i => { try { await api(`/installs/${i.id}`, { name: i.name, clientId: i.clientId, hold: !i.hold }); load(); } catch (e) { toast(e.message); } };
  const remove = async i => { if (!window.confirm(`Remove ${i.name}? It can't check in again until you add it with a new key.`)) return; try { await api(`/installs/${i.id}/remove`, {}); load(); } catch (e) { toast(e.message); } };
  const behind = d.installs.filter(i => d.latest[i.package] && newer(d.latest[i.package], i.version)).length;
  return <>
    <h1 style={{ margin: "0 0 14px", fontSize: 24, color: INK }}>Installations</h1>
    {shown && <section role="alert" style={{ ...cardStyle, marginBottom: 14, borderLeft: `4px solid ${ORANGE}` }}>
      <div style={{ fontWeight: 800, color: INK }}>Update key for {shown.name}</div>
      <div style={{ fontSize: 13.5, color: SOFT, margin: "4px 0 8px" }}>Shown once. On that server: User Management › System › Automatic updates, paste it with the service address <b>{window.location.origin}</b>.</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><code style={{ background: "#F3F5F8", padding: "6px 10px", borderRadius: 6, fontSize: 13, wordBreak: "break-all" }}>{shown.key}</code>
        <button type="button" style={btn()} onClick={() => navigator.clipboard?.writeText(shown.key).then(() => toast("Copied."), () => toast("Select it and copy by hand."))}><Copy size={14} /> Copy</button>
        <button type="button" style={btn("ghost")} onClick={() => setShown(null)}>Done</button></div></section>}
    <Card title={`${d.installs.length} server${d.installs.length === 1 ? "" : "s"}${behind ? ` · ${behind} behind` : ""}`} actions={<>
      <button type="button" style={btn("ghost")} onClick={load}><RefreshCw size={14} /> Refresh</button>
      {!add && <button type="button" style={btn("primary")} onClick={() => setAdd({ name: "", package: "lgc", clientId: "" })}><Plus size={14} /> Add an installation</button>}</>}>
      {add && <div style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: 12, marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
          <label><span style={lbl}>Name</span><input aria-label="Installation name" style={inp} value={add.name} onChange={e => setAdd({ ...add, name: e.target.value })} placeholder="Louisiana Gold & Coins" /></label>
          <label><span style={lbl}>Download it runs</span><input aria-label="Package" list="hub-pkgs" style={inp} value={add.package} onChange={e => setAdd({ ...add, package: e.target.value })} />
            <datalist id="hub-pkgs">{[...new Set([...KNOWN.map(k => k[0]), ...d.packages])].map(p => <option key={p} value={p}>{KNOWN.find(k => k[0] === p)?.[1] || p}</option>)}</datalist></label>
          <label><span style={lbl}>Client</span><select aria-label="Installation client" style={inp} value={add.clientId} onChange={e => setAdd({ ...add, clientId: e.target.value })}><option value="">(none)</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}><button type="button" style={btn("primary")} onClick={save}><KeyRound size={14} /> Add and show the key</button><button type="button" style={btn("ghost")} onClick={() => setAdd(null)}>Cancel</button></div></div>}
      {!d.installs.length ? <div style={{ color: SOFT }}>No servers yet. Add one for each install (St. George, Louisiana Gold & Coins, the sandbox, this office), then paste its key on that server's System page.</div> :
        <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Server</th><th style={th}>Download</th><th style={th}>Version</th><th style={th}>Checked in</th><th style={th}>Automatic</th><th style={th}>Last update</th><th style={th} /></tr></thead>
          <tbody>{d.installs.map(i => { const want = d.latest[i.package], late = want && newer(want, i.version), stale = i.lastSeen && Date.now() - new Date(i.lastSeen) > 26 * 3600e3;
            return <tr key={i.id}><td style={td}><b>{i.name}</b>{i.clientName && <div style={{ fontSize: 12, color: SOFT }}>{i.clientName}</div>}{i.info.url && <div style={{ fontSize: 12 }}><a href={i.info.url} target="_blank" rel="noreferrer">{i.info.url.replace(/^https?:\/\//, "")}</a></div>}</td>
              <td style={td}>{i.package}</td>
              <td style={td}>{i.version ? <span style={{ fontWeight: 700, color: late ? ORANGE : GREEN }}>{late ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />} {i.version}</span> : <span style={{ color: SOFT }}>not yet</span>}
                {late && <div style={{ fontSize: 12, color: ORANGE }}>{want} available</div>}{i.hold && <div style={{ fontSize: 12, color: RED, fontWeight: 700 }}>Updates held</div>}</td>
              <td style={{ ...td, color: stale ? RED : INK }}>{ago(i.lastSeen)}{i.info.users != null && <div style={{ fontSize: 12, color: SOFT }}>{i.info.users} user{i.info.users === 1 ? "" : "s"}</div>}</td>
              <td style={td}>{i.info.auto ? "On" : i.lastSeen ? "Off" : ""}</td>
              <td style={td}>{i.info.lastUpdate ? <span style={{ color: i.info.lastUpdate.ok ? GREEN : RED }}>{i.info.lastUpdate.ok ? "OK" : "Failed"}<div style={{ fontSize: 12, color: SOFT }}>{String(i.info.lastUpdate.at || "").slice(0, 10)}</div></span> : ""}</td>
              <td style={{ ...td, whiteSpace: "nowrap" }}>
                <button type="button" title={i.hold ? "Offer updates again" : "Hold updates for this server"} aria-label={`${i.hold ? "Release" : "Hold"} updates for ${i.name}`} style={{ ...btn("ghost"), padding: "2px 6px" }} onClick={() => hold(i)}>{i.hold ? <Play size={13} /> : <Pause size={13} />}</button>
                <button type="button" title="New key" aria-label={`New key for ${i.name}`} style={{ ...btn("ghost"), padding: "2px 6px" }} onClick={() => rekey(i)}><KeyRound size={13} /></button>
                <button type="button" aria-label={`Remove ${i.name}`} style={{ ...btn("ghost"), padding: "2px 6px" }} onClick={() => remove(i)}><Trash2 size={13} /></button></td></tr>; })}</tbody></table></div>}
      <div style={{ fontSize: 12.5, color: SOFT, marginTop: 8 }}>Servers check in every 6 hours. Red = no check-in for over a day. Automatic = the customer turned on night installs; otherwise their admin clicks Install.</div>
    </Card>
  </>;
}

export function Releases({ toast }) {
  const [d, setD] = useState(null), [busy, setBusy] = useState(""), fileRef = useRef(null);
  const load = () => api("").then(setD, e => toast(e.message));
  useEffect(() => { load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const upload = async list => {
    const files = [...list], zips = files.filter(f => /\.zip$/i.test(f.name));
    if (!zips.length) return toast("Pick the zips and their .sig files together.");
    const done = [], failed = [];
    for (const z of zips) {
      setBusy(`Uploading ${z.name}…`);
      const sigFile = files.find(f => f.name === `${z.name}.sig`);
      try {
        if (!sigFile) throw new Error(`${z.name}.sig is missing (sign it with the License Manager first).`);
        const data = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = bad; r.readAsDataURL(z); });
        await api("/releases", { fileName: z.name, data, sig: await sigFile.text() });
        done.push(z.name);
      } catch (e) { failed.push(`${z.name}: ${e.message}`); }
    }
    setBusy(""); load();
    toast(done.length ? `Published ${done.length} release${done.length === 1 ? "" : "s"}.${failed.length ? ` ${failed.length} failed.` : ""}` : "Nothing was published.");
    if (failed.length) window.alert(failed.join("\n\n"));
  };
  const act = async (r, what) => { if (what === "remove" && !window.confirm(`Remove ${r.package} ${r.version}?`)) return; try { await api(`/releases/${r.id}/${what}`, {}); load(); } catch (e) { toast(e.message); } };
  if (!d) return <div style={{ color: SOFT }}>Loading…</div>;
  return <>
    <h1 style={{ margin: "0 0 14px", fontSize: 24, color: INK }}>Releases</h1>
    <Card title="Publish an update" actions={<><input ref={fileRef} type="file" multiple accept=".zip,.sig" hidden aria-label="Release files" onChange={e => { const f = e.target.files; upload(f); e.target.value = ""; }} />
      <button type="button" style={btn("primary")} disabled={!!busy} onClick={() => fileRef.current.click()}><UploadCloud size={14} /> Upload zips + signatures</button></>}>
      <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, color: INK, lineHeight: 1.6 }}>
        <li>Download the customer zips Claude made (one per customer).</li>
        <li>On your computer, in the License Manager folder: <code>node nexus-license.mjs sign-release &lt;the zips&gt;</code> (makes a .sig next to each).</li>
        <li>Upload all the zips and .sig files here at once. Each server sees its own update at its next check-in (within 6 hours), or click Check now on its System page.</li>
      </ol>
      {busy && <div style={{ marginTop: 8, color: SOFT }}>{busy}</div>}
    </Card>
    <Card title="Every release">
      {!d.releases.length ? <div style={{ color: SOFT }}>None yet.</div> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th style={th}>Download</th><th style={th}>Version</th><th style={th}>What's new</th><th style={th}>Servers on it</th><th style={th}>Status</th><th style={th} /></tr></thead>
        <tbody>{d.releases.map(r => { const on = d.installs.filter(i => i.package === r.package && i.version === r.version).length, of = d.installs.filter(i => i.package === r.package).length;
          return <tr key={r.id}><td style={td}><b>{r.package}</b></td><td style={td}>{r.version}<div style={{ fontSize: 11.5, color: SOFT }}>{(r.size / 1048576).toFixed(1)} MB · signed {r.kid}</div></td>
            <td style={{ ...td, fontSize: 12.5, maxWidth: 380 }}>{r.notes.slice(0, 3).join(" · ")}{r.notes.length > 3 ? " …" : ""}</td>
            <td style={td}>{on} of {of}</td>
            <td style={td}>{r.published ? (d.latest[r.package] === r.version ? <b style={{ color: GREEN }}>Offered</b> : "Older") : <b style={{ color: ORANGE }}>Paused</b>}</td>
            <td style={{ ...td, whiteSpace: "nowrap" }}>{r.published ? <button type="button" aria-label={`Pause ${r.package} ${r.version}`} style={{ ...btn("ghost"), padding: "2px 6px" }} onClick={() => act(r, "pause")}><Pause size={13} /></button>
              : <button type="button" aria-label={`Publish ${r.package} ${r.version}`} style={{ ...btn("ghost"), padding: "2px 6px" }} onClick={() => act(r, "publish")}><Play size={13} /></button>}
              <button type="button" aria-label={`Remove ${r.package} ${r.version}`} style={{ ...btn("ghost"), padding: "2px 6px" }} onClick={() => act(r, "remove")}><Trash2 size={13} /></button></td></tr>; })}</tbody></table></div>}
      <div style={{ fontSize: 12.5, color: SOFT, marginTop: 8 }}>Pause a release to stop offering it (servers that already installed it keep it; roll back from their System page).</div>
    </Card>
  </>;
}
