"use client";

import { useEffect } from "react";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";

/**
 * /signup existed only as a link.
 *
 * Every "Start free" button on the marketing site, the footer CTA and all
 * three pricing buttons pointed here, and there was no page: no route, no
 * rewrite, no redirect. The whole funnel ended in a 404. Sign-up itself has
 * always worked -- it is a mode on /login -- so this is the missing door, not
 * a missing room.
 *
 * It also carries the chosen plan through. A teacher who clicks "Choose Tier 1"
 * has told us something, and until now it was dropped on the floor: the plan
 * parameter arrived at a page that did not exist. Now it rides through sign-up
 * as the destination, so they land on the billing page with that plan already
 * selected.
 */
const PAID = new Set(["tier1", "tier2", "tier3"]);

export default function SignupPage() {
  useEffect(() => {
    const plan = new URLSearchParams(window.location.search).get("plan");
    // Only a plan we actually sell. An unexpected value is dropped rather than
    // pasted into a URL.
    const next = plan && PAID.has(plan) ? `/billing?plan=${plan}` : "/app";
    // replace, not assign: the back button should return to the marketing page
    // they came from, not bounce through this redirect again.
    window.location.replace(
      `/login?mode=signup&next=${encodeURIComponent(next)}`,
    );
  }, []);

  return (
    <main className="auth-page">
      <section className="auth-form-wrap">
        <div className="auth-card" role="status">
          <p className="auth-lead">
            <LoaderCircle className="spin" size={18} aria-hidden="true" /> Taking
            you to sign-up…
          </p>
          <p className="auth-small">
            If nothing happens, <Link href="/login?mode=signup">create your account here</Link>.
          </p>
        </div>
      </section>
    </main>
  );
}
