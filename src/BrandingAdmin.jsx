// User Management › System › Branding (Fenmorix OS installs; master admins): the customer's name, colors, menu names and logo.
// Server: server/system.js saveBranding -> <SYSTEM_DIR>/branding (kept across updates). The logo's icon set (app icons, favicon,
// emblem, watermark) is drawn here in the browser from one picture, so the server needs no image library; it only checks the files.
import React, { useEffect, useRef, useState } from "react";
import { Palette, ImagePlus, RotateCcw, RefreshCw } from "lucide-react";
import { cardStyle, inputStyle, btn, StyleBlock } from "./App.jsx";
import { makeTheme } from "./brand.js";
import { tileOn } from "./licensing.js";
import { call, CodeDialog } from "./SystemAdmin.jsx";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", AMBER = "#B26A00";
const COLORS = [
  ["accent", "Main color", "#FF7900", "Buttons, the active menu item, rules"], ["accentDark", "Main color, dark", "#C94D00", "The end of gradients"],
  ["glow", "Second color", "#55CFFF", "Glow and highlights"], ["navy", "Side bar", "#08131D", "Side bar and app icon background"],
  ["black", "Darkest", "#050709", "Bottom of the side bar, sign-in page"], ["silver", "Light text", "#C5CAD0", "Text on the sign-in page"],
];
const HEX = /^#[0-9a-f]{6}$/i;
const lbl = { fontSize: 12, fontWeight: 700, color: INK_SOFT, display: "block", marginBottom: 3 };

