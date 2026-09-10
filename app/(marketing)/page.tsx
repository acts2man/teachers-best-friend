import Link from "next/link";
import { WorksheetHero } from "@/components/marketing/worksheet-hero";

/* Pricing is read from the same table the app meters against, so the page
   can never drift from what the database enforces. Falls back to the seeded
   values if the query fails at build time. */
async function getPlans() {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
    const { data } = await sb.from("plans").select("id,name,price_cents,scan_quota,seat_based,sort_order").eq("active", true).order("sort_order");
    if (data?.length) return data;
  } catch {}
  return [
    { id: "free", name: "Free", price_cents: 0, scan_quota: 20, seat_based: false, sort_order: 1 },
    { id: "starter", name: "Starter", price_cents: 900, scan_quota: 150, seat_based: false, sort_order: 2 },
    { id: "pro", name: "Pro", price_cents: 1900, scan_quota: 500, seat_based: false, sort_order: 3 },
    { id: "team", name: "Team", price_cents: 1500, scan_quota: 500, seat_based: true, sort_order: 4 },
  ];
}

export const revalidate = 3600;

export default async function LandingPage() {
  const plans = await getPlans();

  return (
    <>
      {/* ---------------- Hero ---------------- */}
      <section className="mk-wrap hero">
        <div className="hero-copy">
          <h1>Photograph the worksheet. See what to reteach.</h1>
          <p className="lede">
            Point your phone at a stack of student work. A few seconds later you know
            which standard each question hits, who missed it, why they missed it, and
            what to do about it on Monday.
          </p>
          <div className="hero-actions">
            <Link href="/signup" className="btn btn-mark">Start free — 20 scans a month</Link>
            <Link href="#how" className="btn btn-quiet">See how it works</Link>
          </div>
          <p className="hero-note">
            No student names required. Nothing is used to train AI. Worksheet photos
            are deleted automatically.
          </p>
        </div>
        <div className="hero-figure">
          <WorksheetHero />
        </div>
      </section>

      <hr className="rule mk-wrap" />

      {/* ---------------- The Sunday-night problem ---------------- */}
      <section className="mk-wrap section narrow">
        <h2>Grading tells you who got it wrong. It doesn't tell you what to teach.</h2>
        <p>
          Twenty-eight worksheets, four wrong on question three. You know the number.
          What you don't know without reading every answer is that six of them added
          the denominators, and two of them just miscopied the problem. Those are
          different lessons.
        </p>
        <p>
          That reading is the part that eats the weekend. It's also the part that
          matters most, because it's the difference between reteaching the right thing
          to the right kids and re-running the whole lesson for everyone.
        </p>
      </section>

      {/* ---------------- How it works ---------------- */}
      <section id="how" className="mk-wrap section">
        <h2>How it works</h2>
        <ol className="steps">
          <li>
            <h3>Photograph</h3>
            <p>
              Snap the worksheet with your phone, or upload a PDF. Handwriting is fine.
              You can scan a whole stack at once.
            </p>
          </li>
          <li>
            <h3>Align</h3>
            <p>
              Each question is matched to a standard from your state's official list —
              not recalled from memory, looked up. You confirm or change every match.
            </p>
          </li>
          <li>
            <h3>Score</h3>
            <p>
              Student answers are read and checked against your key. Every result is
              shown to you before it's recorded. Nothing about a student is decided
              without you.
            </p>
          </li>
          <li>
            <h3>Reteach</h3>
            <p>
              For each wrong answer, you get the likely misconception and material aimed
              at it — grouped so you can see that six students need the same ten
              minutes.
            </p>
          </li>
        </ol>
      </section>

      <hr className="rule mk-wrap" />

      {/* ---------------- Privacy as the product ---------------- */}
      <section id="privacy" className="mk-wrap section privacy">
        <div>
          <h2>Built to hold as little about your students as possible.</h2>
          <p>
            Most classroom tools want a roster with full names on day one. This one
            works with initials, a seat number, whatever you already use — and it's
            designed so that a real name is never required for anything.
          </p>
          <p>
            We're covered by California's student privacy law whether or not your
            district has signed anything with us. We wrote down exactly what that
            means, in language a technology director can check.
          </p>
          <p>
            <Link href="/legal/student-data-privacy">Read our student data commitments</Link>
          </p>
        </div>
        <dl className="privacy-facts">
          <div>
            <dt>Student names</dt>
            <dd>Optional. Every feature works without them.</dd>
          </div>
          <div>
            <dt>Worksheet photos</dt>
            <dd>Deleted automatically. The analysis stays; the photograph doesn't.</dd>
          </div>
          <div>
            <dt>AI training</dt>
            <dd>Never. Not by us, not by our AI provider. It's in the contract.</dd>
          </div>
          <div>
            <dt>Advertising</dt>
            <dd>None. Not here, not anywhere, not ever with student data.</dd>
          </div>
          <div>
            <dt>Who decides</dt>
            <dd>You. AI suggests; you confirm every score and every standard.</dd>
          </div>
          <div>
            <dt>District deletion</dt>
            <dd>Any school can direct us to delete student data. We comply.</dd>
          </div>
        </dl>
      </section>

      {/* ---------------- Coverage, stated honestly ---------------- */}
      <section id="coverage" className="mk-wrap section narrow">
        <h2>Standards we cover today</h2>
        <p>
          We'd rather tell you exactly what's verified than imply everything is.
        </p>
        <table className="coverage">
          <thead>
            <tr><th>Standards set</th><th>Status</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>California Grade 4 — Mathematics</td>
              <td><span className="pill pill-ok">Verified, official CDE wording</span></td>
            </tr>
            <tr>
              <td>California Grade 4 — English Language Arts</td>
              <td><span className="pill pill-ok">Verified, official CDE wording</span></td>
            </tr>
            <tr>
              <td>California, other grades</td>
              <td><span className="pill pill-warn">[COVERAGE STATUS — e.g. "In progress, flagged for review"]</span></td>
            </tr>
            <tr>
              <td>Other states</td>
              <td><span className="pill pill-mute">[COVERAGE STATUS]</span></td>
            </tr>
          </tbody>
        </table>
        <p style={{ marginTop: "1rem", color: "var(--ink-soft)" }}>
          Where a set isn't verified yet, the app says so on every result and asks you
          to check the code. Teaching a grade we don't cover yet? Tell us — it moves
          up the list.
        </p>
      </section>

      <hr className="rule mk-wrap" />

      {/* ---------------- Pricing ---------------- */}
      <section id="pricing" className="mk-wrap section">
        <h2>Pricing</h2>
        <p>
          Plans are measured in scans, because that's what costs us money. One scan is
          one student's worksheet. A class of thirty, two assignments a week, is about
          240 scans a month.
        </p>
        <table className="pricing">
          <thead>
            <tr>
              <th scope="row"></th>
              {plans.map((p) => <th key={p.id} scope="col">{p.name}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Price</th>
              {plans.map((p) => (
                <td key={p.id}>
                  <span className="price">{p.price_cents === 0 ? "$0" : `$${(p.price_cents / 100).toFixed(0)}`}</span>
                  <span className="per">{p.price_cents === 0 ? "" : p.seat_based ? "/seat/month" : "/month"}</span>
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Scans per month</th>
              {plans.map((p) => <td key={p.id} className="tabular">{p.scan_quota}{p.seat_based ? " per seat" : ""}</td>)}
            </tr>
            <tr>
              <th scope="row">Good for</th>
              {plans.map((p) => (
                <td key={p.id}>
                  {p.id === "free" && "Trying it on one assignment"}
                  {p.id === "starter" && "One class, weekly checks"}
                  {p.id === "pro" && "Multiple periods, or checking every assignment"}
                  {p.id === "team" && "A grade-level team or department, five or more"}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Standards alignment</th>
              {plans.map((p) => <td key={p.id}>Included</td>)}
            </tr>
            <tr>
              <th scope="row">Reteaching material</th>
              {plans.map((p) => <td key={p.id}>Included</td>)}
            </tr>
            <tr>
              <th scope="row">Mastery tracking over time</th>
              {plans.map((p) => <td key={p.id}>{p.id === "free" ? "30 days" : "Included"}</td>)}
            </tr>
            <tr>
              <th scope="row">Shared reteaching groups</th>
              {plans.map((p) => <td key={p.id}>{p.id === "team" ? "Across the team" : p.id === "free" ? "—" : "Your classes"}</td>)}
            </tr>
            <tr>
              <th scope="row"></th>
              {plans.map((p) => (
                <td key={p.id}>
                  <Link href={p.id === "team" ? "/contact" : `/signup?plan=${p.id}`} className={`btn ${p.id === "pro" ? "btn-mark" : "btn-quiet"}`}>
                    {p.id === "free" ? "Start free" : p.id === "team" ? "Talk to us" : "Choose " + p.name}
                  </Link>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        <p style={{ color: "var(--ink-soft)", marginTop: "1rem" }}>
          Running out mid-month? Add 100 scans for $5, or move up a plan. We'll tell you
          before you hit the limit, not after.
        </p>
      </section>

      <hr className="rule mk-wrap" />

      {/* ---------------- Districts ---------------- */}
      <section id="districts" className="mk-wrap section districts">
        <div>
          <h2>For districts and schools</h2>
          <p>
            If a teacher in your district has already signed up, every commitment on
            this page already applies to your students' data. If you'd like it in
            writing, we'll sign yours or ours.
          </p>
          <ul className="plain">
            <li>SOPIPA compliance statement, written for a privacy officer</li>
            <li>Ready to execute the California Student Data Privacy Agreement</li>
            <li>AB 1584 provisions on request, including your ownership of student records</li>
            <li>District-directed deletion, honored without a contract</li>
            <li>Site licensing with pooled scans and shared reteaching groups</li>
          </ul>
          <Link href="/contact?topic=district" className="btn btn-quiet">Talk to us about your district</Link>
        </div>
        <div className="districts-quote">
          <p>
            "We put the whole policy on one page a technology director can read in
            ten minutes and check every line of. If something on it isn't true of the
            running product, it doesn't go on the page."
          </p>
          <p style={{ color: "var(--ink-soft)", fontSize: ".9rem" }}>— [FOUNDER NAME], co-founder</p>
        </div>
      </section>

      {/* ---------------- FAQ ---------------- */}
      <section className="mk-wrap section narrow faq">
        <h2>Questions teachers ask</h2>
        <details>
          <summary>How well does it read handwriting?</summary>
          <p>
            Well enough to be useful, not well enough to trust blindly. Faint pencil,
            crossed-out work, and answers in the margins cause misreads. That's why
            every score is shown to you before it's recorded. Think of it as a very
            fast first pass, with you doing the judgment calls.
          </p>
        </details>
        <details>
          <summary>Do I have to enter my students' names?</summary>
          <p>
            No. You need some way to tell students apart — initials, a number, a
            nickname — but a real name is never required, and we'd gently suggest not
            using one.
          </p>
        </details>
        <details>
          <summary>What happens to the photos?</summary>
          <p>
            They're processed, the results are saved, and the photo is deleted
            automatically on a schedule. You can also delete anything yourself at any
            time.
          </p>
        </details>
        <details>
          <summary>My district hasn't approved this. Can I still use it?</summary>
          <p>
            Check your district's policy on classroom tools first — we can't know it
            for you. Our privacy commitments apply either way, and we're glad to talk
            to your district directly if it helps.
          </p>
        </details>
        <details>
          <summary>What if the standard it picks is wrong?</summary>
          <p>
            Change it. The app suggests from your state's official list and you confirm
            each one. Your correction is what gets recorded.
          </p>
        </details>
        <details>
          <summary>Can it grade essays or open-ended work?</summary>
          <p>
            Not yet. It's built for work with an answer key — math, short-answer,
            fill-in, multiple choice. Extended writing is a different problem and we'd
            rather do it right than early.
          </p>
        </details>
      </section>

      {/* ---------------- Close ---------------- */}
      <section className="mk-wrap section close">
        <h2>Try it on one assignment.</h2>
        <p>Twenty scans free, every month, no card. If it saves you a Sunday, you'll know.</p>
        <Link href="/signup" className="btn btn-mark">Start free</Link>
      </section>

      <style>{`
        .section { padding: 4.5rem 1.5rem; }
        .section.narrow > * { max-width: var(--measure); }
        .section h2 { margin-bottom: 1.25rem; }
        .section p + p { margin-top: 1rem; }
        .lede { font-size: var(--t-6); line-height: 1.5; color: var(--ink-soft); margin: 1.25rem 0 1.75rem; max-width: 46ch; }

        .hero { display: grid; grid-template-columns: 1fr 1.15fr; gap: 3.5rem; align-items: center; padding: 4.5rem 1.5rem 4rem; }
        .hero h1 { max-width: 14ch; }
        .hero-actions { display: flex; gap: .75rem; flex-wrap: wrap; }
        .hero-note { margin-top: 1.25rem; font-size: .9rem; color: var(--ink-soft); max-width: 42ch; }

        .steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 2rem; counter-reset: step; }
        .steps li { position: relative; padding-top: 2.5rem; }
        .steps li::before {
          counter-increment: step; content: counter(step);
          position: absolute; top: 0; left: 0;
          font-family: var(--font-display); font-size: 1.6rem; color: var(--mark);
          font-variation-settings: "opsz" 72;
        }
        .steps h3 { margin-bottom: .5rem; }
        .steps p { color: var(--ink-soft); }

        .privacy { display: grid; grid-template-columns: 1fr 1fr; gap: 3.5rem; align-items: start; }
        .privacy-facts { margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem 2rem; }
        .privacy-facts div { padding-top: .75rem; border-top: 1px solid var(--rule); }
        .privacy-facts dt { font-weight: 700; margin-bottom: .25rem; }
        .privacy-facts dd { margin: 0; color: var(--ink-soft); }

        .coverage, .pricing { width: 100%; border-collapse: collapse; margin-top: 1.5rem; }
        .coverage th, .coverage td { text-align: left; padding: .75rem .5rem; border-bottom: 1px solid var(--rule-faint); }
        .coverage th { color: var(--ink-soft); font-weight: 600; border-bottom-color: var(--rule); }
        .pricing th[scope="col"] { font-family: var(--font-display); font-size: var(--t-5); font-weight: 500; text-align: left; padding: .75rem .75rem 1rem; }
        .pricing th[scope="row"] { text-align: left; font-weight: 600; color: var(--ink-soft); padding: .9rem .75rem; width: 14rem; }
        .pricing td { padding: .9rem .75rem; border-top: 1px solid var(--rule-faint); vertical-align: top; }
        .pricing tbody tr:first-child td { border-top: 1px solid var(--rule); }
        .price { font-family: var(--font-display); font-size: var(--t-4); }
        .per { color: var(--ink-soft); margin-left: .25rem; font-size: .9rem; }
        .pricing .btn { font-size: .9rem; padding: .6rem 1rem; }

        .districts { display: grid; grid-template-columns: 1.2fr 1fr; gap: 3.5rem; align-items: start; }
        .plain { padding-left: 1.2rem; margin: 1.25rem 0 1.75rem; }
        .plain li { margin-bottom: .5rem; }
        .districts-quote { padding: 1.75rem; background: #fff; border: 1px solid var(--rule-faint); border-radius: var(--radius); font-family: var(--font-display); font-size: var(--t-6); line-height: 1.4; }
        .districts-quote p + p { margin-top: 1rem; font-family: var(--font-body); }

        .faq details { border-top: 1px solid var(--rule-faint); padding: 1rem 0; }
        .faq details:last-of-type { border-bottom: 1px solid var(--rule-faint); }
        .faq summary { cursor: pointer; font-weight: 700; list-style: none; display: flex; justify-content: space-between; }
        .faq summary::after { content: "+"; color: var(--mark); font-weight: 400; }
        .faq details[open] summary::after { content: "–"; }
        .faq details p { margin-top: .75rem; color: var(--ink-soft); }

        .close { text-align: center; padding-bottom: 2rem; }
        .close p { margin: 0 auto 1.5rem; color: var(--ink-soft); }

        @media (max-width: 960px) {
          .hero { grid-template-columns: 1fr; gap: 2.5rem; }
          .steps { grid-template-columns: 1fr 1fr; }
          .privacy, .districts { grid-template-columns: 1fr; gap: 2rem; }
          .pricing { display: block; overflow-x: auto; }
        }
        @media (max-width: 560px) {
          .steps { grid-template-columns: 1fr; }
          .privacy-facts { grid-template-columns: 1fr; }
          .section { padding: 3rem 1.5rem; }
        }
      `}</style>
    </>
  );
}
