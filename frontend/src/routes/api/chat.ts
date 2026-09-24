import { createFileRoute } from "@tanstack/react-router";
import { verifyToken } from "@/integrations/mongodb/auth.server";

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

        const claims = verifyToken(token);
        if (!claims || !claims.sub) return json({ error: "Unauthorized" }, 401);
        const userId = claims.sub as string;


        const body = (await request.json()) as Body;
        if (!body?.sessionId || !body?.question?.trim()) return json({ error: "Invalid request" }, 400);

        const {
          getSessionById,
          getSessionMessagesWithCitations,
          insertMessage,
          insertCitations,
          getUserDocuments,
          updateSessionTitle,
        } = await import("@/integrations/mongodb/operations");

        const session = await getSessionById(body.sessionId, userId);
        if (!session) return json({ error: "Session not found" }, 404);

        const { streamChatInPython, generateTitleInPython } = await import("@/lib/rag/client");

        try {
          const question = body.question.trim();

          // Auto-generate a descriptive conversation title if it is currently "New conversation"
          if (session.title === "New conversation" || !session.title) {
            void generateTitleInPython(question)
              .then(async (newTitle) => {
                if (newTitle) {
                  await updateSessionTitle(body.sessionId, userId, newTitle);
                }
              })
              .catch((err) => console.warn("Background title generation failed:", err));
          }

          const history = await getSessionMessagesWithCitations(body.sessionId);

          // Save user message to MongoDB
          await insertMessage({
            sessionId: body.sessionId,
            role: "user",
            content: question,
          });

          // Fetch titles for user documents from MongoDB
          const userDocs = await getUserDocuments(userId);
          const titles: Record<string, string> = {};
          for (const d of userDocs) {
            titles[d.id] = d.title;
          }

          const pythonResponse = await streamChatInPython({
            sessionId: body.sessionId,
            question,
            userId,
            documentIds: body.documentIds,
            documentTitles: titles,
            history: (history ?? []).map((m) => ({
              role: m.role as string,
              content: m.content as string,
            })),
          });

          if (!pythonResponse.body) {
            throw new Error("No response body from Python RAG service");
          }

          const reader = pythonResponse.body.getReader();
          const decoder = new TextDecoder();
          const encoder = new TextEncoder();

          const stream = new ReadableStream({
            async start(controller) {
              const send = (event: string, payload: unknown) =>
                controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));

              let buffer = "";
              let answer = "";
              let citationMeta: Array<{
                index: number;
                chunk_id: string;
                document_id: string;
                relevance_score?: number;
              }> = [];

              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;

                  buffer += decoder.decode(value, { stream: true });
                  const frames = buffer.split("\n\n");
                  buffer = frames.pop() ?? "";

                  for (const frame of frames) {
                    const eventLine = frame.split("\n").find((l) => l.startsWith("event:"));
                    const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
                    if (!eventLine || !dataLine) continue;

                    const event = eventLine.slice(6).trim();
                    const payload = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;

                    if (event === "sources") {
                      citationMeta = (payload["citations"] as typeof citationMeta) ?? [];
                      send("sources", payload);
                    } else if (event === "token") {
                      const text = (payload["text"] as string) ?? "";
                      answer += text;
                      send("token", { text });
                    } else if (event === "error") {
                      throw new Error((payload["message"] as string) ?? "Generation failed");
                    }
                  }
                }

                // Persist the assistant message in MongoDB
                const assistantMessage = await insertMessage({
                  sessionId: body.sessionId,
                  role: "assistant",
                  content: answer,
                });

                if (assistantMessage && citationMeta.length > 0) {
                  const used = new Set(
                    [...answer.matchAll(/[[【［]\s*(\d+)(?:†[^\]】］]*)?\s*[\]】］]/g)].map((m) => Number(m[1])),
                  );

                  const rows = citationMeta
                    .filter((c) => used.size === 0 || used.has(c.index))
                    .map((c) => ({
                      message_id: assistantMessage.id,
                      chunk_id: c.chunk_id,
                      citation_index: c.index,
                      relevance_score: c.relevance_score ?? 1.0,
                    }));

                  if (rows.length) {
                    await insertCitations(rows);
                  }
                }

                send("done", { messageId: assistantMessage?.id ?? null });
              } catch (error) {
                console.error("Python streaming error:", error);
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
