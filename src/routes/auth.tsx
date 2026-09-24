import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Library } from "lucide-react";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — Atlas research assistant" },
      {
        name: "description",
        content: "Sign in to Atlas to chat over your research corpus with grounded, cited answers.",
      },
      { property: "og:title", content: "Sign in — Atlas research assistant" },
      {
        property: "og:description",
        content: "Access your document library and grounded research chat.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/workspace" });
    });
  }, [navigate]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/workspace` },
        });
        if (error) throw error;
        if (!data.session) {
          toast.success("Check your inbox to confirm your email address.");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate({ to: "/workspace" });
    } catch (error) {
      const raw = error instanceof Error ? error.message : "Authentication failed";
      const msg = /invalid login credentials/i.test(raw)
        ? "Wrong email or password — or this account doesn't exist yet. Create one first."
        : /weak/i.test(raw)
          ? "That password is too common. Please choose a stronger one."
          : /email not confirmed/i.test(raw)
            ? "Please confirm your email first — check your inbox."
            : raw;
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setBusy(false);
      toast.error("Google sign-in failed");
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/workspace" });
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary ring-1 ring-primary/30">
            <Library className="size-5" />
          </div>
          <div>
            <h1 className="font-display text-lg font-semibold">Atlas</h1>
            <p className="text-xs text-muted-foreground">Grounded research over your corpus</p>
          </div>
        </div>

        <div className="panel p-6">
          <h2 className="text-base font-semibold">
            {mode === "signin" ? "Sign in" : "Create your account"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your documents and conversations stay private to your account.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                autoComplete="email"
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@lab.edu"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            {errorMsg && (
              <p role="alert" className="text-sm text-destructive">
                {errorMsg}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button variant="outline" className="w-full" onClick={google} disabled={busy}>
            Continue with Google
          </Button>

          <button
            type="button"
            className="mt-6 w-full text-center text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? "No account yet? Create one" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
