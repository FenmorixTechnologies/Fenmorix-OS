// Small Excel (.xlsx) writer and reader, no extra packages.
//
// Writer: workbook({ sheets: [{ name, rows, cols, merges, landscape, fitWidth, freeze }] }) -> Buffer
//   rows: arrays of cells; a cell is null, a string/number, or { v, s, date } where
//   s is a style name (see STYLES) and date: true turns "YYYY-MM-DD" into an Excel date.
//   cols: column widths (characters). merges: ["A1:D1", ...].
// Reader: readWorkbook(buffer) -> [{ name, rows: [[value, ...], ...] }] (first 3,000 rows of each sheet).
import zlib from "node:zlib";

// ---- ZIP (stored for writing; stored + deflate for reading) ------------------------------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

export function zip(files) {        // files: [{ name, data: Buffer }]
  const locals = [], centrals = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8"), data = f.data, crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt32LE(0, 10); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt32LE(0, 12); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

export function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw Object.assign(new Error("That isn't an Excel (.xlsx) file."), { status: 400 });
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString("utf8");
    p += 46 + nlen + xlen + clen;
    const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
    const raw = buf.slice(start, start + csize);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, zlib.inflateRawSync(raw, { maxOutputLength: 200 * 1024 * 1024 }));
  }
  return out;
}

// ---- Writer ---------------------------------------------------------------------------------
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
export const colName = i => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

// fonts: 0 normal, 1 bold, 2 bold white, 3 small grey, 4 big bold
// fills: 0 none, 1 gray125 (required), 2 light grey, 3 navy, 4 light red, 5 light blue, 6 light amber
// borders: 0 none, 1 thin all
const STYLE_LIST = [
  ["default", 0, 0, 0, 0, null],
  ["bold", 1, 0, 0, 0, null],
  ["cell", 0, 0, 1, 0, null],
  ["cellBold", 1, 0, 1, 0, null],
  ["head", 1, 2, 1, 0, "center"],
  ["navy", 2, 3, 1, 0, "center"],
  ["date", 0, 0, 1, 14, "center"],
  ["center", 0, 0, 1, 0, "center"],
  ["bumped", 1, 4, 1, 0, "center"],
  ["blue", 0, 5, 1, 0, "center"],
  ["amber", 0, 6, 1, 0, "center"],
  ["note", 3, 0, 0, 0, null],
  ["title", 4, 0, 0, 0, null],
  ["headLeft", 1, 2, 1, 0, null],
  ["countBold", 1, 2, 1, 0, "center"],
];
const STYLES = Object.fromEntries(STYLE_LIST.map((s, i) => [s[0], i]));
function stylesXml() {
  const xf = STYLE_LIST.map(([, font, fill, border, numFmt, align]) =>
    `<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="${border}" applyFont="1" applyFill="1" applyBorder="1"${numFmt ? ' applyNumberFormat="1"' : ""}${align ? ` applyAlignment="1"><alignment horizontal="${align}" vertical="center" wrapText="1"/></xf>` : '><alignment vertical="center"/></xf>'}`).join("");
  const fill = rgb => `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="5"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><sz val="8"/><color rgb="FF666666"/><name val="Arial"/></font><font><b/><sz val="14"/><name val="Arial"/></font></fonts>
<fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fill("E7E9EE")}${fill("13233F")}${fill("F8C9CF")}${fill("D7E6F7")}${fill("FBE7C6")}</fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF999999"/></left><right style="thin"><color rgb="FF999999"/></right><top style="thin"><color rgb="FF999999"/></top><bottom style="thin"><color rgb="FF999999"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${STYLE_LIST.length}">${xf}</cellXfs>
</styleSheet>`;
}
const excelDate = iso => { const [y, m, d] = iso.split("-").map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); };

