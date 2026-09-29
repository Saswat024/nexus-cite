import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  getUserSessions,
  createChatSession,
  getSessionMessagesWithCitations,
  deleteChatSession,
  updateSessionTitle,
  getSessionById,
} from "@/integrations/mongodb/operations";
import { generateTitleInPython } from "@/lib/rag/client";

/**
 * Fetch all chat sessions for the authenticated user from MongoDB.
 */
export const getSessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const sessions = await getUserSessions(userId);
    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      created_at: s.created_at.toISOString(),
    }));
  });

/**
 * Create a new chat session in MongoDB.
 */
export const createSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input?: { title?: string }) => input || {})
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const session = await createChatSession(userId, data.title || "New conversation");
    return {
      id: session.id,
      title: session.title,
      created_at: session.created_at.toISOString(),
    };
  });

/**
 * Delete a chat session and all its messages/citations in MongoDB.
 */
export const deleteSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { sessionId: string }) => {
    if (!input?.sessionId) throw new Error("sessionId is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await deleteChatSession(data.sessionId, userId);
    return { success: true };
  });

/**
 * Rename/update a chat session title in MongoDB.
 */
export const updateSessionTitleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { sessionId: string; title: string }) => {
    if (!input?.sessionId) throw new Error("sessionId is required");
    if (!input?.title?.trim()) throw new Error("title cannot be empty");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await updateSessionTitle(data.sessionId, userId, data.title.trim());
    return { success: true, title: data.title.trim() };
  });

/**
 * Generate an AI title for a chat session based on its messages or query.
 */
export const generateSessionTitleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { sessionId: string; query?: string }) => {
    if (!input?.sessionId) throw new Error("sessionId is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const session = await getSessionById(data.sessionId, userId);
    if (!session) throw new Error("Session not found");

    let prompt = data.query?.trim();
    if (!prompt) {
      const messages = await getSessionMessagesWithCitations(data.sessionId);
      const firstUserMsg = messages.find((m) => m.role === "user");
      if (firstUserMsg?.content) {
        prompt = firstUserMsg.content;
      }
    }

    if (!prompt) {
      return { title: session.title };
    }

    const title = await generateTitleInPython(prompt);
    await updateSessionTitle(data.sessionId, userId, title);
    return { success: true, title };
  });

/**
 * Get messages and joined citations for a session from MongoDB.
 */
export const getSessionMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { sessionId: string }) => {
    if (!input?.sessionId) throw new Error("sessionId is required");
    return input;
  })
  .handler(async ({ data }) => {
    return await getSessionMessagesWithCitations(data.sessionId);
  });

