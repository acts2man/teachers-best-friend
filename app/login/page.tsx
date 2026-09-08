"use client";

import { FormEvent, useState } from "react";
import { BookOpen, LoaderCircle, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

function safeNext(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const supabase = createClient();
      const next = safeNext(
        new URLSearchParams(window.location.search).get("next"),
      );
      if (mode === "signin") {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (authError) throw authError;
        window.location.assign(next);
        return;
      }

      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (authError) throw authError;
      if (data.session) window.location.assign(next);
      else
        setMessage(
          "Check your email to confirm your account, then return here to sign in.",
        );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "We couldn’t complete that sign-in request.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-story">
        <a className="auth-brand" href="/">
          <span className="brand-mark">
            <img src="/brand/teacher-book.png" alt="" width="44" height="44" />
          </span>
          <span>
            a teacher’s<strong>best friend.</strong>
          </span>
        </a>
        <div>
          <p className="eyebrow">YOUR PRIVATE TEACHING WORKSPACE</p>
          <h1>Turn student work into the next right lesson.</h1>
          <p>
            Check alignment, review answers with confidence, and move directly
            into focused reteaching.
          </p>
        </div>
        <div className="auth-trust">
          <ShieldCheck size={19} />
          <span>
            Your classroom and documents stay private to your account.
          </span>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <span className="soft-icon">
            <BookOpen size={22} />
          </span>
          <p className="eyebrow">WELCOME</p>
          <h2>
            {mode === "signin" ? "Open your classroom" : "Create your account"}
          </h2>
          <p className="auth-intro">
            {mode === "signin"
              ? "Sign in to continue where you left off."
              : "Start with a secure personal teaching workspace."}
          </p>
          <form onSubmit={submit} className="form-stack auth-form">
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete={
                  mode === "signin" ? "current-password" : "new-password"
                }
                minLength={8}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error && <p className="auth-message error">{error}</p>}
            {message && <p className="auth-message success">{message}</p>}
            <button
              className="action auth-submit"
              disabled={busy}
              type="submit"
            >
              {busy && <LoaderCircle className="spin" size={16} />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>
          <button
            className="auth-switch"
            type="button"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError("");
              setMessage("");
            }}
          >
            {mode === "signin"
              ? "New here? Create an account"
              : "Already have an account? Sign in"}
          </button>
        </div>
      </section>
    </main>
  );
}
