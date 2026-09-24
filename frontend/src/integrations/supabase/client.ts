export type AuthUser = {
  id: string;
  email: string;
};

export type AuthSession = {
  access_token: string;
  token_type: string;
  user: AuthUser;
};

type AuthStateChangeCallback = (event: "SIGNED_IN" | "SIGNED_OUT", session: AuthSession | null) => void;

const STORAGE_KEY = "atlas_auth_session";
const listeners = new Set<AuthStateChangeCallback>();

function getStoredSession(): AuthSession | null {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as AuthSession;
    if (session?.access_token && session?.user?.id) {
      // Validate token expiration if available
      const payload = parseJwtPayload(session.access_token);
      if (payload?.exp && Math.floor(Date.now() / 1000) > payload.exp) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return session;
    }
    return null;
  } catch {
    return null;
  }
}

function setStoredSession(session: AuthSession | null) {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  try {
    if (session) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch (e) {
    console.error("Failed to write auth session to localStorage", e);
  }
}

function parseJwtPayload(token: string): { sub: string; email: string; exp?: number } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[1]) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

export const auth = {
  async getSession(): Promise<{ data: { session: AuthSession | null }; error: null }> {
    return { data: { session: getStoredSession() }, error: null };
  },

  async getUser(token?: string): Promise<{ data: { user: AuthUser | null }; error: Error | null }> {
    if (token) {
      const payload = parseJwtPayload(token);
      if (payload?.sub) {
        return { data: { user: { id: payload.sub, email: payload.email || "" } }, error: null };
      }
      return { data: { user: null }, error: new Error("Invalid token") };
    }
    const session = getStoredSession();
    return { data: { user: session?.user || null }, error: null };
  },

  async getClaims(token: string): Promise<{ data: { claims: { sub: string; email?: string } | null }; error: Error | null }> {
    const payload = parseJwtPayload(token);
    if (!payload?.sub) {
      return { data: { claims: null }, error: new Error("Invalid token") };
    }
    return { data: { claims: payload }, error: null };
  },

  async signUp(credentials: { email: string; password: string; options?: unknown }): Promise<{
    data: { user: AuthUser | null; session: AuthSession | null };
    error: Error | null;
  }> {
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: credentials.email, password: credentials.password }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to create account");
      }

      setStoredSession(data.session);
      listeners.forEach((cb) => cb("SIGNED_IN", data.session));

      return { data: { user: data.user, session: data.session }, error: null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Registration failed";
      return { data: { user: null, session: null }, error: new Error(message) };
    }
  },

  async signInWithPassword(credentials: { email: string; password: string }): Promise<{
    data: { user: AuthUser | null; session: AuthSession | null };
    error: Error | null;
  }> {
    try {
      const res = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: credentials.email, password: credentials.password }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Invalid login credentials");
      }

      setStoredSession(data.session);
      listeners.forEach((cb) => cb("SIGNED_IN", data.session));

      return { data: { user: data.user, session: data.session }, error: null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Sign in failed";
      return { data: { user: null, session: null }, error: new Error(message) };
    }
  },

  async signOut(): Promise<{ error: null }> {
    setStoredSession(null);
    listeners.forEach((cb) => cb("SIGNED_OUT", null));
    return { error: null };
  },

  onAuthStateChange(callback: AuthStateChangeCallback) {
    listeners.add(callback);
    return {
      data: {
        subscription: {
          unsubscribe() {
            listeners.delete(callback);
          },
        },
      },
    };
  },

  async signInWithOAuth(_options: { provider: string; options?: unknown }): Promise<{ error: Error | null }> {
    return {
      error: new Error("Third-party OAuth is not configured. Please use email and password."),
    };
  },
};

/**
 * Universal auth export compatible with existing supabase imports across the app.
 */
export const supabase = {
  auth,
};
