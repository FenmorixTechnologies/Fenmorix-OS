// Printing an operational period as one IAP: cover, then each form in order, laid out like the FEMA ICS
// forms, numbered "IAP Page N". 205 and 220 (and landscape attachments) print sideways.
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nl = s => esc(s).replace(/\n/g, "<br>");
const d8 = w => (w ? `${w.slice(5, 7)}/${w.slice(8, 10)}/${w.slice(0, 4)}` : "");
const hm = w => (w ? w.slice(11, 16).replace(":", "") : "");
const dt = w => (w ? `${d8(w)} ${hm(w)}` : "");
const chk = on => `<span class="cb">${on ? "&#10004;" : "&nbsp;"}</span>`;

const CSS = `
@page { size: letter; margin: 0.45in; }
@page land { size: letter landscape; margin: 0.4in; }
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; color: #000; margin: 0; font-size: 10.5pt; }
.page { page-break-after: always; break-after: page; }
.page:last-child { page-break-after: auto; break-after: auto; }
.land { page: land; }
h1.form { text-align: center; font-size: 15pt; margin: 0 0 4px; letter-spacing: 0.3px; }
table.f { width: 100%; border-collapse: collapse; border: 2px solid #000; }
table.f td, table.f th { border: 1px solid #000; padding: 3px 5px; vertical-align: top; font-size: 9.5pt; }
table.f th { background: #E6E6E6; text-align: left; font-weight: bold; }
.l { font-weight: bold; }
.sub { font-size: 8pt; color: #222; }
.grey { background: #E6E6E6; font-weight: bold; }
.cb { display: inline-block; width: 11px; height: 11px; border: 1px solid #000; font-size: 8pt; line-height: 10px; text-align: center; margin-right: 3px; vertical-align: -1px; }
.big { min-height: 1.2in; }
.cover { text-align: center; padding-top: 0.4in; }
.cover h1 { color: #D0021B; font-size: 30pt; margin: 0 0 8px; }
.cover h2 { color: #D0021B; font-size: 21pt; margin: 0 0 18px; }
.cover .loc { font-size: 17pt; margin-bottom: 4px; }
.cover img { max-width: 5.6in; max-height: 4.2in; margin: 18px auto; display: block; }
.cover .op { font-size: 19pt; font-weight: bold; margin-top: 14px; }
.cover .opt { font-size: 17pt; font-weight: bold; line-height: 1.6; }
.att h2 { font-size: 13pt; margin: 0 0 6px; }
.att img { max-width: 100%; max-height: 9.3in; display: block; margin: 0 auto; }
.land.att img { max-height: 6.8in; }
.org { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.org .b { border: 1.5px solid #000; padding: 4px 7px; font-size: 9pt; min-width: 1.4in; text-align: center; }
.org .b b { display: block; font-size: 8.5pt; }
.org .row { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.org .cols { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; width: 100%; }
.org .col { display: flex; flex-direction: column; gap: 5px; align-items: stretch; }
.org .ind { margin-left: 10px; }
`;

