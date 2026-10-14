// packages/core/src/resume/extractText.ts  - PDF/DOCX -> plain text (all local, MIT/Apache libs)
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import mammoth from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function extractResumeText(path: string): Promise<{ text: string; needsOcr: boolean }> {
  const ext = extname(path).toLowerCase();
  const buf = await readFile(path);

  if (ext === ".docx") {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return { text: value.trim(), needsOcr: false };
  }
  if (ext === ".pdf") {
    const doc = await getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      let line = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += item.str + (item.hasEOL ? "\n" : " ");
      }
      pages.push(line);
    }
    const text = pages.join("\n").replace(/[ \t]+\n/g, "\n").trim();
    return { text, needsOcr: text.length < 200 };     // scanned PDF -> run tesseract.js fallback
  }
  if (ext === ".txt" || ext === ".md") return { text: buf.toString("utf8"), needsOcr: false };
  throw new Error(`Unsupported resume format: ${ext}`);
}
