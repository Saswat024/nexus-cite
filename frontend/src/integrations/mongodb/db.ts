/**
 * MongoDB database collections and repositories for Atlas Research Assistant.
 */

import { getDb } from "./client";

export type MongoDocument = {
  id: string; // UUID string for API compatibility
  title: string;
  storage_path: string;
  gridfs_file_id?: string;
  uploaded_by: string;
  status: "processing" | "ready" | "failed";
  page_count?: number | null;
  chunk_count: number;
  error_message?: string | null;
  created_at: Date;
};

export type MongoChunk = {
  id: string;
  document_id: string;
  content: string;
  page_number: number;
  section_heading: string | null;
  chunk_index: number;
  qdrant_point_id: string;
  flagged_injection: boolean;
  created_at: Date;
};

export type MongoSession = {
  id: string;
  user_id: string;
  title: string;
  created_at: Date;
};

export type MongoMessage = {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: Date;
};

export type MongoCitation = {
  id: string;
  message_id: string;
  chunk_id: string;
  citation_index: number;
  relevance_score?: number | null | undefined;
  created_at: Date;
};

// ---- Documents Repository ----

export async function getDocumentsCollection() {
  const db = await getDb();
  const col = db.collection<MongoDocument>("documents");
  await col.createIndex({ id: 1 }, { unique: true });
  await col.createIndex({ uploaded_by: 1, created_at: -1 });
  return col;
}

export async function getDocumentChunksCollection() {
  const db = await getDb();
  const col = db.collection<MongoChunk>("document_chunks");
  await col.createIndex({ id: 1 }, { unique: true });
  await col.createIndex({ document_id: 1 });
  return col;
}

export async function getChatSessionsCollection() {
  const db = await getDb();
  const col = db.collection<MongoSession>("chat_sessions");
  await col.createIndex({ id: 1 }, { unique: true });
  await col.createIndex({ user_id: 1, created_at: -1 });
  return col;
}

export async function getMessagesCollection() {
  const db = await getDb();
  const col = db.collection<MongoMessage>("messages");
  await col.createIndex({ id: 1 }, { unique: true });
  await col.createIndex({ session_id: 1, created_at: 1 });
  return col;
}

export async function getCitationsCollection() {
  const db = await getDb();
  const col = db.collection<MongoCitation>("citations");
  await col.createIndex({ id: 1 }, { unique: true });
  await col.createIndex({ message_id: 1 });
  return col;
}

export type MongoUser = {
  id: string;
  email: string;
  password_hash: string;
  salt: string;
  created_at: Date;
};

export async function getUsersCollection() {
  const db = await getDb();
  const col = db.collection<MongoUser>("users");
  await col.createIndex({ id: 1 }, { unique: true });
  await col.createIndex({ email: 1 }, { unique: true });
  return col;
}

