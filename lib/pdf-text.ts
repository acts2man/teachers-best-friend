// Client-side PDF text extraction. Used as a fallback so a typed PDF can
// populate questions or answers even when the hosted AI service is not
// connected. Photographs and scanned PDFs have no text layer and still need
// the AI reader or manual entry.
const MAX_PAGES = 12;

export async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const document = await task.promise;
  const pages: string[] = [];
  try {
    for (let index = 1; index <= Math.min(document.numPages, MAX_PAGES); index++) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      let text = "";
      let lastY: number | null = null;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const y = item.transform[5] as number;
        if (lastY !== null && Math.abs(y - lastY) > 2 && !text.endsWith("\n"))
          text += "\n";
        else if (
          text &&
          !text.endsWith("\n") &&
          !text.endsWith(" ") &&
          item.str &&
          !item.str.startsWith(" ")
        )
          text += " ";
        text += item.str;
        if (item.hasEOL) text += "\n";
        lastY = y;
      }
      pages.push(text.trim());
    }
  } finally {
    await task.destroy();
  }
  return pages
    .filter(Boolean)
    .join("\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractUploadedPdfText(uploadId: string) {
  const response = await fetch("/api/uploads/" + uploadId);
  if (!response.ok) return "";
  if (!(response.headers.get("content-type") || "").includes("application/pdf"))
    return "";
  return extractPdfText(await response.arrayBuffer());
}
