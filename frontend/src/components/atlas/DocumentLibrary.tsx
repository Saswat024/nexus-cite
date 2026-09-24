import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getDocuments,
  uploadAndIngestDocument,
  deleteDocument,
} from "@/lib/documents.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Upload,
  FileText,
  FileCode,
  Loader2,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
} from "lucide-react";

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
  const [uploadProgress, setUploadProgress] = useState<{
    current: number;
    total: number;
    currentName: string;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const fetchDocs = useServerFn(getDocuments);
  const uploadAndIngest = useServerFn(uploadAndIngestDocument);
  const remove = useServerFn(deleteDocument);

  const { data: documents, isLoading } = useQuery({
    queryKey: ["documents"],
    queryFn: async (): Promise<DocumentRow[]> => {
      const data = await fetchDocs();
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

  const handleUploadFiles = async (files: FileList | File[]) => {
    const MAX_BATCH_SIZE = 10;
    let fileArray = Array.from(files).filter((f) =>
      /\.(pdf|docx|md|markdown|txt)$/i.test(f.name)
    );

    if (fileArray.length === 0) {
      toast.error("Please select valid documents (.pdf, .docx, .md, .txt)");
      return;
    }

    if (fileArray.length > MAX_BATCH_SIZE) {
      toast.warning(
        `Batch limit is ${MAX_BATCH_SIZE} files to avoid AI rate limits. Indexing first ${MAX_BATCH_SIZE} files (${fileArray.length - MAX_BATCH_SIZE} remaining).`
      );
      fileArray = fileArray.slice(0, MAX_BATCH_SIZE);
    }

    setUploading(true);
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i]!;
      setUploadProgress({
        current: i + 1,
        total: fileArray.length,
        currentName: file.name,
      });

      try {
        if (fileArray.length > 1) {
          toast.info(`Indexing ${i + 1} of ${fileArray.length}: ${file.name}…`);
        } else {
          toast.info(`Uploading ${file.name} to MongoDB & indexing with Python…`);
        }

        // Read file into base64
        const fileBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const res = reader.result as string;
            resolve(res.split(",")[1] || "");
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        await uploadAndIngest({
          data: {
            filename: file.name,
            fileBase64,
            title: file.name.replace(/\.(pdf|docx|md|markdown|txt)$/i, ""),
          },
        });

        successCount++;
        await queryClient.invalidateQueries({ queryKey: ["documents"] });

        // Gentle 500ms breather between files to protect against Scaleway/HuggingFace burst throttling
        if (i < fileArray.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (error) {
        failCount++;
        console.error(`Failed to ingest ${file.name}:`, error);
        toast.error(`Failed to ingest ${file.name}: ${error instanceof Error ? error.message : "Upload error"}`);
      }
    }

    setUploading(false);
    setUploadProgress(null);
    if (inputRef.current) inputRef.current.value = "";

    if (fileArray.length > 1) {
      if (failCount === 0) {
        toast.success(`All ${successCount} documents uploaded and indexed successfully!`);
      } else {
        toast.info(`Finished: ${successCount} uploaded, ${failCount} failed.`);
      }
    } else if (successCount === 1) {
      toast.success(`${fileArray[0]!.name} uploaded and indexed successfully!`);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div
        className={`border-b border-border p-4 transition-colors ${
          isDragging ? "bg-primary/10 border-primary border-dashed" : ""
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            void handleUploadFiles(e.dataTransfer.files);
          }
        }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold">Corpus</h2>
          <span className="font-mono text-[11px] text-muted-foreground">
            {documents?.length ?? 0} docs
          </span>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.md,.markdown,.txt,text/markdown,text/plain"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) void handleUploadFiles(files);
          }}
        />

        <Button
          className="w-full relative"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              <span>
                {uploadProgress
                  ? `Indexing ${uploadProgress.current}/${uploadProgress.total}...`
                  : "Uploading..."}
              </span>
            </>
          ) : (
            <>
              <Upload className="size-4" />
              <span>Upload PDF, DOCX, or MD</span>
            </>
          )}
        </Button>

        <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
          Batch limit: up to 10 files at a time (.pdf, .docx, .md)
        </p>

        {isDragging && (
          <p className="mt-2 text-center text-xs text-primary font-medium animate-pulse">
            Drop your files here to upload
          </p>
        )}

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
                No documents yet. Upload PDFs, DOCX, or Markdown files to start.
              </p>
            </div>
          )}

          {documents?.map((doc) => {
            const selected = selectedIds.includes(doc.id);
            const isMd = doc.title.toLowerCase().endsWith(".md") || doc.title.toLowerCase().endsWith(".markdown");

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
                    <div className="flex items-center gap-1.5">
                      {isMd ? (
                        <FileCode className="size-3.5 shrink-0 text-primary" />
                      ) : (
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <p className="truncate text-sm font-medium">{doc.title}</p>
                    </div>

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
