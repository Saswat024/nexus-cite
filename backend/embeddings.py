"""
Dense embeddings via Hugging Face InferenceClient (Qwen/Qwen3-Embedding-8B with Scaleway provider)
and lexical sparse vectors (BM25 term frequencies).
"""

from __future__ import annotations

import os
import math
import re
import ctypes
import asyncio
from typing import TypedDict
import numpy as np
from huggingface_hub import InferenceClient, AsyncInferenceClient

HF_MODEL = "Qwen/Qwen3-Embedding-8B"
HF_PROVIDER = "scaleway"
DENSE_DIM = 4096

# HF_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
# HF_PROVIDER = None
# DENSE_DIM = 384

STOPWORDS = set(
    "a an the and or of to in for on with is are was were be been by as at from that this it its we our you your they their he she i not no".split()
)


class SparseVector(TypedDict):
    indices: list[int]
    values: list[float]


def _get_api_key() -> str:
    key = os.environ.get("HUGGINGFACE_API_KEY")
    if not key:
        raise ValueError("Missing HUGGINGFACE_API_KEY in environment")
    return key


def get_inference_client() -> InferenceClient:
    return InferenceClient(provider=HF_PROVIDER, api_key=_get_api_key())


def get_async_inference_client() -> AsyncInferenceClient:
    return AsyncInferenceClient(provider=HF_PROVIDER, api_key=_get_api_key())


def normalize(vec: list[float]) -> list[float]:
    """L2 unit normalization."""
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


async def embed_texts_async(texts: list[str]) -> list[list[float]]:
    """Embed texts with Qwen/Qwen3-Embedding-8B through Hugging Face AsyncInferenceClient with auto-retry."""
    if not texts:
        return []

    client = get_async_inference_client()
    out: list[list[float]] = []
    batch_size = 16

    for i in range(0, len(texts), batch_size):
        batch = [t[:4000] for t in texts[i : i + batch_size]]
        res = None
        last_error = None

        for attempt in range(3):
            try:
                res = await client.feature_extraction(batch, model=HF_MODEL)
                break
            except Exception as e:
                last_error = e
                if attempt < 2:
                    await asyncio.sleep(1.0 * (attempt + 1))
                else:
                    raise last_error

        arr = np.array(res)
        if arr.ndim == 1:
            arr = arr.reshape(1, -1)
        for row in arr:
            vec = [float(v) for v in row.flatten()]
            out.append(normalize(vec))

    return out


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed texts with Qwen/Qwen3-Embedding-8B through Hugging Face InferenceClient (Sync)."""
    if not texts:
        return []

    client = get_inference_client()
    out: list[list[float]] = []
    batch_size = 16

    for i in range(0, len(texts), batch_size):
        batch = [t[:4000] for t in texts[i : i + batch_size]]
        res = client.feature_extraction(batch, model=HF_MODEL)
        arr = np.array(res)
        if arr.ndim == 1:
            arr = arr.reshape(1, -1)
        for row in arr:
            vec = [float(v) for v in row.flatten()]
            out.append(normalize(vec))

    return out


async def embed_query_async(text: str) -> list[float]:
    """Embed a single query string asynchronously."""
    vecs = await embed_texts_async([text])
    if not vecs:
        raise RuntimeError("Embedding failed for query")
    return vecs[0]


def embed_query(text: str) -> list[float]:
    """Embed a single query string synchronously."""
    vecs = embed_texts([text])
    if not vecs:
        raise RuntimeError("Embedding failed for query")
    return vecs[0]


def _fnv1a_32_hash(token: str) -> int:
    """Exact 32-bit signed FNV-1a hash to maintain 100% parity with JS Math.imul."""
    h = 2166136261
    for ch in token:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    signed_h = ctypes.c_int32(h).value
    return abs(signed_h) % 1_000_000


def sparse_vector(text: str) -> SparseVector:
    """
    Lexical sparse vector (hashed term frequencies) powering the BM25-style half of hybrid search.
    Guaranteed exact integer hashing compatibility with existing Qdrant vectors.
    """
    counts: dict[int, int] = {}
    tokens = [
        t
        for t in re.split(r"[^a-z0-9]+", text.lower())
        if len(t) > 2 and t not in STOPWORDS
    ]

    for token in tokens:
        index = _fnv1a_32_hash(token)
        counts[index] = counts.get(index, 0) + 1

    indices = list(counts.keys())
    total = len(tokens) or 1

    # BM25-style saturation on term frequency.
    values = [
        (counts[i] * 2.2) / (counts[i] + 1.2 * (0.25 + 0.75 * (total / 200.0)))
        for i in indices
    ]

    return {"indices": indices, "values": values}
