"""
BAAI BGE Reranker v2 M3 client: Hugging Face serverless inference with self-hosted TEI fallback.
"""

from __future__ import annotations

import os
import re
import logging
from typing import Any
from pydantic import BaseModel
import httpx

logger = logging.getLogger(__name__)

HF_RERANK_URL = "https://router.huggingface.co/hf-inference/models/BAAI/bge-reranker-v2-m3"
HF_BATCH_SIZE = 16


class RerankResult(BaseModel):
    index: int
    score: float


def _is_usable_url(val: str | None) -> bool:
    return bool(val and re.match(r"^https?://", val.strip(), re.IGNORECASE))


async def tei_rerank_async(
    query: str, documents: list[str], top_n: int, url: str
) -> list[RerankResult]:
    key = os.environ.get("BGE_RERANKER_API_KEY")
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"

    body = {
        "query": query,
        "texts": documents,
        "documents": documents,
        "model": "BAAI/bge-reranker-v2-m3",
        "top_n": top_n,
        "return_text": False,
        "raw_scores": False,
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        res = await client.post(url, headers=headers, json=body)
        if res.status_code >= 400:
            raise RuntimeError(f"TEI Reranker failed ({res.status_code}): {res.text[:300]}")

        data = res.json()

    ranked: list[RerankResult] = []
    if isinstance(data, list):
        ranked = [
            RerankResult(index=r["index"], score=float(r.get("score") or r.get("relevance_score") or 0.0))
            for r in data
        ]
    elif isinstance(data, dict) and "results" in data:
        ranked = [
            RerankResult(index=r["index"], score=float(r.get("relevance_score") or r.get("score") or 0.0))
            for r in data["results"]
        ]
    elif isinstance(data, dict) and "scores" in data:
        ranked = [
            RerankResult(index=i, score=float(score))
            for i, score in enumerate(data["scores"])
        ]
    else:
        raise ValueError("Unrecognised TEI reranker response shape")

    ranked.sort(key=lambda x: x.score, reverse=True)
    return ranked[:top_n]


async def hf_rerank_async(
    query: str, documents: list[str], top_n: int, api_key: str
) -> list[RerankResult]:
    scores: list[float] = []

    async with httpx.AsyncClient(timeout=60.0) as client:
        for offset in range(0, len(documents), HF_BATCH_SIZE):
            batch = documents[offset : offset + HF_BATCH_SIZE]
            res = await client.post(
                HF_RERANK_URL,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                },
                json={"inputs": [{"text": doc, "text_pair": query} for doc in batch]},
            )
            if res.status_code >= 400:
                raise RuntimeError(f"Hugging Face reranker failed ({res.status_code}): {res.text[:300]}")

            data = res.json()
            # Router returns [[{label, score}, ...]] for batches
            flat_items: list[dict[str, Any]] = []
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, list):
                        flat_items.extend(item)
                    elif isinstance(item, dict):
                        flat_items.append(item)

            for item in flat_items:
                s = item.get("score")
                scores.append(float(s) if isinstance(s, (int, float)) else 0.0)

    results = [RerankResult(index=i, score=score) for i, score in enumerate(scores)]
    results.sort(key=lambda x: x.score, reverse=True)
    return results[:top_n]


async def rerank_async(
    query: str, documents: list[str], top_n: int = 5
) -> list[RerankResult]:
    """Rerank candidate document chunks against query using BGE Reranker v2 M3 (Async)."""
    if not documents:
        return []

    custom_url = os.environ.get("BGE_RERANKER_URL")
    hf_key = os.environ.get("HUGGINGFACE_API_KEY")

    if _is_usable_url(custom_url):
        try:
            return await tei_rerank_async(query, documents, top_n, custom_url.strip())
        except Exception as exc:
            if not hf_key:
                raise exc
            logger.warning("Configured TEI reranker endpoint failed, falling back to Hugging Face: %s", exc)

    if not hf_key:
        raise ValueError("Missing HUGGINGFACE_API_KEY for reranking")

    return await hf_rerank_async(query, documents, top_n, hf_key)


def rerank(query: str, documents: list[str], top_n: int = 5) -> list[RerankResult]:
    """Rerank candidate document chunks against query using BGE Reranker v2 M3 (Sync)."""
    import asyncio
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(rerank_async(query, documents, top_n))
    else:
        # If in an event loop, create a new thread to run it safely
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor() as executor:
            return executor.submit(lambda: asyncio.run(rerank_async(query, documents, top_n))).result()
