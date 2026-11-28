// Sample quote and spec sheet PDFs from the current price book and print code (vendor-only tool, never shipped).
// Usage: node tools/sales/make-samples.mjs <out dir>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import { DEFAULT_BOOK as B, calculate } from "../../src/pricing.js";
import { quoteHtml, specHtml, setLogo } from "../../src/SalesPrint.js";
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.join(HERE, "../..");
const OUT = process.argv[2] || ".";
setLogo("data:image/png;base64," + fs.readFileSync(path.join(ROOT, "public/brand-fenmorix/vendor-logo.png")).toString("base64"));
const today = new Date().toISOString().slice(0, 10), valid = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
const quote = (number, title, inputs, client) => ({ number, title, inputs, result: calculate(inputs, B), book: B, createdAt: today, validUntil: valid, notes: "", internalNotes: "", client });
const docs = [
  ["Sample quote - Riverbend Fire District.pdf", quoteHtml(quote("Q-2026-0001", "Command for Riverbend Fire District",
    { segment: "ps", edition: "command", users: 85, termYears: 3, founding: true, cadKind: "new", cadVendor: "CentralSquare Enterprise CAD", dr: "enhanced",
      currentSpend: [{ label: "Aladtec (staff scheduling)", annual: 6885 }, { label: "Vector Solutions LMS (training records)", annual: 9775 }, { label: "PSTrax", annual: 9950 }, { label: "Active911", annual: 1415 }, { label: "Tablet Command", annual: 31000 }] }),
    { name: "Riverbend Fire District", city: "Riverbend", state: "LA", contacts: [{ name: "Dana Chief", title: "Fire Chief", email: "dana@riverbend.example", primary: true }] }, {})],
  ["Sample quote - Riverbend Elementary.pdf", quoteHtml(quote("Q-2026-0002", "Classroom for Riverbend Elementary",
    { segment: "edu", edition: "classroom", users: 45, termYears: 3, audienceMode: "flat", audienceCount: 480,
      currentSpend: [{ label: "Gradelink SIS (grades and parent portal)", annual: 1272 }, { label: "Raptor emergency management + badge alert, per campus", annual: 5800 }, { label: "Jotform (forms)", annual: 1188 }] }),
    { name: "Riverbend Elementary School", city: "Riverbend", state: "LA", contacts: [{ name: "Pat Principal", title: "Principal", email: "principal@riverbend-elem.example", primary: true }] }, {})],
  ["Spec sheet - Command edition.pdf", specHtml(B, "ps", "command", { prices: false })],
  ["Spec sheet - Command with prices.pdf", specHtml(B, "ps", "command", { prices: true })],
  ["Spec sheet - School Classroom with prices.pdf", specHtml(B, "edu", "classroom", { prices: true })],
  ["Spec sheet - School Campus with prices.pdf", specHtml(B, "edu", "campus", { prices: true })],
];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
for (const [name, html] of docs) {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.pdf({ path: path.join(OUT, name), format: "Letter", printBackground: true, preferCSSPageSize: true });
  await page.close(); console.log("wrote", name);
}
await browser.close();
