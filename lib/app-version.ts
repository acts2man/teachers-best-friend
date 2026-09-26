"use client";
import { readJson } from "@/lib/utils";
import { useEffect, useState } from "react";

/**
 * Notices when the version a teacher is running is behind the one being served.
 *
 * This is the shape of a bug that cost two days. Auto-read on upload shipped on
 * a Tuesday evening; the next morning a pilot teacher reported it missing. The
 * code was correct and deployed -- his phone was holding the page from before
 * it, and nothing in the app could tell either of us that. Every message back
 * to him said "do a hard refresh", which is a thing teachers should not have to
 * know, and is genuinely awkward on a phone.
 *
 * The build a page was compiled from is inlined at build time; the build being
 * served is one request away. When they differ, say so. Checked when the tab
 * comes back into focus -- which is exactly when a teacher returns to the app
 * after we have shipped something -- and slowly in the background otherwise.
 */
const BUILT_FROM = process.env.COMMIT_REF || "";
const EVERY = 10 * 60 * 1000;

export function useUpdateAvailable() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    // Nothing to compare against on a local build, where COMMIT_REF is unset.
    if (!BUILT_FROM || stale) return;
    let cancelled = false;

    async function check() {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        const d = await readJson(r);
        // Only an explicit disagreement counts. A missing or unreadable answer
        // means we do not know, and telling a teacher to reload on a guess is
        // worse than saying nothing.
        if (!cancelled && typeof d.commit === "string" && d.commit && d.commit !== BUILT_FROM)
          setStale(true);
      } catch {
        // Offline, or the check itself failed. Not a reason to nag.
      }
    }

    const timer = setInterval(check, EVERY);
    document.addEventListener("visibilitychange", check);
    void check();
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [stale]);

  return stale;
}
