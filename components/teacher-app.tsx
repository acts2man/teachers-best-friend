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
  Check,
  LoaderCircle,
  ShieldCheck,
  BookOpen,
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
import { assessmentInClass } from "@/lib/teacher-classes";
import { frameworkOptions } from "@/lib/states";
import type { Workspace } from "@/lib/teacher-types";
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
];

export default function TeacherApp({ view }: { view: string }) {
  const initialSnapshot = useRef(workspaceSnapshot).current;
  const [w, setW] = useState<Workspace | null>(
    initialSnapshot?.workspace ?? null,
  );
  const [revision, setRevision] = useState(initialSnapshot?.revision ?? 0);
  const [loaded, setLoaded] = useState(Boolean(initialSnapshot));
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [aiReady, setAiReady] = useState(initialSnapshot?.aiReady ?? false);
  const [authProvider, setAuthProvider] = useState<"chatgpt" | "supabase">(
    initialSnapshot?.authProvider ?? "chatgpt",
  );
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("4");
  const [framework, setFramework] = useState("California");
  const [pendingView, setPendingView] = useState<string | null>(null);
  const router = useRouter();
  async function reload() {
    try {
      setError("");
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
      };
      workspaceSnapshot = nextSnapshot;
      setW(nextSnapshot.workspace);
      setRevision(nextSnapshot.revision);
      setAiReady(nextSnapshot.aiReady);
      setAuthProvider(nextSnapshot.authProvider);
      setLoaded(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Your classroom couldn’t be loaded.",
      );
    }
  }
  useEffect(() => {
    if (isStale()) reload();
    for (const route of prefetchRoutes) router.prefetch(route);
    const onFocus = () => {
      if (document.visibilityState === "visible" && isStale()) reload();
    };
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The destination view arrives with the new page; clear the optimistic
  // highlight once it does.
  useEffect(() => {
    setPendingView(null);
  }, [view]);
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
    save,
    reload,
    go: (url: string) => router.push(url),
  };
  const shownView = pendingView ?? view;
  const title =
    [
      ...nav,
      ...libraryNav,
      { id: "scan", label: "New assessment" },
      { id: "students", label: "Roster" },
      { id: "settings", label: "Settings" },
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
      <SidebarProvider
        style={{ "--sidebar-width": "238px" } as React.CSSProperties}
        className={w.settings.reduceMotion ? "reduce-motion" : ""}
      >
        <Sidebar className="app-sidebar">
          <SidebarHeader className="brand-area">
            <Link href="/" className="brand">
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
                      href={n.id === "home" ? "/" : "/" + n.id}
                      onClick={() => setPendingView(n.id)}
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
                    <Link href={"/" + n.id} onClick={() => setPendingView(n.id)}>
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
            Choose your state. California Grade 4 is built in; other states and
            grades are retrieved with AI the first time you need them.
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
