import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { ingestDocument, deleteDocument } from "@/lib/documents.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Upload, FileText, Loader2, Trash2, AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";

type DocumentRow = {
  id: string;
  title: string;
  status: "processing" | "ready" | "failed";
  chunk_count: number;
  page_count: number | null;
  error_message: string | null;
  created_at: string;
};

export function DocumentLibrary({
  selectedIds,
  onToggleSelect,
  highlightedId,
}: {
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  highlightedId: string | null;
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const ingest = useServerFn(ingestDocument);
  const remove = useServerFn(deleteDocument);

  const { data: documents, isLoading } = useQuery({
    queryKey: ["documents"],
    queryFn: async (): Promise<DocumentRow[]> => {
      const { data, error } = await supabase
        .from("documents")
        .select("id, title, status, chunk_count, page_count, error_message, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as DocumentRow[];
    },
    refetchInterval: (query) =>
      (query.state.data ?? []).some((d) => d.status === "processing") ? 3000 : false,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => remove({ data: { documentId: id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Document removed");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Delete failed"),
  });

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Not signed in");

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${auth.user.id}/${crypto.randomUUID()}-${safeName}`;

      const { error: uploadError } = await supabase.storage.from("documents").upload(path, file);
      if (uploadError) throw uploadError;

      const { data: doc, error: insertError } = await supabase
        .from("documents")
        .insert({
          title: file.name.replace(/\.(pdf|docx)$/i, ""),
          storage_path: path,
          uploaded_by: auth.user.id,
          status: "processing",
        })
        .select("id")
        .single();
      if (insertError || !doc) throw insertError ?? new Error("Could not create document");

      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.info("Processing document — parsing, chunking and indexing…");

      ingest({ data: { documentId: doc.id } })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["documents"] });
          toast.success(`${file.name} is ready to query`);
        })
        .catch((error: unknown) => {
          queryClient.invalidateQueries({ queryKey: ["documents"] });
          toast.error(error instanceof Error ? error.message : "Ingestion failed");
        });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold">Corpus</h2>
          <span className="font-mono text-[11px] text-muted-foreground">
            {documents?.length ?? 0} docs
          </span>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleUpload(file);
          }}
        />
        <Button className="w-full" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          Upload PDF or DOCX
        </Button>
        {selectedIds.length > 0 && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Retrieval scoped to {selectedIds.length} selected document
            {selectedIds.length > 1 ? "s" : ""}.
          </p>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-1.5 p-3">
          {isLoading &&
            [0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-md" />)}

          {!isLoading && !documents?.length && (
            <div className="rounded-md border border-dashed border-border p-6 text-center">
              <FileText className="mx-auto size-6 text-muted-foreground" />
              <p className="mt-2 text-xs text-muted-foreground">
                No documents yet. Upload a paper or set of course notes to start.
              </p>
            </div>
          )}

          {documents?.map((doc) => {
            const selected = selectedIds.includes(doc.id);
            return (
              <div
                key={doc.id}
                className={`group rounded-md border p-3 transition-colors ${
                  selected ? "border-primary/50 bg-primary/5" : "border-border bg-elevated/40"
                } ${highlightedId === doc.id ? "ring-1 ring-primary" : ""}`}
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onToggleSelect(doc.id)}
                  >
                    <p className="truncate text-sm font-medium">{doc.title}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {doc.status === "processing" && (
                        <Badge variant="secondary" className="gap-1">
                          <Loader2 className="size-3 animate-spin" />
                          processing
                        </Badge>
                      )}
                      {doc.status === "ready" && (
                        <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
                          <CheckCircle2 className="size-3" />
                          ready
                        </Badge>
                      )}
                      {doc.status === "failed" && (
                        <Badge variant="destructive" className="gap-1">
                          <AlertTriangle className="size-3" />
                          failed
                        </Badge>
                      )}
                      {doc.status === "ready" && (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {doc.chunk_count} chunks
                          {doc.page_count ? ` · ${doc.page_count}p` : ""}
                        </span>
                      )}
                    </div>
                    {doc.status === "failed" && doc.error_message && (
                      <p className="mt-1.5 text-[11px] text-destructive">{doc.error_message}</p>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${doc.title}`}
                    className="rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                    onClick={() => deleteMutation.mutate(doc.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      <div className="border-t border-border p-3">
        <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          Instruction-like text inside uploads is neutralised during ingestion.
        </p>
      </div>
    </div>
  );
}
