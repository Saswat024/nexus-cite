"""
Section-aware chunking and ingestion-time prompt injection sanitization.
"""

from __future__ import annotations

import re
from typing import Any, Optional
from pydantic import BaseModel, Field

TARGET_CHARS = 1400
MIN_CHARS = 250

INJECTION_PATTERNS = [
    re.compile(r"ignore (all |any )?(the )?(previous|prior|above|earlier) (instructions?|prompts?|rules?)", re.IGNORECASE),
    re.compile(r"disregard (all |any )?(the )?(previous|prior|above) (instructions?|context)", re.IGNORECASE),
    re.compile(r"you are (now )?(a|an) [^.\n]{0,60}(assistant|ai|model)", re.IGNORECASE),
    re.compile(r"(system|developer)\s*(prompt|message)\s*:", re.IGNORECASE),
    re.compile(r"<\s*/?\s*(system|assistant|user)\s*>", re.IGNORECASE),
    re.compile(r"\bBEGIN\s+SYSTEM\b|\bEND\s+SYSTEM\b", re.IGNORECASE),
    re.compile(r"reveal (your|the) (system )?(prompt|instructions?)", re.IGNORECASE),
    re.compile(r"do not (cite|mention|follow)[^.\n]{0,60}(instructions?|sources?|context)", re.IGNORECASE),
    re.compile(r"act as (if you are )?[^.\n]{0,40}(unrestricted|jailbroken|dan)\b", re.IGNORECASE),
]

SENTENCE_SPLIT_REGEX = re.compile(r"[^.!?]+[.!?]*\s*")


try:
    from parse import Block
except ImportError:
    from .parse import Block

class Chunk(BaseModel):
    content: str
    page_number: int
    section_heading: Optional[str] = None
    chunk_index: int
    flagged_injection: bool = False


class SanitizeResult(BaseModel):
    text: str
    flagged: bool


def sanitize_text(text: str) -> tuple[str, bool]:
    """
    Prompt-injection defense applied at ingestion time: instruction-like text found
    inside a document is neutralized (and flagged) before it can reach the context window.
    """
    flagged = False
    out = text

    for pattern in INJECTION_PATTERNS:
        def repl(match: re.Match) -> str:
            nonlocal flagged
            flagged = True
            return f"[redacted instruction-like text: {len(match.group(0))} chars]"

        out = pattern.sub(repl, out)

    return out, flagged


def chunk_blocks(blocks: list[Block] | list[dict] | list[Any]) -> list[Chunk]:
    """
    Section-aware chunking: blocks are grouped along their natural section boundaries
    and only split further when a section exceeds the target size.
    """
    normalized_blocks: list[Block] = []
    for b in blocks:
        if isinstance(b, Block):
            normalized_blocks.append(b)
        elif isinstance(b, dict):
            normalized_blocks.append(Block(**b))
        else:
            normalized_blocks.append(
                Block(
                    text=getattr(b, "text", ""),
                    page=int(getattr(b, "page", 1)),
                    heading=getattr(b, "heading", None),
                )
            )

    chunks: list[Chunk] = []
    index = 0

    current: dict | None = None

    def flush():
        nonlocal current, index
        if not current:
            return
        raw = "\n\n".join(current["parts"]).strip()
        if raw:
            sanitized, flagged = sanitize_text(raw)
            chunks.append(
                Chunk(
                    content=sanitized,
                    page_number=current["page"],
                    section_heading=current["heading"],
                    chunk_index=index,
                    flagged_injection=flagged,
                )
            )
            index += 1
        current = None

    for block in normalized_blocks:
        if not current or current["heading"] != block.heading:
            if current and current["length"] >= MIN_CHARS:
                flush()
            elif current:
                # tiny trailing section: keep accumulating under the new heading
                current["heading"] = block.heading

        if not current:
            current = {
                "heading": block.heading,
                "page": block.page,
                "parts": [],
                "length": 0,
            }

        sentences = SENTENCE_SPLIT_REGEX.findall(block.text) or [block.text]
        for sentence in sentences:
            s_len = len(sentence)
            if current["length"] + s_len > TARGET_CHARS and current["length"] >= MIN_CHARS:
                heading = current["heading"]
                flush()
                current = {
                    "heading": heading,
                    "page": block.page,
                    "parts": [],
                    "length": 0,
                }
            current["parts"].append(sentence.strip())
            current["length"] += s_len

    flush()

    return [c for c in chunks if len(c.content) > 40]
