"""
PDF and DOCX document parsing with page number preservation and section heading detection.
"""

from __future__ import annotations

import io
import re
import zipfile
import xml.etree.ElementTree as ET
from typing import Optional
from pydantic import BaseModel

HEADING_MAX_LEN = 120
HEADING_NUMBER_REGEX = re.compile(r"^(\d+(\.\d+)*)[.)]?\s+[A-Z]")
COMMON_SECTION_REGEX = re.compile(
    r"^(abstract|introduction|background|related work|method(s|ology)?|experiments?|results?|discussion|conclusions?|references|appendix|chapter\s+\d+)\b",
    re.IGNORECASE,
)


class Block(BaseModel):
    text: str
    page: int
    heading: Optional[str] = None


class ParseResult(BaseModel):
    blocks: list[Block]
    page_count: int


def looks_like_heading(line: str) -> bool:
    """Heuristic to detect chapter/section headings in extracted text."""
    t = line.strip()
    if not t or len(t) > HEADING_MAX_LEN:
        return False
    if HEADING_NUMBER_REGEX.match(t):
        return True
    if COMMON_SECTION_REGEX.search(t):
        return True
    letters = re.sub(r"[^A-Za-z]", "", t)
    if len(letters) > 3 and letters == letters.upper() and len(t.split()) <= 10:
        return True
    return False


def parse_pdf(pdf_bytes: bytes) -> ParseResult:
    """
    Extract page-tagged blocks from a PDF, preserving page numbers and section headings.
    Uses PyMuPDF (fitz) if installed, with PyPDF2 / pypdf as fallback.
    """
    pages_text: list[str] = []

    try:
        import fitz  # PyMuPDF
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        for page in doc:
            pages_text.append(page.get_text("text") or "")
        doc.close()
    except ImportError:
        try:
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
            for page in reader.pages:
                pages_text.append(page.extract_text() or "")
        except ImportError:
            import PyPDF2
            reader = PyPDF2.PdfReader(io.BytesIO(pdf_bytes))
            for page in reader.pages:
                pages_text.append(page.extract_text() or "")

    blocks: list[Block] = []
    heading: Optional[str] = None

    for i, page_text in enumerate(pages_text):
        page = i + 1
        lines = re.split(r"\n+", page_text or "")
        buffer: list[str] = []

        def flush():
            nonlocal buffer
            body = re.sub(r"\s+", " ", " ".join(buffer)).strip()
            if body:
                blocks.append(Block(text=body, page=page, heading=heading))
            buffer = []

        for raw in lines:
            line = raw.strip()
            if not line:
                continue
            if looks_like_heading(line):
                flush()
                heading = line
            else:
                buffer.append(line)
        flush()

    return ParseResult(blocks=blocks, page_count=len(pages_text))


def parse_docx(docx_bytes: bytes) -> ParseResult:
    """
    Extract blocks from a DOCX by reading word/document.xml directly.
    Pure Python, worker-safe, no external native dependencies required.
    """
    with zipfile.ZipFile(io.BytesIO(docx_bytes)) as zf:
        if "word/document.xml" not in zf.namelist():
            raise ValueError("Not a readable DOCX file: missing word/document.xml")
        xml_content = zf.read("word/document.xml")

    # Namespaces used in WordprocessingML
    ns = {
        "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    }

    root = ET.fromstring(xml_content)
    blocks: list[Block] = []
    heading: Optional[str] = None
    char_count = 0

    # Each <w:p> is a paragraph
    paragraphs = root.findall(".//w:p", ns)
    for p in paragraphs:
        # Check style (e.g. Heading1, Title, etc.)
        style_val = ""
        p_style = p.find(".//w:pStyle", ns)
        if p_style is not None:
            style_val = p_style.attrib.get(f"{{{ns['w']}}}val", "")

        # Extract text from all <w:t> tags in this paragraph
        text_elements = p.findall(".//w:t", ns)
        text = "".join(t.text or "" for t in text_elements).strip()
        text = re.sub(r"\s+", " ", text)
        if not text:
            continue

        if re.search(r"^heading", style_val, re.IGNORECASE) or re.search(r"^title$", style_val, re.IGNORECASE) or looks_like_heading(text):
            heading = text
            continue

        char_count += len(text)
        page = (char_count // 2500) + 1
        blocks.append(Block(text=text, page=page, heading=heading))

    page_count = max(1, (char_count // 2500) + 1)
    return ParseResult(blocks=blocks, page_count=page_count)


def parse_markdown(md_bytes: bytes) -> ParseResult:
    """
    Extract structured blocks from a Markdown (.md, .markdown, .txt) file.
    Detects section headings (# H1, ## H2, etc.), preserves code blocks,
    and calculates page numbers based on reading pace (~2000 chars per page).
    """
    try:
        content = md_bytes.decode("utf-8")
    except UnicodeDecodeError:
        content = md_bytes.decode("latin-1", errors="replace")

    lines = content.splitlines()
    blocks: list[Block] = []
    heading: Optional[str] = None
    char_count = 0
    buffer: list[str] = []
    in_code_block = False

    def flush():
        nonlocal buffer, char_count
        if not buffer:
            return
        text = "\n".join(buffer).strip()
        if text:
            char_count += len(text)
            page = max(1, (char_count // 2000) + 1)
            blocks.append(Block(text=text, page=page, heading=heading))
        buffer = []

    for raw_line in lines:
        line = raw_line.strip()

        # Handle fenced code blocks
        if line.startswith("```"):
            in_code_block = not in_code_block
            buffer.append(raw_line)
            if not in_code_block:
                flush()
            continue

        if in_code_block:
            buffer.append(raw_line)
            continue

        # Check for markdown ATX headings (# H1, ## H2, etc.)
        heading_match = re.match(r"^(#{1,6})\s+(.+)$", line)
        if heading_match:
            flush()
            heading = heading_match.group(2).strip()
            continue

        # Check for setext headings (line followed by === or ---)
        if buffer and (re.match(r"^={3,}\s*$", line) or re.match(r"^-{3,}\s*$", line)):
            possible_title = buffer.pop().strip()
            flush()
            if possible_title:
                heading = possible_title
            continue

        if not line:
            # Paragraph boundary
            flush()
        else:
            buffer.append(line)

    flush()

    total_chars = max(char_count, 1)
    page_count = max(1, (total_chars // 2000) + 1)
    return ParseResult(blocks=blocks, page_count=page_count)


def parse_document(filename: str, bytes_data: bytes) -> ParseResult:
    """Parse document bytes based on file extension."""
    lower = filename.lower()
    if lower.endswith(".pdf"):
        return parse_pdf(bytes_data)
    if lower.endswith(".docx"):
        return parse_docx(bytes_data)
    if lower.endswith((".md", ".markdown", ".txt")):
        return parse_markdown(bytes_data)
    raise ValueError(f"Unsupported file type for {filename}. Supported formats: PDF, DOCX, Markdown (.md).")

