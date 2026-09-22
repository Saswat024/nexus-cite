import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getSession();
    throw redirect({ to: data.session ? "/workspace" : "/auth" });
  },
  head: () => ({
    meta: [
      { title: "Atlas — grounded research assistant" },
      {
        name: "description",
        content:
          "Atlas is a retrieval-augmented research console: chat over your papers and course material with hybrid search, reranking and cited answers.",
      },
      { property: "og:title", content: "Atlas — grounded research assistant" },
      {
        property: "og:description",
        content: "Hybrid retrieval, reranking and strictly cited answers over your own document corpus.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => null,
});
