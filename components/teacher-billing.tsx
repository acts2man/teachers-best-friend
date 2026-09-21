"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CreditCard, ExternalLink, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { useTeacher } from "./teacher-context";
import { Action, Pill, SectionTitle } from "./teacher-shared";
import { describeFailure } from "@/lib/connection";

type Plan = { id: string; name: string; price_cents: number; scan_quota: number };
type Current = {
  planId: string;
  planName: string | null;
  quota: number | null;
  status: string;
  periodEnd: string;
  hasCustomer: boolean;
  hasSubscription: boolean;
};
type State = { billingEnabled: boolean; plans: Plan[]; current: Current | null };

/** $19.99 keeps its cents; $0 and whole dollars read cleanly. */
function price(cents: number) {
  return cents === 0 ? "$0" : `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

/** "3 October 2026" rather than an ISO string a teacher has to decode. */
function renewal(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function statusNote(current: Current) {
  if (current.status === "past_due")
    return "Your last payment didn’t go through. Your plan is still working while the card is retried — updating it in Manage billing fixes it.";
  if (current.status === "canceled")
    return "Your plan was cancelled. You’re back on the free plan.";
  return null;
}

/**
 * Plan and billing, inside the app.
 *
 * Written so that it is honest in the state it is actually in today: there is
 * no Stripe account, so nothing here can be bought. The plans are still shown
 * -- a teacher deciding whether this is worth paying for should be able to see
 * what it costs -- but the buttons say "Opening soon" and are disabled. The
 * thing we never wanted was a button that looks live, takes a click, and
 * returns an error.
 */
export function BillingView() {
  const { quota, refreshQuota } = useTeacher();
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const params = useSearchParams();
  // Derived, not copied into state. A teacher who clicked "Choose Tier 2" on
  // the marketing site arrives at /billing?plan=tier2, and that choice is
  // already state -- it lives in the URL. Copying it through an effect would
  // render once without it and once with, which is the flicker described in
  // docs/url-derived-state.md.
  const wanted = params.get("plan");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/billing/state", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setState(d as State);
    } catch (e) {
      toast.error(describeFailure(e, "Couldn’t load your plan."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // load() awaits before it sets state: a plain load-on-mount, not a
    // synchronous setState.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // A teacher who picked a plan on the marketing site arrives at
  // /billing?plan=tier2. Highlight it so the choice they already made is still
  // visible after signing up, rather than dropping them on a generic page and
  // making them choose twice.
  // Coming back from Stripe. A toast and a meter refresh, no state of its own.
  const checkout = params.get("checkout");
  useEffect(() => {
    if (checkout === "done") {
      toast.success("You’re all set — your new plan is active.");
      refreshQuota();
    }
    if (checkout === "cancelled") toast("Checkout cancelled. Nothing was charged.");
  }, [checkout, refreshQuota]);

  async function choose(plan: string) {
    setBusy(plan);
    try {
      const r = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      window.location.assign(d.url);
    } catch (e) {
      toast.error(describeFailure(e, "Couldn’t open checkout."));
      setBusy(null);
    }
  }

  async function managePlan() {
    setBusy("portal");
    try {
      const r = await fetch("/api/billing/portal", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      window.location.assign(d.url);
    } catch (e) {
      toast.error(describeFailure(e, "Couldn’t open billing."));
      setBusy(null);
    }
  }

  if (loading)
    return (
      <section className="view">
        <SectionTitle title="Plan and billing" />
        <p className="muted">
          <LoaderCircle className="spin" size={16} aria-hidden="true" /> Loading your plan…
        </p>
      </section>
    );

  const current = state?.current ?? null;
  const enabled = Boolean(state?.billingEnabled);
  const note = current ? statusNote(current) : null;
  const usedQuota = quota?.quota ?? current?.quota ?? 0;
  const used = quota?.used ?? 0;

  return (
    <section className="view billing-view">
      <SectionTitle
        title="Plan and billing"
        description="What you're on, what you've used, and what the other plans cost."
      />

      <div className="card billing-current">
        <div className="billing-current-head">
          <div>
            <p className="eyebrow">YOUR PLAN</p>
            <h3>{current?.planName ?? "Free"}</h3>
          </div>
          {current?.hasCustomer && enabled && (
            <Action
              variant="secondary small"
              disabled={busy !== null}
              onClick={managePlan}
            >
              {busy === "portal" ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <CreditCard size={15} />
              )}
              Manage billing
            </Action>
          )}
        </div>
        <div className="billing-facts">
          <Pill>
            {/* Pages, because that is the unit now: one scan is one page a
                teacher photographs or uploads. */}
            {used} of {usedQuota} scans used this period
          </Pill>
          {current && <Pill>Renews {renewal(current.periodEnd)}</Pill>}
        </div>
        {note && <p className="billing-note">{note}</p>}
      </div>

      {!enabled && (
        <p className="billing-soon">
          Paid plans are opening soon. Your free account keeps working in the
          meantime, and nothing here will charge you until you choose to.
        </p>
      )}

      <ul className="billing-plans">
        {(state?.plans ?? []).map((p) => {
          const isCurrent = current?.planId === p.id;
          const preselected = wanted === p.id;
          return (
            <li
              key={p.id}
              className={`billing-plan${preselected ? " is-wanted" : ""}${isCurrent ? " is-current" : ""}`}
            >
              <span className="billing-plan-name">{p.name}</span>
              <span className="billing-plan-price">
                {price(p.price_cents)}
                <small>/month</small>
              </span>
              <span className="billing-plan-quota">
                <strong className="tabular">{p.scan_quota}</strong> pages per month
              </span>
              {isCurrent ? (
                <Pill>Your plan</Pill>
              ) : (
                <Action
                  variant={preselected ? "" : "secondary"}
                  // Disabled, and labelled so it is obvious why. Never a live
                  // button that leads to an error.
                  disabled={!enabled || busy !== null}
                  onClick={() => choose(p.id)}
                >
                  {busy === p.id && <LoaderCircle className="spin" size={15} />}
                  {enabled ? `Choose ${p.name}` : "Opening soon"}
                </Action>
              )}
            </li>
          );
        })}
      </ul>

      <p className="billing-small">
        1 scan = 1 page you photograph or upload. A page is never charged twice,
        however many times we look at it, and re-grading work you’ve already
        scanned is free.{" "}
        <a href="/#pricing" target="_blank" rel="noreferrer">
          See the full comparison <ExternalLink size={13} aria-hidden="true" />
        </a>
      </p>
    </section>
  );
}
