(() => {
  const nav = document.querySelector(".mainnav"); if (!nav) return;
  const btns = [...document.querySelectorAll(".mainnav .nb, .mainnav .menu-btn")];
  const panel = b => document.getElementById(b.getAttribute("aria-controls"));
  const close = except => btns.forEach(b => { if (b !== except && b.getAttribute("aria-expanded") === "true") { b.setAttribute("aria-expanded", "false"); panel(b).hidden = true; } });
  btns.forEach(b => b.addEventListener("click", e => {
    e.stopPropagation();
    const open = b.getAttribute("aria-expanded") !== "true" || (e.detail > 0 && matchMedia("(hover: hover)").matches && innerWidth > 1100);
    close(b); b.setAttribute("aria-expanded", String(open)); panel(b).hidden = !open;
    if (open) { const first = panel(b).querySelector("a"); if (first && e.detail === 0) first.focus(); }
  }));
  document.addEventListener("click", e => { if (!e.target.closest(".dd, .allmenu")) close(); });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    const b = btns.find(x => x.getAttribute("aria-expanded") === "true"); close(); if (b) b.focus();
  });
  document.querySelectorAll(".dd a, .allmenu a").forEach(a => a.addEventListener("click", () => close()));
  // With a mouse, pointing at a menu opens it and moving away closes it (after a short pause).
  if (matchMedia("(hover: hover)").matches) document.querySelectorAll(".mainnav .nm").forEach(g => {
    const b = g.querySelector(".nb"); let t;
    g.addEventListener("mouseenter", () => { clearTimeout(t); if (innerWidth > 1100 && b.getAttribute("aria-expanded") !== "true") { close(b); b.setAttribute("aria-expanded", "true"); panel(b).hidden = false; } });
    g.addEventListener("mouseleave", () => { t = setTimeout(() => { if (b.getAttribute("aria-expanded") === "true") { b.setAttribute("aria-expanded", "false"); panel(b).hidden = true; } }, 250); });
  });
})();
