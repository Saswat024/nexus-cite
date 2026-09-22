const HF_MODEL = "sentence-transformers/all-MiniLM-L6-v2";
const HF_URL = `https://router.huggingface.co/hf-inference/models/${HF_MODEL}/pipeline/feature-extraction`;

export const DENSE_DIM = 384;

function meanPool(value: number[] | number[][]): number[] {
  if (typeof value[0] === "number") return value as number[];
  const tokens = value as number[][];
  const dim = tokens[0]!.length;
  const out = new Array<number>(dim).fill(0);
  for (const t of tokens) for (let i = 0; i < dim; i++) out[i] += t[i]!;
  return out.map((v) => v / tokens.length);
}

function normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

/** Embed texts with all-MiniLM-L6-v2 through the Hugging Face inference API. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const key = process.env["HUGGINGFACE_API_KEY"];
  if (!key) throw new Error("Missing HUGGINGFACE_API_KEY");

  const out: number[][] = [];
  const BATCH = 32;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH).map((t) => t.slice(0, 4000));
    const res = await fetch(HF_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: batch, options: { wait_for_model: true } }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Embedding failed (${res.status}): ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as (number[] | number[][])[];
    for (const item of json) out.push(normalize(meanPool(item)));
  }
  return out;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [vec] = await embedTexts([text]);
  if (!vec) throw new Error("Embedding failed for query");
  return vec;
}

const STOPWORDS = new Set(
  "a an the and or of to in for on with is are was were be been by as at from that this it its we our you your they their he she i not no".split(
    " ",
  ),
);

/** Lexical sparse vector (hashed term frequencies) powering the BM25-style half of hybrid search. */
export function sparseVector(text: string): { indices: number[]; values: number[] } {
  const counts = new Map<number, number>();
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));

  for (const token of tokens) {
    let hash = 2166136261;
    for (let i = 0; i < token.length; i++) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const index = Math.abs(hash) % 1_000_000;
    counts.set(index, (counts.get(index) ?? 0) + 1);
  }

  const indices = [...counts.keys()];
  const total = tokens.length || 1;
  // BM25-style saturation on term frequency.
  const values = indices.map((i) => {
    const tf = counts.get(i)!;
    return (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (total / 200)));
  });
  return { indices, values };
}
