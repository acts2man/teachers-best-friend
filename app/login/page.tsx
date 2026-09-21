"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  BookOpen,
  Cpu,
  LoaderCircle,
  Lock,
  ShieldCheck,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const ADMIN_HOME = "/admin";

function safeNext(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/app";
}

function wantsAdmin(search: string) {
  const next = new URLSearchParams(search).get("next") ?? "";
  return next === ADMIN_HOME || next.startsWith(`${ADMIN_HOME}/`);
}

export default function LoginPage() {
  const [admin, setAdmin] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // The admin variant is chosen by the URL (?next=/admin) so the landing
  // page and the admin gate can both deep-link straight to it.
  //
  // ?mode=signup opens straight on "create account". /signup sends teachers
  // here with it, so someone who pressed "Start free" is not asked to find the
  // toggle before they can do the thing they just clicked.
  useEffect(() => {
    const search = window.location.search;
    setAdmin(wantsAdmin(search));
    if (new URLSearchParams(search).get("mode") === "signup" && !wantsAdmin(search))
      setMode("signup");
  }, []);

  function switchToAdmin() {
    setAdmin(true);
    setMode("signin");
    setError("");
    setMessage("");
    window.history.replaceState(null, "", `/login?next=${ADMIN_HOME}`);
  }

  function switchToTeacher() {
    setAdmin(false);
    setError("");
    setMessage("");
    window.history.replaceState(null, "", "/login");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const supabase = createClient();
      const next = admin
        ? ADMIN_HOME
        : safeNext(new URLSearchParams(window.location.search).get("next"));
      if (admin || mode === "signin") {
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
    <main className={admin ? "auth-page is-admin" : "auth-page"}>
      <section className="auth-story">
        <Link className="auth-brand" href="/">
          <span className="brand-mark">
            <img src="/brand/teacher-book.png" alt="" width="44" height="44" />
          </span>
          <span>
            a teacher’s<strong>best friend.</strong>
          </span>
        </Link>
        {admin ? (
          <div>
            <p className="eyebrow">OPERATIONS CONSOLE</p>
            <h1>Every scan, every cost, every account. One place.</h1>
            <p>
              Watch AI spend against the one-cent target, manage teacher
              accounts, and choose which model handles each kind of work.
            </p>
          </div>
        ) : (
          <div>
            <p className="eyebrow">YOUR PRIVATE TEACHING WORKSPACE</p>
            <h1>Turn student work into the next right lesson.</h1>
            <p>
              Check alignment, review answers with confidence, and move directly
              into focused reteaching.
            </p>
          </div>
        )}
        <div className="auth-trust">
          <ShieldCheck size={19} />
          <span>
            {admin
              ? "Admin access is verified on the server for every page and action."
              : "Your classroom and documents stay private to your account."}
          </span>
        </div>
      </section>
      <section className="auth-panel">
        <div className={admin ? "auth-card auth-card-admin" : "auth-card"}>
          {admin ? (
            <div className="auth-admin-head">
              <span className="soft-icon">
                <ShieldCheck size={22} />
              </span>
              <span className="auth-admin-pill">
                <Lock size={11} />
                Restricted access
              </span>
            </div>
          ) : (
            <span className="soft-icon">
              <BookOpen size={22} />
            </span>
          )}
          <p className="eyebrow">{admin ? "ADMIN DASHBOARD" : "WELCOME"}</p>
          <h2>
            {admin
              ? "Sign in as an administrator"
              : mode === "signin"
                ? "Open your classroom"
                : "Create your account"}
          </h2>
          <p className="auth-intro">
            {admin
              ? "Use the same email and password as your teaching account. Admin access is attached to approved accounts, so there’s nothing extra to set up."
              : mode === "signin"
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
                  admin || mode === "signin"
                    ? "current-password"
                    : "new-password"
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
              {admin
                ? "Open the admin dashboard"
                : mode === "signin"
                  ? "Sign in"
                  : "Create account"}
            </button>
          </form>
          {admin ? (
            <>
              <ul className="auth-admin-facts" aria-label="What the admin dashboard includes">
                <li>
                  <BarChart3 size={14} />
                  Usage &amp; cost
                </li>
                <li>
                  <Users size={14} />
                  Teacher accounts
                </li>
                <li>
                  <Cpu size={14} />
                  AI pipeline
                </li>
              </ul>
              <button
                className="auth-switch"
                type="button"
                onClick={switchToTeacher}
              >
                Not an administrator? Sign in to your classroom
              </button>
            </>
          ) : (
            <>
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
              <a
                className="auth-switch auth-switch-admin"
                href={`/login?next=${ADMIN_HOME}`}
                onClick={(event) => {
                  event.preventDefault();
                  switchToAdmin();
                }}
              >
                <ShieldCheck size={13} />
                Administrator? Sign in to the admin dashboard
              </a>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
