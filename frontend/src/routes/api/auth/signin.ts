import { createFileRoute } from "@tanstack/react-router";
import { loginUser } from "@/integrations/mongodb/auth.server";

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/auth/signin")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const { email, password } = body || {};

          if (!email || !password) {
            return json({ error: "Email and password are required." }, 400);
          }

          const { user, token } = await loginUser(email, password);

          return json(
            {
              user,
              session: {
                access_token: token,
                token_type: "bearer",
                user,
              },
            },
            200
          );
        } catch (err: unknown) {
          let message = err instanceof Error ? err.message : "Failed to sign in";
          if (
            message.includes("SSL alert number 80") ||
            message.includes("tlsv1 alert") ||
            message.includes("ServerSelection") ||
            message.includes("ETIMEDOUT")
          ) {
            message =
              "MongoDB Atlas connection rejected: Your current IP address is not whitelisted in MongoDB Atlas. Please go to MongoDB Atlas > Network Access and add your IP address (or allow 0.0.0.0/0).";
          }
          return json({ error: message }, 400);
        }
      },
    },
  },
});
