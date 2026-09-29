import { createServerFn } from "@tanstack/react-start";
import { registerUser, loginUser, verifyToken, getUserById } from "@/integrations/mongodb/auth.server";

export const signUpFn = createServerFn({ method: "POST" })
  .validator((input: { email: string; password: string }) => {
    if (!input?.email || !input?.password) {
      throw new Error("Email and password are required.");
    }
    return input;
  })
  .handler(async ({ data }) => {
    const { user, token } = await registerUser(data.email, data.password);
    return {
      user,
      session: {
        access_token: token,
        token_type: "bearer",
        user,
      },
    };
  });

export const signInFn = createServerFn({ method: "POST" })
  .validator((input: { email: string; password: string }) => {
    if (!input?.email || !input?.password) {
      throw new Error("Email and password are required.");
    }
    return input;
  })
  .handler(async ({ data }) => {
    const { user, token } = await loginUser(data.email, data.password);
    return {
      user,
      session: {
        access_token: token,
        token_type: "bearer",
        user,
      },
    };
  });

export const verifySessionFn = createServerFn({ method: "POST" })
  .validator((input: { token: string }) => input)
  .handler(async ({ data }) => {
    if (!data?.token) return { user: null };
    const payload = verifyToken(data.token);
    if (!payload?.sub) return { user: null };
    const user = await getUserById(payload.sub as string);
    return { user };
  });