// ---- Icon set from one picture ----------------------------------------------------------------------------------------
const loadImage = file => new Promise((ok, bad) => {
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => ok({ img, url }); img.onerror = () => { URL.revokeObjectURL(url); bad(new Error("That file isn't a picture this browser can read (use PNG, JPG, SVG or WebP).")); };
  img.src = url;
});
function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d")]; }
// Draw the picture centered inside the box, keeping its shape
function fit(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width || 512, ih = img.naturalHeight || img.height || 512, s = Math.min(w / iw, h / ih);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, x + (w - iw * s) / 2, y + (h - ih * s) / 2, iw * s, ih * s);
}
function square(img, size, pad, bg) {
  const [c, ctx] = canvas(size, size);
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size); }
  const p = size * pad; fit(ctx, img, p, p, size - 2 * p, size - 2 * p);
  return c;
}
function icoFrom(pngs) {   // ICO holding PNG images (every current browser reads these)
  const head = 6 + 16 * pngs.length, total = head + pngs.reduce((n, p) => n + p.bytes.length, 0);
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint16(2, 1, true); dv.setUint16(4, pngs.length, true);
  let off = head;
  pngs.forEach((p, i) => {
    const e = 6 + 16 * i;
    out[e] = p.size >= 256 ? 0 : p.size; out[e + 1] = p.size >= 256 ? 0 : p.size;
    dv.setUint16(e + 4, 1, true); dv.setUint16(e + 6, 32, true); dv.setUint32(e + 8, p.bytes.length, true); dv.setUint32(e + 12, off, true);
    out.set(p.bytes, off); off += p.bytes.length;
  });
  let s = ""; for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
  return `data:image/x-icon;base64,${btoa(s)}`;
}
const pngBytes = c => { const b = atob(c.toDataURL("image/png").split(",")[1]); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
export function makeIconSet(img, colors = {}) {
  const navy = colors.navy || "#08131D";
  const files = {
    "nexus-emblem.png": square(img, 512, 0.04).toDataURL("image/png"),
    "nexus-hero-art.png": square(img, 640, 0.1).toDataURL("image/png"),
    "logo-large.png": square(img, 512, 0.04).toDataURL("image/png"),
    "icon-192.png": square(img, 192, 0.14, navy).toDataURL("image/png"),
    "icon-512.png": square(img, 512, 0.14, navy).toDataURL("image/png"),
    "icon-maskable-512.png": square(img, 512, 0.22, navy).toDataURL("image/png"),
    "apple-touch-icon.png": square(img, 180, 0.14, navy).toDataURL("image/png"),
    "favicon.ico": icoFrom([16, 32, 48].map(size => ({ size, bytes: pngBytes(square(img, size, 0.06, navy)) }))),
  };
  // Watermark behind every page: the logo in faint gray on white (the page multiplies it in)
  const [w, wx] = canvas(1600, 1000);
  wx.fillStyle = "#FFFFFF"; wx.fillRect(0, 0, 1600, 1000);
  wx.filter = "grayscale(1)"; wx.globalAlpha = 0.22; fit(wx, img, 400, 100, 800, 800);
  files["nexus-watermark.jpg"] = w.toDataURL("image/jpeg", 0.85);
  return files;
}
function wordmarkFrom(img) {
  const iw = img.naturalWidth || 1200, ih = img.naturalHeight || 240, s = Math.min(1, 1200 / iw);
  const [c, ctx] = canvas(Math.max(1, Math.round(iw * s)), Math.max(1, Math.round(ih * s)));
  fit(ctx, img, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

// ---- Live preview of the frame ----------------------------------------------------------------------------------------
function Preview({ colors, org, short, terms, tiles, logo }) {
  const t = makeTheme(colors);
  const items = tiles.slice(0, 5).map(x => terms[x.key] || x.label);
  return <div aria-label="Branding preview" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
    <div style={{ width: 200, borderRadius: 10, overflow: "hidden", background: t.sideBg, color: "#E6EAF2", fontSize: 12.5, boxShadow: "0 2px 10px rgba(0,0,0,.2)" }}>
      <div style={{ padding: "12px 14px 8px", display: "flex", gap: 8, alignItems: "center" }}>
        <img src={logo || "/nexus-emblem.png"} alt="" style={{ width: 30, height: 30, objectFit: "contain", filter: t.emblemGlow }} />
        <div style={{ lineHeight: 1.1 }}><div style={{ fontWeight: 900, fontStyle: "italic" }}>{short || "ORG"}</div>
          <div style={{ fontSize: 10, fontWeight: 800, color: colors.accent || "#FF7900" }}>FENMORIX OS</div></div></div>
      <div style={{ height: 2, margin: "0 12px 8px", background: t.rule }} />
      {["Home", ...items].map((x, i) => <div key={x + i} style={{ margin: "3px 8px", padding: "6px 10px", borderRadius: 8, ...(i === 0 ? { background: t.pillBg, boxShadow: t.pillShadow, fontWeight: 700 } : {}) }}>{x}</div>)}
      <div style={{ height: 10 }} /></div>
    <div style={{ flex: "1 1 220px", minWidth: 220, borderRadius: 10, overflow: "hidden", background: t.loginBg, backgroundColor: t.loginBase, padding: 16, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 8 }}>
      <img src={logo || "/nexus-hero-art.png"} alt="" style={{ width: 64, height: 64, objectFit: "contain" }} />
      <div style={{ color: t.loginSub, fontSize: 12, fontWeight: 700 }}>{org || "Your organization"}</div>
      <div style={{ width: 170, background: "#F7F8FA", borderRadius: 8, borderTop: `3px solid ${t.cardTop}`, padding: 10, fontSize: 11.5, color: INK }}>
        <b>Sign in to continue</b><div style={{ height: 8, background: "#E3E7EE", borderRadius: 4, margin: "8px 0" }} />
        <div style={{ height: 16, background: "#13233F", borderRadius: 5 }} /></div></div>
  </div>;
}

export default function BrandingCard({ toast }) {
  const [s, setS] = useState(null), [f, setF] = useState(null), [ask, setAsk] = useState(null), [logo, setLogo] = useState(null), [saved, setSaved] = useState(false);
  const fileRef = useRef(null), wordRef = useRef(null);
  const v = Date.now();
  const take = x => { setS(x); const sv = x.saved || {}; setF({ org: sv.org || "", short: sv.short || "", place: sv.place || "", app: sv.app || "", colors: { ...(sv.colors || {}) }, terms: { ...(sv.terms || {}) } }); };
  useEffect(() => { call("/branding").then(take, x => toast(x.message)); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => logo?.url && URL.revokeObjectURL(logo.url), [logo]);
  if (!s || !s.editable || !f) return null;
  const b = s.brand || {};
  const tiles = (s.tiles || []).filter(t => tileOn(t.key));
  const colors = Object.fromEntries(COLORS.map(([k, , d]) => [k, HEX.test(f.colors[k] || "") ? f.colors[k] : (b.colors?.[k] || d)]));
  const set = (k, val) => setF(x => ({ ...x, [k]: val }));
  const setColor = (k, val) => setF(x => ({ ...x, colors: { ...x.colors, [k]: val } }));
  const setTerm = (k, val) => setF(x => ({ ...x, terms: { ...x.terms, [k]: val } }));
  const bad = COLORS.filter(([k]) => f.colors[k] && !HEX.test(f.colors[k]));
  const done = msg => x => { setAsk(null); take(x); setSaved(true); toast(msg); };
  const save = () => setAsk({ title: "Save the branding", note: "Names, colors and menu names for everyone on this server.",
    run: () => call("/branding", { org: f.org, short: f.short, place: f.place, app: f.app, colors: f.colors, terms: f.terms }), msg: "Branding saved. Reload the page to see it everywhere." });
  const pickLogo = async file => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast("That picture is over 10 MB.");
    try { const { img, url } = await loadImage(file); setLogo({ name: file.name, url, files: makeIconSet(img, colors) }); }
    catch (e) { toast(e.message); }
  };
  const pickWordmark = async file => {
    if (!file) return;
    try { const { img, url } = await loadImage(file); URL.revokeObjectURL(url);
      setAsk({ title: "Use this name logo", note: `${file.name} replaces the wide logo on the sign-in page.`, run: () => call("/branding/logo", { files: { "brand-wordmark.png": wordmarkFrom(img) } }), msg: "Name logo saved. Reload the page to see it." }); }
    catch (e) { toast(e.message); }
  };
  const useLogo = () => setAsk({ title: "Use this logo", note: `${logo.name} becomes the app icon, the browser tab icon and the logo on every page.`,
    run: () => call("/branding/logo", { files: logo.files }), msg: "Logo saved. Reload the page to see it (phones pick up a new home-screen icon when the app is added again).", after: () => setLogo(null) });
  const removeAll = () => setAsk({ title: "Go back to the Fenmorix OS logo", note: "Removes the uploaded logo and name logo.", run: () => call("/branding/remove", { all: true }), msg: "Back to the Fenmorix OS logo. Reload the page to see it." });
  const uploaded = (s.files || []).filter(x => x.uploaded).map(x => x.name);
  return <section style={cardStyle} aria-label="Branding">
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <div><div style={{ fontWeight: 800, color: INK }}><Palette size={16} style={{ verticalAlign: -3 }} /> Branding</div>
        <div style={{ fontSize: 13, color: INK_SOFT }}>This organization's name, logo, colors and menu names. Kept when the app is updated.</div></div>
      {saved && <button type="button" style={btn("outline")} onClick={() => window.location.reload()}><RefreshCw size={14} /> Reload to see it</button>}</div>

    <div style={{ fontWeight: 800, color: INK, margin: "14px 0 6px" }}>Name</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
      {[["org", "Organization", "Acme County Government", 120], ["short", "Short name (side bar)", "ACME", 20], ["place", "Place", "Acme", 60], ["app", "App name (browser tab)", "Fenmorix OS", 60]].map(([k, l, ph, max]) =>
        <label key={k}><span style={lbl}>{l}</span><input aria-label={l} maxLength={max} placeholder={b[k] || ph} value={f[k]} onChange={e => set(k, e.target.value)} style={{ ...inputStyle, margin: 0 }} /></label>)}</div>

    <div style={{ fontWeight: 800, color: INK, margin: "16px 0 6px" }}>Logo</div>
    <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
      {(logo ? [["App icon", logo.files["icon-192.png"]], ["Logo", logo.files["nexus-emblem.png"]], ["Tab", logo.files["favicon.ico"]]]
        : [["App icon", `/icon-192.png?v=${v}`], ["Logo", `/nexus-emblem.png?v=${v}`], ["Tab", `/favicon.ico?v=${v}`]]).map(([k, src]) =>
        <div key={k} style={{ textAlign: "center", fontSize: 11.5, color: INK_SOFT }}>
          <img src={src} alt={`${k} ${logo ? "(new)" : "(now)"}`} style={{ width: k === "Tab" ? 32 : 64, height: k === "Tab" ? 32 : 64, objectFit: "contain", display: "block", margin: "0 auto 4px", background: k === "Logo" ? "#08131D" : "transparent", borderRadius: 8, padding: k === "Logo" ? 4 : 0 }} />{k}</div>)}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden aria-label="Logo file" onChange={e => { pickLogo(e.target.files[0]); e.target.value = ""; }} />
        <input ref={wordRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden aria-label="Name logo file" onChange={e => { pickWordmark(e.target.files[0]); e.target.value = ""; }} />
        {logo ? <><button type="button" style={btn("primary")} onClick={useLogo}>Use this logo</button><button type="button" style={btn("ghost")} onClick={() => setLogo(null)}>Cancel</button></>
          : <button type="button" style={btn("outline")} onClick={() => fileRef.current?.click()}><ImagePlus size={14} /> Upload a logo</button>}
        <button type="button" style={btn("ghost")} onClick={() => wordRef.current?.click()}>Upload a name logo (wide)</button>
        {uploaded.length > 0 && <button type="button" style={btn("ghost")} onClick={removeAll}><RotateCcw size={14} /> Back to the Fenmorix OS logo</button>}</div></div>
    <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 6 }}>A square logo works best (PNG with a clear background, at least 512 × 512). The app icon, browser tab icon, page watermark and
      every logo size are made from it. The name logo is the wide one on the sign-in page; without one, the Fenmorix OS name logo shows there.</div>

    <div style={{ fontWeight: 800, color: INK, margin: "16px 0 6px" }}>Colors</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10, marginBottom: 10 }}>
      {COLORS.map(([k, l, d, hint]) => <div key={k}><span style={lbl}>{l}</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="color" aria-label={`${l} picker`} value={colors[k]} onChange={e => setColor(k, e.target.value.toUpperCase())} style={{ width: 38, height: 34, padding: 0, border: `1px solid ${LINE}`, borderRadius: 6, background: "none" }} />
          <input aria-label={l} value={f.colors[k] || ""} placeholder={b.colors?.[k] || d} maxLength={7} onChange={e => setColor(k, e.target.value.trim())} style={{ ...inputStyle, margin: 0, width: 100, fontFamily: "monospace" }} />
          {f.colors[k] && <button type="button" title="Use the default" aria-label={`${l}: use the default`} style={{ ...btn("ghost"), padding: "4px 6px" }} onClick={() => setColor(k, "")}><RotateCcw size={13} /></button>}</div>
        <div style={{ fontSize: 11.5, color: INK_SOFT, marginTop: 2 }}>{hint}</div></div>)}</div>
    {bad.length > 0 && <div role="alert" style={{ color: AMBER, fontSize: 13, marginBottom: 8 }}>Colors are written #RRGGBB, like #FF7900.</div>}
    <Preview colors={colors} org={f.org || b.org} short={f.short || b.short} terms={f.terms} tiles={tiles} logo={logo?.files?.["nexus-emblem.png"] || ""} />

    <div style={{ fontWeight: 800, color: INK, margin: "16px 0 4px" }}>Menu names</div>
    <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 8 }}>Call each section what this organization calls it. Leave blank for the built-in name.</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "6px 12px" }}>
      {tiles.map(t => <label key={t.key} style={{ display: "flex", flexDirection: "column" }}><span style={lbl}>{t.label}</span>
        <input aria-label={`Menu name for ${t.label}`} maxLength={40} placeholder={t.label} value={f.terms[t.key] || ""} onChange={e => setTerm(t.key, e.target.value)} style={{ ...inputStyle, margin: 0 }} /></label>)}</div>

    <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" style={btn("primary")} disabled={bad.length > 0} onClick={save}>Save branding</button>
      {s.saved?.updatedAt && <span style={{ fontSize: 12.5, color: INK_SOFT }}>Last changed {new Date(s.saved.updatedAt).toLocaleString()} by {s.saved.updatedBy}</span>}</div>
    {ask && <CodeDialog title={ask.title} note={ask.note} run={ask.run} onCancel={() => setAsk(null)} onDone={x => { ask.after?.(); done(ask.msg)(x); }} />}
  </section>;
}

