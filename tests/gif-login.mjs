import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
await page.goto("http://localhost:3077/");
const t0 = Date.now(); let i = 0;
while (Date.now() - t0 < 7600) {
  await page.screenshot({ path: `/tmp/claude-0/-home-claude/936fcc05-20e3-5129-8bb4-925077c41c5a/scratchpad/frames/f${String(i++).padStart(3, "0")}.png`, clip: { x: 120, y: 90, width: 560, height: 600 } });
}
console.log("frames", i, "ms", Date.now() - t0);
await browser.close();
