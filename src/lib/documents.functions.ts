import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Ingestion pipeline: download from storage -> parse with page/section structure ->
 * section-aware chunking + prompt-injection sanitisation -> embed -> Qdrant upsert
 * -> document_chunks rows -> flip status to ready.
 */
export const ingestDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { documentId: string }) => {
    if (!input?.documentId) throw new Error("documentId is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { parseDocument } = await import("./rag/parse.server");
    const { chunkBlocks } = await import("./rag/chunking.server");
    const { embedTexts } = await import("./rag/embeddings.server");
    const { upsertChunks, deleteByDocument } = await import("./rag/qdrant.server");

    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("id, title, storage_path, uploaded_by")
      .eq("id", data.documentId)
      .single();
    if (docError || !doc) throw new Error("Document not found");

    const fail = async (message: string) => {
      await supabase
        .from("documents")
        .update({ status: "failed", error_message: message.slice(0, 500) })
        .eq("id", doc.id);
      throw new Error(message);
    };

    try {
      const { data: file, error: fileError } = await supabase.storage
        .from("documents")
        .download(doc.storage_path);
      if (fileError || !file) return await fail(fileError?.message ?? "Could not read the uploaded file");

      const bytes = new Uint8Array(await file.arrayBuffer());
      const { blocks, pageCount } = await parseDocument(doc.storage_path, bytes);
      const chunks = chunkBlocks(blocks);
      if (!chunks.length) return await fail("No readable text found in this document");

      // Re-ingestion safety: clear any prior vectors/rows for this document.
      await deleteByDocument(doc.id);
      await supabase.from("document_chunks").delete().eq("document_id", doc.id);

      const { data: inserted, error: insertError } = await supabase
        .from("document_chunks")
        .insert(
          chunks.map((c) => ({
            document_id: doc.id,
            content: c.content,
            page_number: c.page_number,
            section_heading: c.section_heading,
            chunk_index: c.chunk_index,
            flagged_injection: c.flagged_injection,
          })),
        )
        .select("id, content, page_number, section_heading, chunk_index");
      if (insertError || !inserted) return await fail(insertError?.message ?? "Could not save chunks");

      const ordered = [...inserted].sort((a, b) => a.chunk_index - b.chunk_index);
      const vectors = await embedTexts(ordered.map((c) => c.content));

      await upsertChunks(
        ordered.map((chunk, i) => ({
          id: chunk.id,
          dense: vectors[i]!,
          text: chunk.content,
          payload: {
            document_id: doc.id,
            chunk_id: chunk.id,
            page_number: chunk.page_number,
            section_heading: chunk.section_heading,
            user_id: userId,
            content: chunk.content,
          },
        })),
      );

      await supabase
        .from("document_chunks")
        .upsert(ordered.map((c) => ({ id: c.id, document_id: doc.id, content: c.content, qdrant_point_id: c.id })));

      await supabase
        .from("documents")
        .update({
          status: "ready",
          page_count: pageCount,
          chunk_count: ordered.length,
          error_message: null,
        })
        .eq("id", doc.id);

      return { ok: true, chunks: ordered.length, pages: pageCount };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ingestion failed";
      await supabase
        .from("documents")
        .update({ status: "failed", error_message: message.slice(0, 500) })
        .eq("id", doc.id);
      throw new Error(message);
    }
  });

/** Removes a document, its chunks and its vectors. */
export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { documentId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { deleteByDocument } = await import("./rag/qdrant.server");

    const { data: doc } = await supabase
      .from("documents")
      .select("id, storage_path")
      .eq("id", data.documentId)
      .single();
    if (!doc) return { ok: true };

    await deleteByDocument(doc.id);
    await supabase.storage.from("documents").remove([doc.storage_path]);
    await supabase.from("documents").delete().eq("id", doc.id);
    return { ok: true };
  });
