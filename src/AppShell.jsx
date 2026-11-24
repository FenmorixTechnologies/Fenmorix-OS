// The frame every screen uses: a dark side bar (logo, "St. George Fire / <section>",
// Main menu, the section's pages, who's signed in) and the page on the right.
// On narrow screens the side bar becomes a top bar with a menu button.
import React, { useEffect, useState } from "react";
import { Home, LogOut, KeyRound, Menu, X, MonitorSmartphone } from "lucide-react";
import SessionsPanel from "./Sessions.jsx";
import { StyleBlock } from "./App.jsx";
import NexusBrand from "./Brand.jsx";
import SandboxBanner from "./SandboxBanner.jsx";
import { BRAND, THEME } from "./brand.js";
import { sectionName, moduleOn } from "./licensing.js";
import { SpotTicker } from "./Spot.jsx";
import { useSession } from "./session.js";

const INK = "#13233F", PAPER = "#F3F5F8", BRICK = "#C8102E";
// Frame colors come from the install's theme (src/brand.js: Nexus for St. George, Fenmorix OS for everyone else)
const SIDEBAR_BG = THEME.sideBg;
const RED_RULE = THEME.rule;
const NARROW = "(max-width: 860px)";

function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia && window.matchMedia(NARROW).matches);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on));
  }, []);
  return narrow;
}