function sheetXml(sh) {
  const rows = sh.rows.map((row, r) => {
    const cells = (row || []).map((cell, c) => {
      if (cell === null || cell === undefined) return "";
      const o = typeof cell === "object" ? cell : { v: cell };
      const ref = colName(c) + (r + 1);
      const s = STYLES[o.s || (o.date ? "date" : "default")] || 0;
      if (o.v === null || o.v === undefined || o.v === "") return s ? `<c r="${ref}" s="${s}"/>` : "";
      if (o.date && /^\d{4}-\d{2}-\d{2}$/.test(o.v)) return `<c r="${ref}" s="${s}"><v>${excelDate(o.v)}</v></c>`;
      if (typeof o.v === "number" && isFinite(o.v)) return `<c r="${ref}" s="${s}"><v>${o.v}</v></c>`;
      return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(o.v)}</t></is></c>`;
    }).join("");
    const ht = sh.heights?.[r] ? ` ht="${sh.heights[r]}" customHeight="1"` : "";
    return `<row r="${r + 1}"${ht}>${cells}</row>`;
  }).join("");
  const cols = sh.cols?.length ? `<cols>${sh.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
  const merges = sh.merges?.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map(m => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "";
  const pane = sh.freeze ? `<sheetViews><sheetView workbookViewId="0"><pane xSplit="${sh.freeze[0]}" ySplit="${sh.freeze[1]}" topLeftCell="${colName(sh.freeze[0])}${sh.freeze[1] + 1}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>` : "";
  const fit = sh.fitWidth ? `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${fit}${pane}${cols}<sheetData>${rows}</sheetData>${merges}<pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup orientation="${sh.landscape ? "landscape" : "portrait"}"${sh.fitWidth ? ' fitToWidth="1" fitToHeight="0"' : ""}/></worksheet>`;
}

export function workbook({ sheets }) {
  const used = new Set();
  const names = sheets.map(s => {
    let n = String(s.name || "Sheet").replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || "Sheet", k = 2;
    while (used.has(n.toLowerCase())) n = `${n.slice(0, 27)} (${k++})`;
    used.add(n.toLowerCase()); return n;
  });
  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: stylesXml() },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];
  return zip(files.map(f => ({ name: f.name, data: Buffer.from(f.data, "utf8") })));
}

// ---- Reader ---------------------------------------------------------------------------------
const unxml = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");
const colIndex = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
export const fromExcelDate = n => new Date(Date.UTC(1899, 11, 30) + Math.round(Number(n)) * 86400000).toISOString().slice(0, 10);
// Date and time: "YYYY-MM-DD HH:MM:SS" (to the nearest second, no time zone)
export const fromExcelDateTime = n => new Date(Date.UTC(1899, 11, 30) + Math.round(Number(n) * 86400) * 1000).toISOString().slice(0, 19).replace("T", " ");

export function readWorkbook(buf, maxRows = 3000) {
  const files = unzip(buf);
  // Some exporters (FireWorks, .NET Open XML SDK) write prefixed tags (<x:row>) and absolute part paths (/xl/...)
  const text = name => (files.get(name) || files.get(`/${name}`))?.toString("utf8").replace(/<(\/?)[A-Za-z][\w-]*:(?=[A-Za-z])/g, "<$1") || "";
  const shared = [];
  for (const si of text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    shared.push(unxml([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join("")));
  }
  // Which number formats are dates
  const styles = text("xl/styles.xml");
  const fmtCode = new Map([...styles.matchAll(/<numFmt numFmtId="(\d+)" formatCode="([^"]*)"/g)].map(m => [+m[1], m[2].replace(/\[[^\]]*\]|"[^"]*"/g, "")]));
  const customDate = new Set([...fmtCode].filter(([, c]) => /[dy]/i.test(c) || /m.*[dy]|[dy].*m/i.test(c)).map(([id]) => id));
  const customTime = new Set([...fmtCode].filter(([, c]) => /h/i.test(c)).map(([id]) => id));
  const xfs = [...(styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] || "").matchAll(/<xf [^>]*numFmtId="(\d+)"/g)].map(m => +m[1]);
  const isDateStyle = s => { const f = xfs[s]; return f !== undefined && ((f >= 14 && f <= 22) || (f >= 45 && f <= 47) || customDate.has(f) || customTime.has(f)); };
  const hasTime = s => { const f = xfs[s]; return f === 22 || (f >= 18 && f <= 21) || (f >= 45 && f <= 47) || customTime.has(f); };
  // Attributes can come in any order (Id before or after Target)
  const rels = Object.fromEntries([...text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b([^>]*)>/g)]
    .map(m => [m[1].match(/\bId="([^"]+)"/)?.[1], m[1].match(/\bTarget="([^"]+)"/)?.[1]]).filter(([k, v]) => k && v));
  const sheets = [];
  for (const sm of text("xl/workbook.xml").matchAll(/<sheet\b([^>]*)>/g)) {
    const m = [null, sm[1].match(/\bname="([^"]*)"/)?.[1] || "Sheet", sm[1].match(/\br:id="([^"]+)"/)?.[1]];
    const target = (rels[m[2]] || "").replace(/^\/?xl\//, "").replace(/^\//, "");
    const xml = text(`xl/${target}`);
    const rows = [];
    for (const rm of xml.matchAll(/<row [^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>|<row [^>]*r="(\d+)"[^>]*\/>/g)) {
      const r = +(rm[1] || rm[3]) - 1;
      if (r >= maxRows) break;
      const row = [];
      for (const cm of (rm[2] || "").matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[2], body = cm[3] || "";
        const t = attrs.match(/t="(\w+)"/)?.[1], s = +(attrs.match(/s="(\d+)"/)?.[1] || 0);
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let val = null;
        if (t === "s") val = shared[+v] ?? null;
        else if (t === "inlineStr") val = unxml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(""));
        else if (t === "str") val = v !== undefined ? unxml(v) : null;
        else if (t === "b") val = v === "1";
        else if (v !== undefined) {
          if (!isDateStyle(s)) val = Number(v);
          else if (hasTime(s) && Number(v) < 1) val = fromExcelDateTime(v).slice(11);                // time of day only
          else if (hasTime(s) || Math.abs(Number(v) % 1) > 1e-9) val = fromExcelDateTime(v);
          else val = fromExcelDate(v);
        }
        row[colIndex(cm[1])] = val;
      }
      rows[r] = row;
    }
    sheets.push({ name: unxml(m[1]), rows: Array.from(rows, r => r || []) });
  }
  return sheets;
}
