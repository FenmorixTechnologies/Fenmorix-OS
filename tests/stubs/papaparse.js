function parseText(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"' && text[i+1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i+1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c; }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x !== ""));
}
export default { parse(file, opts) { const r = new FileReader(); r.onload = () => { const rows = parseText(r.result); const h = rows.shift() || [];
  opts.complete({ data: rows.map(x => Object.fromEntries(h.map((k, i) => [k, x[i] ?? ""]))) }); }; r.readAsText(file); } };
