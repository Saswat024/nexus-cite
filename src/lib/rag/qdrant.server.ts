import { DENSE_DIM, sparseVector } from "./embeddings.server";

export const COLLECTION = "rag_chunks";

type QdrantPayload = {
  document_id: string;
  chunk_id: string;
  page_number: number | null;
  section_heading: string | null;
  user_id: string;
  content: string;
};

function config() {
  const url = process.env["QDRANT_URL"];
  const key = process.env["QDRANT_API_KEY"];
  if (!url || !key) throw new Error("Missing QDRANT_URL or QDRANT_API_KEY");
  return { url: url.replace(/\/$/, ""), key };
}

async function qdrant<T = unknown>(path: string, init: RequestInit & { method: string }): Promise<T> {
  const { url, key } = config();
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: { "api-key": key, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Qdrant ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

let ensured = false;

/** Create the hybrid (dense + sparse) collection on first use. */
export async function ensureCollection(): Promise<void> {
  if (ensured) return;
  const existing = await qdrant<{ result?: { collections: { name: string }[] } }>("/collections", {
    method: "GET",
  });
  const names = existing.result?.collections?.map((c) => c.name) ?? [];
  if (!names.includes(COLLECTION)) {
    await qdrant(`/collections/${COLLECTION}`, {
      method: "PUT",
      body: JSON.stringify({
        vectors: { dense: { size: DENSE_DIM, distance: "Cosine" } },
        sparse_vectors: { lexical: { modifier: "idf" } },
      }),
    });
    for (const field of ["document_id", "user_id"]) {
      await qdrant(`/collections/${COLLECTION}/index`, {
        method: "PUT",
        body: JSON.stringify({ field_name: field, field_schema: "keyword" }),
      });
    }
  }
  ensured = true;
}

export async function upsertChunks(
  points: { id: string; dense: number[]; text: string; payload: QdrantPayload }[],
): Promise<void> {
  await ensureCollection();
  const BATCH = 64;
  for (let i = 0; i < points.length; i += BATCH) {
    const batch = points.slice(i, i + BATCH);
    await qdrant(`/collections/${COLLECTION}/points?wait=true`, {
      method: "PUT",
      body: JSON.stringify({
        points: batch.map((p) => ({
          id: p.id,
          vector: { dense: p.dense, lexical: sparseVector(p.text) },
          payload: p.payload,
        })),
      }),
    });
  }
}

export async function deleteByDocument(documentId: string): Promise<void> {
  await ensureCollection();
  await qdrant(`/collections/${COLLECTION}/points/delete?wait=true`, {
    method: "POST",
    body: JSON.stringify({ filter: { must: [{ key: "document_id", match: { value: documentId } }] } }),
  });
}

export type HybridHit = {
  id: string;
  score: number;
  payload: QdrantPayload;
};

/** Native Qdrant hybrid query: dense + sparse prefetch fused with RRF. */
export async function hybridSearch(args: {
  denseVector: number[];
  queryText: string;
  userId: string;
  documentIds?: string[] | undefined;
  limit?: number;
}): Promise<HybridHit[]> {
  await ensureCollection();
  const limit = args.limit ?? 20;
  const must: unknown[] = [{ key: "user_id", match: { value: args.userId } }];
  if (args.documentIds?.length) must.push({ key: "document_id", match: { any: args.documentIds } });
  const filter = { must };

  const body = {
    prefetch: [
      { query: args.denseVector, using: "dense", filter, limit: limit * 2 },
      { query: sparseVector(args.queryText), using: "lexical", filter, limit: limit * 2 },
    ],
    query: { fusion: "rrf" },
    limit,
    with_payload: true,
  };

  const res = await qdrant<{ result: { points: HybridHit[] } }>(
    `/collections/${COLLECTION}/points/query`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return res.result?.points ?? [];
}
