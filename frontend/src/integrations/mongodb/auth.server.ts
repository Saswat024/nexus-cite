import crypto from "node:crypto";
import { getUsersCollection, MongoUser } from "./db";

const JWT_SECRET =
  process.env["JWT_SECRET"] ||
  process.env["SUPABASE_PUBLISHABLE_KEY"] ||
  "atlas-rag-secret-token-key-2026-auth";

/**
 * Hash password with a unique salt using PBKDF2 (SHA-512)
 */
export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
  return { hash, salt };
}

/**
 * Constant-time password verification
 */
export function verifyPassword(password: string, salt: string, storedHash: string): boolean {
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
  const hashBuf = Buffer.from(hash, "hex");
  const storedBuf = Buffer.from(storedHash, "hex");
  if (hashBuf.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(hashBuf, storedBuf);
}

/**
 * Sign standard HS256 JWT
 */
export function signToken(payload: { sub: string; email: string; [key: string]: unknown }): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + 30 * 24 * 60 * 60, // 30 days
  };
  const body = Buffer.from(JSON.stringify(fullPayload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

/**
 * Verify and decode standard HS256 JWT
 */
export function verifyToken(token: string): { sub: string; email: string; [key: string]: unknown } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  if (!header || !body || !sig) return null;

  const expectedSig = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf-8"));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
      return null; // Expired
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Register user immediately into MongoDB without email confirmation.
 */
export async function registerUser(email: string, password: string): Promise<{
  user: { id: string; email: string };
  token: string;
}> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("Invalid email address format.");
  }
  if (!password || password.length < 6) {
    throw new Error("Password must be at least 6 characters long.");
  }

  const usersCol = await getUsersCollection();
  const existing = await usersCol.findOne({ email: normalizedEmail });

  if (existing) {
    // If the account already exists, check if credentials match so user gets logged right in
    if (verifyPassword(password, existing.salt, existing.password_hash)) {
      const token = signToken({ sub: existing.id, email: existing.email });
      return {
        user: { id: existing.id, email: existing.email },
        token,
      };
    }
    throw new Error("An account with this email already exists. Please sign in instead.");
  }

  const { hash, salt } = hashPassword(password);
  const userId = crypto.randomUUID();
  const newUser: MongoUser = {
    id: userId,
    email: normalizedEmail,
    password_hash: hash,
    salt,
    created_at: new Date(),
  };

  await usersCol.insertOne(newUser);

  const token = signToken({ sub: userId, email: normalizedEmail });
  return {
    user: { id: userId, email: normalizedEmail },
    token,
  };
}

/**
 * Log in existing user from MongoDB.
 */
export async function loginUser(email: string, password: string): Promise<{
  user: { id: string; email: string };
  token: string;
}> {
  const normalizedEmail = email.trim().toLowerCase();
  const usersCol = await getUsersCollection();
  const user = await usersCol.findOne({ email: normalizedEmail });

  if (!user) {
    throw new Error("Invalid login credentials — or this account doesn't exist yet. Create one first.");
  }

  const matches = verifyPassword(password, user.salt, user.password_hash);
  if (!matches) {
    throw new Error("Invalid login credentials. Please check your password.");
  }

  const token = signToken({ sub: user.id, email: user.email });
  return {
    user: { id: user.id, email: user.email },
    token,
  };
}

/**
 * Get user by id
 */
export async function getUserById(id: string): Promise<{ id: string; email: string } | null> {
  const usersCol = await getUsersCollection();
  const user = await usersCol.findOne({ id });
  if (!user) return null;
  return { id: user.id, email: user.email };
}
