import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DocumentLibrary } from "@/components/atlas/DocumentLibrary";
import { ChatPanel } from "@/components/atlas/ChatPanel";
import { SourceSheet } from "@/components/atlas/SourceSheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Library, LogOut, MessageSquarePlus } from "lucide-react";
import type { CitationMeta } from "@/lib/atlas-types";

export const Route = createFileRoute("/_authenticated/workspace")({
  head: () => ({
    meta: [
      { title: "Workspace — Atlas research assistant" },
      {
        name: "description",
        content:
          "Your document library and grounded research chat: hybrid retrieval, BGE reranking and cited answers.",
      },
      { property: "og:title", content: "Workspace — Atlas research assistant" },
      {
        property: "og:description",
        content: "Chat over your indexed papers and course material with inline citations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Workspace,
});

type SessionRow = { id: string; title: string; created_at: string };

function Workspace() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [citation, setCitation] = useState<CitationMeta | null>(null);
  const [highlightedDoc, setHighlightedDoc] = useState<string | null>(null);

  const { data: sessions, isLoading } = useQuery({
    queryKey: ["sessions"],
    queryFn: async (): Promise<SessionRow[]> => {
      const { data, error } = await supabase
        .from("chat_sessions")
        .select("id, title, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const createSession = async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const { data, error } = await supabase
      .from("chat_sessions")
      .insert({ user_id: auth.user.id, title: "New conversation" })
      .select("id")
      .single();
    if (error || !data) {
      toast.error("Could not start a conversation");
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    setSessionId(data.id);
  };

  useEffect(() => {
    if (isLoading) return;
    if (!sessionId) {
      if (sessions?.length) setSessionId(sessions[0]!.id);
      else void createSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, sessions, sessionId]);

  const signOut = async () => {
    await supabase.auth.signOut();
    queryClient.clear();
    navigate({ to: "/auth" });
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-sidebar">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/15 text-primary ring-1 ring-primary/30">
            <Library className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm font-semibold">Atlas</p>
            <p className="truncate text-[11px] text-muted-foreground">Grounded research console</p>
          </div>
          <button
            type="button"
            aria-label="Sign out"
            onClick={signOut}
            className="rounded p-1.5 text-muted-foreground hover:text-foreground"
          >
            <LogOut className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          <DocumentLibrary
            selectedIds={selectedDocs}
            highlightedId={highlightedDoc}
            onToggleSelect={(id) =>
              setSelectedDocs((prev) =>
                prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id],
              )
            }
          />
        </div>

        <div className="max-h-64 border-t border-border">
          <div className="flex items-center justify-between px-4 py-2.5">
            <h2 className="font-display text-sm font-semibold">Conversations</h2>
            <button
              type="button"
              aria-label="New conversation"
              onClick={() => void createSession()}
              className="rounded p-1 text-muted-foreground hover:text-primary"
            >
              <MessageSquarePlus className="size-4" />
            </button>
          </div>
          <ScrollArea className="max-h-44">
            <div className="space-y-1 px-3 pb-3">
              {isLoading && <Skeleton className="h-8 w-full" />}
              {sessions?.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => setSessionId(session.id)}
                  className={`w-full truncate rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                    sessionId === session.id
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-elevated hover:text-foreground"
                  }`}
                >
                  {session.title}
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <ChatPanel
          sessionId={sessionId}
          documentIds={selectedDocs}
          onCitationClick={setCitation}
        />
      </main>

      <SourceSheet
        citation={citation}
        onOpenChange={(open) => !open && setCitation(null)}
        onJumpToDocument={(documentId) => {
          setHighlightedDoc(documentId);
          setCitation(null);
          setTimeout(() => setHighlightedDoc(null), 2500);
        }}
      />
    </div>
  );
}