function head(title, inc, p, extra = "") {
  return `<h1 class="form">${esc(title)}</h1>
  <table class="f"><tr>
    <td style="width:42%"><span class="l">1. Incident Name:</span><br>${esc(inc.name)}${inc.number ? ` ${esc(inc.number)}` : ""}</td>
    <td><span class="l">2. Operational Period:</span> Date From: ${d8(p.starts)} &nbsp; Date To: ${d8(p.ends)}<br>
      <span style="margin-left:1.5in">Time From: ${hm(p.starts)} &nbsp; Time To: ${hm(p.ends)}</span></td>${extra}
  </tr></table>`;
}
function foot(form, page, prepared, label = "Prepared by", extra = "") {
  const pr = prepared || {};
  return `<table class="f" style="border-top:0">
    <tr><td colspan="3"><span class="l">${esc(label)}:</span> Name: ${esc(pr.name)} &nbsp;&nbsp; <span class="l">Position/Title:</span> ${esc(pr.position)} &nbsp;&nbsp; <span class="l">Signature:</span> ______________</td></tr>
    ${extra}
    <tr><td style="width:18%" class="l">${esc(form)}</td><td style="width:18%"><span class="l">IAP Page</span> ${page}</td><td><span class="l">Date/Time:</span> ${esc(dt(pr.at))}</td></tr></table>`;
}
const rowsTable = (cols, rows, minRows = 0) => {
  const list = [...(rows || [])];
  while (list.length < minRows) list.push({});
  return `<table class="f" style="border-top:0"><tr>${cols.map(c => `<th style="${c.w ? `width:${c.w}` : ""}">${esc(c.label)}</th>`).join("")}</tr>
    ${list.map(r => `<tr>${cols.map(c => `<td>${c.check ? (r[c.key] ? "&#10004;" : "&nbsp;") : nl(r[c.key]) || "&nbsp;"}</td>`).join("")}</tr>`).join("")}</table>`;
};