// ---- Setup wizard: a new customer's first master admin (install from a License Manager kit; brand.setupPending) -------------
// Steps: welcome (what's licensed) -> name -> logo (the kit's logo, or upload, or keep Fenmorix) -> colors -> menu names -> finish.
// One authenticator code at the end saves it all. "Later" hides it for this browser session; it comes back until finished.
const STEPS = ["Welcome", "Name", "Logo", "Colors", "Menu names", "Finish"];
export function SetupWizard({ onLater }) {
  const [step, setStep] = useState(0), [s, setS] = useState(null), [lic, setLic] = useState(null), [f, setF] = useState(null);
  const [logo, setLogo] = useState(null), [keep, setKeep] = useState(false), [ask, setAsk] = useState(null), [error, setError] = useState(""), [done, setDone] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => {
    call("/branding").then(x => {
      setS(x); const sv = x.saved || {}, b = x.brand || {};
      setF({ org: sv.org || b.org || "", short: sv.short || b.short || "", place: sv.place || b.place || "", app: sv.app || "", colors: { ...(sv.colors || {}) }, terms: { ...(sv.terms || {}) } });
      if (x.setupLogo) fetch("/api/system/branding/setup-logo", { credentials: "same-origin" }).then(r => (r.ok ? r.blob() : null))
        .then(bl => bl && loadImage(bl).then(({ img, url }) => setLogo({ name: "the logo that came with this install", url, img })))
        .catch(() => {});
    }, e => setError(e.message));
    call("/license").then(setLic, () => {});
  }, []);
  if (error) return <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", padding: 30, color: INK }}>{error} <button type="button" style={btn("ghost")} onClick={onLater}>Close</button></div>;
  if (!s || !f) return <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", padding: 30, color: INK_SOFT }}>Loading…</div>;
  const b = s.brand || {};
  const tiles = (s.tiles || []).filter(t => tileOn(t.key));
  const colors = Object.fromEntries(COLORS.map(([k, , d]) => [k, HEX.test(f.colors[k] || "") ? f.colors[k] : d]));
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const setColor = (k, v) => setF(x => ({ ...x, colors: { ...x.colors, [k]: v } }));
  const bad = COLORS.some(([k]) => f.colors[k] && !HEX.test(f.colors[k]));
  const pick = async file => { if (!file) return; try { const { img, url } = await loadImage(file); setLogo({ name: file.name, url, img }); setKeep(false); } catch (e) { setError(e.message); } };
  const finish = () => setAsk({
    run: async () => {
      if (logo && !keep) await call("/branding/logo", { files: makeIconSet(logo.img, colors) });
      return call("/branding", { org: f.org, short: f.short, place: f.place, app: f.app, colors: f.colors, terms: f.terms, setup: "done" });
    },
  });
  if (done) return <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
    <StyleBlock />
    <section style={{ ...cardStyle, maxWidth: 520, textAlign: "center" }} aria-label="Setup finished">
      <div style={{ fontSize: 22, fontWeight: 800, color: INK }}>{f.org} is set up</div>
      <div style={{ color: INK_SOFT, margin: "8px 0 16px", fontSize: 14 }}>Everything can be changed later under User Management › System › Branding. Next: approve your people's account requests
        in User Management, and give admins their access.</div>
      <button type="button" style={btn("primary")} onClick={() => window.location.reload()}>Open Fenmorix OS</button></section></div>;
  const mods = lic?.modules?.filter(m => m.on) || [];
  const body = [
    // Welcome
    <div key="w"><div style={{ fontSize: 15, color: INK, marginBottom: 10 }}>A few steps to make this install look and read like <b>{f.org || "your organization"}</b>. Each one can be changed later.</div>
      {lic && <div style={{ fontSize: 13.5, color: INK_SOFT }}><b style={{ color: INK }}>Licensed:</b> {lic.license ? `${lic.license.customer} · ` : ""}{mods.length} module{mods.length === 1 ? "" : "s"}
        {lic.license?.seats ? ` · up to ${lic.license.seats} users` : ""}{lic.license?.expires ? ` · through ${lic.license.expires}` : ""}
        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>{mods.map(m => <span key={m.key} style={{ background: "#EEF2F7", borderRadius: 12, padding: "3px 10px", fontSize: 12.5, color: INK }}>{m.name}</span>)}</div></div>}</div>,
    // Name
    <div key="n" style={{ display: "grid", gap: 10 }}>
      {[["org", "Organization's full name", 120], ["short", "Short name (side bar)", 20], ["place", "Place (city or county)", 60], ["app", "App name in the browser tab (blank = Fenmorix OS)", 60]].map(([k, l, max]) =>
        <label key={k}><span style={lbl}>{l}</span><input aria-label={l} maxLength={max} value={f[k]} onChange={e => set(k, e.target.value)} style={{ ...inputStyle, margin: 0 }} /></label>)}</div>,
    // Logo
    <div key="l">
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <img src={logo && !keep ? logo.url : "/nexus-emblem.png"} alt={logo && !keep ? "New logo" : "Current logo"} style={{ width: 110, height: 110, objectFit: "contain", background: colors.navy, borderRadius: 14, padding: 8 }} />
        <div style={{ fontSize: 13.5, color: INK_SOFT, flex: "1 1 220px" }}>{logo && !keep ? <>Using <b>{logo.name}</b>. The app icon, browser tab icon and every logo size are made from it.</>
          : "Keeping the Fenmorix OS logo."}</div></div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden aria-label="Logo file" onChange={e => { pick(e.target.files[0]); e.target.value = ""; }} />
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" style={btn("outline")} onClick={() => fileRef.current?.click()}>{logo ? "Use a different logo" : "Upload a logo"}</button>
        {logo && <button type="button" style={btn("ghost")} onClick={() => setKeep(k => !k)}>{keep ? "Use the new logo" : "Keep the Fenmorix OS logo"}</button>}</div></div>,
    // Colors
    <div key="c">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginBottom: 12 }}>
        {COLORS.slice(0, 4).map(([k, l, d, hint]) => <div key={k}><span style={lbl}>{l}</span>
          <div style={{ display: "flex", gap: 6 }}><input type="color" aria-label={`${l} picker`} value={colors[k]} onChange={e => setColor(k, e.target.value.toUpperCase())} style={{ width: 38, height: 34, padding: 0, border: `1px solid ${LINE}`, borderRadius: 6 }} />
            <input aria-label={l} maxLength={7} placeholder={d} value={f.colors[k] || ""} onChange={e => setColor(k, e.target.value.trim())} style={{ ...inputStyle, margin: 0, width: 100, fontFamily: "monospace" }} /></div>
          <div style={{ fontSize: 11.5, color: INK_SOFT }}>{hint}</div></div>)}</div>
      <Preview colors={colors} org={f.org} short={f.short} terms={f.terms} tiles={tiles} logo={logo && !keep ? logo.url : ""} /></div>,
    // Menu names
    <div key="m"><div style={{ fontSize: 13, color: INK_SOFT, marginBottom: 8 }}>Optional: call sections what {f.short || "your organization"} calls them. Blank = the built-in name.</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "6px 12px", maxHeight: 380, overflow: "auto" }}>
        {tiles.map(t => <label key={t.key}><span style={lbl}>{t.label}</span><input aria-label={`Menu name for ${t.label}`} maxLength={40} placeholder={t.label} value={f.terms[t.key] || ""}
          onChange={e => setF(x => ({ ...x, terms: { ...x.terms, [t.key]: e.target.value } }))} style={{ ...inputStyle, margin: 0 }} /></label>)}</div></div>,
    // Finish
    <div key="f" style={{ fontSize: 14, color: INK }}>
      <div><b>{f.org}</b> ({f.short}) · {f.app || "Fenmorix OS"}</div>
      <div style={{ color: INK_SOFT, marginTop: 4 }}>Logo: {logo && !keep ? logo.name : "Fenmorix OS"} · Main color {colors.accent} · {Object.values(f.terms).filter(Boolean).length} menu name{Object.values(f.terms).filter(Boolean).length === 1 ? "" : "s"} changed</div>
      <div style={{ color: INK_SOFT, marginTop: 10, fontSize: 13 }}>Saving asks for a code from your authenticator.</div></div>,
  ][step];
  const canNext = step !== 1 || (f.org.trim() && f.short.trim());
  return <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", minHeight: "100vh", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", boxSizing: "border-box" }}>
    <StyleBlock />
    <section role="region" aria-label="Setup wizard" style={{ ...cardStyle, width: "min(760px, 100%)", margin: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.8 }}>Set up Fenmorix OS · step {step + 1} of {STEPS.length}</div>
      <div style={{ display: "flex", gap: 4, margin: "8px 0 14px" }}>{STEPS.map((x, i) => <div key={x} title={x} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= step ? colors.accent : LINE }} />)}</div>
      <h2 style={{ margin: "0 0 12px", color: INK, fontSize: 22 }}>{STEPS[step]}</h2>
      {body}
      {bad && step === 3 && <div role="alert" style={{ color: AMBER, fontSize: 13, marginTop: 8 }}>Colors are written #RRGGBB, like #FF7900.</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 18, alignItems: "center", flexWrap: "wrap" }}>
        {step > 0 && <button type="button" style={btn("ghost")} onClick={() => setStep(step - 1)}>Back</button>}
        {step < STEPS.length - 1 ? <button type="button" style={btn("primary")} disabled={!canNext || (step === 3 && bad)} onClick={() => setStep(step + 1)}>Next</button>
          : <button type="button" style={btn("primary")} disabled={bad} onClick={finish}>Finish setup</button>}
        <button type="button" style={{ ...btn("ghost"), marginLeft: "auto" }} onClick={onLater}>Do this later</button></div>
      {ask && <CodeDialog title="Finish setup" note="Saves the name, logo, colors and menu names." run={ask.run} onCancel={() => setAsk(null)} onDone={() => { setAsk(null); setDone(true); }} />}
    </section></div>;
}
