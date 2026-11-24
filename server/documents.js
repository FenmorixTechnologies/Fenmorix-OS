// Reading uploaded documents for Procurement, Reimbursements and Help Desk.
//   POST /api/documents/autofill  { filename, data (base64), divisions, categories }
//        -> { fields } read from a requisition / invoice / quote (PDF, image, Excel, CSV, Word or text)
//   POST /api/documents/sheet     { filename, data (base64) } -> { sheets: [{ name, rows: [[...]] }] }
//        (CSV or .xlsx: used by the requisition and Spiceworks imports)
// Autofill needs ANTHROPIC_API_KEY in .env; the key never leaves the server.
import { readWorkbook, unzip } from "./xlsx.js";
import { parseCsv } from "./csv.js";
import { brand } from "./brand.js";

const MAX_BYTES = 15 * 1024 * 1024;
const err = (status, message) => Object.assign(new Error(message), { status });
const ext = name => (String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
const IMAGE = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

function decode(body) {
  const data = Buffer.from(String(body.data || "").replace(/^data:[^,]*,/, ""), "base64");
  if (!data.length) throw err(400, "That file is empty.");
  if (data.length > MAX_BYTES) throw err(413, "That file is over 15 MB.");
  return data;
}

// Spreadsheets: CSV or .xlsx (old .xls files have to be saved as .xlsx first)
export function readSheets(filename, data, maxRows = 5000) {
  const e = ext(filename);
  if (e === "csv" || e === "txt") return [{ name: "CSV", rows: parseCsv(data.toString("utf8")) }];
  if (e === "xls") throw err(415, "That's an older Excel (.xls) file. Open it in Excel, choose File > Save As > Excel Workbook (.xlsx), and upload that.");
  if (e === "xlsx" || e === "xlsm") {
    try { return readWorkbook(data, maxRows); }
    catch (x) { throw err(400, `Couldn't read that Excel file (${x.message}). Is it a real .xlsx file?`); }
  }
  throw err(415, "Choose a CSV or Excel (.xlsx) file.");
}

// Text out of a Word .docx (paragraphs and table cells)
function docxText(data) {
  let xml;
  try { xml = unzip(data).get("word/document.xml"); } catch { xml = null; }
  if (!xml) throw err(400, "Couldn't read that Word file. Is it a .docx? (Older .doc files: save as .docx or PDF first.)");
  return xml.toString("utf8")
    .replace(/<w:tab\/>/g, "\t").replace(/<\/w:tc>/g, "\t").replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n").trim();
}

// What Claude is shown: the PDF or picture itself, or the text of a spreadsheet / Word / text file
function contentFor(filename, data) {
  const e = ext(filename);
  if (e === "pdf") return { type: "document", source: { type: "base64", media_type: "application/pdf", data: data.toString("base64") } };
  if (IMAGE[e]) return { type: "image", source: { type: "base64", media_type: IMAGE[e], data: data.toString("base64") } };
  if (e === "heic" || e === "heif") throw err(415, "iPhone photos (HEIC) can't be read. Take a screenshot of it, or set the iPhone camera to \"Most Compatible\" (JPEG), and try again.");
  let text;
  if (["csv", "xlsx", "xlsm", "xls"].includes(e)) {
    text = readSheets(filename, data).map(s => `Sheet "${s.name}":\n` + s.rows.slice(0, 400).map(r => r.map(v => String(v ?? "")).join("\t")).join("\n")).join("\n\n");
  } else if (e === "docx") text = docxText(data);
  else if (e === "doc") throw err(415, "Older Word (.doc) files can't be read. Save it as .docx or PDF and try again.");
  else if (e === "txt") text = data.toString("utf8");
  else throw err(415, "Autofill reads PDF, pictures (JPG, PNG), Excel (.xlsx), CSV and Word (.docx) files.");
  text = text.slice(0, 120000);
  if (!text.trim()) throw err(400, "That file doesn't have any text in it.");
  return { type: "text", text: `Contents of the file "${filename}":\n\n${text}` };
}

const FREQ = ["monthly", "quarterly", "semiannually", "yearly", "one_time"];
const PAY = ["Check", "ACH", "Purchase order", "Credit card", "Cash", "Other"];
function prompt(divisions, categories) {
  return `This file is a purchase requisition, a vendor invoice or bill, or a quote for a fire department. Extract the purchasing details as JSON only (no markdown fences, no commentary), in exactly this shape:
{
  "division": "", "category": "", "vendor": "",
  "vendorPhone": "", "vendorFax": "", "vendorAddress": "", "vendorCity": "", "vendorState": "", "vendorZip": "", "vendorAccountNumber": "",
  "title": "", "description": "", "invoiceNumber": "", "date": "",
  "paymentMethod": "", "cardLast4": "", "cardholderName": "",
  "lineItems": [ { "description": "", "amount": 0, "frequency": "" } ]
}
Rules:
- division: the closest match from this list, or "" if none fits: ${divisions.join(", ")}
- category: the closest match from this list, or "" if none fits: ${categories.join(", ")}
- frequency for each line item: one of ${FREQ.join(", ")}. Recurring service plans are usually monthly or yearly; late fees, past-due balances and one-off charges are one_time.
- paymentMethod: one of ${PAY.join(", ")}, or "" if unclear.
- date: the invoice / requisition / quote date as YYYY-MM-DD, or "".
- title: a short (4-8 word) description of what's being bought.
- Each distinct charge is its own line item (not one combined total). Amounts are plain numbers.
- If a spreadsheet lists many separate purchases, describe only the first one and put "MULTIPLE" in invoiceNumber.
- Anything not in the file: "" (or [] / 0). Never make anything up.`;
}

// Ask Claude (Anthropic API) for JSON. content = message content blocks. Errors are plain-language.
export async function askClaude(content, { maxTokens = 2000, what = "The assistant", noKey, notFound, fail, json = true, timeoutMs = 120_000 } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw err(503, noKey || `${what} isn't turned on for ${brand().productName} yet (the server needs an ANTHROPIC_API_KEY in .env).`);
  let upstream, out;
  const model = process.env.AI_MODEL || "claude-sonnet-4-6";
  try {
    upstream = await fetch(`${process.env.AI_API_BASE || "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01",
        // Keys made outside a Claude Console workspace need the workspace named on every request
        ...(String(process.env.ANTHROPIC_WORKSPACE_ID || "").trim() ? { "anthropic-workspace-id": String(process.env.ANTHROPIC_WORKSPACE_ID).trim() } : {}),
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    out = await upstream.json().catch(() => ({}));
  } catch (x) {
    throw err(502, `Couldn't reach the assistant (${x.name === "TimeoutError" ? "it took too long" : x.message}). Check the server's internet access.`);
  }
  if (!upstream.ok) {
    const m = out?.error?.message || `error ${upstream.status}`;
    console.warn(`[${what}] ${upstream.status}: ${m}`);
    const why = upstream.status === 401 ? "the API key in .env isn't valid"
      : upstream.status === 404 && /model/i.test(m) ? `the model "${model}" isn't available; set AI_MODEL in .env`
      : /workspace/i.test(m) ? "the API key isn't tied to a workspace. In System > Server settings, set ANTHROPIC_WORKSPACE_ID to the workspace ID from the Claude Console (or use a key made inside a workspace), then restart"
      : upstream.status === 429 ?"too many requests right now; try again in a minute"
      : upstream.status === 413 || /too large|too long/i.test(m) ? "the file is too big for it; try a smaller PDF"
      : m;
    throw err(502, `${fail || `${what} couldn't do that`}: ${why}.`);
  }
  const text = (out.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  if (!json) return text.trim();
  try {
    const t = text.replace(/```json|```/g, "").trim();
    return JSON.parse(t.slice(t.search(/[\[{]/)));
  } catch { throw err(502, notFound || `${what} didn't return anything usable. Try again.`); }
}
export const pdfOrImageContent = contentFor;

export async function handleDocuments(req, res, parts, user, send, jsonBody) {
  const what = parts[2];
  if (req.method !== "POST") throw err(404, "Not found");
  const body = await jsonBody(req);
  const data = decode(body);
  if (what === "sheet") return send(res, 200, { sheets: readSheets(body.filename, data) });
  if (what !== "autofill") throw err(404, "Not found");

  const divisions = (Array.isArray(body.divisions) ? body.divisions : []).map(String).slice(0, 60);
  const categories = (Array.isArray(body.categories) ? body.categories : []).map(String).slice(0, 60);
  const content = contentFor(body.filename, data);
  const fields = await askClaude([content, { type: "text", text: prompt(divisions, categories) }], { maxTokens: 1500, what: "Autofill",
    noKey: "Autofill isn't turned on for " + brand().productName + " yet (the server needs an ANTHROPIC_API_KEY in .env). Enter the details by hand, and attach the file to the requisition after you submit it.",
    notFound: "Autofill didn't find requisition details in that file. Enter them by hand.", fail: "Autofill couldn't read that file" });
  return send(res, 200, { fields });
}
