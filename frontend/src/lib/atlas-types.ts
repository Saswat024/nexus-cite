export type CitationMeta = {
  index: number;
  chunk_id: string;
  document_id: string;
  document_title: string;
  page_number: number | null;
  section_heading: string | null;
  relevance_score: number | null;
  content: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  citations: CitationMeta[];
  streaming?: boolean;
};
