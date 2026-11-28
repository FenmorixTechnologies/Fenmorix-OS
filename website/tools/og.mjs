// Renders assets/og.jpg (1200x630 share card) from the brand wordmark. Run: node tools/og.mjs
import { createRequire } from "node:module"; const { chromium } = createRequire(import.meta.url)("playwright");
import fs from "node:fs";
const wm = fs.readFileSync(new URL("../assets/fenmorix-wordmark.webp", import.meta.url)).toString("base64");
const html = `<!doctype html><html><head><style>
html,body{margin:0;width:1200px;height:630px;background:#08131D;overflow:hidden}
body{display:flex;flex-direction:column;justify-content:center;padding:0 96px;box-sizing:border-box;
 background:radial-gradient(900px 520px at 100% 100%,rgba(255,121,0,.28),transparent 60%),radial-gradient(700px 420px at 0% 0%,rgba(85,207,255,.14),transparent 60%),#08131D}
img{width:560px;margin-bottom:44px}
h1{font:700 62px/1.05 "Fira Sans",sans-serif;letter-spacing:-.5px;color:#fff;margin:0;max-width:960px}
p{font:400 28px/1.4 "Fira Sans",sans-serif;color:#C5CAD0;margin:22px 0 0;max-width:900px}
.bar{position:absolute;left:96px;bottom:64px;width:120px;height:6px;background:#FF7900;border-radius:3px}
</style></head><body><img src="data:image/webp;base64,${wm}" alt=""><h1>One system to run the whole organization</h1>
<p>Public safety, government, business and schools. Switch on only the modules you need.</p><div class="bar"></div></body></html>`;
const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1200, height: 630 } });
await pg.setContent(html, { waitUntil: "networkidle" }).catch(() => pg.setContent(html));
await pg.waitForTimeout(500);
await pg.screenshot({ path: new URL("../assets/og.jpg", import.meta.url).pathname, type: "jpeg", quality: 88 });
await b.close();
