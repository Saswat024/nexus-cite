import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Body = {
  sessionId: string;
  question: string;
  documentIds?: string[];
};

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Query pipeline (streaming):
 * embed query -> Qdrant hybrid search (dense + sparse, RRF) top 20 ->
 * BGE reranker top 5 -> numbered context block -> GPT-OSS on Groq (strict grounded
 * prompt) -> stream tokens -> persist assistant message + citation rows.
 */
export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (!token) return json({ error: "Unauthorized" }, 401);

        const supabaseUrl = process.env["SUPABASE_URL"]!;
        const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
        const supabase = createClient<Database>(supabaseUrl, publishableKey, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: {
            fetch: (input, init) => {
              const headers = new Headers(init?.headers);
              headers.set("apikey", publishableKey);
              headers.set("Authorization", `Bearer ${token}`);
              return fetch(input, { ...init, headers });
            },
          },
        });

        const { data: userData, error: userError } = await supabase.auth.getUser(token);
        if (userError || !userData.user) return json({ error: "Unauthorized" }, 401);
        const userId = userData.user.id;

        const body = (await request.json()) as Body;
        if (!body?.sessionId || !body?.question?.trim()) return json({ error: "Invalid request" }, 400);

        const { data: session } = await supabase
          .from("chat_sessions")
          .select("id")
          .eq("id", body.sessionId)
          .eq("user_id", userId)
          .single();
        if (!session) return json({ error: "Session not found" }, 404);

        const { embedQuery } = await import("@/lib/rag/embeddings.server");
        const { hybridSearch } = await import("@/lib/rag/qdrant.server");
        const { rerank } = await import("@/lib/rag/rerank.server");
        const { buildContextBlock, streamGroqAnswer } = await import("@/lib/rag/groq.server");

        try {
          const question = body.question.trim();

          const { data: history } = await supabase
            .from("messages")
            .select("role, content")
            .eq("session_id", body.sessionId)
            .order("created_at", { ascending: true })
            .limit(20);

          await supabase.from("messages").insert({
            session_id: body.sessionId,
            role: "user",
            content: question,
          });

          const denseVector = await embedQuery(question);
          const hits = await hybridSearch({
            denseVector,
            queryText: question,
            userId,
            documentIds: body.documentIds,
            limit: 20,
          });

          if (!hits.length) {
            const answer =
              "The provided documents don't contain enough information to answer that. Upload or select a document first.";
            await supabase
              .from("messages")
              .insert({ session_id: body.sessionId, role: "assistant", content: answer });
            return new Response(
              `event: token\ndata: ${JSON.stringify({ text: answer })}\n\nevent: done\ndata: ${JSON.stringify({ citations: [] })}\n\n`,
              { headers: { "Content-Type": "text/event-stream" } },
            );
          }

          // Reranking is a quality boost, not a hard dependency: if the reranker
          // endpoint is unreachable or misconfigured, fall back to fused RRF order.
          let ranked: { index: number; score: number }[];
          try {
            ranked = await rerank(
              question,
              hits.map((h) => h.payload.content),
              5,
            );
          } catch (rerankError) {
            console.error("Reranker unavailable, falling back to RRF order", rerankError);
            ranked = hits.slice(0, 5).map((h, index) => ({ index, score: h.score }));
          }


          const top = ranked
            .map((r, i) => {
              const hit = hits[r.index];
              if (!hit) return null;
              return { index: i + 1, hit, score: r.score };
            })
            .filter((v): v is { index: number; hit: (typeof hits)[number]; score: number } => v !== null);

          const documentIds = [...new Set(top.map((t) => t.hit.payload.document_id))];
          const { data: docs } = await supabase
            .from("documents")
            .select("id, title")
            .in("id", documentIds);
          const titles = new Map((docs ?? []).map((d) => [d.id, d.title]));

          const contextItems = top.map((t) => ({
            index: t.index,
            content: t.hit.payload.content,
            title: titles.get(t.hit.payload.document_id) ?? "Document",
            page_number: t.hit.payload.page_number,
            section_heading: t.hit.payload.section_heading,
          }));

          const citationMeta = top.map((t) => ({
            index: t.index,
            chunk_id: t.hit.payload.chunk_id,
            document_id: t.hit.payload.document_id,
            document_title: titles.get(t.hit.payload.document_id) ?? "Document",
            page_number: t.hit.payload.page_number,
            section_heading: t.hit.payload.section_heading,
            relevance_score: t.score,
            content: t.hit.payload.content,
          }));

          const context = buildContextBlock(contextItems);
          const encoder = new TextEncoder();

          const stream = new ReadableStream({
            async start(controller) {
              const send = (event: string, payload: unknown) =>
                controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));

              let answer = "";
              try {
                send("sources", { citations: citationMeta });
                for await (const delta of streamGroqAnswer({
                  question,
                  context,
                  history: (history ?? []).map((m) => ({
                    role: m.role as "user" | "assistant",
                    content: m.content,
                  })),
                })) {
                  answer += delta;
                  send("token", { text: delta });
                }

                const { data: assistantMessage, error: messageError } = await supabase
                  .from("messages")
                  .insert({ session_id: body.sessionId, role: "assistant", content: answer })
                  .select("id")
                  .single();
                if (messageError) console.error("Failed to store assistant message", messageError);

                if (assistantMessage) {
                  const used = new Set(
                    [...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])),
                  );
                  const rows = citationMeta
                    .filter((c) => used.size === 0 || used.has(c.index))
                    .map((c) => ({
                      message_id: assistantMessage.id,
                      chunk_id: c.chunk_id,
                      citation_index: c.index,
                      relevance_score: c.relevance_score,
                    }));
                  if (rows.length) {
                    const { error: citationError } = await supabase.from("citations").insert(rows);
                    if (citationError) console.error("Failed to store citations", citationError);
                  }
                }

                send("done", { messageId: assistantMessage?.id ?? null });
              } catch (error) {
                console.error(error);
                send("error", {
                  message: error instanceof Error ? error.message : "Something went wrong",
                });
              } finally {
                controller.close();
              }
            },
          });

          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-store",
              Connection: "keep-alive",
            },
          });
        } catch (error) {
          console.error(error);
          return json(
            { error: error instanceof Error ? error.message : "Retrieval failed" },
            500,
          );
        }
      },
    },
  },
});
