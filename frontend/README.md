# Research Compass

I'm building a production-grade RAG research assistant — chat over a large corpus

(research papers / course material) with grounded, cited answers. Build it to this

spec exactly; this needs to read as production infrastructure, not a PDF-chatbot demo.

## Stack

- Frontend: React 19 + TanStack Start + Vite + TypeScript + Tailwind + shadcn/ui

- Storage & Database: MongoDB Atlas
  - Raw document files (PDF/DOCX) stored in MongoDB GridFS (`documents_fs` bucket)
  - Collections for `documents`, `document_chunks`, `chat_sessions`, `messages`, and `citations`

- Core RAG Engine (Python): FastAPI microservice (`src/lib/rag`)
  - PDF/DOCX parsing preserving page numbers and section boundaries
  - Section-aware chunking and prompt-injection defense
  - Dense embeddings via Hugging Face (`sentence-transformers/all-MiniLM-L6-v2`) + BM25 lexical sparse vectors
  - Hybrid retrieval on Qdrant Cloud with native RRF fusion
  - Cross-encoder reranking with BAAI BGE Reranker v2 M3
  - Grounded SSE streaming completions on Groq (`openai/gpt-oss-120b`)

## Flow 1 — Ingestion

1. User uploads a PDF/DOCX from the sidebar → stored directly in MongoDB GridFS
2. Python RAG Engine parses the document preserving page numbers and headings
3. Splits into section-aware chunks and sanitizes instruction-like text
4. Embeds each chunk (dense + lexical sparse) and upserts points into Qdrant Cloud
5. Persists matching chunk records to MongoDB `document_chunks` and flips document status to "ready"

2. An Edge Function parses it, preserving page numbers and section headers, and

   splits it into chunks along natural section boundaries — not blind fixed-size

   windows

3. Embeds each chunk, upserts into Qdrant with payload {document_id, chunk_id,

   page_number, section_heading}, inserts a matching row into document_chunks

4. Flips documents.status to "ready"; UI shows a processing indicator until then

## Flow 2 — Query

1. User asks a question in the chat panel

2. Edge Function: embeds the query → Qdrant hybrid search with RRF fusion,

   top ~20 → Cohere rerank → keep top 5

3. Builds a context block from those 5 chunks, each tagged with a citation index

4. Calls the generation model with a strict system prompt: answer ONLY from the

   given context, cite every claim as [1] [2] etc., and if the context doesn't

   support an answer, say so explicitly instead of filling the gap from general

   knowledge

5. Streams the response back; stores the assistant message and citation rows

## UI

- Left sidebar: document library — upload button, list with status badges

- Main panel: chat interface; citations render as inline numbered chips; clicking

  one opens a side panel showing the exact source chunk highlighted, with a

  jump-to-document link

- Clean modern SaaS look, dark mode, loading skeletons during ingestion/streaming

## Security

- RLS so a user only ever sees their own documents and chats

- Sanitize/flag any instruction-like text found inside ingested documents before

  it reaches the context window (basic prompt-injection defense on ingestion)

Start with the schema, the ingestion Edge Function, and the query Edge Function,

then wire the chat UI to real data. Ask me for each secret as you need it.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
