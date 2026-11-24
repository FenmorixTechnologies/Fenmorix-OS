#!/usr/bin/env node
// Stands in for whisper-cli: writes <-of>.txt for each -f, text depends on the clip number
import fs from "node:fs";
const a = process.argv.slice(2);
const files = [], outs = [];
for (let i = 0; i < a.length; i++) { if (a[i] === "-f") files.push(a[++i]); else if (a[i] === "-of") outs.push(a[++i]); }
if (!a.includes("-otxt") || !a.includes("-m") || !a.includes("--prompt")) { console.error("missing args"); process.exit(2); }
fs.appendFileSync("/home/claude/testrun/fake-whisper.log", `${files.length} files\n`);
const lines = ["Engine 61 on scene, two-story residential, smoke showing from the Alpha side, establishing command.", "[BLANK_AUDIO]",
  "Copy Engine 61, command established at 1402.", "Ladder 18 en route.", "Thank you.", "Primary search all clear."];
files.forEach((f, i) => {
  if (!fs.existsSync(f)) { console.error("no file " + f); process.exit(3); }
  if (/voice-\d+\.wav$/.test(f)) { fs.writeFileSync(`${outs[i]}.txt`, fs.existsSync("/home/claude/testrun/fake-voice.txt") ? fs.readFileSync("/home/claude/testrun/fake-voice.txt", "utf8") : "Command copies.\n"); return; }
  const n = Number(f.match(/(\d+)\.wav$/)[1]);
  fs.writeFileSync(`${outs[i]}.txt`, ` ${lines[n % lines.length]}\n`);
});