// ---- Each form -> pages ---------------------------------------------------------------------------------
const R = {
  cover(f, x) {
    const d = f.data;
    return [{ html: `<div class="cover">
      <h1>${esc((d.title || "Incident Action Plan").toUpperCase())}</h1>
      <h2>${esc(x.inc.name)}${x.inc.number ? ` ${esc(x.inc.number)}` : ""}</h2>
      ${d.subtitle ? `<div class="loc">${esc(d.subtitle)}</div>` : ""}
      <div style="font-size:13pt">${esc(new Date(`${x.p.starts}:00`).toLocaleDateString("en-US", { weekday: "long" }))}</div>
      ${d.photo ? `<img src="${x.origin}/api/imt/files/${d.photo}" alt="">` : `<div style="height:2.6in"></div>`}
      <div class="op">OPERATIONAL PERIOD</div>
      <div class="opt">${d8(x.p.starts)} &nbsp;&nbsp; ${hm(x.p.starts)}<br>to<br>${d8(x.p.ends)} &nbsp;&nbsp; ${hm(x.p.ends)}</div>
      ${d.note ? `<div style="margin-top:14px;font-size:12pt">${nl(d.note)}</div>` : ""}
      ${x.period.status === "approved" ? `<div style="margin-top:16px;font-size:10pt">Approved by ${esc(x.period.approvedBy)}</div>` : `<div style="margin-top:16px;font-size:12pt;color:#D0021B;font-weight:bold">DRAFT - NOT APPROVED</div>`}
    </div>` }];
  },
  "202"(f, x, page) {
    const d = f.data, has = k => x.kinds.includes(k);
    const objs = (d.objectives || []).filter(o => String(o).trim());
    const sig = x.period.status === "approved" ? (x.period.signature ? `<img src="${x.period.signature}" style="height:34px;vertical-align:middle">` : esc(x.period.approvedBy)) : "______________";
    return [{ html: `${head("INCIDENT OBJECTIVES (ICS 202)", x.inc, x.p)}
      <table class="f" style="border-top:0">
        <tr><td><span class="l">3. Objective(s):</span><div class="big">${objs.map((o, i) => `${i + 1}. ${nl(o)}`).join("<br>")}</div></td></tr>
        <tr><td><span class="l">4. Operational Period Command Emphasis:</span><div style="min-height:0.7in">${nl(d.emphasis)}</div>
          ${d.awareness ? `<div style="margin-top:4px"><span class="l">General Situational Awareness</span><br>${nl(d.awareness)}</div>` : ""}</td></tr>
        <tr><td><span class="l">5. Site Safety Plan Required?</span> Yes ${chk(d.siteSafety?.required)} No ${chk(!d.siteSafety?.required)}<br>
          <span class="l">Approved Site Safety Plan(s) Located at:</span> ${esc(d.siteSafety?.location)}</td></tr>
        <tr><td><span class="l">6. Incident Action Plan</span> (the items checked below are included in this Incident Action Plan):<br>
          <table style="width:100%;border:0"><tr>
            <td style="border:0">${["203", "204", "205", "205a", "206"].map(k => `${chk(has(k))}ICS ${k.toUpperCase()}`).join("<br>")}</td>
            <td style="border:0">${chk(has("207"))}ICS 207<br>${chk(has("208"))}ICS 208<br>${chk(has("attachment"))}Map/Chart<br>${chk(has("weather"))}Weather Forecast/Tides/Currents<br>${chk(has("220"))}ICS 220</td>
            <td style="border:0"><span class="l">Other Attachments:</span><br>${(d.other || []).filter(o => o.label).map(o => `${chk(o.included)}${esc(o.label)}`).join("<br>")}</td>
          </tr></table></td></tr>
      </table>
      ${foot("ICS 202", page, d.prepared, "7. Prepared by", `<tr><td colspan="3"><span class="l">8. Approved by Incident Commander:</span> Name: ${esc(d.approved?.name || x.period.approvedBy)} &nbsp;&nbsp; <span class="l">Signature:</span> ${sig}</td></tr>`)}` }];
  },
  "203"(f, x, page) {
    const rows = f.data.rows || [];
    const sec = (s, title) => {
      const list = rows.filter(r => r.section === s && (r.name || r.label || ["command", "planning", "logistics", "finance"].includes(s)));
      return `<tr><td colspan="2" class="grey">${esc(title)}</td></tr>` + list.map(r => `<tr><td style="width:44%;text-align:right">${esc(s === "agency" ? r.agency : r.role)}${r.label ? `: ${esc(r.label)}` : ""}</td><td>${esc(r.name)}</td></tr>`).join("");
    };
    const left = sec("command", "3. Incident Commander(s) and Command Staff:") + sec("agency", "4. Agency/Organization Representatives:") + sec("planning", "5. Planning Section:") + sec("logistics", "6. Logistics Section:");
    const right = sec("operations", "7. Operations Section:") + (rows.some(r => r.section === "air" && r.name) ? sec("air", "Air Operations Branch") : "") + sec("finance", "8. Finance/Administration Section:");
    return [{ html: `${head("ORGANIZATION ASSIGNMENT LIST (ICS 203)", x.inc, x.p)}
      <table class="f" style="border-top:0"><tr><td style="width:50%;padding:0"><table class="f" style="border:0">${left}</table></td>
        <td style="padding:0"><table class="f" style="border:0">${right}</table></td></tr></table>
      ${foot("ICS 203", page, f.data.prepared, "9. Prepared by")}` }];
  },
  "204"(f, x, page) {
    const d = f.data;
    const osc = (x.forms.find(y => y.kind === "203")?.data.rows || []).find(r => r.section === "operations" && r.role === "Chief") || {};
    return [{ html: `<h1 class="form">ASSIGNMENT LIST (ICS 204)</h1>
      <table class="f"><tr><td style="width:36%"><span class="l">1. Incident Name:</span><br><b>${esc(x.inc.name)}</b></td>
        <td style="width:40%"><span class="l">2. Operational Period:</span><br>Date From: ${d8(x.p.starts)} &nbsp; Date To: ${d8(x.p.ends)}<br>Time From: ${hm(x.p.starts)} &nbsp; Time To: ${hm(x.p.ends)}</td>
        <td rowspan="2"><span class="l">3.</span><br><span class="l">Branch:</span> ${esc(d.branch)}<br><span class="l">Division:</span> ${esc(d.division)}<br><span class="l">Group:</span> ${esc(d.group)}<br><span class="l">Staging Area:</span> ${esc(d.staging)}</td></tr>
        <tr><td colspan="2"><span class="l">4. Operations Personnel</span> &nbsp; Name / Contact Number(s)<br>
          Operations Section Chief: ${esc(osc.name)} ${esc(osc.contact)}<br>Branch Director: ${esc(d.branchDirector?.name)} ${esc(d.branchDirector?.contact)}<br>
          Division/Group Supervisor: ${esc(d.supervisor?.name)} ${esc(d.supervisor?.contact)}</td></tr></table>
      <table class="f" style="border-top:0"><tr><td class="l">5. Resources Assigned:</td></tr></table>
      ${rowsTable([{ key: "ident", label: "Resource Identifier", w: "20%" }, { key: "leader", label: "Leader", w: "17%" }, { key: "persons", label: "# of Persons", w: "8%" },
        { key: "contact", label: "Contact (e.g., phone, pager, radio frequency, etc.)", w: "22%" }, { key: "notes", label: "Reporting Location, Special Equipment and Supplies, Remarks, Notes, Information" }], d.resources, 6)}
      <table class="f" style="border-top:0">
        <tr><td><span class="l">6. Work Assignments:</span><div style="min-height:1in">${nl(d.work)}</div></td></tr>
        <tr><td><span class="l">7. Special Instructions:</span><div style="min-height:0.7in">${nl(d.special)}</div></td></tr>
        <tr><td><span class="l">8. Communications</span> (radio and/or phone contact numbers needed for this assignment):</td></tr></table>
      ${rowsTable([{ key: "name", label: "Name/Function", w: "40%" }, { key: "contact", label: "Primary Contact: indicate cell, pager, or radio (frequency/system/channel)" }], d.comms, 3)}
      ${foot("ICS 204", page, d.prepared, "9. Prepared by")}` }];
  },
  "205"(f, x, page) {
    const d = f.data;
    return [{ landscape: true, html: `<h1 class="form">INCIDENT RADIO COMMUNICATIONS PLAN (ICS 205)</h1>
      <table class="f"><tr><td style="width:30%"><span class="l">1. Incident Name:</span><br>${esc(x.inc.name)}</td>
        <td style="width:25%"><span class="l">2. Date/Time Prepared:</span><br>${esc(dt(d.prepared?.at))}</td>
        <td><span class="l">3. Operational Period:</span> Date From: ${d8(x.p.starts)} Date To: ${d8(x.p.ends)} &nbsp; Time From: ${hm(x.p.starts)} Time To: ${hm(x.p.ends)}</td></tr></table>
      <table class="f" style="border-top:0"><tr><td class="l">4. Basic Radio Channel Use:</td></tr></table>
      ${rowsTable([{ key: "zone", label: "Zone Grp." }, { key: "ch", label: "Ch #" }, { key: "func", label: "Function" }, { key: "name", label: "Channel Name/Trunked Radio System Talkgroup" },
        { key: "assignment", label: "Assignment" }, { key: "rxFreq", label: "RX Freq N or W" }, { key: "rxTone", label: "RX Tone/NAC" }, { key: "txFreq", label: "TX Freq N or W" },
        { key: "txTone", label: "TX Tone/NAC" }, { key: "mode", label: "Mode (A, D, or M)" }, { key: "remarks", label: "Remarks" }], d.channels, 8)}
      <table class="f" style="border-top:0"><tr><td><span class="l">5. Special Instructions:</span><br>${nl(d.special)}</td></tr></table>
      ${foot("ICS 205", page, d.prepared, "6. Prepared by (Communications Unit Leader)")}` }];
  },
  "205a"(f, x, page) {
    const rows = [...(f.data.rows || [])].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return [{ html: `${head("COMMUNICATIONS LIST (ICS 205A)", x.inc, x.p)}
      <table class="f" style="border-top:0"><tr><td class="l">3. Basic Local Communications Information:</td></tr></table>
      ${rowsTable([{ key: "position", label: "Incident Assigned Position", w: "34%" }, { key: "name", label: "Name (Alphabetized)", w: "30%" }, { key: "contact", label: "Method(s) of Contact (phone, pager, cell, etc.)" }], rows, 12)}
      ${foot("ICS 205A", page, f.data.prepared, "4. Prepared by")}` }];
  },
  "206"(f, x, page) {
    const d = f.data;
    return [{ html: `${head("MEDICAL PLAN (ICS 206)", x.inc, x.p)}
      <table class="f" style="border-top:0"><tr><td class="l">3. Medical Aid Stations:</td></tr></table>
      ${rowsTable([{ key: "name", label: "Name" }, { key: "location", label: "Location" }, { key: "contact", label: "Contact Number(s)/Frequency" }, { key: "als", label: "Paramedics on Site?", check: true, w: "12%" }], d.stations, 2)}
      <table class="f" style="border-top:0"><tr><td class="l">4. Transportation (indicate air or ground):</td></tr></table>
      ${rowsTable([{ key: "name", label: "Ambulance Service" }, { key: "location", label: "Location" }, { key: "contact", label: "Contact Number(s)/Frequency" }, { key: "als", label: "Level of Service: ALS", check: true, w: "12%" }], d.transport, 3)}
      <table class="f" style="border-top:0"><tr><td class="l">5. Hospitals:</td></tr></table>
      ${rowsTable([{ key: "name", label: "Hospital Name" }, { key: "address", label: "Address, Latitude & Longitude if Helipad" }, { key: "contact", label: "Contact Number(s)/Frequency" },
        { key: "air", label: "Travel Time Air", w: "7%" }, { key: "ground", label: "Travel Time Ground", w: "8%" }, { key: "trauma", label: "Trauma Center", w: "8%" }, { key: "burn", label: "Burn Center", check: true, w: "6%" }, { key: "helipad", label: "Helipad", check: true, w: "6%" }], d.hospitals, 3)}
      <table class="f" style="border-top:0"><tr><td><span class="l">6. Special Medical Emergency Procedures:</span><div style="min-height:1in">${nl(d.procedures)}</div>
        ${chk(d.aviation)} Check box if aviation assets are utilized for rescue. If assets are used, coordinate with Air Operations.</td></tr></table>
      ${foot("ICS 206", page, d.prepared, "7. Prepared by (Medical Unit Leader)", `<tr><td colspan="3"><span class="l">8. Approved by (Safety Officer):</span> Name: ${esc(d.approved?.name)} &nbsp;&nbsp; <span class="l">Signature:</span> ______________</td></tr>`)}` }];
  },
  "207"(f, x, page) {
    const rows = x.forms.find(y => y.kind === "203")?.data.rows || [];
    const named = r => r.name || r.label;
    const pick = (s, re) => rows.filter(r => r.section === s && re.test(r.role) && named(r));
    const b = (t, ppl) => `<div class="b"><b>${esc(t)}</b>${ppl.map(p => esc(p.name || "")).join("<br>") || "&nbsp;"}</div>`;
    const cols = [["Operations", "operations"], ["Planning", "planning"], ["Logistics", "logistics"], ["Finance/Admin", "finance"]].map(([t, s]) => `<div class="col">${b(`${t} Section Chief`, pick(s, /^Chief$/))}
      ${rows.filter(r => r.section === s && r.role !== "Chief" && named(r)).map(r => `<div class="ind">${b(`${r.role}${r.label ? `: ${r.label}` : ""}`, [r])}</div>`).join("")}
      ${s === "operations" && rows.some(r => r.section === "air" && r.name) ? `<div class="ind">${b("Air Operations", rows.filter(r => r.section === "air" && r.name).map(r => ({ name: `${r.role}: ${r.name}` })))}</div>` : ""}</div>`).join("");
    return [{ landscape: true, html: `${head("INCIDENT ORGANIZATION CHART (ICS 207)", x.inc, x.p)}
      <div class="org" style="margin-top:10px">${b("Incident Commander(s)", pick("command", /^IC/))}
        <div class="row">${pick("command", /Safety|Public|Liaison|Deputy/).map(r => b(r.role, [r])).join("")}</div>
        <div class="cols">${cols}</div></div>
      <table class="f" style="margin-top:10px"><tr><td class="l" style="width:18%">ICS 207</td><td><span class="l">IAP Page</span> ${page}</td></tr></table>` }];
  },
  "208"(f, x, page) {
    const d = f.data;
    return [{ html: `${head("SAFETY MESSAGE/PLAN (ICS 208)", x.inc, x.p)}
      <table class="f" style="border-top:0"><tr><td><span class="l">3. Safety Message/Expanded Safety Message, Safety Plan, Site Safety Plan:</span><div style="min-height:6in;margin-top:6px">${nl(d.message)}</div></td></tr>
        <tr><td><span class="l">4. Site Safety Plan Required?</span> Yes ${chk(d.siteSafety?.required)} No ${chk(!d.siteSafety?.required)}<br><span class="l">Approved Site Safety Plan(s) Located At:</span> ${esc(d.siteSafety?.location)}</td></tr></table>
      ${foot("ICS 208", page, d.prepared, "5. Prepared by")}` }];
  },
  "211"(f, x, page) {
    const d = f.data;
    return [{ landscape: true, html: `${head("INCIDENT CHECK-IN LIST (ICS 211)", x.inc, x.p, `<td><span class="l">3. Check-In Location:</span><br>${esc(d.location)}</td>`)}
      ${rowsTable([{ key: "at", label: "Date/Time" }, { key: "agency", label: "Agency" }, { key: "kind", label: "Kind/Type" }, { key: "ident", label: "Resource Name or Identifier" }, { key: "orderNo", label: "Order Request #" },
        { key: "leader", label: "Leader's Name" }, { key: "persons", label: "Total # of Personnel" }, { key: "contact", label: "Contact Info" }, { key: "home", label: "Home Unit / Departure Point" },
        { key: "assignment", label: "Incident Assignment" }, { key: "notes", label: "Other Qualifications / Notes" }], (d.rows || []).map(r => ({ ...r, at: dt(r.at) })), 12)}
      ${foot("ICS 211", page, d.prepared, "Prepared by")}` }];
  },
  "213"(f, x, page) {
    const d = f.data;
    return [{ html: `<h1 class="form">GENERAL MESSAGE (ICS 213)</h1>
      <table class="f"><tr><td colspan="2"><span class="l">1. Incident Name (Optional):</span> ${esc(x.inc.name)}</td></tr>
        <tr><td style="width:60%"><span class="l">2. To (Name and Position):</span> ${esc(d.to?.name)} ${d.to?.position ? `(${esc(d.to.position)})` : ""}</td><td rowspan="2"><span class="l">5. Date/Time:</span> ${esc(dt(d.at))}</td></tr>
        <tr><td><span class="l">3. From (Name and Position):</span> ${esc(d.from?.name)} ${d.from?.position ? `(${esc(d.from.position)})` : ""}</td></tr>
        <tr><td colspan="2"><span class="l">4. Subject:</span> ${esc(d.subject)}</td></tr>
        <tr><td colspan="2"><span class="l">6. Message:</span><div style="min-height:3in">${nl(d.message)}</div></td></tr>
        <tr><td colspan="2"><span class="l">7. Approved by:</span> Name: ${esc(d.approved?.name)} &nbsp; Position/Title: ${esc(d.approved?.position)} &nbsp; Signature: ____________</td></tr>
        <tr><td colspan="2"><span class="l">8. Reply:</span><div style="min-height:2in">${nl(d.reply)}</div></td></tr>
        <tr><td colspan="2"><span class="l">9. Replied by:</span> Name: ${esc(d.replyBy?.name)} &nbsp; Position/Title: ${esc(d.replyBy?.position)} &nbsp; Date/Time: ${esc(dt(d.replyBy?.at))}</td></tr>
        <tr><td class="l">ICS 213</td><td><span class="l">IAP Page</span> ${page}</td></tr></table>` }];
  },
  "214"(f, x, page) {
    const d = f.data;
    return [{ html: `${head("ACTIVITY LOG (ICS 214)", x.inc, x.p)}
      <table class="f" style="border-top:0"><tr><td><span class="l">3. Name:</span> ${esc(d.name)}</td><td><span class="l">4. ICS Position:</span> ${esc(d.position)}</td><td><span class="l">5. Home Agency (and Unit):</span> ${esc(d.agency)}</td></tr>
        <tr><td colspan="3" class="l">6. Resources Assigned:</td></tr></table>
      ${rowsTable([{ key: "name", label: "Name" }, { key: "position", label: "ICS Position" }, { key: "agency", label: "Home Agency (and Unit)" }], d.resources, 4)}
      <table class="f" style="border-top:0"><tr><td class="l">7. Activity Log:</td></tr></table>
      ${rowsTable([{ key: "at", label: "Date/Time", w: "18%" }, { key: "text", label: "Notable Activities" }], (d.log || []).map(l => ({ ...l, at: dt(l.at) })), 14)}
      ${foot("ICS 214", page, d.prepared, "8. Prepared by")}` }];
  },
  "220"(f, x, page) {
    const d = f.data;
    return [{ landscape: true, html: `<h1 class="form">AIR OPERATIONS SUMMARY (ICS 220)</h1>
      <table class="f"><tr><td style="width:30%"><span class="l">1. Incident Name:</span> ${esc(x.inc.name)}</td><td><span class="l">2. Operational Period:</span> ${dt(x.p.starts)} to ${dt(x.p.ends)}</td>
        <td><span class="l">3. Sunrise:</span> ${esc(d.sunrise)} &nbsp; <span class="l">Sunset:</span> ${esc(d.sunset)}</td></tr>
        <tr><td colspan="3"><span class="l">4. Remarks</span> (safety notes, hazards, air operations special equipment, etc.):<br>${nl(d.remarks)}</td></tr>
        ${d.tfr ? `<tr><td colspan="3"><span class="l">TFR / medivac:</span> ${nl(d.tfr)}</td></tr>` : ""}</table>
      <table style="width:100%;border-collapse:collapse"><tr><td style="width:50%;vertical-align:top;padding:0">
        ${rowsTable([{ key: "position", label: "6. Personnel: Position" }, { key: "name", label: "Name" }, { key: "phone", label: "Phone" }], d.personnel, 4)}</td>
        <td style="vertical-align:top;padding:0">${rowsTable([{ key: "function", label: "7. Frequencies" }, { key: "rx", label: "RX" }, { key: "tx", label: "TX" }, { key: "tone", label: "Tone/NAC" }], d.frequencies, 4)}</td></tr></table>
      ${rowsTable([{ key: "tail", label: "8. Tail #" }, { key: "callSign", label: "Call Sign" }, { key: "type", label: "Type" }, { key: "makeModel", label: "Make/Model" }, { key: "base", label: "Base" },
        { key: "avail", label: "Available" }, { key: "stop", label: "Stop" }, { key: "remarks", label: "Remarks" }], d.aircraft, 4)}
      ${foot("ICS 220", page, d.prepared, "9. Prepared by")}` }];
  },
  weather(f, x, page) {
    const s = f.data.snapshot;
    const body = s ? `<div class="sub">National Weather Service${s.place ? `, near ${esc(s.place)}` : ""}${s.station ? `, station ${esc(s.station)}` : ""}. Retrieved ${esc(new Date(s.updatedAt).toLocaleString())}.</div>
      ${s.now ? `<p><b>Present conditions:</b> ${esc(s.now.text)} ${s.now.tempF ?? ""}°F, wind ${esc(s.now.windDir)} ${s.now.windMph ?? ""} mph${s.now.gustMph ? ` gusting ${s.now.gustMph}` : ""}, humidity ${s.now.humidity ?? "-"}%, visibility ${s.now.visibilityMi ?? "-"} mi.</p>` : ""}
      ${(s.alerts || []).map(a => `<p style="border:2px solid #000;padding:4px"><b>${esc(a.event)}</b>: ${esc(a.headline)}</p>`).join("")}
      <table class="f"><tr><th style="width:18%">Period</th><th style="width:10%">Temp</th><th style="width:16%">Wind</th><th style="width:9%">Precip</th><th>Forecast</th></tr>
        ${(s.periods || []).slice(0, 10).map(p => `<tr><td><b>${esc(p.name)}</b></td><td>${p.tempF}°F</td><td>${esc(p.wind)}</td><td>${p.pop || 0}%</td><td>${esc(p.detail || p.short)}</td></tr>`).join("")}</table>` : "<p>No forecast was added.</p>";
    return [{ html: `<h1 class="form">WEATHER FORECAST</h1>${head("", x.inc, x.p).replace('<h1 class="form"></h1>', "")}<div style="margin-top:8px">${body}</div>
      ${f.data.notes ? `<p><b>Notes:</b><br>${nl(f.data.notes)}</p>` : ""}
      <table class="f" style="margin-top:10px"><tr><td class="l" style="width:18%">Weather</td><td><span class="l">IAP Page</span> ${page}</td></tr></table>` }];
  },
  attachment(f, x, page) {
    const d = f.data;
    const file = (x.files || []).find(y => y.id === d.fileId);
    if (!file) return [];
    const imgs = /^image\//.test(file.mime) ? [file.id] : file.pages || [];
    if (!imgs.length) return [{ html: `<div class="att"><h2>${esc(d.title || file.name)}</h2><p>(${esc(file.name)}: printed separately.)</p><div class="sub">IAP Page ${page}</div></div>` }];
    return imgs.map((id, i) => ({ landscape: !!d.landscape, html: `<div class="att"><h2>${esc(d.title || file.name)}${imgs.length > 1 ? ` (${i + 1} of ${imgs.length})` : ""}</h2>
      <img src="${x.origin}/api/imt/files/${id}" alt=""><div class="sub" style="text-align:right">IAP Page ${page + i}</div></div>` }));
  },
};

