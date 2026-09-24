import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  createDocumentWithFile,
  getUserDocuments,
  updateDocumentStatus,
  deleteDocumentAndFile,
  getDocumentFileBuffer,
  replaceDocumentChunks,
  MongoDocument,
} from "@/integrations/mongodb/operations";
import {
  ingestDocumentInPython,
  deleteDocumentInPython,
} from "./rag/client";

/**
 * Upload a document file to MongoDB GridFS and ingest it through the Python RAG engine.
 */
export const uploadAndIngestDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      filename: string;
      fileBase64: string;
      title?: string;
    }) => {
      if (!input?.filename || !input?.fileBase64) {
        throw new Error("filename and fileBase64 are required");
      }
      return input;
    }
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const fileBytes = Buffer.from(data.fileBase64, "base64");
    const title = data.title || data.filename.replace(/\.(pdf|docx|md|markdown|txt)$/i, "");

    // 1. Store the file in MongoDB GridFS and create document record in MongoDB
    const doc = await createDocumentWithFile({
      title,
      filename: data.filename,
      fileBuffer: fileBytes,
      userId,
    });

    try {
      // 2. Execute parse, chunk, embed, and Qdrant upsert pipeline in Python
      const pythonRes = await ingestDocumentInPython({
        documentId: doc.id,
        userId,
        filename: data.filename,
        fileBytes,
      });

      if (!pythonRes.chunks.length) {
        await updateDocumentStatus(doc.id, {
          status: "failed",
          error_message: "No readable text found in document",
        });
        throw new Error("No readable text found in document");
      }

      // 3. Persist chunk records into MongoDB
      await replaceDocumentChunks(
        doc.id,
        pythonRes.chunks.map((c) => ({
          id: c.id,
          content: c.content,
          page_number: c.page_number,
          section_heading: c.section_heading,
          chunk_index: c.chunk_index,
          flagged_injection: c.flagged_injection,
          qdrant_point_id: c.id,
        }))
      );

      // 4. Update document status in MongoDB
      await updateDocumentStatus(doc.id, {
        status: "ready",
        page_count: pythonRes.page_count,
        chunk_count: pythonRes.chunk_count,
        error_message: null,
      });

      return {
        ok: true,
        documentId: doc.id,
        chunks: pythonRes.chunk_count,
        pages: pythonRes.page_count,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ingestion failed";
      await updateDocumentStatus(doc.id, {
        status: "failed",
        error_message: message.slice(0, 500),
      });
      throw new Error(message);
    }
  });

/**
 * Re-run ingestion on an existing document in MongoDB GridFS.
 */
export const ingestDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { documentId: string }) => {
    if (!input?.documentId) throw new Error("documentId is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { userId } = context;

    try {
      const { buffer, filename } = await getDocumentFileBuffer(data.documentId);
      const pythonRes = await ingestDocumentInPython({
        documentId: data.documentId,
        userId,
        filename,
        fileBytes: buffer,
      });

      await replaceDocumentChunks(
        data.documentId,
        pythonRes.chunks.map((c) => ({
          id: c.id,
          content: c.content,
          page_number: c.page_number,
          section_heading: c.section_heading,
          chunk_index: c.chunk_index,
          flagged_injection: c.flagged_injection,
          qdrant_point_id: c.id,
        }))
      );

      await updateDocumentStatus(data.documentId, {
        status: "ready",
        page_count: pythonRes.page_count,
        chunk_count: pythonRes.chunk_count,
        error_message: null,
      });

      return { ok: true, chunks: pythonRes.chunk_count, pages: pythonRes.page_count };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ingestion failed";
      await updateDocumentStatus(data.documentId, {
        status: "failed",
        error_message: message.slice(0, 500),
      });
      throw new Error(message);
    }
  });

/**
 * List all documents for the authenticated user from MongoDB.
 */
export const getDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const docs = await getUserDocuments(userId);
    return docs.map((d) => ({
      id: d.id,
      title: d.title,
      status: d.status,
      chunk_count: d.chunk_count,
      page_count: d.page_count ?? null,
      error_message: d.error_message ?? null,
      created_at: d.created_at.toISOString(),
    }));
  });

/**
 * Removes a document, its GridFS chunks, MongoDB metadata, and Qdrant vectors.
 */
export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { documentId: string }) => input)
  .handler(async ({ data }) => {
    // 1. Delete vectors from Qdrant
    await deleteDocumentInPython(data.documentId);
    // 2. Delete file from GridFS and metadata from MongoDB
    await deleteDocumentAndFile(data.documentId);
    return { ok: true };
  });
