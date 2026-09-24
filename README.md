# Atlas — Grounded Research Assistant

Atlas is a retrieval-augmented research assistant designed for querying academic papers, documentation, and research corpora with hybrid retrieval, BGE reranking, and citation grounding.

## Project Structure

The project is decoupled into independent backend and frontend services:

```
RAG/
├── backend/                  # Python FastAPI RAG Microservice
│   ├── server.py             # FastAPI REST and Streaming endpoints
│   ├── embeddings.py         # Qwen/Qwen3-Embedding-8B (Scaleway) & BM25 sparse vectors
│   ├── chunking.py           # Section-aware chunking & prompt-injection defense
│   ├── qdrant.py             # Qdrant Cloud hybrid search (Dense + Lexical Sparse with RRF)
│   ├── rerank.py             # BAAI BGE Reranker v2 M3
│   ├── groq.py               # Groq LLM streaming with strict citation grounding
│   ├── mongo.py              # MongoDB Atlas & GridFS storage operations
│   ├── parse.py              # PDF (PyMuPDF) and DOCX extraction
│   ├── requirements.txt      # Python dependencies
│   ├── test_github_pdf_rag.py# Comprehensive RAG pipeline test suite
│   └── GitHub.pdf            # Sample test document
│
└── frontend/                 # TanStack Start & React 19 Web Application
    ├── src/
    │   ├── components/       # Atlas UI (ChatPanel, DocumentLibrary, SourceSheet)
    │   ├── routes/           # File-based routes (/auth, /workspace, /api/chat)
    │   ├── lib/              # Client functions, types, and backend RAG connector
    │   └── integrations/     # Native MongoDB authentication and operations
    ├── package.json          # Node dependencies and scripts
    └── vite.config.ts        # Vite + TanStack Start configuration
```

## Quick Start

### 1. Start the Backend (FastAPI RAG Engine)
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn server:app --port 8000 --reload
```
- Health Check: `http://127.0.0.1:8000/health`
- Interactive API Docs: `http://127.0.0.1:8000/docs`

### 2. Start the Frontend (Atlas Web App)
```bash
cd frontend
npm install
npm run dev
```
- Web Application: `http://localhost:8080/`

## Key Capabilities
- **Dense Embeddings**: `Qwen/Qwen3-Embedding-8B` (4096 dimensions via Scaleway provider).
- **Lexical Sparse Vectors**: Exact BM25 term-frequency vectors fused with dense vectors using Reciprocal Rank Fusion (RRF).
- **Reranker**: BAAI BGE Reranker v2 M3 for relevance sorting.
- **Strict Grounding**: Citations extracted directly from verified document chunks and displayed with inline badges.
- **Native MongoDB Storage**: Documents and files saved directly into MongoDB Atlas GridFS; sessions and messages persisted in MongoDB collections.
- **Zero Email Verification**: Instant account creation and sign-in.
