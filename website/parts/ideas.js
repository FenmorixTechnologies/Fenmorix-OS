// Feature ideas: checked here, then sent to /api/idea (the website Worker forwards it to Fenmorix's office as a support request).
(() => {
  const f = document.getElementById("idea-form"), st = document.getElementById("idea-status");
  const say = (t, cls) => { st.textContent = t; st.className = cls || ""; };
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    const bad = [];
    for (const [k, label] of [["name", "your name"], ["org", "your organization"], ["email", "your email"], ["phone", "your phone number"], ["idea", "your idea"]]) {
      const el = f.elements[k], val = String(v[k] || "").trim();
      const wrong = !val || (k === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) || (k === "phone" && val.replace(/\D/g, "").length < 7);
      el.setAttribute("aria-invalid", wrong ? "true" : "false");
      if (wrong) bad.push(label);
    }
    if (bad.length) { say("Please fill in " + bad.join(", ").replace(/, ([^,]*)$/, " and $1") + ".", "bad"); f.querySelector('[aria-invalid="true"]').focus(); return; }
    const token = (f.querySelector('[name="cf-turnstile-response"]') || {}).value || "";
    const btn = f.querySelector("button[type=submit]"); btn.disabled = true; say("Sending…");
    try {
      const r = await fetch("/api/idea", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: v.name, org: v.org, email: v.email, phone: v.phone, idea: v.idea, website: v.website, token, build: window.fxBuild || null }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "It didn't go through.");
      f.reset(); f.querySelectorAll("[aria-invalid]").forEach(x => x.removeAttribute("aria-invalid"));
      say("Thank you! Your idea reached our team. We'll be in touch at the email you gave.", "ok");
    } catch (err) {
      say(err.message + " You can also email michael@fenmorix.com.", "bad");
    } finally { btn.disabled = false; if (window.turnstile) try { window.turnstile.reset(); } catch {} }
  });
})();
