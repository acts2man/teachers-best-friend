"use client";
import { useEffect } from "react";

/**
 * The last resort: a failure in the root layout itself, which app/error.tsx
 * cannot catch because it lives inside that layout. This one replaces the whole
 * document, so it ships its own <html> and <body> and cannot rely on the app's
 * stylesheet having loaded -- hence the inline styles, which is the one place
 * in this codebase they are the right answer.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled root error", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          background: "#f7f7ef",
          color: "#23312b",
          fontFamily: "system-ui, -apple-system, Segoe UI, Arial, sans-serif",
        }}
      >
        <main style={{ maxWidth: "34rem", textAlign: "center" }} role="alert">
          <h1 style={{ fontSize: "22px", margin: "0 0 12px" }}>
            The app couldn&rsquo;t load
          </h1>
          <p style={{ margin: "0 0 20px", lineHeight: 1.6 }}>
            Your work is saved. Uploads and grading are stored as they happen,
            so nothing you have scanned or confirmed is lost.
          </p>
          <button
            onClick={reset}
            style={{
              border: "none",
              borderRadius: "10px",
              padding: "12px 20px",
              fontSize: "15px",
              fontWeight: 600,
              cursor: "pointer",
              background: "#2f6b53",
              color: "#ffffff",
            }}
          >
            Reload the app
          </button>
          {error.digest ? (
            <p style={{ marginTop: "20px", fontSize: "13px", opacity: 0.75 }}>
              Quote this code if you report it: <code>{error.digest}</code>
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
