// PDF pages -> JPEG pictures in the browser (pdf.js), so maps and other PDF attachments print inside the IAP.
// pdf.js is loaded at run time from the server (/vendor/pdfjs/, served from node_modules/pdfjs-dist), not bundled.
const LIB = "/vendor/pdfjs/pdf.min.mjs", WORKER = "/vendor/pdfjs/pdf.worker.min.mjs";
export async function pdfToImages(file, { scale = 1.7, maxPages = 40, onPage } = {}) {
  const pdfjs = await import(/* @vite-ignore */ LIB);
  pdfjs.GlobalWorkerOptions.workerSrc = WORKER;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const pages = [];
  const n = Math.min(doc.numPages, maxPages);
  for (let i = 1; i <= n; i++) {
    onPage?.(i, n);
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    pages.push(canvas.toDataURL("image/jpeg", 0.85).split(",")[1]);
  }
  return { pages, total: doc.numPages };
}
