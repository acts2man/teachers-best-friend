"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  House,
  ScanLine,
  Files,
  Users,
  Library,
  Settings,
  ArrowRight,
  Plus,
  ChevronDown,
  HelpCircle,
  Headset,
  Check,
  LoaderCircle,
  ShieldCheck,
  BookOpen,
  LayoutDashboard,
} from "lucide-react";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Toaster, toast } from "sonner";
import { catalogFor } from "@/lib/teacher-catalog";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { assessmentInClass } from "@/lib/teacher-classes";
import { frameworkOptions } from "@/lib/states";
import type { Workspace } from "@/lib/teacher-types";
import { ViewAsPicker } from "./teacher-view-as";
import { TeacherContext } from "./teacher-context";
import { Pick, Action, Modal, Pill } from "./teacher-shared";
import HomeView from "./teacher-home";
import GuideView from "./teacher-guide";
import { AssessmentView } from "./teacher-assessments";
import { ClassesView } from "./teacher-classes";
import { ScanView } from "./teacher-scan";
import {
  StandardsView,
  DiagnosticsView,
  StudentsView,
} from "./teacher-insights";
import { ReteachView, ResourcesView, SettingsView } from "./teacher-planning";
import { SupportView } from "./teacher-support";
import {
  fetchQuota,
  quotaLevel,
  SCAN_COMPLETE_EVENT,
  type Quota,
} from "@/lib/quota-client";
const nav = [
  { id: "home", label: "Overview", icon: House },
  { id: "assessments", label: "Assessments", icon: Files },
  { id: "lessons", label: "Lesson plans", icon: BookOpen },
  { id: "classes", label: "Classes", icon: Users },
];
const libraryNav = [
  { id: "standards", label: "Standards", icon: Library },
  { id: "guide", label: "How to use", icon: HelpCircle },
];
type WorkspaceSnapshot = {
  workspace: Workspace;
  revision: number;
  aiReady: boolean;
  authProvider: "chatgpt" | "supabase";
  fetchedAt: number;
  impersonating: { teacherEmail: string } | null;
};

// Keep the authoritative workspace alive while Next.js moves between pages.
// A hard refresh intentionally starts empty so stale sample data never flashes.
let workspaceSnapshot: WorkspaceSnapshot | null = null;
// Re-check the server only when the in-memory copy is older than this, or when
// the tab comes back into focus after being away. Switching screens reuses the
// copy already in memory instead of downloading the whole workspace again.
const STALE_AFTER_MS = 2 * 60 * 1000;
const isStale = () =>
  !workspaceSnapshot || Date.now() - workspaceSnapshot.fetchedAt > STALE_AFTER_MS;
// Screens reached from buttons rather than sidebar links, prefetched once so
// they open as quickly as the sidebar destinations.
const prefetchRoutes = [
  "/assessments",
  "/lessons",
  "/classes",
  "/students",
  "/scan",
  "/standards",
  "/settings",
  "/guide",
  "/resources",
  "/support",
];

