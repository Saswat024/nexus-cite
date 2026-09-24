/**
 * Client for Python RAG Engine FastAPI service.
 * Routes all document parsing, chunking, embeddings, hybrid search, reranking, and generation
 * to the Python service running on localhost:8000 (or PYTHON_RAG_URL).
 */

export const PYTHON_RAG_URL = (
  process.env["PYTHON_RAG_URL"] || "http://127.0.0.1:8000"
).replace(/\/$/, "");

export type IngestChunkResult = {
  id: string;
  content: string;
  page_number: number;
  section_heading: string | null;
  chunk_index: number;
  flagged_injection: boolean;
};

export type IngestResponse = {
  page_count: number;
  chunk_count: number;
  chunks: IngestChunkResult[];
};

export async function checkPythonService(): Promise<boolean> {
  try {
    const res = await fetch(`${PYTHON_RAG_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function ingestDocumentInPython(args: {
  documentId: string;
  userId: string;
  filename: string;
  fileBytes: Uint8Array;
}): Promise<IngestResponse> {
  // Convert Uint8Array to Base64 in Node/worker environment
  const base64 = Buffer.from(args.fileBytes).toString("base64");

  let res: Response;
  try {
    res = await fetch(`${PYTHON_RAG_URL}/api/rag/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        document_id: args.documentId,
        user_id: args.userId,
        filename: args.filename,
        file_base64: base64,
      }),
    });
  } catch (err) {
    throw new Error(
      `Python RAG service unreachable at ${PYTHON_RAG_URL}. Make sure it is running in 'backend/' via 'python -m uvicorn server:app --port 8000'. (${err instanceof Error ? err.message : err})`
    );
  }

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Python ingestion failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  return (await res.json()) as IngestResponse;
}

export async function deleteDocumentInPython(documentId: string): Promise<void> {
  try {
    const res = await fetch(`${PYTHON_RAG_URL}/api/rag/documents/${documentId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      console.warn(`Python deleteDocument returned ${res.status}`);
    }
  } catch (err) {
    console.warn(`Could not reach Python RAG service to delete vectors: ${err}`);
  }
}

export async function streamChatInPython(args: {
  sessionId: string;
  question: string;
  userId: string;
  documentIds?: string[] | undefined;
  documentTitles?: Record<string, string> | undefined;
  history: Array<{ role: string; content: string }>;
}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${PYTHON_RAG_URL}/api/rag/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: args.sessionId,
        question: args.question,
        user_id: args.userId,
        document_ids: args.documentIds,
        document_titles: args.documentTitles,
        history: args.history,
      }),
    });
  } catch (err) {
    throw new Error(
      `Python RAG service unreachable at ${PYTHON_RAG_URL}. Make sure it is running in 'backend/' via 'python -m uvicorn server:app --port 8000'. (${err instanceof Error ? err.message : err})`
    );
  }

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Python chat retrieval failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  return res;
}

export async function generateTitleInPython(query: string, context?: string): Promise<string> {
  try {
    const res = await fetch(`${PYTHON_RAG_URL}/api/rag/generate-title`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, context }),
    });
    if (res.ok) {
      const data = (await res.json()) as { title?: string };
      if (data?.title) return data.title;
    }
  } catch (err) {
    console.warn("Failed to generate title in Python, using fallback:", err);
  }

  const fallback = query.slice(0, 36).trim();
  return fallback.length > 0 ? (fallback.length === query.length ? fallback : `${fallback}...`) : "Untitled conversation";
}

