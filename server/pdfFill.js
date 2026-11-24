// Fill an official fillable PDF (e.g. LWC-WC-1007) from a form submission.
// settings.pdf = { template: "file.pdf", map: [{ pdf: "<PDF field name>", from: "<form field key>", as?, value? }] }
//   as: text (default) | mdy | time12 | am | pm | area | local | ssn1 | ssn2 | ssn3 | address | check (value)
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

const DIR = path.join(import.meta.dirname, "pdf-templates");

function convert(as, v, want) {
  if (v === undefined || v === null || v === "") return as === "check" ? false : "";
  const s = String(v);
  const digits = s.replace(/\D/g, "");
  switch (as) {
    case "mdy": { const [y, m, d] = s.split("-"); return m && d ? `${m}/${d}/${y.slice(2)}` : s; }
    case "time12": { const [h, m] = s.split(":").map(Number); if (isNaN(h)) return s; return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}`; }
    case "am": return Number(s.split(":")[0]) < 12;
    case "pm": return Number(s.split(":")[0]) >= 12;
    case "area": return digits.length >= 10 ? digits.slice(-10, -7) : "";
    case "local": return digits.length >= 7 ? `${digits.slice(-7, -4)}-${digits.slice(-4)}` : s;
    case "ssn1": return digits.slice(0, 3);
    case "ssn2": return digits.slice(3, 5);
    case "ssn3": return digits.slice(5, 9);
    case "address":
      if (typeof v === "object") return [v.street, [v.city, v.state].filter(Boolean).join(", ") + (v.zip ? ` ${v.zip}` : "")].filter(x => x && x.trim()).join("\n");
      return s;
    case "check": return Array.isArray(v) ? v.includes(want) : s === want;
    default:
      if (Array.isArray(v)) return v.join(", ");
      if (typeof v === "object") return convert("address", v);
      return s;
  }
}

export async function fillPdf(cfg, data) {
  const file = path.join(DIR, path.basename(cfg.template));
  const doc = await PDFDocument.load(await fs.readFile(file));
  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const m of cfg.map || []) {
    let field;
    try { field = form.getField(m.pdf); } catch { continue; }
    const v = convert(m.as || "text", data[m.from], m.value);
    const kind = field.constructor.name;
    if (kind === "PDFCheckBox") { if (v === true) field.check(); else field.uncheck(); continue; }
    if (kind === "PDFTextField") {
      let text = String(v ?? "");
      const max = field.getMaxLength();
      if (max && text.length > max) text = text.slice(0, max);
      if (text.includes("\n")) { try { field.enableMultiline(); } catch { /* fine */ } }
      field.setText(text);
      // Shrink long single-line text so it fits its box instead of being cut off
      if (text && !field.isMultiline()) {
        const rect = field.acroField.getWidgets()[0]?.getRectangle();
        const da = field.acroField.getDefaultAppearance() || "";
        let size = Number((da.match(/([\d.]+)\s+Tf/) || [])[1]) || 10;
        if (rect && size > 0) {
          while (size > 5 && font.widthOfTextAtSize(text, size) > rect.width - 4) size -= 0.5;
          field.setFontSize(size);
        }
      }
    }
  }
  // Lock the answers into the page so they print the same everywhere
  form.updateFieldAppearances(font);
  form.flatten();
  return doc.save();
}