export default function TeacherApp({ view }: { view: string }) {
  // Seed from the module-level snapshot that survives client-side navigation.
  // These are lazy initializers on purpose: React calls them once, on the
  // first render of this component, which is exactly the "read it at mount"
  // behaviour the old `useRef(workspaceSnapshot).current` was reaching for --
  // without reading a ref during render, which React 19 does not guarantee is
  // stable and which the compiler flags.
  const [w, setW] = useState<Workspace | null>(
    () => workspaceSnapshot?.workspace ?? null,
  );
  const [revision, setRevision] = useState(() => workspaceSnapshot?.revision ?? 0);
  const [loaded, setLoaded] = useState(() => Boolean(workspaceSnapshot));
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [aiReady, setAiReady] = useState(
    () => workspaceSnapshot?.aiReady ?? false,
  );
  const [authProvider, setAuthProvider] = useState<"chatgpt" | "supabase">(
    () => workspaceSnapshot?.authProvider ?? "chatgpt",
  );
  const [isAdmin, setIsAdmin] = useState(false);
  const [canViewAs, setCanViewAs] = useState(false);
  const [impersonating, setImpersonating] = useState<{
    teacherEmail: string;
  } | null>(() => workspaceSnapshot?.impersonating ?? null);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("4");
  const [framework, setFramework] = useState("California");
  // Optimistic sidebar highlight. Records which view we were on when the link
  // was clicked, so the highlight expires by derivation the moment the new
  // page arrives -- no effect, and no window where the highlight outlives the
  // navigation it belonged to.
  const [pending, setPending] = useState<{ from: string; to: string } | null>(
    null,
  );
  const [quota, setQuota] = useState<Quota | null>(null);
  const [leaving, setLeaving] = useState(false);
  const router = useRouter();

  /**
   * Leave a "view as" session.
   *
   * Deliberately a fetch to a route handler rather than a server action: the
   * banner renders on /app and /[view], which are force-static, and an action
   * POST to a prerendered route came back out of the cache with the exit
   * silently not applied. The navigation is a full page load so nothing of the
   * viewed teacher's workspace survives in memory.
   */
  async function stopViewing() {
    setLeaving(true);
    try {
      await fetch("/api/impersonation", {
        method: "DELETE",
        cache: "no-store",
      });
    } catch {
      // The cookie is cleared server-side even on an error path; if the
      // request never landed at all the reload below just re-renders the
      // banner, which is recoverable. Either way, leave.
    }
    window.location.href = "/admin/accounts";
  }
  async function reload() {
    try {
      const r = await fetch("/api/workspace", { cache: "no-store" });
      if (r.status === 401) {
        const next = window.location.pathname + window.location.search;
        router.replace("/login?next=" + encodeURIComponent(next));
        return;
      }
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      const nextSnapshot: WorkspaceSnapshot = {
        workspace: d.workspace,
        revision: d.revision,
        aiReady: Boolean(d.aiReady),
        authProvider: d.authProvider || "chatgpt",
        fetchedAt: Date.now(),
        impersonating: d.impersonating ?? null,
      };
      workspaceSnapshot = nextSnapshot;
      setW(nextSnapshot.workspace);
      setRevision(nextSnapshot.revision);
      setAiReady(nextSnapshot.aiReady);
      setAuthProvider(nextSnapshot.authProvider);
      setImpersonating(nextSnapshot.impersonating);
      setLoaded(true);
      // Cleared on success rather than on entry: clearing it up front made a
      // failing reload blank the message and then restore it a moment later.
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Your classroom couldn’t be loaded.",
      );
    }
  }
  useEffect(() => {
    // reload() awaits the fetch before it touches state, so nothing is set
    // synchronously here and no cascading render results. The rule cannot see
    // through an async function to determine that.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isStale()) reload();
    for (const route of prefetchRoutes) router.prefetch(route);
    const onFocus = () => {
      if (document.visibilityState === "visible" && isStale()) reload();
    };
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    // The /admin link is shown only when the signed-in profile has
    // is_admin = true. Read with the user's own session: RLS lets a user
    // select their own profiles row. The database's is_admin() check still
    // guards every admin page, so this is display-only.
    if (authProvider !== "supabase") return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = createBrowserSupabase();
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) return;
        const { data } = await supabase
          .from("profiles")
          .select("is_admin, is_app_manager")
          .eq("id", auth.user.id)
          .maybeSingle();
        if (!cancelled) {
          setIsAdmin(Boolean(data?.is_admin));
          // Mirrors can_impersonate() in the database, which is the real gate
          // on every impersonation call. This only decides whether the
          // sidebar control is rendered.
          setCanViewAs(
            Boolean(data?.is_admin) || Boolean(data?.is_app_manager),
          );
        }
      } catch {
        // Not signed in or Supabase is not configured: no admin link.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authProvider]);
  // The scan meter. Plans only exist on the Supabase deployment, so the
  // ChatGPT Sites host simply never shows one. Re-read after every analysis
  // (analyzeRequest announces it) so the count a teacher sees is the count
  // the server would enforce.
  useEffect(() => {
    if (authProvider !== "supabase") return;
    let cancelled = false;
    const read = async () => {
      const next = await fetchQuota();
      if (!cancelled) setQuota(next);
    };
    read();
    window.addEventListener(SCAN_COMPLETE_EVENT, read);
    return () => {
      cancelled = true;
      window.removeEventListener(SCAN_COMPLETE_EVENT, read);
    };
  }, [authProvider]);
  useEffect(() => {
    document.documentElement.classList.toggle(
      "reduce-motion",
      w?.settings.reduceMotion ?? false,
    );
    document.documentElement.dataset.theme = w?.settings.theme || "pine";
  }, [w?.settings.reduceMotion, w?.settings.theme]);

  if (!w) {
    return <WorkspaceLoading error={error} retry={reload} />;
  }

  async function save(next: Workspace, message?: string) {
    if (!loaded) {
      toast.error("Wait for your classroom to load before saving.");
      return false;
    }
    // Viewing another teacher's account is read-only. The server refuses these
    // writes anyway (writingTeacherId in lib/teacher-server.ts); stopping here
    // turns a 403 into a plain explanation, and keeps the refusal identical
    // across all of the save() call sites without touching any of them.
    if (impersonating) {
      toast.error(
        "You’re viewing " +
          impersonating.teacherEmail +
          "’s account, so changes are turned off. Stop viewing to make changes of your own.",
      );
      return false;
    }
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    try {
      const r = await fetch("/api/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: next, revision }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      workspaceSnapshot = {
        workspace: next,
        revision: d.revision,
        aiReady,
        authProvider,
        fetchedAt: Date.now(),
        impersonating,
      };
      setW(next);
      setRevision(d.revision);
      if (message) toast.success(message);
      return true;
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Changes couldn’t be saved.",
      );
      return false;
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  // Every view derives from the active classroom, so a workspace with no
  // classes cannot be rendered at all. Before this guard the line below read
  // `classroom.id` off undefined and threw, leaving a blank page with no way
  // out — which is exactly where an admin "reset this teacher" used to land
  // the account. Offer to rebuild instead of crashing.
  if (w.classes.length === 0) {
    return (
      <EmptyWorkspace
        busy={busy}
        onCreate={() =>
          save(
            {
              ...w,
              classes: [
                {
                  id: "my-class",
                  name: "My classroom",
                  grade: 4,
                  framework: "California",
                  demo: false,
                },
              ],
              activeClassId: "my-class",
            },
            "Your classroom is ready.",
          )
        }
      />
    );
  }
  const classroom =
      w.classes.find((c) => c.id === w.activeClassId) || w.classes[0],
    students = w.students.filter((s) => s.classId === classroom.id),
    assessments = w.assessments.filter((a) =>
      assessmentInClass(a, classroom.id),
    ),
    catalog = catalogFor(w, classroom.grade, classroom.framework);
  const value = {
    w,
    classroom,
    students,
    assessments,
    catalog,
    loaded,
    busy,
    aiReady,
    // Viewing another teacher's account. Screens use it to hide controls that
    // would only fail: the server refuses every write for the whole session.
    readOnly: Boolean(impersonating),
    quota,
    refreshQuota: () =>
      window.dispatchEvent(new Event(SCAN_COMPLETE_EVENT)),
    save,
    reload,
    go: (url: string) => router.push(url),
  };
  const shownView = pending && pending.from === view ? pending.to : view;
  const title =
    [
      ...nav,
      ...libraryNav,
      { id: "scan", label: "New assessment" },
      { id: "students", label: "Roster" },
      { id: "settings", label: "Settings" },
      { id: "support", label: "Support" },
      { id: "resources", label: "Teaching resources" },
      { id: "diagnostics", label: "Class insights" },
    ].find((n) => n.id === shownView)?.label || "Overview";
  async function createClass() {
    if (!w || !name.trim()) return;
    const id = crypto.randomUUID();
    if (
      await save(
        {
          ...w,
          classes: [
            ...w.classes,
            {
              id,
              name: name.trim(),
              grade: Number(grade),
              framework,
              demo: false,
            },
          ],
          activeClassId: id,
        },
        name.trim() + " is ready. Add its roster next.",
      )
    ) {
      setCreateOpen(false);
      setName("");
      router.push("/students");
    }
  }
  return (
    <TeacherContext.Provider value={value}>
      {impersonating && (
        <div className="impersonation-banner" role="status">
          <ShieldCheck size={16} />
          <span>
            Viewing <strong>{impersonating.teacherEmail}</strong>’s
            workspace as an app manager. This is read-only — saving,
            uploading and scanning are turned off until you stop viewing.
          </span>
          <button type="button" onClick={stopViewing} disabled={leaving}>
            {leaving ? "Leaving…" : "Stop viewing"}
          </button>
        </div>
      )}
      <SidebarProvider
        style={{ "--sidebar-width": "238px" } as React.CSSProperties}
        className={w.settings.reduceMotion ? "reduce-motion" : ""}
      >
        <Sidebar className="app-sidebar">
          <SidebarHeader className="brand-area">
            <Link href="/app" className="brand">
              <span className="brand-mark">
                <img
                  src="/brand/teacher-book.png"
                  alt=""
                  width="44"
                  height="44"
                />
              </span>
              <span>
                a teacher’s
                <span>
                  best friend<span className="brand-dot">.</span>
                </span>
              </span>
            </Link>
          </SidebarHeader>
          <SidebarContent className="side-content">
            <button className="new-scan" onClick={() => router.push("/scan")}>
              <ScanLine size={18} />
              New assessment
              <Plus size={16} />
            </button>
            <QuotaMeter quota={quota} />
            <div className="nav-label">YOUR WORKSPACE</div>
            <SidebarMenu>
              {nav.map((n) => (
                <SidebarMenuItem key={n.id}>
                  <SidebarMenuButton
                    asChild
                    isActive={shownView === n.id}
                    className="nav-link"
                  >
                    <Link
                      href={n.id === "home" ? "/app" : "/" + n.id}
                      onClick={() => setPending({ from: view, to: n.id })}
                    >
                      <n.icon size={19} />
                      <span>{n.label}</span>
                      {shownView === n.id && (
                        <span className="nav-active-dot" />
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
            <div className="nav-label library-label">YOUR TOOLKIT</div>
            <SidebarMenu>
              {libraryNav.map((n) => (
                <SidebarMenuItem key={n.id}>
                  <SidebarMenuButton
                    asChild
                    isActive={shownView === n.id}
                    className="nav-link"
                  >
                    <Link href={"/" + n.id} onClick={() => setPending({ from: view, to: n.id })}>
                      <n.icon size={18} />
                      <span>{n.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarContent>
          <SidebarFooter className="side-footer">
            <Link href="/settings" className="footer-link">
              <Settings size={18} />
              Settings
            </Link>
            <Link href="/support" className="footer-link">
              <Headset size={18} />
              Support
            </Link>
            {isAdmin && (
              <Link href="/admin" className="footer-link">
                <LayoutDashboard size={18} />
                Admin
              </Link>
            )}
            {canViewAs && !impersonating && <ViewAsPicker />}
            {authProvider === "supabase" && (
              <form action="/auth/signout" method="post">
                <button className="footer-link" type="submit">
                  <ShieldCheck size={18} />
                  Sign out
                </button>
              </form>
            )}
            <div className="teacher-account">
              <span className="account-avatar">
                {(w.settings.teacherName || "Teacher").slice(0, 1)}
              </span>
              <div>
                <strong>
                  {w.settings.teacherName || "Your teaching space"}
                </strong>
                <span>Personal workspace</span>
              </div>
              <ShieldCheck size={16} />
            </div>
            <nav className="footer-legal" aria-label="Policies">
              <Link href="/legal/privacy">Privacy</Link>
              <Link href="/legal/student-data-privacy">Student data</Link>
              <Link href="/legal/how-we-use-ai">How we use AI</Link>
              <Link href="/legal/terms">Terms</Link>
            </nav>
          </SidebarFooter>
        </Sidebar>
        <div className="app-main">
          <header className="topbar">
            <div className="breadcrumb">
              <SidebarTrigger className="mobile-menu" />
              <span>My classroom</span>
              <span className="breadcrumb-slash">/</span>
              <strong>{title}</strong>
            </div>
            <div className="topbar-right">
              {loaded && (
                <span className="save-indicator">
                  {busy ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : (
                    <Check size={14} />
                  )}
                  <span>{busy ? "Saving" : "Saved"}</span>
                </span>
              )}
              <div className="class-switch">
                <span className="switch-label-text">Classroom</span>
                <Pick
                  label="Switch classroom"
                  value={classroom.id}
                  onChange={(v) =>
                    v === "new"
                      ? setCreateOpen(true)
                      : v === "manage"
                        ? router.push("/classes")
                        : save({ ...w, activeClassId: v })
                  }
                  options={[
                    ...w.classes.map((c) => ({
                      value: c.id,
                      label: c.name + " · Grade " + c.grade,
                    })),
                    { value: "new", label: "+ New class" },
                    { value: "manage", label: "All classes…" },
                  ]}
                />
              </div>
            </div>
          </header>
          <main className="workspace-content" id="main-content">
            {error && (
              <div className="error-banner" role="alert">
                <span>{error}</span>
                <button onClick={reload}>Retry</button>
              </div>
            )}
            {classroom.demo && (
              <div className="demo-strip">
                <Pill tone="green">SAMPLE CLASSROOM</Pill>
                <span>
                  Meet the Explorers. All student names and results are
                  fictional.
                </span>
                <button onClick={() => setCreateOpen(true)}>
                  Make it yours
                  <ArrowUpRightIcon />
                </button>
              </div>
            )}
            <div className="view-enter" key={view + "-" + classroom.id}>
              {view === "home" ? (
                <HomeView />
              ) : view === "assessments" ? (
                <AssessmentView />
              ) : view === "guide" ? (
                <GuideView />
              ) : view === "classes" ? (
                <ClassesView />
              ) : view === "scan" ? (
                <ScanView />
              ) : view === "standards" ? (
                <StandardsView />
              ) : view === "diagnostics" ? (
                <DiagnosticsView />
              ) : view === "students" ? (
                <StudentsView />
              ) : view === "lessons" ? (
                <ReteachView />
              ) : view === "resources" ? (
                <ResourcesView />
              ) : view === "support" ? (
                <SupportView />
              ) : (
                <SettingsView />
              )}
            </div>
          </main>
        </div>
      </SidebarProvider>
      <Toaster position="bottom-right" richColors closeButton />
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create a class"
        description="One class per period or group. Each keeps its own students, assessments, and lesson plans."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createClass();
          }}
          className="form-stack"
        >
          <label>
            Class name
            <input
              required
              maxLength={70}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Period 3 · Math"
            />
          </label>
          <label>
            Grade
            <Pick
              label="Grade"
              value={grade}
              onChange={setGrade}
              options={Array.from({ length: 13 }, (_, i) => ({
                value: String(i),
                label: i === 0 ? "Kindergarten" : "Grade " + i,
              }))}
            />
          </label>
          <label>
            Standards
            <Pick
              label="Standards framework"
              value={framework}
              onChange={setFramework}
              options={frameworkOptions(
                w.customStandards.map((s) => s.framework),
              )}
            />
          </label>
          <p className="field-help">
            Choose your state. California Kindergarten through Grade 8 is
            built in; other states and grades are retrieved with AI the first
            time you need them.
          </p>
          <Action type="submit" disabled={busy || !name.trim()}>
            Create class
            <ArrowRight size={16} />
          </Action>
        </form>
      </Modal>
    </TeacherContext.Provider>
  );
}
function ArrowUpRightIcon() {
  return <ArrowRight size={14} />;
}

function WorkspaceLoading({
  error,
  retry,
}: {
  error: string;
  retry: () => void;
}) {
  return (
    <div className="workspace-loading" data-state="loading" aria-busy={!error}>
      <aside className="workspace-loading-sidebar" aria-hidden="true">
        <div className="brand workspace-loading-brand">
          <span className="brand-mark">
            <img
              src="/brand/teacher-book.png"
              alt=""
              width="44"
              height="44"
            />
          </span>
          <span>
            a teacher’s
            <span>
              best friend<span className="brand-dot">.</span>
            </span>
          </span>
        </div>
        <div className="workspace-loading-side-block" />
        <div className="workspace-loading-side-line wide" />
        <div className="workspace-loading-side-line" />
        <div className="workspace-loading-side-line" />
        <div className="workspace-loading-side-line short" />
      </aside>
      <section className="workspace-loading-main">
        <div className="workspace-loading-topbar" />
        <div className="workspace-loading-content">
          {error ? (
            <div className="workspace-loading-error" role="alert">
              <h1>Your classroom couldn’t be loaded.</h1>
              <p>{error}</p>
              <button className="action" onClick={retry}>
                Try again
              </button>
            </div>
          ) : (
            <div className="workspace-loading-status" role="status">
              <LoaderCircle className="spin" size={22} />
              <span>Opening your classroom…</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * Shown when the workspace loads but carries no classes — the one state the
 * app cannot render, because every view is scoped to the active classroom.
 * Reachable after an admin reset, or after a teacher deletes their last class
 * in an older client. Recoverable in one click rather than a blank page.
 */
function EmptyWorkspace({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="workspace-loading" data-state="empty">
      <section className="workspace-loading-main">
        <div className="workspace-loading-content">
          <div className="workspace-loading-error" role="status">
            <h1>Let’s set up your first classroom.</h1>
            <p>
              This account has no classes yet. Create one to open your
              workspace — you can rename it, change the grade, and add more
              classes at any time under Classes.
            </p>
            <button className="action" onClick={onCreate} disabled={busy}>
              {busy ? "Creating…" : "Create my classroom"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * Scans left this period, in the sidebar under "New assessment".
 *
 * The meter existed server-side from the start (/api/quota, my_scan_quota)
 * but nothing rendered it, so the first a teacher heard about their limit was
 * a refusal part-way through an upload. Renders nothing at all when there is
 * no meter to show — the ChatGPT Sites host has no plans.
 */
function QuotaMeter({ quota }: { quota: Quota | null }) {
  if (!quota || quota.quota <= 0) return null;
  const level = quotaLevel(quota);
  const pct = Math.min(100, Math.round((quota.used / quota.quota) * 100));
  return (
    <div className="quota-meter" data-level={level}>
      <div className="quota-line">
        <span className="quota-count">
          {level === "out" ? "No scans left" : `${quota.remaining} scans left`}
        </span>
        <span className="quota-of">of {quota.quota}</span>
      </div>
      <div className="quota-track" role="img"
        aria-label={`${quota.used} of ${quota.quota} scans used this period`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      {level !== "ok" && (
        <p className="quota-note">
          {level === "out"
            ? "Your plan’s scans are used up for this period."
            : "You’re close to this period’s limit."}{" "}
          <Link href="/contact?topic=team">Get more scans</Link>
        </p>
      )}
    </div>
  );
}
