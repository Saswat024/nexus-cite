/**
 * BAAI BGE Reranker v2 M3.
 *
 * Primary source: Hugging Face serverless inference (text-classification route,
 * which scores query/document pairs with the cross-encoder) using the shared
 * HUGGINGFACE_API_KEY. If BGE_RERANKER_URL points at a self-hosted TEI or
 * compatible endpoint, that is tried first and HF is the fallback.
 * Supports TEI (/rerank), {results: []} and {scores: []} response shapes.
 */

const HF_RERANK_URL =
  "https://router.huggingface.co/hf-inference/models/BAAI/bge-reranker-v2-m3";
const HF_BATCH_SIZE = 16;

function isUsableUrl(value: string | undefined): value is string {
  return !!value && /^https?:\/\//i.test(value.trim());
}

export async function rerank(
  query: string,
  documents: string[],
  topN: number,
): Promise<{ index: number; score: number }[]> {
  if (!documents.length) return [];

  const customUrl = process.env["BGE_RERANKER_URL"];
  const hfKey = process.env["HUGGINGFACE_API_KEY"];

  if (isUsableUrl(customUrl)) {
    try {
      return await teiRerank(query, documents, topN, customUrl.trim());
    } catch (error) {
      if (!hfKey) throw error;
      console.warn("Configured reranker endpoint failed, falling back to Hugging Face", error);
    }
  }

  if (!hfKey) throw new Error("Missing HUGGINGFACE_API_KEY for reranking");
  return hfRerank(query, documents, topN, hfKey);
}

// ---- Hugging Face serverless (text-classification route) ----

async function hfRerank(
  query: string,
  documents: string[],
  topN: number,
  apiKey: string,
): Promise<{ index: number; score: number }[]> {
  const scores: number[] = [];

  for (let offset = 0; offset < documents.length; offset += HF_BATCH_SIZE) {
    const batch = documents.slice(offset, offset + HF_BATCH_SIZE);
    const res = await fetch(HF_RERANK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        inputs: batch.map((doc) => ({ text: doc, text_pair: query })),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Hugging Face reranker failed (${res.status}): ${body.slice(0, 300)}`);
    }

    const json = (await res.json()) as unknown;
    // The router returns [[{label, score}, ...]] for a batch; flatten defensively.
    const list = Array.isArray(json)
      ? Array.isArray(json[0])
        ? (json as unknown[]).flat()
        : (json as unknown[])
      : [];
    for (const item of list as { score?: unknown }[]) {
      scores.push(typeof item?.score === "number" ? item.score : 0);
    }
  }

  return scores
    .map((score, index) => ({ index, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

// ---- Self-hosted TEI / compatible endpoint ----

async function teiRerank(
  query: string,
  documents: string[],
  topN: number,
  url: string,
): Promise<{ index: number; score: number }[]> {
  const key = process.env["BGE_RERANKER_API_KEY"];

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({
      query,
      texts: documents,
      documents,
      model: "BAAI/bge-reranker-v2-m3",
      top_n: topN,
      return_text: false,
      raw_scores: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Reranker failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as unknown;
  let ranked: { index: number; score: number }[] = [];

  if (Array.isArray(json)) {
    ranked = (json as { index: number; score?: number; relevance_score?: number }[]).map((r) => ({
      index: r.index,
      score: r.score ?? r.relevance_score ?? 0,
    }));
  } else if (json && typeof json === "object" && Array.isArray((json as { results?: unknown }).results)) {
    ranked = (json as { results: { index: number; relevance_score?: number; score?: number }[] }).results.map(
      (r) => ({ index: r.index, score: r.relevance_score ?? r.score ?? 0 }),
    );
  } else if (json && typeof json === "object" && Array.isArray((json as { scores?: unknown }).scores)) {
    ranked = (json as { scores: number[] }).scores.map((score, index) => ({ index, score }));
  } else {
    throw new Error("Unrecognised reranker response shape");
  }

  return ranked.sort((a, b) => b.score - a.score).slice(0, topN);
}
