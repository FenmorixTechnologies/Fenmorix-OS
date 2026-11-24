import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
const SCR = "/tmp/claude-0/-home-claude/936fcc05-20e3-5129-8bb4-925077c41c5a/scratchpad";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const p = await (await b.newContext()).newPage();
await p.goto("http://localhost:3077/");
// sign in to load images
await p.getByLabel(/^Email/).fill("paula@sgfd.org"); await p.getByLabel(/^Password/).fill("Correct horse battery");
await p.getByRole("button", { name: "Sign in" }).click(); await p.waitForTimeout(1500);
const fs = await import("node:fs");
await p.setContent(fs.readFileSync(`${SCR}/iap.html`, "utf8").replace(/http:\/\/localhost:3077/g, "http://localhost:3077"), { waitUntil: "load" });
await p.pdf({ path: `${SCR}/iap-test.pdf`, format: "Letter", printBackground: true, preferCSSPageSize: true });
await b.close();
