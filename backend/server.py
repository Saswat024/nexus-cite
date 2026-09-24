"""
FastAPI Microservice for Atlas RAG Engine.
Exposes endpoints for parsing, chunking, embeddings, hybrid search, reranking, full ingestion, and streaming generation.
"""

from __future__ import annotations

import os
import base64
import uuid
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json

import sys

# Ensure backend directory is in sys.path
backend_dir = str(Path(__file__).resolve().parent)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

# Locate and load .env file from directory or project root
env_path = Path(__file__).resolve().parent / ".env"
if env_path.exists():
    load_dotenv(dotenv_path=env_path)
else:
    load_dotenv()

from chunking import Block, Chunk, chunk_blocks, sanitize_text
from parse import parse_document
from embeddings import embed_texts_async, embed_query_async, sparse_vector
from qdrant import (
    upsert_chunks_async,
    delete_by_document_async,
    hybrid_search_async,
    UpsertPoint,
    QdrantPayload,
)
from rerank import rerank_async
from groq import (
    ContextItem,
    ChatMessage,
    build_context_block,
    stream_groq_answer,
    generate_title_async,
    condense_query_async,
)


app = FastAPI(
    title="Atlas RAG Engine",
    description="Production-grade Python RAG service with hybrid search, BGE reranking and grounded citations.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "has_qdrant_url": bool(os.environ.get("QDRANT_URL")),
        "has_groq_key": bool(os.environ.get("GROQ_API_KEY")),
        "has_hf_key": bool(os.environ.get("HUGGINGFACE_API_KEY")),
    }


class ChunkRequest(BaseModel):
    blocks: list[Block]


@app.post("/api/rag/chunk", response_model=list[Chunk])
async def api_chunk_blocks(req: ChunkRequest):
    return chunk_blocks(req.blocks)


class EmbedRequest(BaseModel):
    texts: list[str]


@app.post("/api/rag/embed")
async def api_embed_texts(req: EmbedRequest):
    dense = await embed_texts_async(req.texts)
    sparse = [sparse_vector(t) for t in req.texts]
    return {"dense": dense, "sparse": sparse}


class SearchRequest(BaseModel):
    query: str
    user_id: str
    document_ids: Optional[list[str]] = None
    limit: int = 20


@app.post("/api/rag/search")
async def api_hybrid_search(req: SearchRequest):
    dense_vec = await embed_query_async(req.query)
    hits = await hybrid_search_async(
        dense_vector=dense_vec,
        query_text=req.query,
        user_id=req.user_id,
        document_ids=req.document_ids,
        limit=req.limit,
    )
    return {"hits": [h.model_dump() for h in hits]}


class RerankRequest(BaseModel):
    query: str
    documents: list[str]
    top_n: int = 5


@app.post("/api/rag/rerank")
async def api_rerank(req: RerankRequest):
    results = await rerank_async(
        query=req.query,
        documents=req.documents,
        top_n=req.top_n,
    )
    return {"results": [r.model_dump() for r in results]}


class IngestRequest(BaseModel):
    document_id: str
    user_id: str
    filename: str
    file_base64: str  # Base64 encoded file content


class IngestChunkResult(BaseModel):
    id: str
    content: str
    page_number: int
    section_heading: Optional[str] = None
    chunk_index: int
    flagged_injection: bool = False


class IngestResponse(BaseModel):
    page_count: int
    chunk_count: int
    chunks: list[IngestChunkResult]


@app.post("/api/rag/ingest", response_model=IngestResponse)
async def api_ingest_document(req: IngestRequest):
    """
    Full document ingestion pipeline in Python:
    1. Base64 decode raw document
    2. Extract page-tagged blocks & headings
    3. Section-aware chunking with prompt-injection defense
    4. Dense (MiniLM) and Lexical Sparse (BM25) vector generation
    5. Clean prior document vectors and upsert points to Qdrant Cloud
    """
    try:
        raw_bytes = base64.b64decode(req.file_base64)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid base64 document content: {exc}")

    try:
        parse_res = parse_document(req.filename, raw_bytes)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Document parsing failed: {exc}")

    chunks = chunk_blocks(parse_res.blocks)
    if not chunks:
        raise HTTPException(status_code=400, detail="No readable text found in document.")

    # Re-ingestion safety: clear prior vectors from Qdrant
    await delete_by_document_async(req.document_id)

    # Generate point IDs and embed texts
    chunk_ids = [str(uuid.uuid4()) for _ in chunks]
    vectors = await embed_texts_async([c.content for c in chunks])

    points: list[UpsertPoint] = []
    chunk_results: list[IngestChunkResult] = []

    for chunk, chunk_id, dense_vec in zip(chunks, chunk_ids, vectors):
        payload = QdrantPayload(
            document_id=req.document_id,
            chunk_id=chunk_id,
            page_number=chunk.page_number,
            section_heading=chunk.section_heading,
            user_id=req.user_id,
            content=chunk.content,
        )
        points.append(
            UpsertPoint(
                id=chunk_id,
                dense=dense_vec,
                text=chunk.content,
                payload=payload,
            )
        )
        chunk_results.append(
            IngestChunkResult(
                id=chunk_id,
                content=chunk.content,
                page_number=chunk.page_number,
                section_heading=chunk.section_heading,
                chunk_index=chunk.chunk_index,
                flagged_injection=chunk.flagged_injection,
            )
        )

    await upsert_chunks_async(points)

    return IngestResponse(
        page_count=parse_res.page_count,
        chunk_count=len(chunk_results),
        chunks=chunk_results,
    )


