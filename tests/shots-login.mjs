import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const errors = [];
for (const [name, w, h] of [["desktop", 1600, 900], ["phone", 390, 844]]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("http://localhost:3077/");
  await page.waitForTimeout(450);
  if (name === "desktop") await page.screenshot({ path: `/home/claude/testrun/shot-login-mid.png` });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `/home/claude/testrun/shot-login-${name}.png` });
  if (name === "desktop") {
    // jump the lightning animation to the strike frame to see the flash
    await page.evaluate(() => document.getAnimations().forEach(a => { if (a.animationName === "nx-strike") { a.pause(); a.currentTime = a.effect.getTiming().delay + a.effect.getTiming().duration * 0.034; } }));
    await page.waitForTimeout(100);
    await page.locator(".nx-hero").screenshot({ path: `/home/claude/testrun/shot-login-strike.png` });
  }
}
console.log("errors:", errors.join("; ") || "none");
await browser.close();
