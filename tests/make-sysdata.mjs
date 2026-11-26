// Fixtures for e2e51 / e2e53 (System page): release zips good / bad. Run: node make-sysdata.mjs  (writes /home/claude/testrun/sysdata)
import fs from "node:fs";
import { zip } from "/home/claude/testrun/app/server/xlsx.js";
const D = "/home/claude/testrun/sysdata"; fs.mkdirSync(D, { recursive: true });
const f = (name, t) => ({ name, data: Buffer.from(t) });
const base = [f("app/package.json", '{"name":"sgfd-app"}'), f("app/server/index.js", "// sample"), f("app/src/main.jsx", "// sample"), f("app/scripts/update.ps1", "# sample")];
fs.writeFileSync(`${D}/good.zip`, zip([...base, f("app/VERSION.json", JSON.stringify({ version: "2099.01.01", notes: ["Sample release note"] })), f("app/db/migrations/999_sample.sql", "SELECT 1;")]));
fs.writeFileSync(`${D}/env.zip`, zip([...base, f("app/.env", "PGPASSWORD=x")]));
fs.writeFileSync(`${D}/escape.zip`, zip([...base, f("app/../evil.js", "x")]));
fs.writeFileSync(`${D}/other.zip`, zip([f("readme.txt", "x")]));
console.log("sysdata zips made");
