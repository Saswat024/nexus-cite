/**
 * MongoDB client and GridFS storage manager.
 * Connects to MongoDB Atlas or local MongoDB using MONGODB_URI.
 */

import { MongoClient, Db, GridFSBucket, ObjectId } from "mongodb";

let client: MongoClient | null = null;
let clientPromise: Promise<MongoClient> | null = null;

const DEFAULT_DB_NAME = "nexus_cite";

export function getMongoUri(): string {
  const uri = process.env["MONGODB_URI"];
  if (!uri) {
    throw new Error(
      "Missing MONGODB_URI in environment variables. Please provide your MongoDB Atlas connection string in .env (e.g. MONGODB_URI=mongodb+srv://...)"
    );
  }
  return uri;
}

export async function getMongoClient(): Promise<MongoClient> {
  const uri = getMongoUri();

  if (!clientPromise) {
    client = new MongoClient(uri);
    clientPromise = client.connect();
  }
  return clientPromise;
}

export async function getDb(): Promise<Db> {
  const c = await getMongoClient();
  const dbName = process.env["MONGODB_DB_NAME"] || DEFAULT_DB_NAME;
  return c.db(dbName);
}

export async function getGridFSBucket(): Promise<GridFSBucket> {
  const db = await getDb();
  return new GridFSBucket(db, { bucketName: "documents_fs" });
}

/**
 * Upload a document buffer to MongoDB GridFS.
 * Returns the GridFS file ID and filename.
 */
export async function uploadFileToGridFS(
  filename: string,
  buffer: Buffer | Uint8Array,
  metadata?: Record<string, unknown>
): Promise<{ fileId: string; filename: string }> {
  const bucket = await getGridFSBucket();
  const rawBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename, {
      metadata: metadata || {},
    });

    uploadStream.on("finish", () => {
      resolve({
        fileId: uploadStream.id.toString(),
        filename,
      });
    });

    uploadStream.on("error", (error) => {
      reject(error);
    });

    uploadStream.end(rawBuffer);
  });
}

/**
 * Download a document buffer from MongoDB GridFS by file ID.
 */
export async function downloadFileFromGridFS(fileId: string): Promise<Buffer> {
  const bucket = await getGridFSBucket();
  const chunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    const downloadStream = bucket.openDownloadStream(new ObjectId(fileId));

    downloadStream.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    downloadStream.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    downloadStream.on("error", (error) => {
      reject(error);
    });
  });
}

/**
 * Delete a file from MongoDB GridFS by file ID.
 */
export async function deleteFileFromGridFS(fileId: string): Promise<void> {
  try {
    const bucket = await getGridFSBucket();
    await bucket.delete(new ObjectId(fileId));
  } catch (err) {
    console.warn(`Could not delete GridFS file ${fileId}:`, err);
  }
}
