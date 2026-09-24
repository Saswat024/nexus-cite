"""
RAG Engine in Python: Document Parsing, Chunking, Embeddings, Vector Storage, Reranking, and Generation.
"""

from .chunking import Block, Chunk, chunk_blocks, sanitize_text
from .parse import parse_document, parse_pdf, parse_docx, ParseResult
from .embeddings import (
    DENSE_DIM,
    embed_texts,
    embed_texts_async,
    embed_query,
    embed_query_async,
    sparse_vector,
)
from .qdrant import (
    COLLECTION,
    QdrantPayload,
    HybridHit,
    UpsertPoint,
    ensure_collection,
    ensure_collection_async,
    upsert_chunks,
    upsert_chunks_async,
    delete_by_document,
    delete_by_document_async,
    hybrid_search,
    hybrid_search_async,
)
from .rerank import rerank, rerank_async, RerankResult
from .groq import (
    GROQ_MODEL,
    RAG_SYSTEM_PROMPT,
    ContextItem,
    ChatMessage,
    build_context_block,
    stream_groq_answer,
    generate_title_async,
    condense_query_async,
)

from .mongo import (
    get_mongo_client,
    get_mongo_db,
    get_gridfs,
    upload_to_gridfs,
    download_from_gridfs,
    delete_from_gridfs,
)

__all__ = [
    "Block",
    "Chunk",
    "chunk_blocks",
    "sanitize_text",
    "parse_document",
    "parse_pdf",
    "parse_docx",
    "ParseResult",
    "DENSE_DIM",
    "embed_texts",
    "embed_texts_async",
    "embed_query",
    "embed_query_async",
    "sparse_vector",
    "COLLECTION",
    "QdrantPayload",
    "HybridHit",
    "UpsertPoint",
    "ensure_collection",
    "ensure_collection_async",
    "upsert_chunks",
    "upsert_chunks_async",
    "delete_by_document",
    "delete_by_document_async",
    "hybrid_search",
    "hybrid_search_async",
    "rerank",
    "rerank_async",
    "RerankResult",
    "GROQ_MODEL",
    "RAG_SYSTEM_PROMPT",
    "ContextItem",
    "ChatMessage",
    "build_context_block",
    "stream_groq_answer",
    "get_mongo_client",
    "get_mongo_db",
    "get_gridfs",
    "upload_to_gridfs",
    "download_from_gridfs",
    "delete_from_gridfs",
]
