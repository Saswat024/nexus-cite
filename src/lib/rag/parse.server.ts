import { unzipSync, strFromU8 } from "fflate";

export type Block = {
  text: string;
  page: number;
  heading: string | null;
};

const HEADING_MAX_LEN = 120;

function looksLikeHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > HEADING_MAX_LEN) return false;
  if (/^(\d+(\.\d+)*)[.)]?\s+[A-Z]/.test(t)) return true; // 2.1 Something
  if (/^(abstract|introduction|background|related work|method(s|ology)?|experiments?|results?|discussion|conclusions?|references|appendix|chapter\s+\d+)\b/i.test(t))
    return true;
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length > 3 && letters === letters.toUpperCase() && t.split(/\s+/).length <= 10) return true;
  return false;
}

/** Extract page-tagged blocks from a PDF, preserving page numbers and section headings. */
export async function parsePdf(bytes: Uint8Array): Promise<{ blocks: Block[]; pageCount: number }> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [String(text)];

  const blocks: Block[] = [];
  let heading: string | null = null;

  pages.forEach((pageText, i) => {
    const page = i + 1;
    const lines = String(pageText ?? "").split(/\n+/);
    let buffer: string[] = [];

    const flush = () => {
      const body = buffer.join(" ").replace(/\s+/g, " ").trim();
      if (body) blocks.push({ text: body, page, heading });
      buffer = [];
    };

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (looksLikeHeading(line)) {
        flush();
        heading = line;
      } else {
        buffer.push(line);
      }
    }
    flush();
  });

  return { blocks, pageCount: pages.length };
}

/** Extract blocks from a DOCX by reading word/document.xml directly (worker-safe, no native deps). */
export function parseDocx(bytes: Uint8Array): { blocks: Block[]; pageCount: number } {
  const files = unzipSync(bytes);
  const entry = files["word/document.xml"];
  if (!entry) throw new Error("Not a readable DOCX file");
  const xml = strFromU8(entry);

  const paragraphs = xml.split(/<w:p[ >]/).slice(1);
  const blocks: Block[] = [];
  let heading: string | null = null;
  // DOCX has no reliable page numbers; approximate ~2500 chars per page.
  let charCount = 0;

  for (const p of paragraphs) {
    const styleMatch = p.match(/<w:pStyle[^>]*w:val="([^"]+)"/);
    const style = styleMatch?.[1] ?? "";
    const text = (p.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? [])
      .map((t) => t.replace(/<[^>]+>/g, ""))
      .join("")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;

    if (/^heading/i.test(style) || /^title$/i.test(style) || looksLikeHeading(text)) {
      heading = text;
      continue;
    }
    charCount += text.length;
    blocks.push({ text, page: Math.floor(charCount / 2500) + 1, heading });
  }

  return { blocks, pageCount: Math.max(1, Math.floor(charCount / 2500) + 1) };
}

export async function parseDocument(
  filename: string,
  bytes: Uint8Array,
): Promise<{ blocks: Block[]; pageCount: number }> {
  if (/\.pdf$/i.test(filename)) return parsePdf(bytes);
  if (/\.docx$/i.test(filename)) return parseDocx(bytes);
  throw new Error("Unsupported file type. Upload a PDF or DOCX.");
}
