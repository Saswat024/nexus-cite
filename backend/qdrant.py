"""
Qdrant Cloud client: hybrid search (dense + lexical sparse with RRF fusion) and vector lifecycle management.
"""

from __future__ import annotations

import os
from typing import Any, Optional
from pydantic import BaseModel
import httpx

try:
    from embeddings import DENSE_DIM, sparse_vector
except ImportError:
    from .embeddings import DENSE_DIM, sparse_vector

COLLECTION = "rag_chunks"


class QdrantPayload(BaseModel):
    document_id: str
    chunk_id: str
    page_number: Optional[int] = None
    section_heading: Optional[str] = None
    user_id: str
    content: str


class HybridHit(BaseModel):
    id: str
    score: float
    payload: QdrantPayload


class UpsertPoint(BaseModel):
    id: str
    dense: list[float]
    text: str
    payload: QdrantPayload


def _get_config() -> tuple[str, str]:
    url = os.environ.get("QDRANT_URL")
    key = os.environ.get("QDRANT_API_KEY")
    if not url or not key:
        raise ValueError("Missing QDRANT_URL or QDRANT_API_KEY in environment")
    return url.rstrip("/"), key


_ensured = False


async def qdrant_request_async(path: str, method: str = "GET", json_body: Any = None) -> dict[str, Any]:
    url, key = _get_config()
    headers = {
        "api-key": key,
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        res = await client.request(
            method=method,
            url=f"{url}{path}",
            headers=headers,
            json=json_body,
        )
        if res.status_code >= 400:
            raise RuntimeError(f"Qdrant {path} failed ({res.status_code}): {res.text[:300]}")
        return res.json() if res.text else {}


def qdrant_request(path: str, method: str = "GET", json_body: Any = None) -> dict[str, Any]:
    url, key = _get_config()
    headers = {
        "api-key": key,
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=60.0) as client:
        res = client.request(
            method=method,
            url=f"{url}{path}",
            headers=headers,
            json=json_body,
        )
        if res.status_code >= 400:
            raise RuntimeError(f"Qdrant {path} failed ({res.status_code}): {res.text[:300]}")
        return res.json() if res.text else {}


async def ensure_collection_async() -> None:
    """Create the hybrid (dense + sparse) collection on first use (Async)."""
    global _ensured
    if _ensured:
        return

    existing = await qdrant_request_async("/collections", method="GET")
    collections = [c.get("name") for c in existing.get("result", {}).get("collections", [])]

    if COLLECTION in collections:
        try:
            info = await qdrant_request_async(f"/collections/{COLLECTION}", method="GET")
            dense_size = (
                info.get("result", {})
                .get("config", {})
                .get("params", {})
                .get("vectors", {})
                .get("dense", {})
                .get("size")
            )
            if dense_size != DENSE_DIM:
                await qdrant_request_async(f"/collections/{COLLECTION}", method="DELETE")
                collections.remove(COLLECTION)
        except Exception:
            pass

    if COLLECTION not in collections:
        await qdrant_request_async(
            f"/collections/{COLLECTION}",
            method="PUT",
            json_body={
                "vectors": {"dense": {"size": DENSE_DIM, "distance": "Cosine"}},
                "sparse_vectors": {"lexical": {"modifier": "idf"}},
            },
        )
        for field in ["document_id", "user_id"]:
            await qdrant_request_async(
                f"/collections/{COLLECTION}/index",
                method="PUT",
                json_body={"field_name": field, "field_schema": "keyword"},
            )

    _ensured = True


def ensure_collection() -> None:
    """Create the hybrid (dense + sparse) collection on first use (Sync)."""
    global _ensured
    if _ensured:
        return

    existing = qdrant_request("/collections", method="GET")
    collections = [c.get("name") for c in existing.get("result", {}).get("collections", [])]

    if COLLECTION in collections:
        try:
            info = qdrant_request(f"/collections/{COLLECTION}", method="GET")
            dense_size = (
                info.get("result", {})
                .get("config", {})
                .get("params", {})
                .get("vectors", {})
                .get("dense", {})
                .get("size")
            )
            if dense_size != DENSE_DIM:
                qdrant_request(f"/collections/{COLLECTION}", method="DELETE")
                collections.remove(COLLECTION)
        except Exception:
            pass

    if COLLECTION not in collections:
        qdrant_request(
            f"/collections/{COLLECTION}",
            method="PUT",
            json_body={
                "vectors": {"dense": {"size": DENSE_DIM, "distance": "Cosine"}},
                "sparse_vectors": {"lexical": {"modifier": "idf"}},
            },
        )
        for field in ["document_id", "user_id"]:
            qdrant_request(
                f"/collections/{COLLECTION}/index",
                method="PUT",
                json_body={"field_name": field, "field_schema": "keyword"},
            )

    _ensured = True


async def upsert_chunks_async(points: list[UpsertPoint] | list[dict]) -> None:
    """Upsert chunk points with dense and lexical sparse vectors (Async)."""
    await ensure_collection_async()
    normalized = [p if isinstance(p, UpsertPoint) else UpsertPoint(**p) for p in points]
    batch_size = 64

    for i in range(0, len(normalized), batch_size):
        batch = normalized[i : i + batch_size]
        await qdrant_request_async(
            f"/collections/{COLLECTION}/points?wait=true",
            method="PUT",
            json_body={
                "points": [
                    {
                        "id": p.id,
                        "vector": {
                            "dense": p.dense,
                            "lexical": sparse_vector(p.text),
                        },
                        "payload": p.payload.model_dump(),
                    }
                    for p in batch
                ]
            },
        )


def upsert_chunks(points: list[UpsertPoint] | list[dict]) -> None:
    """Upsert chunk points with dense and lexical sparse vectors (Sync)."""
    ensure_collection()
    normalized = [p if isinstance(p, UpsertPoint) else UpsertPoint(**p) for p in points]
    batch_size = 64

    for i in range(0, len(normalized), batch_size):
        batch = normalized[i : i + batch_size]
        qdrant_request(
            f"/collections/{COLLECTION}/points?wait=true",
            method="PUT",
            json_body={
                "points": [
                    {
                        "id": p.id,
                        "vector": {
                            "dense": p.dense,
                            "lexical": sparse_vector(p.text),
                        },
                        "payload": p.payload.model_dump(),
                    }
                    for p in batch
                ]
            },
        )


async def delete_by_document_async(document_id: str) -> None:
    """Delete all points associated with a document_id (Async)."""
    await ensure_collection_async()
    await qdrant_request_async(
        f"/collections/{COLLECTION}/points/delete?wait=true",
        method="POST",
        json_body={
            "filter": {
                "must": [{"key": "document_id", "match": {"value": document_id}}]
            }
        },
    )


def delete_by_document(document_id: str) -> None:
    """Delete all points associated with a document_id (Sync)."""
    ensure_collection()
    qdrant_request(
        f"/collections/{COLLECTION}/points/delete?wait=true",
        method="POST",
        json_body={
            "filter": {
                "must": [{"key": "document_id", "match": {"value": document_id}}]
            }
        },
    )


async def delete_by_user_async(user_id: str) -> None:
    """Delete all points associated with a user_id (Async)."""
    await ensure_collection_async()
    await qdrant_request_async(
        f"/collections/{COLLECTION}/points/delete?wait=true",
        method="POST",
        json_body={
            "filter": {
                "must": [{"key": "user_id", "match": {"value": user_id}}]
            }
        },
    )


def delete_by_user(user_id: str) -> None:
    """Delete all points associated with a user_id (Sync)."""
    ensure_collection()
    qdrant_request(
        f"/collections/{COLLECTION}/points/delete?wait=true",
        method="POST",
        json_body={
            "filter": {
                "must": [{"key": "user_id", "match": {"value": user_id}}]
            }
        },
    )


async def hybrid_search_async(
    dense_vector: list[float],
    query_text: str,
    user_id: str,
    document_ids: Optional[list[str]] = None,
    limit: int = 20,
) -> list[HybridHit]:
    """Native Qdrant hybrid query: dense + sparse prefetch fused with RRF (Async)."""
    await ensure_collection_async()
    must: list[dict[str, Any]] = [{"key": "user_id", "match": {"value": user_id}}]
    if document_ids:
        must.append({"key": "document_id", "match": {"any": document_ids}})
    filt = {"must": must}

    body = {
        "prefetch": [
            {"query": dense_vector, "using": "dense", "filter": filt, "limit": limit * 2},
            {"query": sparse_vector(query_text), "using": "lexical", "filter": filt, "limit": limit * 2},
        ],
        "query": {"fusion": "rrf"},
        "limit": limit,
        "with_payload": True,
    }

    res = await qdrant_request_async(f"/collections/{COLLECTION}/points/query", method="POST", json_body=body)
    raw_points = res.get("result", {}).get("points", [])
    return [
        HybridHit(
            id=p["id"],
            score=float(p.get("score", 0.0)),
            payload=QdrantPayload(**p.get("payload", {})),
        )
        for p in raw_points
    ]


def hybrid_search(
    dense_vector: list[float],
    query_text: str,
    user_id: str,
    document_ids: Optional[list[str]] = None,
    limit: int = 20,
) -> list[HybridHit]:
    """Native Qdrant hybrid query: dense + sparse prefetch fused with RRF (Sync)."""
    ensure_collection()
    must: list[dict[str, Any]] = [{"key": "user_id", "match": {"value": user_id}}]
    if document_ids:
        must.append({"key": "document_id", "match": {"any": document_ids}})
    filt = {"must": must}

    body = {
        "prefetch": [
            {"query": dense_vector, "using": "dense", "filter": filt, "limit": limit * 2},
            {"query": sparse_vector(query_text), "using": "lexical", "filter": filt, "limit": limit * 2},
        ],
        "query": {"fusion": "rrf"},
        "limit": limit,
        "with_payload": True,
    }

    res = qdrant_request(f"/collections/{COLLECTION}/points/query", method="POST", json_body=body)
    raw_points = res.get("result", {}).get("points", [])
    return [
        HybridHit(
            id=p["id"],
            score=float(p.get("score", 0.0)),
            payload=QdrantPayload(**p.get("payload", {})),
        )
        for p in raw_points
    ]
