"use client";
import { useEffect, useRef, useState } from "react";
import { Eye, LoaderCircle, Search } from "lucide-react";
import { describeFailure } from "@/lib/connection";
import { toast } from "sonner";
import { Action, Modal, Pill } from "./teacher-shared";

type Candidate = {
  id: string;
  email: string;
  name: string;
  school: string;
  status: string;
  lastSeenAt: string | null;
};

/**
 * The "View as teacher" control in the teacher app's sidebar, for app
 * managers. The admin dashboard has its own entry point on each account
 * page; this one exists so an app manager can switch accounts without
 * detouring through /admin first.
 */
export function ViewAsPicker() {
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [teachers, setTeachers] = useState<Candidate[] | null>(null);
  const [query, setQuery] = useState("");
  // A ref, not state, so the "already fetching" guard costs no render and the
  // effect sets nothing synchronously.
  const fetching = useRef(false);

  useEffect(() => {
    if (!open || teachers || fetching.current) return;
    fetching.current = true;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/impersonation/candidates", {
          cache: "no-store",
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        if (!cancelled) setTeachers(d.teachers as Candidate[]);
      } catch (e) {
        if (!cancelled) {
          // An empty list rather than a permanent spinner: the toast explains
          // why, and reopening the picker retries.
          setTeachers([]);
          toast.error(
            describeFailure(e, "The account list couldn’t be loaded."),
          );
        }
      } finally {
        fetching.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, teachers]);

  const loading = open && teachers === null;

  async function start(teacher: Candidate) {
    if (starting) return;
    setStarting(teacher.id);
    try {
      const r = await fetch("/api/impersonation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacherId: teacher.id }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      // A full document load, not a router push: the workspace is cached in a
      // module-level variable, and it has to be rebuilt under the new identity.
      window.location.assign("/app");
    } catch (e) {
      setStarting(null);
      toast.error(
        describeFailure(e, "That account couldn’t be opened."),
      );
    }
  }

  const term = query.trim().toLowerCase();
  const shown = (teachers ?? []).filter((t) =>
    !term
      ? true
      : [t.name, t.email, t.school].some((v) => v.toLowerCase().includes(term)),
  );

  return (
    <>
      <button
        type="button"
        className="footer-link"
        onClick={() => setOpen(true)}
      >
        <Eye size={16} aria-hidden="true" />
        View as teacher
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="View as teacher"
        description="Open another teacher's account read-only. You can look at everything; saving, uploading and scanning stay turned off until you stop viewing."
        wide
      >
        <div className="view-as-search">
          <Search size={16} aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email or school"
            aria-label="Search accounts"
          />
        </div>
        {loading && (
          <p className="cell-meta">
            <LoaderCircle className="spin" size={14} /> Loading accounts…
          </p>
        )}
        {teachers && shown.length === 0 && (
          <p className="cell-meta">No account matches “{query}”.</p>
        )}
        <div className="view-as-list">
          {shown.map((t) => (
            <div className="view-as-row" key={t.id}>
              <div>
                <strong>{t.name || t.email || "Unnamed account"}</strong>
                <span className="cell-meta">
                  {t.email}
                  {t.school ? " · " + t.school : ""}
                </span>
              </div>
              {t.status !== "active" && <Pill tone="amber">{t.status}</Pill>}
              <Action
                variant="secondary small"
                disabled={!!starting}
                onClick={() => start(t)}
              >
                {starting === t.id ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Eye size={15} />
                )}
                View
              </Action>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
