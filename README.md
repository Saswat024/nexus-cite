# Research Compass

I'm building a production-grade RAG research assistant — chat over a large corpus

(research papers / course material) with grounded, cited answers. Build it to this

spec exactly; this needs to read as production infrastructure, not a PDF-chatbot demo.

##Stack

- Frontend: React + Vite + TypeScript + Tailwind + shadcn/ui

- Backend: Supabase (Lovable Cloud) — Postgres, Auth (email + Google OAuth), Storage
for raw file uploads, Edge Functions (Deno/TS) for ALL server-side orchestration

- Vector + hybrid search: Qdrant Cloud, called via REST from an Edge Function
(I'll provide QDRANT_URL and QDRANT_API_KEY as secrets) — use Qdrant's native
hybrid query (dense + sparse/BM25) with RRF fusion, not a single dense pass

- Reranker: BAAI BGE Reranker v2 M3, using an open-source/self-hosted deployment
and called via REST from the same Edge Function

- Generation: GPT-OSS via Groq, called via REST from the same Edge Function
(I'll provide GROQ_API_KEY as a secret)

- No API key or secret is ever referenced from client code — everything routes
through Edge Functions

## Data model (Postgres)

- documents: id, title, storage_path, uploaded_by, status (processing/ready/failed), created_at

- document_chunks: id, document_id fk, content, page_number, section_heading,

  qdrant_point_id, created_at

- chat_sessions: id, user_id, title, created_at

- messages: id, session_id, role, content, created_at

- citations: id, message_id, chunk_id, relevance_score

## Flow 1 — Ingestion

1. User uploads a PDF/DOCX from the sidebar → stored in Supabase Storage

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

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/70201093-2d93-4ab5-bbc9-066f328ad8f7).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
