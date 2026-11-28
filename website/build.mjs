// Builds the website. Edit shell.html and parts/*, then run: node website/build.mjs
//  - index.html = shell.html with each <!--part:NAME--> replaced by parts/NAME and <!--schema--> by the JSON-LD below
//  - worker.js  = the deployed Cloudflare Worker; the inlined constants (HTML, NOTFOUND, OG) are rewritten in place,
//                 the routing code above/below them is edited by hand.
// Checks: every part placeholder filled, page has one <h1>, canonical, description and og:image; claims that the
// product doesn't support (see the SEO plan, section 3) fail the build.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const rd = f => fs.readFileSync(path.join(dir, f), "utf8");

const SITE = "https://fenmorix.com";
const schema = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": SITE + "/#org", name: "Fenmorix Technologies, LLC", alternateName: "Fenmorix", url: SITE + "/",
      logo: SITE + "/assets/logo.png", email: "michael@fenmorix.com",
      address: { "@type": "PostalAddress", addressLocality: "Baton Rouge", addressRegion: "LA", addressCountry: "US" } },
    { "@type": "WebSite", "@id": SITE + "/#site", name: "Fenmorix Technologies", url: SITE + "/", publisher: { "@id": SITE + "/#org" }, inLanguage: "en-US" },
    { "@type": "SoftwareApplication", "@id": SITE + "/#os", name: "Fenmorix OS", applicationCategory: "BusinessApplication", operatingSystem: "Web browser",
      description: "One system for messaging, schedules, purchasing, forms, training, emergency notification and reporting, for public safety agencies, governments, businesses and schools. Organizations switch on only the modules they need.",
      url: SITE + "/", publisher: { "@id": SITE + "/#org" } },
  ],
};

let html = rd("shell.html");
html = html.replace(/<!--part:([\w.-]+)-->/g, (_, f) => rd("parts/" + f).trim());
// Cloudflare Turnstile site key (public; widget "fenmorix.com feature ideas"). The secret lives only in the Worker's bindings.
const TURNSTILE_SITEKEY = "0x4AAAAAAGWMktYnw7EvzJNP";
html = html.replaceAll("__TURNSTILE_SITEKEY__", TURNSTILE_SITEKEY);
html = html.replace("<!--schema-->", `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script>`);
// Same light minifying the live page has always had: no indentation, no whole-line comments, no blank lines.
html = html.split("\n").map(l => l.trimStart()).filter(l => l && !/^\/\/( |$)/.test(l) && !/^\/\*.*\*\/$/.test(l)).join("\n");
const notFound = rd("404.html");

const problems = [];
if (/<!--part:/.test(html)) problems.push("a part placeholder was not filled");
if (/__[A-Z_]+__/.test(html)) problems.push("a __PLACEHOLDER__ was not filled: " + html.match(/__[A-Z_]+__/)[0]);
if ((html.match(/<h1[\s>]/g) || []).length !== 1) problems.push("index.html needs exactly one <h1>");
for (const need of ['rel="canonical"', 'name="description"', 'property="og:image"', "application/ld+json"])
  if (!html.includes(need)) problems.push("index.html is missing " + need);
// Wording the product doesn't support (SEO plan section 3). Lower-case match on the visible copy and scripts.
const BANNED = ["permission slip", "parent conference", "parent-teacher", "built for cjis", "cjis-certified", "cjis certified",
  "students are out", "one family", "class schedules for students", "sports physicals"];
for (const [name, text] of [["index.html", html], ["404.html", notFound]])
  for (const b of BANNED) if (text.toLowerCase().includes(b)) problems.push(`${name} says "${b}", which the product doesn't support`);
if (problems.length) { console.error("Build stopped:\n - " + problems.join("\n - ")); process.exit(1); }

fs.writeFileSync(path.join(dir, "index.html"), html);

let worker = rd("worker.js");
const setConst = (name, value) => {
  const line = `const ${name} = ${JSON.stringify(value)};`;
  const re = new RegExp(`^const ${name} = ".*";$`, "m");
  if (re.test(worker)) worker = worker.replace(re, () => line);
  else worker = worker.replace(/^const HTML = ".*";$/m, m => m + "\n" + line);
};
setConst("HTML", html);
setConst("NOTFOUND", notFound);
setConst("LASTMOD", new Date().toISOString().slice(0, 10));
setConst("OG", fs.readFileSync(path.join(dir, "assets/og.jpg")).toString("base64"));
fs.writeFileSync(path.join(dir, "worker.js"), worker);
console.log(`index.html ${html.length} bytes, worker.js ${worker.length} bytes`);
