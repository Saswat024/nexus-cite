import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  getSessions,
  createSession as createSessionFn,
  deleteSession as deleteSessionFn,
  updateSessionTitleFn,
  generateSessionTitleFn,
} from "@/lib/chat.functions";
import { DocumentLibrary } from "@/components/atlas/DocumentLibrary";
import { ChatPanel } from "@/components/atlas/ChatPanel";
import { SourceSheet } from "@/components/atlas/SourceSheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Library,
  LogOut,
  MessageSquarePlus,
  Trash2,
  Sparkles,
  Pencil,
  Check,
  X,
  Loader2,
} from "lucide-react";
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
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth >= 1024;
    }
    return false;
  });

  useEffect(() => {
    const handleResize = () => {
      if (typeof window !== "undefined" && window.innerWidth < 1024) {
        setSidebarOpen(false);
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const [generatingSessionId, setGeneratingSessionId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  const fetchSessions = useServerFn(getSessions);
  const createNewSession = useServerFn(createSessionFn);
  const deleteSessionServer = useServerFn(deleteSessionFn);
  const updateTitleServer = useServerFn(updateSessionTitleFn);
  const generateTitleServer = useServerFn(generateSessionTitleFn);

  const { data: sessions, isLoading } = useQuery({
    queryKey: ["sessions"],
    queryFn: async (): Promise<SessionRow[]> => {
      const data = await fetchSessions();
      return (data ?? []) as SessionRow[];
    },
  });

  const createSession = async () => {
    try {
      const data = await createNewSession({ data: { title: "New conversation" } });
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      setSessionId(data.id);
      if (typeof window !== "undefined" && window.innerWidth < 1024) {
        setSidebarOpen(false);
      }
    } catch {
      toast.error("Could not start a conversation");
    }
  };

  const handleSelectSession = (id: string) => {
    setSessionId(id);
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  };

  const handleDeleteSession = async (idToDelete: string) => {
    try {
      await deleteSessionServer({ data: { sessionId: idToDelete } });
      toast.success("Conversation deleted");

      await queryClient.invalidateQueries({ queryKey: ["sessions"] });

      if (sessionId === idToDelete) {
        const remaining = sessions?.filter((s) => s.id !== idToDelete) ?? [];
        if (remaining.length > 0 && remaining[0]) {
          setSessionId(remaining[0].id);
        } else {
          void createSession();
        }
      }
    } catch {
      toast.error("Failed to delete conversation");
    }
  };

  const handleGenerateTitle = async (id: string) => {
    setGeneratingSessionId(id);
    try {
      const res = await generateTitleServer({ data: { sessionId: id } });
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      toast.success(`Renamed to "${res.title}"`);
    } catch {
      toast.error("Could not generate title");
    } finally {
      setGeneratingSessionId(null);
    }
  };

  const handleStartRename = (session: SessionRow) => {
    setEditingSessionId(session.id);
    setEditingTitle(session.title);
  };

  const handleSaveRename = async (id: string) => {
    if (!editingTitle.trim()) {
      setEditingSessionId(null);
      return;
    }
    try {
      await updateTitleServer({ data: { sessionId: id, title: editingTitle.trim() } });
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      setEditingSessionId(null);
      toast.success("Conversation renamed");
    } catch {
      toast.error("Failed to rename conversation");
    }
  };

  useEffect(() => {
    if (isLoading) return;
    if (!sessionId) {
      if (sessions?.length && sessions[0]) setSessionId(sessions[0].id);
      else void createSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, sessions, sessionId]);

  const signOut = async () => {
    await supabase.auth.signOut();
    queryClient.clear();
    navigate({ to: "/auth" });
  };

  const currentSession = sessions?.find((s) => s.id === sessionId);

  return (
    <div className="relative flex h-screen w-full max-w-full min-w-0 overflow-hidden">
      {/* Mobile / Tablet overlay backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs lg:hidden transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Responsive Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 sm:w-80 flex-col border-r border-border bg-sidebar transition-all duration-300 ease-in-out lg:static lg:z-auto ${
          sidebarOpen
            ? "translate-x-0 lg:w-80 lg:shrink-0"
            : "-translate-x-full lg:w-0 lg:overflow-hidden lg:border-r-0"
        }`}
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
          <img
            src="/favicon.png"
            alt="Atlas"
            className="size-8 rounded-md object-contain ring-1 ring-border shadow-xs"
          />
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm font-semibold">Atlas</p>
            <p className="truncate text-[11px] text-muted-foreground">Grounded research console</p>
          </div>
          <button
            type="button"
            aria-label="Close sidebar"
            onClick={() => setSidebarOpen(false)}
            className="rounded p-1.5 text-muted-foreground hover:text-foreground lg:hidden"
            title="Close sidebar"
          >
            <X className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Sign out"
            onClick={signOut}
            className="rounded p-1.5 text-muted-foreground hover:text-foreground"
            title="Sign out"
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
            onClearSelection={() => setSelectedDocs([])}
          />
        </div>

        <div className="flex flex-col shrink-0 border-t border-border max-h-72 sm:max-h-80">
          <div className="flex items-center justify-between px-4 py-2.5 shrink-0">
            <div className="flex items-center gap-1.5">
              <h2 className="font-display text-sm font-semibold">Conversations</h2>
              {sessions && sessions.length > 0 && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  ({sessions.length})
                </span>
              )}
            </div>
            <button
              type="button"
              aria-label="New conversation"
              onClick={() => void createSession()}
              className="rounded p-1 text-muted-foreground hover:text-primary transition-colors cursor-pointer"
              title="New conversation"
            >
              <MessageSquarePlus className="size-4" />
            </button>
          </div>
          <ScrollArea className="max-h-56 sm:max-h-64 w-full">
            <div className="space-y-1 px-3 pb-3">
              {isLoading && <Skeleton className="h-8 w-full" />}
              {sessions?.map((session) => (
                <div
                  key={session.id}
                  onClick={() => handleSelectSession(session.id)}
                  className={`group relative flex items-center justify-between gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors cursor-pointer ${
                    sessionId === session.id
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-elevated hover:text-foreground"
                  }`}
                >
                  {editingSessionId === session.id ? (
                    <div className="flex items-center gap-1 w-full" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleSaveRename(session.id);
                          if (e.key === "Escape") setEditingSessionId(null);
                        }}
                        autoFocus
                        className="w-full rounded border border-primary/40 bg-secondary/80 px-1.5 py-0.5 text-xs text-foreground focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void handleSaveRename(session.id)}
                        className="rounded p-0.5 text-primary hover:bg-primary/20"
                        title="Save"
                      >
                        <Check className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingSessionId(null)}
                        className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                        title="Cancel"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="truncate flex-1" title={session.title}>
                        {session.title}
                      </span>
                      <div
                        className={`flex items-center gap-0.5 transition-opacity ${
                          sessionId === session.id
                            ? "opacity-90 hover:opacity-100"
                            : "opacity-0 group-hover:opacity-100"
                        }`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          title="Generate title with AI"
                          disabled={generatingSessionId === session.id}
                          onClick={() => void handleGenerateTitle(session.id)}
                          className="rounded p-1 text-muted-foreground hover:bg-background/80 hover:text-primary transition-colors disabled:opacity-50"
                        >
                          {generatingSessionId === session.id ? (
                            <Loader2 className="size-3.5 animate-spin text-primary" />
                          ) : (
                            <Sparkles className="size-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          title="Rename conversation"
                          onClick={() => handleStartRename(session)}
                          className="rounded p-1 text-muted-foreground hover:bg-background/80 hover:text-foreground transition-colors"
                        >
                          <Pencil className="size-3" />
                        </button>
                        <button
                          type="button"
                          title="Delete conversation"
                          onClick={() => void handleDeleteSession(session.id)}
                          className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive transition-colors"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </aside>

      <main className="flex min-w-0 max-w-full w-full flex-1 flex-col overflow-hidden">
        <ChatPanel
          sessionId={sessionId}
          sessionTitle={currentSession?.title ?? null}
          documentIds={selectedDocs}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
          onCitationClick={setCitation}
          onDeleteSession={handleDeleteSession}
          onGenerateTitle={handleGenerateTitle}
          onRenameSession={async (newTitle) => {
            if (sessionId) {
              await updateTitleServer({ data: { sessionId, title: newTitle } });
              await queryClient.invalidateQueries({ queryKey: ["sessions"] });
            }
          }}
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
