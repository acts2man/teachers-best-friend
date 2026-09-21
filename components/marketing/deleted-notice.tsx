"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Check } from "lucide-react";

/**
 * The last thing a deleted account sees.
 *
 * It lives here rather than in the page because the landing page is statically
 * rendered and revalidated hourly, and reading searchParams in the page itself
 * would opt the most-visited page on the site out of that caching for the sake
 * of one sentence that almost nobody sees. Derived from the URL rather than
 * held in state, per docs/url-derived-state.md; the Suspense boundary is what
 * keeps the page around it static.
 */
function Notice() {
  const deleted = useSearchParams().get("deleted") === "1";
  if (!deleted) return null;
  return (
    <div className="mk-wrap" role="status">
      <p className="deleted-notice">
        <Check size={18} aria-hidden="true" />
        Your account and your classroom data have been deleted.
      </p>
    </div>
  );
}

export function DeletedNotice() {
  return (
    <Suspense fallback={null}>
      <Notice />
    </Suspense>
  );
}
