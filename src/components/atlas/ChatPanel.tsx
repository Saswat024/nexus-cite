import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ArrowUp, Loader2, Quote, Square } from "lucide-react";
import { MessageBody } from "./MessageBody";
import type { ChatMessage, CitationMeta } from "@/lib/atlas-types";

type Props = {
  sessionId: string | null;
  documentIds: string[];
  onCitationClick: (citation: CitationMeta) => void;
};

export function ChatPanel({ sessionId, documentIds, onCitationClick }: Props) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<ChatMessage | null>(null);
  const [userEcho, setUserEcho] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { data: messages, isLoading } = useQuery({
    queryKey: ["messages", sessionId],
    enabled: !!sessionId,
    queryFn: async (): Promise<ChatMessage[]> => {
      if (!sessionId) return [];
      const { data: rows, error } = await supabase
        .from("messages")
        .select("id, role, content, created_at")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });
      if (error) throw error;

      const ids = (rows ?? []).map((r) => r.id);
      let citationsByMessage = new Map<string, CitationMeta[]>();
      if (ids.length) {
        const { data: cites } = await supabase
          .from("citations")
          .select(
            "message_id, citation_index, relevance_score, document_chunks(id, content, page_number, section_heading, document_id, documents(title))",
          )
          .in("message_id", ids)
          .order("citation_index", { ascending: true });

        citationsByMessage = new Map();
        for (const row of cites ?? []) {
          const chunk = row.document_chunks as unknown as {
            id: string;
            content: string;
            page_number: number | null;
            section_heading: string | null;
            document_id: string;
            documents: { title: string } | null;
          } | null;
          if (!chunk) continue;
          const list = citationsByMessage.get(row.message_id) ?? [];
          list.push({
            index: row.citation_index,
            chunk_id: chunk.id,
            document_id: chunk.document_id,
            document_title: chunk.documents?.title ?? "Document",
            page_number: chunk.page_number,
            section_heading: chunk.section_heading,
            relevance_score: row.relevance_score,
            content: chunk.content,
          });
          citationsByMessage.set(row.message_id, list);
        }
      }

      return (rows ?? []).map((row) => ({
        id: row.id,
        role: row.role as "user" | "assistant",
        content: row.content,
        created_at: row.created_at,
        citations: citationsByMessage.get(row.id) ?? [],
      }));
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending, userEcho]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [sessionId, streaming]);

  const send = async () => {
    const question = input.trim();
    if (!question || !sessionId || streaming) return;

    setInput("");
    setUserEcho(question);
    setStreaming(true);
    setPending({
      id: "pending",
      role: "assistant",
      content: "",
      created_at: new Date().toISOString(),
      citations: [],
      streaming: true,
    });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Your session expired — sign in again");

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sessionId, question, documentIds }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? "The assistant could not respond");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let citations: CitationMeta[] = [];
      let answer = "";

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
            citations = payload["citations"] as CitationMeta[];
            setPending((prev) => (prev ? { ...prev, citations } : prev));
          } else if (event === "token") {
            answer += payload["text"] as string;
            setPending((prev) => (prev ? { ...prev, content: answer, citations } : prev));
          } else if (event === "error") {
            throw new Error((payload["message"] as string) ?? "Generation failed");
          }
        }
      }

      await queryClient.invalidateQueries({ queryKey: ["messages", sessionId] });
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") {
        toast.error(error instanceof Error ? error.message : "Something went wrong");
      }
      await queryClient.invalidateQueries({ queryKey: ["messages", sessionId] });
    } finally {
      setStreaming(false);
      setPending(null);
      setUserEcho(null);
      abortRef.current = null;
    }
  };

  const rendered: ChatMessage[] = [
    ...(messages ?? []),
    ...(userEcho
      ? [
          {
            id: "echo",
            role: "user" as const,
            content: userEcho,
            created_at: new Date().toISOString(),
            citations: [],
          },
        ]
      : []),
    ...(pending ? [pending] : []),
  ];

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
          {isLoading && sessionId && (
            <div className="space-y-4">
              <Skeleton className="h-10 w-2/3" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}

          {!isLoading && rendered.length === 0 && (
            <div className="pt-16 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/25">
                <Quote className="size-5" />
              </div>
              <h2 className="mt-4 font-display text-lg font-semibold">Ask your corpus</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                Every answer is drawn only from your indexed documents, with a numbered citation for
                each claim. Retrieval runs hybrid dense + lexical search, fused with RRF, then
                reranked with BGE v2 M3.
              </p>
            </div>
          )}

          {rendered.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="flex justify-end">
                <div className="max-w-[80%] rounded-lg bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                  {message.content}
                </div>
              </div>
            ) : (
              <div key={message.id} className="space-y-3">
                {message.streaming && !message.content ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Retrieving, reranking and grounding…
                  </div>
                ) : (
                  <MessageBody
                    content={message.content}
                    citations={message.citations}
                    onCitationClick={onCitationClick}
                  />
                )}

                {message.citations.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {message.citations.map((citation) => (
                      <button
                        key={`${message.id}-${citation.index}`}
                        type="button"
                        onClick={() => onCitationClick(citation)}
                        className="flex max-w-[16rem] items-center gap-1.5 rounded-md border border-border bg-elevated/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                      >
                        <span className="citation-chip">{citation.index}</span>
                        <span className="truncate">
                          {citation.document_title}
                          {citation.page_number ? ` · p${citation.page_number}` : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ),
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div className="border-t border-border bg-surface/60 p-4">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            disabled={!sessionId}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="Ask a question grounded in your documents…"
            className="min-h-[3.5rem] resize-none bg-background"
          />
          {streaming ? (
            <Button
              variant="outline"
              size="icon"
              onClick={() => abortRef.current?.abort()}
              aria-label="Stop"
            >
              <Square className="size-4" />
            </Button>
          ) : (
            <Button size="icon" onClick={() => void send()} disabled={!input.trim() || !sessionId}>
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
