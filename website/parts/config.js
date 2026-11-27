// The configurator: sector -> preset modules; switches -> the picture and the "about" panel; colors and name -> the picture.
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const NAMES = { ps: "Riverbend Fire District", gov: "City of Riverbend", biz: "Riverbend Supply Co.", edu: "Riverbend Elementary" };
  const HELLO = { ps: "Good morning, Captain Reyes", gov: "Good morning, Dana", biz: "Good morning, Jordan", edu: "Good morning, Ms. Avery" };
  let sector = "ps", on = new Set(PRESETS.ps), focus = null, fresh = null, nameTouched = false;
  const paint = { a: PAINTS[0].a, s: PAINTS[0].s };
  const offered = m => !m.sectors || m.sectors.includes(sector);
  const mod = k => MODULES.find(m => m.key === k);

  // Sector buttons
  document.querySelectorAll("[data-sector]").forEach(b => b.addEventListener("click", () => setSector(b.dataset.sector)));
  function setSector(s) {
    sector = s;
    document.querySelectorAll("[data-sector]").forEach(b => b.setAttribute("aria-pressed", b.dataset.sector === s ? "true" : "false"));
    on = new Set(PRESETS[s]); focus = null; fresh = null;
    if (!nameTouched) $("pv-name").value = NAMES[s];
    buildSwitches(); render();
    document.dispatchEvent(new CustomEvent("fx-sector", { detail: s }));
  }

  // Module switches, grouped
  function buildSwitches() {
    const box = $("groups"); box.innerHTML = "";
    for (const g of GROUPS) {
      const list = MODULES.filter(m => m.group === g && offered(m)); if (!list.length) continue;
      const d = document.createElement("div"); d.className = "group";
      d.innerHTML = `<h3>${esc(g)}</h3><div class="switches"></div>`;
      for (const m of list) {
        const b = document.createElement("button"); b.type = "button"; b.className = "sw"; b.dataset.key = m.key;
        b.innerHTML = esc(m.label) + (m.soon ? " <em>Coming next</em>" : "");
        b.addEventListener("click", () => {
          if (on.has(m.key)) { on.delete(m.key); fresh = null; } else { on.add(m.key); fresh = m.key; }
          focus = m.key; render();
        });
        d.querySelector(".switches").appendChild(b);
      }
      box.appendChild(d);
    }
  }

  function render() {
    document.querySelectorAll(".sw").forEach(b => { b.setAttribute("aria-pressed", on.has(b.dataset.key) ? "true" : "false"); b.classList.toggle("focus", b.dataset.key === focus); });
    // About panel
    const S = SECTORS[sector], m = focus && mod(focus);
    $("about").innerHTML = m
      ? `<h3>${esc(m.label)} <span>${on.has(m.key) ? "On" : "Off"}${m.soon ? " · coming next" : ""}</span></h3><p>${esc(m.desc)}</p>
         <ul>${m.feats.map(f => `<li>${esc(f)}</li>`).join("")}</ul><p class="use"><b>${esc(S.in)}:</b> ${esc(m.use[sector] || "")}</p>`
      : `<h3>Built for ${esc(S.label.toLowerCase())}</h3><p>We switched on a starting set for ${esc(S.noun)}. Turn modules on or off and the picture changes; tap any module to read what it does and how ${esc(S.noun)} would use it.</p>
         <p class="use"><b>Every module shares</b> the same sign-in, people, permissions and phone alerts, so adding one later takes minutes, not a new system.</p>`;
    // Tally
    const n = on.size;
    $("count").textContent = n;
    $("tally-text").textContent = n === 0 ? "modules on. Pick what your organization needs." : `module${n === 1 ? "" : "s"} on. Ready-made bundles cost less than modules picked one by one, and we'll show you both.`;
    drawPreview();
  }

  // The picture
  function drawPreview() {
    const pv = $("pv"); pv.style.setProperty("--acc", paint.a); pv.style.setProperty("--side", paint.s);
    const name = $("pv-name").value.trim() || NAMES[sector];
    $("pv-mark").textContent = name.replace(/^(the|city of|town of)\s+/i, "").charAt(0).toUpperCase() || "Y";
    $("pv-org").textContent = name;
    $("pv-url").textContent = (name.toLowerCase().replace(/^(the|city of|town of)\s+/, "").split(/[^a-z0-9]+/)[0] || "yourorg") + ".fenmorix.com";
    $("pv-hello").textContent = HELLO[sector];
    // Side bar: Home, then each group's switched-on modules
    const side = $("pv-nav"); side.innerHTML = `<div class="pv-nav on">Home</div>`;
    let shown = 0, extra = 0;
    for (const g of GROUPS) {
      const list = MODULES.filter(m => m.group === g && offered(m) && on.has(m.key)); if (!list.length) continue;
      if (shown >= 11) { extra += list.length; continue; }
      side.insertAdjacentHTML("beforeend", `<div class="pv-grp">${esc(g)}</div>`);
      for (const m of list) {
        if (shown >= 11) { extra++; continue; }
        side.insertAdjacentHTML("beforeend", `<div class="pv-nav${m.key === fresh ? " new" : ""}">${esc(m.label)}</div>`); shown++;
      }
    }
    if (extra) side.insertAdjacentHTML("beforeend", `<div class="pv-more">+${extra} more</div>`);
    // Home page cards: the newest switched on first
    const keys = [...on].reverse().slice(0, 6), cards = $("pv-cards");
    cards.innerHTML = keys.length ? keys.map(k => {
      const m = mod(k), w = (sector === "edu" && m.wEdu) || m.w;
      return `<div class="pv-card${k === fresh ? " new" : ""}"><h4>${esc(w.t)}</h4>${w.l.map(x => `<p>${x}</p>`).join("")}</div>`;
    }).join("") : `<div class="pv-empty">Switch on a module to see it here.</div>`;
    pv.setAttribute("aria-label", `Preview of Fenmorix OS for ${name}, in ${PAINTS.find(p => p.a === paint.a)?.name || "your color"}, with ${on.size} modules: ${[...on].map(k => mod(k).label).join(", ") || "none"}.`);
    // Demo email carries the build
    const body = `Our organization: ${name}\nType: ${SECTORS[sector].label}\nOur size (people):\nBest time to talk:\n\nModules we're interested in: ${[...on].map(k => mod(k).label).join(", ")}\nColor: ${paint.a}\n`;
    $("build-mail").href = "mailto:michael@fenmorix.com?subject=" + encodeURIComponent("Fenmorix OS demo: " + name) + "&body=" + encodeURIComponent(body);
    window.fxBuild = { sector, modules: [...on].map(k => mod(k).label), name, color: paint.a };
  }

  // Colors and name
  const sw = $("swatches");
  PAINTS.forEach((p, i) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "swatch"; b.style.setProperty("--a", p.a); b.style.setProperty("--s", p.s);
    b.setAttribute("aria-label", p.name); b.setAttribute("aria-pressed", i === 0 ? "true" : "false"); b.title = p.name;
    b.addEventListener("click", () => { paint.a = p.a; paint.s = p.s; $("pv-color").value = p.a; mark(b); drawPreview(); });
    sw.appendChild(b);
  });
  const mark = b => sw.querySelectorAll(".swatch").forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
  $("pv-color").addEventListener("input", e => { paint.a = e.target.value; mark(null); drawPreview(); });
  $("pv-name").addEventListener("input", () => { nameTouched = true; drawPreview(); });

  $("pv-date").textContent = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  setSector("ps");
})();