// nav: [{ key, label, icon, badge, group }]  (group = heading shown above the first item of a group)
export default function AppShell({ section: sectionKey, nav = [], active, onNav, onHome, children, footerExtra, wide }) {
  const section = sectionName(sectionKey);
  const { user, pendingCount, changePassword, signOut } = useSession();
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState(false);
  useEffect(() => { setOpen(false); }, [active]);

  const go = key => { setOpen(false); onNav && onNav(key); };
  const brand = (size = "big") => <NexusBrand size={size} onClick={onHome} title={onHome ? "Back to the main menu" : undefined} />;

  let lastGroup = null;
  const items = nav.map(n => {
    const heading = n.group && n.group !== lastGroup ? n.group : null;
    lastGroup = n.group || lastGroup;
    const on = n.key === active;
    const Icon = n.icon;
    return (
      <React.Fragment key={n.key}>
        {heading && <div style={{ fontSize: 11.5, fontWeight: 800, color: "#DCE2EC", textTransform: "uppercase", letterSpacing: 0.9, padding: "16px 10px 6px", margin: "0 0 6px", borderBottom: "1px solid rgba(255,255,255,0.10)" }}>{heading}</div>}
        <button type="button" onClick={() => go(n.key)} aria-current={on ? "page" : undefined} className={on ? "sgfd-nav sgfd-nav-on" : "sgfd-nav"} style={{
          display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", padding: "9px 12px", borderRadius: 8,
          marginBottom: 3, fontSize: 14.5, fontWeight: on ? 800 : 600, border: "none", cursor: "pointer", fontFamily: "inherit",
          background: on ? THEME.pillBg : "transparent",
          boxShadow: on ? THEME.pillShadow : "none",
          color: on ? "#FFFFFF" : "#E4E9F1",
        }}>
          {Icon && <Icon size={19} strokeWidth={1.9} style={{ flexShrink: 0, opacity: on ? 1 : 0.92 }} />}
          <span style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>{n.label}</span>
          {n.badge > 0 && (
            <span title={`${n.badge} waiting for you`} style={{ background: on ? "#fff" : BRICK, color: on ? BRICK : "#fff", borderRadius: 999, fontSize: 11, fontWeight: 800, padding: "1px 7px", minWidth: 18, textAlign: "center" }}>{n.badge}</span>
          )}
        </button>
      </React.Fragment>
    );
  });

  const sideBody = (
    <>
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 12px" }}>
        {onHome && (
          <button type="button" onClick={onHome} className="sgfd-nav" style={{
            display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "9px 12px", borderRadius: 8, cursor: "pointer",
            marginBottom: 2, fontSize: 14.5, fontWeight: 700, color: "#FFFFFF", background: "rgba(255,255,255,0.07)",
            border: "1px solid rgba(255,255,255,0.14)", fontFamily: "inherit",
          }}><Home size={19} strokeWidth={1.9} /> Main menu</button>
        )}
        {items}
      </div>
      <div style={{ height: 2, background: RED_RULE, margin: "0 0 0 0" }} />
      <div style={{ padding: "14px 18px 16px" }}>
        {footerExtra}
        {user?.role === "master" && pendingCount > 0 && (
          <div style={{ fontSize: 12, fontWeight: 700, color: "#F4B860", marginBottom: 8 }}>
            {pendingCount} account request{pendingCount === 1 ? "" : "s"} waiting
          </div>
        )}
        {user && <>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#FFFFFF" }}>{user.name}</div>
          <div style={{ fontSize: 12.5, color: "#C3CBDA", marginBottom: 10 }}>{user.roleLabel}{user.division ? ` – ${user.division}` : ""}</div>
        </>}
        <button type="button" onClick={changePassword} style={footBtn} className="sgfd-foot"><KeyRound size={16} /> Change password</button>
        <button type="button" onClick={() => setDevices(true)} style={footBtn} className="sgfd-foot"><MonitorSmartphone size={16} /> Signed-in devices</button>
        <button type="button" onClick={signOut} style={footBtn} className="sgfd-foot"><LogOut size={16} /> Sign out</button>
        {BRAND.vendor && <div style={{ fontSize: 10.5, color: "rgba(230,234,242,0.55)", padding: "8px 4px 0", letterSpacing: 0.3 }}>{BRAND.productName} · {BRAND.vendor}</div>}
      </div>
    </>
  );

  return (
    <div style={{ display: "flex", flexDirection: narrow ? "column" : "row", minHeight: "100vh", background: PAPER, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color: INK }}>
      <StyleBlock />
      <style>{`.sgfd-nav:not(.sgfd-nav-on):hover { background: rgba(255,255,255,0.08) !important; color: #fff !important; } .sgfd-nav:focus-visible { outline: 2px solid #fff; outline-offset: -2px; } .sgfd-foot:hover { color: #fff !important; }`}</style>
      {narrow ? (
        <>
          <div style={{ position: "sticky", top: 0, zIndex: 50, background: SIDEBAR_BG, display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderBottom: `2px solid ${THEME.border}` }}>
            <button type="button" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen(o => !o)}
              style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 4, display: "flex" }}>
              {open ? <X size={22} /> : <Menu size={22} />}
            </button>
            {brand("small")}
            <span style={{ color: "#C3CBDA", fontSize: 14, fontWeight: 700, marginLeft: "auto", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{section}</span>
          </div>
          {open && (
            <div style={{ position: "fixed", inset: "58px 0 0 0", zIndex: 49, display: "flex" }}>
              <nav aria-label={`${section} pages`} style={{ width: "min(300px, 85vw)", background: SIDEBAR_BG, display: "flex", flexDirection: "column" }}>{sideBody}</nav>
              <div onClick={() => setOpen(false)} style={{ flex: 1, background: "rgba(10,18,34,0.45)" }} />
            </div>
          )}
        </>
      ) : (
        <nav aria-label={`${section} pages`} style={{ width: 268, background: SIDEBAR_BG, color: "#E6EAF2", display: "flex", flexDirection: "column", flexShrink: 0, position: "sticky", top: 0, height: "100vh", boxShadow: "2px 0 12px rgba(0,0,0,0.18)" }}>
          <div style={{ padding: "14px 16px 12px" }}>{brand("big")}</div>
          <div style={{ height: 2, background: RED_RULE }} />
          {section !== "Home" && <div onClick={onHome} title={onHome ? "Back to the main menu" : undefined} style={{ padding: "12px 24px 0", fontSize: 12, fontWeight: 800, color: THEME.sectionLabel, textTransform: "uppercase", letterSpacing: 0.9, cursor: onHome ? "pointer" : "default" }}>{section}</div>}
          {sideBody}
        </nav>
      )}
      {devices && <SessionsPanel isMaster={user?.role === "master"} onClose={() => setDevices(false)} />}
      {/* The grey Nexus artwork as a faint watermark behind every page (multiplied into the page
          background, so its light parts vanish and only the drawing shows) */}
      <div aria-hidden="true" style={{
        position: "fixed", top: 0, bottom: 0, right: 0, left: narrow ? 0 : 268, zIndex: 0, pointerEvents: "none",
        background: "url(/nexus-watermark.jpg) center / cover no-repeat", opacity: 0.2, mixBlendMode: "multiply",
        WebkitMaskImage: "radial-gradient(ellipse at center, #000 55%, transparent 100%)", maskImage: "radial-gradient(ellipse at center, #000 55%, transparent 100%)",
      }} />
      <main style={{ flex: 1, minWidth: 0, padding: narrow ? "18px 14px 40px" : "28px clamp(20px, 3vw, 48px) 48px", position: "relative", zIndex: 1 }}>
        <SandboxBanner style={{ margin: narrow ? "-18px -14px 14px" : "-28px calc(-1 * clamp(20px, 3vw, 48px)) 18px" }} />
        {moduleOn("spot") && <SpotTicker onOpen={sectionKey === "Spot Prices" ? undefined : () => window.dispatchEvent(new CustomEvent("sgfd-open", { detail: { module: "spot" } }))}
          style={{ margin: narrow ? `${BRAND.sandbox ? -14 : -18}px -14px 14px` : `${BRAND.sandbox ? -18 : -28}px calc(-1 * clamp(20px, 3vw, 48px)) 18px` }} />}
        <div style={{ maxWidth: wide ? "none" : 1280 }}>{children}</div>
      </main>
    </div>
  );
}

const footBtn = {
  display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "#DCE2EC", cursor: "pointer", marginBottom: 9,
  background: "none", border: "none", padding: 0, fontFamily: "inherit",
};
