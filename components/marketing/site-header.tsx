"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/* The top bar is a thin hairline at rest; once the page scrolls it gains a
   backdrop blur and a rule so it reads as a surface, not a stripe. */
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header className={`mk-header${scrolled ? " is-scrolled" : ""}`}>
      <div className="mk-wrap mk-nav">
        <Link href="/" className="mk-brand">
          A Teacher’s <em>Best Friend</em>
        </Link>
        <nav aria-label="Main">
          <Link href="/#how">How it works</Link>
          <Link href="/#privacy">Privacy</Link>
          <Link href="/#pricing">Pricing</Link>
          <Link href="/#districts">For districts</Link>
        </nav>
        <div className="mk-nav-actions">
          <Link href="/login" className="mk-login">Sign in</Link>
          <Link href="/signup" className="btn btn-mark btn-sm">Start free</Link>
        </div>
      </div>
    </header>
  );
}
