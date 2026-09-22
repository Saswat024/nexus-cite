import type { Block } from "./parse.server";

export type Chunk = {
  content: string;
  page_number: number;
  section_heading: string | null;
  chunk_index: number;
  flagged_injection: boolean;
};

const TARGET_CHARS = 1400;
const MIN_CHARS = 250;

/**
 * Prompt-injection defense applied at ingestion time: instruction-like text found
 * inside a document is neutralised (and flagged) before it can reach the context window.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |any )?(the )?(previous|prior|above|earlier) (instructions?|prompts?|rules?)/gi,
  /disregard (all |any )?(the )?(previous|prior|above) (instructions?|context)/gi,
  /you are (now )?(a|an) [^.\n]{0,60}(assistant|ai|model)/gi,
  /(system|developer)\s*(prompt|message)\s*:/gi,
  /<\s*\/?\s*(system|assistant|user)\s*>/gi,
  /\bBEGIN\s+SYSTEM\b|\bEND\s+SYSTEM\b/gi,
  /reveal (your|the) (system )?(prompt|instructions?)/gi,
  /do not (cite|mention|follow)[^.\n]{0,60}(instructions?|sources?|context)/gi,
  /act as (if you are )?[^.\n]{0,40}(unrestricted|jailbroken|dan)\b/gi,
];

export function sanitizeText(text: string): { text: string; flagged: boolean } {
  let flagged = false;
  let out = text;
  for (const pattern of INJECTION_PATTERNS) {
    out = out.replace(pattern, (match) => {
      flagged = true;
      return `[redacted instruction-like text: ${match.length} chars]`;
    });
  }
  return { text: out, flagged };
}

/**
 * Section-aware chunking: blocks are grouped along their natural section boundaries
 * and only split further when a section exceeds the target size.
 */
export function chunkBlocks(blocks: Block[]): Chunk[] {
  const chunks: Chunk[] = [];
  let index = 0;

  let current: { heading: string | null; page: number; parts: string[]; length: number } | null = null;

  const flush = () => {
    if (!current) return;
    const raw = current.parts.join("\n\n").trim();
    if (raw) {
      const { text, flagged } = sanitizeText(raw);
      chunks.push({
        content: text,
        page_number: current.page,
        section_heading: current.heading,
        chunk_index: index++,
        flagged_injection: flagged,
      });
    }
    current = null;
  };

  for (const block of blocks) {
    if (!current || current.heading !== block.heading) {
      if (current && current.length >= MIN_CHARS) flush();
      else if (current) {
        // tiny trailing section: keep accumulating under the new heading
        current.heading = block.heading;
      }
    }
    if (!current) current = { heading: block.heading, page: block.page, parts: [], length: 0 };

    const sentences = block.text.match(/[^.!?]+[.!?]*\s*/g) ?? [block.text];
    for (const sentence of sentences) {
      if (current.length + sentence.length > TARGET_CHARS && current.length >= MIN_CHARS) {
        const heading: string | null = current.heading;
        flush();
        current = { heading, page: block.page, parts: [], length: 0 };
      }
      current.parts.push(sentence.trim());
      current.length += sentence.length;
    }
  }
  flush();

  return chunks.filter((c) => c.content.length > 40);
}
