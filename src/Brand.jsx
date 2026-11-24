// The product brand: emblem + italic "<ORG> / <WORD> <ACCENT> / <TAGLINE>" (St. George: "SGFD / NEXUS / MANAGEMENT SYSTEM";
// Fenmorix OS: "<ORG> / FENMORIX OS / UNIFIED OPERATIONS PLATFORM", and its lockup image on the sign-in page).
//   size "small" - phone top bar        size "big" - desktop side bar
//   size "splash" - sign-in page: big emblem with the title underneath. The emblem is three
//                  stacked layers (art, lightning, fire ring): it flares in, the title rises, the
//                  red rule draws across, then the lightning flickers now and then, the fire ring
//                  breathes and embers drift up. All motion is off for people who ask their device
//                  for reduced motion.
import React from "react";
import { BRAND, THEME } from "./brand.js";

const FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const CHROME = {
  background: "linear-gradient(180deg, #FFFFFF 0%, #EEF1F6 42%, #9EA7B6 54%, #E3E7EE 72%, #FFFFFF 100%)",
  WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
};
const SIZES = {
  small: { emblem: 38, margin: 0, sgfd: 12, nexus: 16, ms: 0, gap: 8 },
  big: { emblem: 92, margin: "-12px -6px -12px -12px", sgfd: 21, nexus: 33, ms: 10.5, gap: 8 },
  splash: { emblem: "clamp(200px, 30vw, 340px)", margin: 0, sgfd: "clamp(26px, 3vw, 36px)", nexus: "clamp(52px, 6.4vw, 84px)", ms: "clamp(13px, 1.4vw, 17px)", gap: 0 },
};

