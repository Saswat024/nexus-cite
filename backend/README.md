# Atlas RAG Engine (Backend)

High-performance Python RAG microservice supporting hybrid dense and lexical search, BAAI BGE reranking, and grounded answer generation with Groq.

## Stack & Architecture
- **Framework**: FastAPI (Async, Uvicorn)
- **Embeddings**: `Qwen/Qwen3-Embedding-8B` (4096 dimensions via Hugging Face Scaleway provider)
- **Lexical Sparse Vector**: BM25 hashed token frequencies (exact parity with Qdrant sparse index)
- **Vector DB**: Qdrant Cloud (dense + lexical sparse vectors with Reciprocal Rank Fusion)
- **Reranker**: BAAI BGE Reranker v2 M3
- **LLM Generator**: Groq LLM streaming (`openai/gpt-oss-120b` or `llama-3.3-70b-versatile`)
- **Document Store**: MongoDB Atlas & GridFS

## Setup & Running

1. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

2. **Configure environment variables**:
   Create or verify `.env` in this directory:
   ```env
   GROQ_API_KEY=your_groq_api_key
   HUGGINGFACE_API_KEY=your_hf_token
   HF_TOKEN=your_hf_token
   QDRANT_URL=your_qdrant_url
   QDRANT_API_KEY=your_qdrant_api_key
   MONGODB_URI=your_mongodb_atlas_uri
   MONGODB_DB_NAME=nexus_cite
   ```

3. **Run the FastAPI server**:
   ```bash
   python -m uvicorn server:app --port 8000 --reload
   ```

4. **Verify Health**:
   Open `http://127.0.0.1:8000/health` or `http://127.0.0.1:8000/docs` for the interactive Swagger documentation.

5. **Run test suite**:
   ```bash
   python test_github_pdf_rag.py
   ```