export function iapHtml({ incident, period, forms, files, include }) {
  const x = { inc: incident, p: period, period, forms, files, kinds: forms.map(f => f.kind), origin: window.location.origin };
  const pages = [];
  let n = 1;
  for (const f of forms) {
    if (include && !include.includes(f.id)) continue;
    const r = R[f.kind];
    if (!r) continue;
    const out = r(f, x, f.kind === "cover" ? "" : n) || [];
    for (const pg of out) pages.push(pg);
    if (f.kind !== "cover") n += out.length;
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>IAP - ${esc(incident.name)} - Period ${period.seq}</title><style>${CSS}</style></head><body>
    ${pages.map(p => `<div class="page${p.landscape ? " land" : ""}">${p.html}</div>`).join("")}</body></html>`;
}

// Print in a hidden frame once the pictures have loaded
export function printIap(args) {
  const html = iapHtml(args);
  let frame = document.getElementById("imt-print-frame");
  if (frame) frame.remove();
  frame = document.createElement("iframe");
  frame.id = "imt-print-frame";
  Object.assign(frame.style, { position: "fixed", right: 0, bottom: 0, width: 0, height: 0, border: 0 });
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  const imgs = [...doc.images];
  const ready = Promise.race([Promise.all(imgs.map(im => (im.complete ? 1 : new Promise(r => { im.onload = im.onerror = r; })))), new Promise(r => setTimeout(r, 10000))]);
  return ready.then(() => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { /* blocked */ } return html; });
}