@app.delete("/api/rag/documents/{document_id}")
async def api_delete_document(document_id: str):
    """Delete all vectors and payload for a document from Qdrant."""
    await delete_by_document_async(document_id)
    return {"ok": True, "deleted": document_id}


class ChatRequest(BaseModel):
    session_id: str
    question: str
    user_id: str
    document_ids: Optional[list[str]] = None
    document_titles: Optional[dict[str, str]] = None
    history: list[ChatMessage] = []


@app.post("/api/rag/chat/stream")
async def api_chat_stream(req: ChatRequest):
    # Contextual Query Condensation: rewrite follow-up questions containing pronouns (he, his, etc.)
    search_query = req.question
    if req.history:
        search_query = await condense_query_async(req.question, req.history)
        if search_query != req.question:
            print(f"[RAG Retrieval] Rewrote query '{req.question}' -> '{search_query}'")

    dense_vec = await embed_query_async(search_query)
    hits = await hybrid_search_async(
        dense_vector=dense_vec,
        query_text=search_query,
        user_id=req.user_id,
        document_ids=req.document_ids,
        limit=20,
    )

    if not hits:
        answer = "The provided documents don't contain enough information to answer that. Upload or select a document first."

        async def empty_stream():
            yield f"event: token\ndata: {json.dumps({'text': answer})}\n\n"
            yield f"event: done\ndata: {json.dumps({'citations': []})}\n\n"

        return StreamingResponse(empty_stream(), media_type="text/event-stream")

    try:
        ranked = await rerank_async(
            query=search_query,
            documents=[h.payload.content for h in hits],
            top_n=5,
        )
    except Exception:
        ranked = [
            type("Rerank", (), {"index": i, "score": hits[i].score})()
            for i in range(min(5, len(hits)))
        ]

    top_hits = [hits[r.index] for r in ranked if r.index < len(hits)]
    titles_map = req.document_titles or {}

    context_items = [
        ContextItem(
            index=i + 1,
            content=h.payload.content,
            title=titles_map.get(h.payload.document_id, f"Document {h.payload.document_id[:8]}"),
            page_number=h.payload.page_number,
            section_heading=h.payload.section_heading,
        )
        for i, h in enumerate(top_hits)
    ]
    citations_meta = [
        {
            "index": i + 1,
            "chunk_id": h.payload.chunk_id,
            "document_id": h.payload.document_id,
            "document_title": titles_map.get(h.payload.document_id, "Document"),
            "page_number": h.payload.page_number,
            "section_heading": h.payload.section_heading,
            "relevance_score": ranked[i].score,
            "content": h.payload.content,
        }
        for i, h in enumerate(top_hits)
    ]

    context_block = build_context_block(context_items)

    async def event_generator():
        yield f"event: sources\ndata: {json.dumps({'citations': citations_meta})}\n\n"
        async for token in stream_groq_answer(
            question=req.question,
            context=context_block,
            history=req.history,
        ):
            yield f"event: token\ndata: {json.dumps({'text': token})}\n\n"
        yield f"event: done\ndata: {json.dumps({'citations': citations_meta})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


class GenerateTitleRequest(BaseModel):
    query: str
    context: Optional[str] = None


@app.post("/api/rag/generate-title")
async def api_generate_title(req: GenerateTitleRequest):
    """Generate a clean, concise 3-5 word conversation title using Groq with fast fallback."""
    title = await generate_title_async(req.query, req.context)
    return {"title": title}


@app.post("/api/rag/parse")
async def api_parse_document(file: UploadFile = File(...)):
    content = await file.read()
    try:
        result = parse_document(file.filename or "unknown", content)
        return result.model_dump()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.lib.rag.server:app", host="0.0.0.0", port=8000, reload=True)