export default function NexusBrand({ size = "big", onClick, title }) {
  const s = SIZES[size] || SIZES.big;
  const hero = size === "splash";
  // Longer product words ("FENMORIX OS") get a smaller size so they fit where "NEXUS" did
  const letters = BRAND.word.length + (BRAND.wordAccent ? BRAND.wordAccent.length + 1 : 0);
  const scale = typeof s.nexus === "number" ? Math.min(1, 6 / letters) : 1;
  const wordSize = typeof s.nexus === "number" ? Math.round(s.nexus * scale) : s.nexus;
  const tagSize = typeof s.ms === "number" ? Math.min(s.ms, Math.round(s.ms * 17 / Math.max(17, BRAND.tagline.length))) : s.ms;
  // A customer's own logo (Fenmorix OS installs): the logo large across the top, the product name smaller under it
  if (!hero && BRAND.orgLogo && BRAND.product !== "nexus") {
    const big = size !== "small";
    return (
      <div onClick={onClick} role={onClick ? "button" : undefined} title={title} aria-label={BRAND.org}
        style={{ display: "flex", flexDirection: big ? "column" : "row", alignItems: big ? "stretch" : "center", gap: big ? 6 : 8, cursor: onClick ? "pointer" : "default", minWidth: 0 }}>
        <img src="/org-logo.png" alt={BRAND.org} style={big ? { width: "100%", height: "auto", maxHeight: 96, objectFit: "contain", objectPosition: "center", display: "block", filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.45))" }
          : { height: 30, width: "auto", maxWidth: 150, objectFit: "contain", display: "block" }} />
        <span style={{ lineHeight: 1, fontStyle: "italic", fontFamily: FONT, color: "#fff", textAlign: big ? "center" : "left", minWidth: 0 }}>
          <span style={{ display: "block", fontSize: big ? 17 : 12, fontWeight: 900, letterSpacing: 0.6, whiteSpace: "nowrap", filter: "drop-shadow(0 2px 2px rgba(0,0,0,0.55))" }}>
            <span style={CHROME}>{BRAND.word}</span>{BRAND.wordAccent && <span style={{ color: THEME.accent }}> {BRAND.wordAccent}</span>}</span>
          {big && <span style={{ display: "block", fontSize: 8.5, fontWeight: 800, letterSpacing: 0.8, marginTop: 3, whiteSpace: "nowrap", opacity: 0.9 }}>{BRAND.tagline}</span>}
        </span>
      </div>
    );
  }
  return (
    <div onClick={onClick} role={onClick ? "button" : undefined} title={title}
      aria-label={BRAND.product === "nexus" ? `${BRAND.app} Management System` : BRAND.app} className={hero ? "nx-hero" : undefined}
      style={{ display: "flex", flexDirection: hero ? "column" : "row", alignItems: "center", textAlign: hero ? "center" : "left", gap: s.gap, cursor: onClick ? "pointer" : "default", minWidth: 0, position: "relative" }}>
      {hero && <style>{HERO_CSS}</style>}
      <span className={hero ? "nx-emblem" : undefined} style={{ position: "relative", flexShrink: 0, margin: s.margin, width: s.emblem, height: s.emblem, display: "block" }}>
        {hero && <span className="nx-glow" aria-hidden="true" />}
        {hero && <span className="nx-embers" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span>}
        {hero ? (
          <span className="nx-layers">
            <img className="nx-art" src="/nexus-hero-art.png" alt="" />
            <img className="nx-bolts nx-bolts-a" src="/nexus-hero-bolts.png" alt="" />
            <img className="nx-bolts nx-bolts-b" src="/nexus-hero-bolts.png" alt="" />
            <img className="nx-ring" src="/nexus-hero-ring.png" alt="" />
          </span>
        ) : (
          <img src="/nexus-emblem.png" alt="" style={{ position: "relative", width: "100%", height: "100%", display: "block", filter: THEME.emblemGlow }} />
        )}
      </span>
      {hero && BRAND.wordmark ? (
        // The product's own lockup image (Fenmorix OS) under the emblem on the sign-in page
        <span className="nx-title" style={{ display: "block", marginTop: 10 }}>
          <img src="/brand-wordmark.png" alt={BRAND.productName} style={{ width: "min(560px, 80vw)", height: "auto", display: "block", margin: "0 auto" }} />
          <span className="nx-rule" aria-hidden="true" />
        </span>
      ) : (
      <span className={hero ? "nx-title" : undefined} style={{ lineHeight: 1, minWidth: 0, marginTop: hero ? 6 : 0, fontStyle: "italic", color: "#fff", fontFamily: FONT }}>
        <span style={{ display: "block", fontSize: s.sgfd, fontWeight: 900, letterSpacing: 0.5, textShadow: "0 2px 3px rgba(0,0,0,0.45)" }}>{BRAND.short}</span>
        <span style={{ display: "block", fontSize: wordSize, fontWeight: 900, letterSpacing: hero ? 2 : 0.5, marginTop: hero ? -4 : size === "big" ? -1 : 0, paddingRight: hero ? "0.12em" : 0, whiteSpace: "nowrap", filter: "drop-shadow(0 2px 2px rgba(0,0,0,0.55))" }}>
          <span style={CHROME}>{BRAND.word}</span>{BRAND.wordAccent && <span style={{ color: THEME.accent }}> {BRAND.wordAccent}</span>}</span>
        {!!s.ms && <span style={{ display: "block", fontSize: tagSize, fontWeight: 800, letterSpacing: hero ? 1.2 : 0.6, marginTop: hero ? 6 : 3, whiteSpace: "nowrap", textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>{BRAND.tagline}</span>}
        {hero && <span className="nx-rule" aria-hidden="true" />}
      </span>
      )}
    </div>
  );
}

const HERO_CSS = `
.nx-hero .nx-layers { position: relative; display: block; width: 100%; height: 100%; animation: nx-flare 1.2s cubic-bezier(.2,.9,.25,1.2) both; }
.nx-hero .nx-layers img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.nx-hero .nx-art { filter: drop-shadow(0 6px 18px rgba(0,0,0,0.5)); }
/* Lightning: dark most of the time, then a quick double flicker like a real strike.
   Two copies, clipped to left and right halves, on different cycles so it never looks mechanical. */
.nx-hero .nx-bolts { opacity: 0; mix-blend-mode: screen; }
.nx-hero .nx-bolts-a { clip-path: inset(0 50% 0 0); animation: nx-strike 7.3s linear 2.2s infinite; }
.nx-hero .nx-bolts-b { clip-path: inset(0 0 0 50%); animation: nx-strike 9.7s linear 5.1s infinite; }
/* Fire ring: a slow, subtle breath */
.nx-hero .nx-ring { animation: nx-breathe 4.2s ease-in-out 1.2s infinite; transform-origin: center; }
.nx-hero .nx-glow { position: absolute; inset: ${THEME.heroInset || "9%"}; border-radius: 50%; box-shadow: ${THEME.heroGlow}; background: ${THEME.heroFill || "none"}; animation: nx-pulse 4.2s ease-in-out 1.2s infinite; }
.nx-hero .nx-title { animation: nx-rise-t .8s ease-out .5s both; }
.nx-hero .nx-rule { display: block; height: 3px; margin: 14px auto 0; width: 86%; border-radius: 2px; transform-origin: center;
  background: ${THEME.heroRule}; box-shadow: 0 0 10px ${THEME.accent}99;
  animation: nx-draw .9s ease-out .9s both; }
.nx-hero .nx-embers { position: absolute; inset: 0; pointer-events: none; }
.nx-hero .nx-embers i { position: absolute; bottom: 14%; width: 4px; height: 4px; border-radius: 50%; background: #FFB347;
  box-shadow: 0 0 6px 2px rgba(255,120,30,0.8); opacity: 0; animation: nx-ember 4.6s ease-in infinite; }
.nx-hero .nx-embers i:nth-child(1) { left: 14%; animation-delay: 1.3s; }
.nx-hero .nx-embers i:nth-child(2) { left: 28%; animation-delay: 2.1s; animation-duration: 5.4s; }
.nx-hero .nx-embers i:nth-child(3) { left: 42%; animation-delay: 1.7s; width: 3px; height: 3px; }
.nx-hero .nx-embers i:nth-child(4) { left: 58%; animation-delay: 3.0s; }
.nx-hero .nx-embers i:nth-child(5) { left: 72%; animation-delay: 2.5s; animation-duration: 5s; width: 3px; height: 3px; }
.nx-hero .nx-embers i:nth-child(6) { left: 86%; animation-delay: 1.5s; }
.nx-hero .nx-embers i:nth-child(7) { left: 20%; animation-delay: 3.6s; animation-duration: 5.8s; }
.nx-hero .nx-embers i:nth-child(8) { left: 64%; animation-delay: 4.1s; width: 3px; height: 3px; }
.nx-hero .nx-embers i:nth-child(9) { left: 80%; animation-delay: 3.3s; animation-duration: 4.2s; }
@keyframes nx-flare { 0% { opacity: 0; transform: scale(.6) rotate(-10deg); filter: brightness(2.2); }
  70% { opacity: 1; transform: scale(1.04) rotate(1.5deg); filter: brightness(1.15); } 100% { opacity: 1; transform: none; filter: none; } }
@keyframes nx-strike { 0%, 100% { opacity: 0; } 1.2% { opacity: .85; } 2.2% { opacity: .15; } 3.4% { opacity: 1; } 6.5% { opacity: 0; } }
@keyframes nx-breathe { 0%, 100% { opacity: .82; transform: scale(1); filter: brightness(.95); } 50% { opacity: 1; transform: scale(1.012); filter: brightness(1.18); } }
@keyframes nx-pulse { 0%, 100% { opacity: .45; } 50% { opacity: .9; } }
@keyframes nx-rise-t { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
@keyframes nx-draw { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes nx-ember { 0% { opacity: 0; transform: translate(0, 0) scale(1); } 15% { opacity: 1; }
  100% { opacity: 0; transform: translate(-10px, -170px) scale(.4); } }
@media (prefers-reduced-motion: reduce) {
  .nx-hero .nx-layers, .nx-hero .nx-title, .nx-hero .nx-rule, .nx-hero .nx-glow, .nx-hero .nx-ring, .nx-hero .nx-bolts { animation: none !important; }
  .nx-hero .nx-embers { display: none; }
}
`;
