/**
 * Comprehensive MongoDB Database Operations for Atlas Research Assistant.
 * Fully replaces Supabase Postgres for documents, chunks, sessions, messages, and citations.
 */

import {
  getDocumentsCollection,
  getDocumentChunksCollection,
  getChatSessionsCollection,
  getMessagesCollection,
  getCitationsCollection,
  MongoDocument,
  MongoChunk,
  MongoSession,
  MongoMessage,
  MongoCitation,
} from "./db";
import {
  uploadFileToGridFS,
  downloadFileFromGridFS,
  deleteFileFromGridFS,
} from "./client";

// ---- Documents & GridFS ----

export async function createDocumentWithFile(args: {
  id?: string;
  title: string;
  filename: string;
  fileBuffer: Buffer | Uint8Array;
  userId: string;
}): Promise<MongoDocument> {
  const docId = args.id || crypto.randomUUID();
  const safeName = args.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${args.userId}/${crypto.randomUUID()}-${safeName}`;

  // Store raw file in MongoDB GridFS
  const { fileId } = await uploadFileToGridFS(safeName, args.fileBuffer, {
    documentId: docId,
    userId: args.userId,
    originalName: args.filename,
  });

  const col = await getDocumentsCollection();
  const doc: MongoDocument = {
    id: docId,
    title: args.title,
    storage_path: storagePath,
    gridfs_file_id: fileId,
    uploaded_by: args.userId,
    status: "processing",
    chunk_count: 0,
    page_count: null,
    error_message: null,
    created_at: new Date(),
  };

  await col.insertOne(doc);
  return doc;
}

export async function getDocumentById(documentId: string): Promise<MongoDocument | null> {
  const col = await getDocumentsCollection();
  return col.findOne({ id: documentId });
}

export async function getUserDocuments(userId: string): Promise<MongoDocument[]> {
  const col = await getDocumentsCollection();
  return col.find({ uploaded_by: userId }).sort({ created_at: -1 }).toArray();
}

export async function updateDocumentStatus(
  documentId: string,
  updates: Partial<Pick<MongoDocument, "status" | "page_count" | "chunk_count" | "error_message">>
): Promise<void> {
  const col = await getDocumentsCollection();
  await col.updateOne({ id: documentId }, { $set: updates });
}

export async function deleteDocumentAndFile(documentId: string): Promise<void> {
  const col = await getDocumentsCollection();
  const doc = await col.findOne({ id: documentId });
  if (doc?.gridfs_file_id) {
    await deleteFileFromGridFS(doc.gridfs_file_id);
  }
  await col.deleteOne({ id: documentId });

  // Clean chunks
  const chunksCol = await getDocumentChunksCollection();
  await chunksCol.deleteMany({ document_id: documentId });
}

export async function deleteAllDocumentsForUser(userId: string): Promise<{ deletedCount: number }> {
  const col = await getDocumentsCollection();
  const docs = await col.find({ uploaded_by: userId }).toArray();

  for (const doc of docs) {
    if (doc.gridfs_file_id) {
      try {
        await deleteFileFromGridFS(doc.gridfs_file_id);
      } catch (err) {
        console.warn(`Could not delete GridFS file ${doc.gridfs_file_id}:`, err);
      }
    }
  }

  const docIds = docs.map((d) => d.id);
  if (docIds.length > 0) {
    const chunksCol = await getDocumentChunksCollection();
    await chunksCol.deleteMany({ document_id: { $in: docIds } });
    await col.deleteMany({ uploaded_by: userId });
  }

  return { deletedCount: docs.length };
}

export async function getDocumentFileBuffer(documentId: string): Promise<{ buffer: Buffer; filename: string }> {
  const doc = await getDocumentById(documentId);
  if (!doc || !doc.gridfs_file_id) {
    throw new Error(`Document ${documentId} or its GridFS file not found in MongoDB`);
  }
  const buffer = await downloadFileFromGridFS(doc.gridfs_file_id);
  return { buffer, filename: doc.storage_path };
}

// ---- Document Chunks ----

export async function replaceDocumentChunks(
  documentId: string,
  chunks: Array<{
    id: string;
    content: string;
    page_number: number;
    section_heading: string | null;
    chunk_index: number;
    flagged_injection: boolean;
    qdrant_point_id: string;
  }>
): Promise<void> {
  const col = await getDocumentChunksCollection();
  await col.deleteMany({ document_id: documentId });

  if (chunks.length > 0) {
    const mongoChunks: MongoChunk[] = chunks.map((c) => ({
      ...c,
      document_id: documentId,
      created_at: new Date(),
    }));
    await col.insertMany(mongoChunks);
  }
}

export async function getChunksByIds(chunkIds: string[]): Promise<MongoChunk[]> {
  const col = await getDocumentChunksCollection();
  return col.find({ id: { $in: chunkIds } }).toArray();
}

// ---- Chat Sessions ----

export async function getUserSessions(userId: string): Promise<MongoSession[]> {
  const col = await getChatSessionsCollection();
  return col.find({ user_id: userId }).sort({ created_at: -1 }).toArray();
}

export async function getSessionById(sessionId: string, userId: string): Promise<MongoSession | null> {
  const col = await getChatSessionsCollection();
  return col.findOne({ id: sessionId, user_id: userId });
}

export async function createChatSession(userId: string, title: string = "New conversation"): Promise<MongoSession> {
  const col = await getChatSessionsCollection();
  const session: MongoSession = {
    id: crypto.randomUUID(),
    user_id: userId,
    title,
    created_at: new Date(),
  };
  await col.insertOne(session);
  return session;
}

export async function updateSessionTitle(sessionId: string, userId: string, title: string): Promise<void> {
  const col = await getChatSessionsCollection();
  await col.updateOne({ id: sessionId, user_id: userId }, { $set: { title: title.trim() } });
}

export async function deleteChatSession(sessionId: string, userId: string): Promise<void> {
  const sessionsCol = await getChatSessionsCollection();
  const messagesCol = await getMessagesCollection();
  const citationsCol = await getCitationsCollection();

  const session = await sessionsCol.findOne({ id: sessionId, user_id: userId });
  if (!session) return;

  const messages = await messagesCol.find({ session_id: sessionId }).toArray();
  const messageIds = messages.map((m) => m.id);

  if (messageIds.length > 0) {
    await citationsCol.deleteMany({ message_id: { $in: messageIds } });
  }

  await messagesCol.deleteMany({ session_id: sessionId });
  await sessionsCol.deleteOne({ id: sessionId, user_id: userId });
}

// ---- Messages & Citations ----

export async function getSessionMessagesWithCitations(sessionId: string) {
  const messagesCol = await getMessagesCollection();
  const citationsCol = await getCitationsCollection();
  const chunksCol = await getDocumentChunksCollection();
  const docsCol = await getDocumentsCollection();

  const messages = await messagesCol.find({ session_id: sessionId }).sort({ created_at: 1 }).toArray();
  const messageIds = messages.map((m) => m.id);

  const citations = messageIds.length > 0
    ? await citationsCol.find({ message_id: { $in: messageIds } }).sort({ citation_index: 1 }).toArray()
    : [];

  const chunkIds = [...new Set(citations.map((c) => c.chunk_id))];
  const chunks = chunkIds.length > 0 ? await chunksCol.find({ id: { $in: chunkIds } }).toArray() : [];
  const chunkMap = new Map(chunks.map((c) => [c.id, c]));

  const docIds = [...new Set(chunks.map((c) => c.document_id))];
  const docs = docIds.length > 0 ? await docsCol.find({ id: { $in: docIds } }).toArray() : [];
  const docMap = new Map(docs.map((d) => [d.id, d.title]));

  const citationsByMessage = new Map<string, Array<{
    index: number;
    chunk_id: string;
    document_id: string;
    document_title: string;
    page_number: number | null;
    section_heading: string | null;
    relevance_score?: number | null | undefined;
    content: string;
  }>>();

  for (const cite of citations) {
    const chunk = chunkMap.get(cite.chunk_id);
    if (!chunk) continue;
    const list = citationsByMessage.get(cite.message_id) || [];
    list.push({
      index: cite.citation_index,
      chunk_id: chunk.id,
      document_id: chunk.document_id,
      document_title: docMap.get(chunk.document_id) || "Document",
      page_number: chunk.page_number,
      section_heading: chunk.section_heading,
      relevance_score: cite.relevance_score,
      content: chunk.content,
    });
    citationsByMessage.set(cite.message_id, list);
  }

  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    created_at: m.created_at.toISOString(),
    citations: citationsByMessage.get(m.id) || [],
  }));
}

export async function insertMessage(args: {
  sessionId: string;
  role: "user" | "assistant";
  content: string;
}): Promise<MongoMessage> {
  const col = await getMessagesCollection();
  const msg: MongoMessage = {
    id: crypto.randomUUID(),
    session_id: args.sessionId,
    role: args.role,
    content: args.content,
    created_at: new Date(),
  };
  await col.insertOne(msg);
  return msg;
}

export async function insertCitations(rows: Array<{
  message_id: string;
  chunk_id: string;
  citation_index: number;
  relevance_score?: number | null | undefined;
}>): Promise<void> {
  if (!rows.length) return;
  const col = await getCitationsCollection();
  const mongoRows: MongoCitation[] = rows.map((r) => ({
    id: crypto.randomUUID(),
    message_id: r.message_id,
    chunk_id: r.chunk_id,
    citation_index: r.citation_index,
    relevance_score: r.relevance_score,
    created_at: new Date(),
  }));
  await col.insertMany(mongoRows);
}

export type { MongoDocument };

