import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, ExternalLink } from "lucide-react";
import type { CitationMeta } from "@/lib/atlas-types";

export function SourceSheet({
  citation,
  onOpenChange,
  onJumpToDocument,
}: {
  citation: CitationMeta | null;
  onOpenChange: (open: boolean) => void;
  onJumpToDocument: (documentId: string) => void;
}) {
  return (
    <Sheet open={!!citation} onOpenChange={onOpenChange}>
      <SheetContent className="w-full border-border bg-surface p-0 sm:max-w-md">
        {citation && (
          <>
            <SheetHeader className="border-b border-border p-5">
              <div className="flex items-center gap-2">
                <span className="citation-chip citation-chip-active">{citation.index}</span>
                <SheetTitle className="text-sm font-medium">Source chunk</SheetTitle>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <FileText className="size-3.5" />
                  {citation.document_title}
                </span>
                {citation.page_number ? <Badge variant="secondary">page {citation.page_number}</Badge> : null}
                {citation.relevance_score !== null ? (
                  <Badge variant="outline" className="font-mono">
                    rerank {citation.relevance_score.toFixed(3)}
                  </Badge>
                ) : null}
              </div>
              {citation.section_heading ? (
                <p className="mt-2 text-left text-xs text-muted-foreground">
                  Section: <span className="text-foreground">{citation.section_heading}</span>
                </p>
              ) : null}
            </SheetHeader>

            <ScrollArea className="h-[calc(100vh-13rem)]">
              <div className="p-5">
                <p className="rounded-md border border-primary/25 bg-primary/5 p-4 text-sm leading-relaxed whitespace-pre-wrap">
                  {citation.content}
                </p>
              </div>
            </ScrollArea>

            <div className="border-t border-border p-4">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => onJumpToDocument(citation.document_id)}
              >
                <ExternalLink className="size-4" />
                Jump to document
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
