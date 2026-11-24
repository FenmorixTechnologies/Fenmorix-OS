// The strip across the top of every page on a sandbox server (nothing on a real department's server).
import React from "react";
import { BRAND } from "./brand.js";

export default function SandboxBanner({ style }) {
  if (!BRAND.sandbox) return null;
  return (
    <div role="note" aria-label="Sandbox notice" style={{ background: "repeating-linear-gradient(135deg, #FFF4D6 0 14px, #FFE9B0 14px 28px)", color: "#5A3B00",
      borderBottom: "1px solid #E7B95A", padding: "6px 14px", fontSize: 13, fontWeight: 600, textAlign: "center", lineHeight: 1.35, position: "relative", zIndex: 5, ...style }}>
      <span style={{ background: "#B26A00", color: "#fff", borderRadius: 4, padding: "1px 7px", marginRight: 8, fontSize: 11.5, letterSpacing: 0.6 }}>SANDBOX</span>
      {BRAND.sandboxNote}
    </div>
  );
}
