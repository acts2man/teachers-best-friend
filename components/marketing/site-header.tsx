"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";

const LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/#privacy", label: "Privacy" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#districts", label: "For districts" },
];

/* The top bar is a thin hairline at rest; once the page scrolls it gains a
   backdrop blur and a rule so it reads as a surface, not a stripe. Below
   860px the nav folds into a menu so Sign in and every section stay
   reachable. */
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onResize = () => { if (window.innerWidth > 860) setOpen(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <header className={`mk-header${scrolled || open ? " is-scrolled" : ""}${open ? " is-open" : ""}`}>
      <div className="mk-wrap mk-nav">
        <Link href="/" className="mk-brand" onClick={close}>
          A Teacher’s <em>Best Friend</em>
        </Link>
        <nav aria-label="Main">
          {LINKS.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
        </nav>
        <div className="mk-nav-actions">
          <Link href="/login" className="mk-login">Sign in</Link>
          <Link href="/signup" className="btn btn-mark btn-sm">Start free</Link>
          <button
            type="button"
            className="mk-menu-btn"
            aria-expanded={open}
            aria-controls="mk-mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </div>
      <div id="mk-mobile-nav" className="mk-mobile-nav" hidden={!open}>
        <nav aria-label="Main, mobile">
          {LINKS.map((l) => <Link key={l.href} href={l.href} onClick={close}>{l.label}</Link>)}
          <Link href="/login" onClick={close}>Sign in</Link>
        </nav>
        <Link href="/signup" className="btn btn-mark" onClick={close}>Start free — 20 scans a month</Link>
      </div>
    </header>
  );
}
