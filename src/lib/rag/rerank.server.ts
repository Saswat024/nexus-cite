/**
 * BAAI BGE Reranker v2 M3, self-hosted, called over REST.
 * Supports both the TEI (/rerank) response shape and a plain {scores: []} shape.
 */
export async function rerank(
  query: string,
  documents: string[],
  topN: number,
): Promise<{ index: number; score: number }[]> {
  const url = process.env["BGE_RERANKER_URL"];
  const key = process.env["BGE_RERANKER_API_KEY"];
  if (!url) throw new Error("Missing BGE_RERANKER_URL");
  if (!documents.length) return [];

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
