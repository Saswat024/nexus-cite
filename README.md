# Nexus Cite (Atlas) — Grounded Research Assistant

Nexus Cite is a production-grade, retrieval-augmented research assistant designed for querying academic papers, documentation, and large research corpora. It features hybrid dense + lexical retrieval, cross-encoder reranking, and citation-grounded streaming generation.

---

## Architecture Overview

The application is decoupled into independent microservices:

```
Nexus Cite/
├── backend/                  # Python FastAPI RAG Microservice
│   ├── server.py             # REST & SSE streaming endpoints
│   ├── embeddings.py         # Dense embeddings (Qwen) & BM25 sparse vectors
│   ├── chunking.py           # Section-aware chunking & prompt-injection defense
│   ├── qdrant.py             # Qdrant Cloud hybrid search (Dense + Sparse with RRF)
│   ├── rerank.py             # BAAI BGE Reranker v2 M3 cross-encoder
│   ├── groq.py               # Fast LLM streaming with strict citation grounding
│   ├── mongo.py              # MongoDB Atlas & GridFS storage operations
│   ├── parse.py              # PDF (PyMuPDF) and DOCX text extraction
│   ├── Dockerfile            # Container configuration for Render
│   └── requirements.txt      # Python dependencies
│
├── frontend/                 # TanStack Start & React 19 Web Application
│   ├── src/
│   │   ├── routes/           # File-based routes (/auth, /workspace, /api/chat)
│   │   ├── components/       # Atlas UI (ChatPanel, DocumentLibrary, SourceSheet)
│   │   ├── lib/              # Server functions, types, and backend RAG connector
│   │   ├── integrations/     # Native MongoDB auth and database operations
│   │   └── server.ts         # Nitro/SSR entrypoint with server function pre-registration
│   ├── public/               # Favicon and branded logo assets
│   ├── package.json          # Node dependencies
│   └── vite.config.ts        # Vite + TanStack Start configuration (Vercel Nitro preset)
│
├── render.yaml               # Render Blueprint for automated backend deployment
└── Dockerfile                # Root fallback container definition
```

---

## Key Capabilities

- **Dense Embeddings**: `Qwen/Qwen3-Embedding-8B` (4096 dimensions via Hugging Face Scaleway provider).
- **Lexical Sparse Vectors**: Exact BM25 term-frequency vectors combined with dense vectors using Reciprocal Rank Fusion (RRF).
- **Cross-Encoder Reranker**: BAAI BGE Reranker v2 M3 for deep relevance sorting of top candidate chunks.
- **Strict Grounding**: Citations extracted directly from verified document chunks and displayed with interactive inline badges.
- **Native MongoDB Storage**: Raw documents saved directly in MongoDB Atlas GridFS; user accounts, sessions, and messages persisted in MongoDB collections.
- **Batch Management**: Dedicated "Delete All Documents" modal that purges GridFS binaries, MongoDB metadata, and Qdrant vector points in one transaction.

---

## Local Development

### 1. Prerequisites
- **Python 3.11+**
- **Node.js 20+** and **npm**
- **MongoDB Atlas** cluster
- **Qdrant Cloud** cluster
- API keys for **Groq** and **Hugging Face**

---

### 2. Backend Setup (FastAPI RAG Engine)
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Create `backend/.env`:
```env
GROQ_API_KEY=your_groq_api_key
HUGGINGFACE_API_KEY=your_huggingface_api_key
QDRANT_URL=https://your-cluster.qdrant.io:6333
QDRANT_API_KEY=your_qdrant_api_key
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=nexus_cite
```

Run the backend development server:
```bash
python -m uvicorn server:app --port 8000 --reload
```
- Health Check: `http://127.0.0.1:8000/health`
- Interactive API Docs: `http://127.0.0.1:8000/docs`

---

### 3. Frontend Setup (TanStack Start & React 19)
```bash
cd frontend
npm install
```

Create `frontend/.env`:
```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=nexus_cite
JWT_SECRET=your_secure_jwt_secret_key_here
PYTHON_RAG_URL=http://127.0.0.1:8000
```

Start the frontend development server:
```bash
npm run dev
```
- Application: `http://localhost:8080/`

---

## Production Deployment

### Backend on Render (Docker)
1. In [Render Dashboard](https://dashboard.render.com), click **New +** &rarr; **Web Service**.
2. Connect your GitHub repository.
3. Configure the service:
   - **Root Directory**: `backend`
   - **Runtime**: `Docker`
   - **Health Check Path**: `/health`
4. Set Environment Variables:
   - `GROQ_API_KEY`
   - `HUGGINGFACE_API_KEY`
   - `QDRANT_URL`
   - `QDRANT_API_KEY`
   - `MONGODB_URI`
   - `MONGODB_DB_NAME`
5. Copy the deployed backend URL (e.g., `https://nexus-cite-backend.onrender.com`).

> **Note**: In your MongoDB Atlas Network Access settings, ensure `0.0.0.0/0` is added to allow connections from Render's dynamic IP ranges.

### Frontend on Vercel
1. In [Vercel Dashboard](https://vercel.com), click **Add New...** &rarr; **Project**.
2. Import your GitHub repository.
3. Configure settings:
   - **Root Directory**: `frontend`
   - **Framework Preset**: `Other` (or `Vite`)
   - **Build Command**: `npm run build`
   - **Output Directory**: (leave empty / auto-detected `.vercel/output`)
4. Set Environment Variables:
   - `PYTHON_RAG_URL`: Your Render backend URL (e.g. `https://nexus-cite-backend.onrender.com`)
   - `MONGODB_URI`: Your MongoDB Atlas URI
   - `MONGODB_DB_NAME`: `nexus_cite`
   - `JWT_SECRET`: A secure random string
5. Click **Deploy**.
