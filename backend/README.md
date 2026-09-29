# Nexus Cite — Python RAG Engine (Backend)

High-performance Python microservice powering document ingestion, section-aware chunking, hybrid vector search (Dense + BM25 Sparse), BAAI BGE reranking, and citation-grounded generation via Groq.

---

## Tech Stack & Architecture

- **Framework**: FastAPI (Async, Uvicorn)
- **Embeddings**: `Qwen/Qwen3-Embedding-8B` (4096 dimensions via Hugging Face Scaleway provider)
- **Lexical Sparse Vector**: Exact BM25 token frequencies mapped into sparse vectors for Qdrant
- **Vector Database**: Qdrant Cloud (hybrid dense + sparse indices with Reciprocal Rank Fusion)
- **Cross-Encoder Reranker**: BAAI BGE Reranker v2 M3
- **LLM Generator**: Groq streaming API (`openai/gpt-oss-120b` or `qwen/qwen3.8-27b`)
- **Document Store**: MongoDB Atlas & GridFS (`documents_fs`)
- **Parser**: PyMuPDF (`fitz`) and `pypdf` with section-boundary detection

---

## Local Development

### 1. Install Dependencies
```bash
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure Environment Variables
Create `.env` in this directory:
```env
GROQ_API_KEY=your_groq_api_key
HUGGINGFACE_API_KEY=your_huggingface_api_key
QDRANT_URL=https://your-cluster-id.region.aws.cloud.qdrant.io:6333
QDRANT_API_KEY=your_qdrant_api_key
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=nexus_cite
```

### 3. Run Development Server
```bash
python -m uvicorn server:app --port 8000 --reload
```
- Root Endpoint: `http://127.0.0.1:8000/`
- Health Check: `http://127.0.0.1:8000/health`
- Interactive OpenAPI Docs: `http://127.0.0.1:8000/docs`

---

## Docker & Container Deployment

### Local Docker Build & Run
```bash
# Build Docker image
docker build -t nexus-cite-backend .

# Run container mapping port 8000
docker run -p 8000:8000 --env-file .env nexus-cite-backend
```

### Render Deployment
This service is configured for direct deployment on **Render**:
- **Runtime**: Docker
- **Root Directory**: `backend`
- **Health Check Path**: `/health`
- Render assigns a dynamic `$PORT` environment variable, which the Docker container automatically binds to using `0.0.0.0:${PORT:-8000}`.

---

## API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/` | Service status and version info |
| `GET` | `/health` | Health check probe (validates Qdrant, Groq, HF, Mongo configs) |
| `POST` | `/api/rag/ingest` | Parses, chunks, embeds, and indexes document files |
| `POST` | `/api/rag/chunk` | Section-aware chunking and injection sanitization |
| `POST` | `/api/rag/embed` | Generates dense and sparse vectors for text batches |
| `POST` | `/api/rag/hybrid-search` | Executes Qdrant hybrid retrieval with RRF fusion |
| `POST` | `/api/rag/rerank` | Reranks top candidates with BGE Reranker v2 M3 |
| `POST` | `/api/rag/chat/stream` | Server-Sent Events (SSE) streaming answers with grounded citations |
| `POST` | `/api/rag/generate-title` | Generates concise 3-5 word conversation title |
| `DELETE` | `/api/rag/documents/{document_id}` | Deletes document vectors from Qdrant |
| `DELETE` | `/api/rag/documents/user/{user_id}` | Purges all indexed document vectors for a user |
