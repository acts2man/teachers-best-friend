"use client";
import { useEffect } from "react";

/**
 * What a teacher sees when something in the app throws.
 *
 * Without this file the whole page goes blank: React unmounts the tree and
 * Next.js has nothing to put in its place. A blank screen in the middle of a
 * class, with no explanation and no way back, is the worst possible version of
 * any bug -- and it happens to be the version a teacher cannot report usefully,
 * because there is nothing on screen to describe.
 *
 * So: say something plain, say what is safe (their work is saved -- uploads and
 * grading are written server-side as they happen, not on leaving the page), and
 * offer the two ways out. The digest is shown because it is the one thing that
 * ties a teacher's report to the actual error in the logs.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Reaches the platform logs, where the digest below can be matched to it.
    console.error("Unhandled application error", error);
  }, [error]);

  return (
    <div className="error-page" role="alert">
      <h1>Something went wrong on this screen</h1>
      <p>
        Your work is saved — uploads and grading are stored as they happen, not
        when you leave a page. This is a fault in the screen itself, not in
        anything you did.
      </p>
      <div className="error-page-actions">
        <button className="action" onClick={reset}>
          Try this screen again
        </button>
        <button
          className="action secondary"
          // A full load rather than a client-side route change: whatever threw
          // may still be mounted, and a soft navigation can walk straight back
          // into it. Starting the app again cannot.
          onClick={() => window.location.assign("/assessments")}
        >
          Back to assessments
        </button>
      </div>
      <p className="error-page-meta">
        If it keeps happening, tell us what you were doing and quote this code
        {error.digest ? (
          <>
            {" "}
            — <code>{error.digest}</code>
          </>
        ) : null}
        .
      </p>
    </div>
  );
}
