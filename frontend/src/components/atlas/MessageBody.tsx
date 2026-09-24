import type { CitationMeta } from "@/lib/atlas-types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renders assistant text with rich markdown (tables, lists, headings, code) and clickable citation chips. */
export function MessageBody({
  content,
  citations,
  onCitationClick,
}: {
  content: string;
  citations: CitationMeta[];
  onCitationClick: (citation: CitationMeta) => void;
}) {
  // 1. Normalise full-width brackets 【n】 or ［n］ to standard [n].
  let normalised = content.replace(/[【［]\s*(\d+)(?:†[^\】］]*)?\s*[】］]/g, "[$1]");

  // 2. Normalise comma-separated citations e.g. [1, 2] -> [1][2]
  normalised = normalised.replace(/\[([0-9,\s]+)\]/g, (match, inner) => {
    const parts = inner.split(",").map((s: string) => s.trim()).filter(Boolean);
    if (parts.length > 1 && parts.every((p: string) => /^\d+$/.test(p))) {
      return parts.map((p: string) => `[${p}]`).join("");
    }
    return match;
  });

  // 3. Convert standalone [n] into markdown links [n](#citation-n) so ReactMarkdown preserves and styles them
  const formatted = normalised.replace(/\[(\d+)\](?!\()/g, (_m, g1) => `[${g1}](#citation-${g1})`);

  return (
    <div className="text-sm leading-relaxed text-foreground/90 space-y-2">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...props }) => {
            if (href?.startsWith("#citation-")) {
              const idx = Number(href.replace("#citation-", ""));
              const citation = citations.find((c) => c.index === idx);
              return (
                <button
                  type="button"
                  className="citation-chip hover:citation-chip-active align-middle my-0.5 cursor-pointer"
                  title={
                    citation
                      ? `${citation.document_title}${citation.page_number ? ` · page ${citation.page_number}` : ""}`
                      : `Source [${idx}]`
                  }
                  onClick={(e) => {
                    e.preventDefault();
                    if (citation) onCitationClick(citation);
                  }}
                >
                  {idx}
                </button>
              );
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
                {...props}
              >
                {children}
              </a>
            );
          },
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-border/80 bg-surface/50 shadow-sm">
              <table className="w-full text-left text-xs border-collapse">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="border-b border-border/80 bg-elevated/70 text-foreground font-semibold">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-border/40 font-mono text-[12.5px] text-foreground/90">
              {children}
            </tbody>
          ),
          tr: ({ children }) => (
            <tr className="transition-colors hover:bg-surface/80">
              {children}
            </tr>
          ),
          th: ({ children }) => (
            <th className="px-3.5 py-2.5 font-semibold text-foreground whitespace-nowrap">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3.5 py-2 whitespace-nowrap text-muted-foreground">
              {children}
            </td>
          ),
          h1: ({ children }) => (
            <h1 className="text-base font-bold text-foreground mt-4 mb-2 first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-sm font-semibold text-foreground mt-3 mb-1.5 first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-2.5 mb-1 first:mt-0">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="leading-relaxed mb-2 last:mb-0">
              {children}
            </p>
          ),
          ul: ({ children }) => (
            <ul className="my-2 ml-4 list-disc space-y-1 text-sm">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 ml-4 list-decimal space-y-1 text-sm">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="leading-relaxed">
              {children}
            </li>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">
              {children}
            </strong>
          ),
          code: ({ className, children, ...props }) => {
            const isInline = !className;
            if (isInline) {
              return (
                <code
                  className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[12px] text-primary font-medium"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <pre className="my-2 overflow-x-auto rounded-lg border border-border/60 bg-surface/90 p-3 font-mono text-xs">
                <code className={className} {...props}>
                  {children}
                </code>
              </pre>
            );
          },
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-primary/50 pl-3 italic text-muted-foreground">
              {children}
            </blockquote>
          ),
        }}
      >
        {formatted}
      </ReactMarkdown>
    </div>
  );
}

