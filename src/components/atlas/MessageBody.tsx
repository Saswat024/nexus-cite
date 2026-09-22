import type { CitationMeta } from "@/lib/atlas-types";

/** Renders assistant text with [n] markers turned into clickable citation chips. */
export function MessageBody({
  content,
  citations,
  onCitationClick,
}: {
  content: string;
  citations: CitationMeta[];
  onCitationClick: (citation: CitationMeta) => void;
}) {
  const parts = content.split(/(\[\d+\])/g);

  return (
    <div className="text-sm leading-relaxed whitespace-pre-wrap">
      {parts.map((part, i) => {
        const match = part.match(/^\[(\d+)\]$/);
        if (!match) return <span key={i}>{part}</span>;
        const index = Number(match[1]);
        const citation = citations.find((c) => c.index === index);
        if (!citation) return <span key={i}>{part}</span>;
        return (
          <button
            key={i}
            type="button"
            className="citation-chip hover:citation-chip-active"
            title={`${citation.document_title}${citation.page_number ? ` · page ${citation.page_number}` : ""}`}
            onClick={() => onCitationClick(citation)}
          >
            {index}
          </button>
        );
      })}
    </div>
  );
}
