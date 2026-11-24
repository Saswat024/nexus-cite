"""
Dense embeddings via fastembed (ONNX, sentence-transformers/all-MiniLM-L6-v2, 384 dims)
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
from fastembed import TextEmbedding

HF_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
DENSE_DIM = 384

_model: TextEmbedding | None = None


def _get_model() -> TextEmbedding:
    global _model
    if _model is None:
        _model = TextEmbedding(HF_MODEL)
    return _model


STOPWORDS = set(
    "a an the and or of to in for on with is are was were be been by as at from that this it its we our you your they their he she i not no".split()
)


class SparseVector(TypedDict):
    indices: list[int]
    values: list[float]


def normalize(vec: list[float]) -> list[float]:
    """L2 unit normalization."""
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed texts synchronously with fastembed."""
    if not texts:
        return []
    model = _get_model()
    truncated = [t[:4000] for t in texts]
    embeddings = model.embed(truncated, batch_size=16)
    return [normalize([float(v) for v in vec]) for vec in embeddings]


async def embed_texts_async(texts: list[str]) -> list[list[float]]:
    """Embed texts asynchronously via thread pool."""
    if not texts:
        return []
    return await asyncio.to_thread(embed_texts, texts)


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
