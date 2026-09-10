import Link from "next/link";
import { ShieldCheck, UserX, Trash2, Ban } from "lucide-react";
import { LiveScanHero } from "@/components/marketing/live-scan-hero";
import { Figure } from "@/components/marketing/figure";
import { Reveal, RevealGroup, RevealItem, StepsRail } from "@/components/marketing/motion";

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
    { id: "elite", name: "Elite", price_cents: 2999, scan_quota: 1000, seat_based: false, sort_order: 4 },
    { id: "team", name: "Team", price_cents: 1500, scan_quota: 500, seat_based: true, sort_order: 5 },
  ];
}

export const revalidate = 3600;

/* A small marginal number on every section: the worksheet motif, quietly. */
function SectionHead({ no, children }: { no: string; children: React.ReactNode }) {
  return (
    <div className="section-head">
      <span className="section-no" aria-hidden="true">{no}</span>
      <h2>{children}</h2>
    </div>
  );
}

const GOOD_FOR: Record<string, string> = {
  free: "Trying it on one assignment",
  starter: "One class, weekly checks",
  pro: "Multiple periods, or checking every assignment",
  elite: "Every assignment, every class, all year",
  team: "A grade-level team or department, five or more",
};

/* $0 and whole-dollar plans read cleanly; a plan with cents (Elite, $29.99)
   keeps them instead of rounding up to $30. */
function priceLabel(cents: number) {
  if (cents === 0) return "$0";
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export default async function LandingPage() {
  const plans = await getPlans();

  return (
    <>
      {/* ---------------- Hero ---------------- */}
      <section className="mk-wrap hero">
        <Reveal className="hero-title">
          <h1>
            Photograph the worksheet. See what to{" "}
            <span className="em">
              reteach
              <svg viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
                <path pathLength={1} d="M1 6 C 20 2, 45 1.5, 99 4" />
              </svg>
            </span>
            .
          </h1>
        </Reveal>
        <div className="hero-copy">
          <Reveal as="p" className="lede" delay={0.12}>
            Point your phone at a stack of student work. A few seconds later you know
            which standard each question hits, who missed it, why they missed it, and
            what to do about it on Monday.
          </Reveal>
          <Reveal className="hero-actions" delay={0.2}>
            <Link href="/signup" className="btn btn-mark">Start free — 20 scans a month</Link>
            <Link href="#how" className="btn btn-quiet">See how it works</Link>
          </Reveal>
          <Reveal as="p" className="hero-note" delay={0.28}>
            No student names required. Nothing is used to train AI. Worksheet photos
            are deleted automatically.
          </Reveal>
        </div>
        <div className="hero-figure">
          <LiveScanHero />
        </div>
      </section>

      {/* ---------------- Story band: the problem, in a face ---------------- */}
      <Reveal as="section" className="mk-wrap story-band">
        <Figure
          src="/images/teacher-overwhelmed.png"
          alt="A teacher at her desk after school, working through a tall stack of student papers"
          width={1600}
          height={1040}
          sizes="(max-width: 1200px) 100vw, 1160px"
          className="story-figure"
          placeholder
        />
        <div className="story-caption">
          <p className="story-kicker">The Sunday that never ends</p>
          <p className="story-line">
            The stack doesn’t get smaller. Every paper holds a different reason a
            student missed question three — and finding it is the part that eats
            the weekend.
          </p>
        </div>
      </Reveal>

      <hr className="hairline mk-wrap" />

      {/* ---------------- The Sunday-night problem ---------------- */}
      <Reveal as="section" className="mk-wrap section narrow">
        <SectionHead no="01">Grading tells you who got it wrong. It doesn’t tell you what to teach.</SectionHead>
        <div className="section-body">
          <p>
            Twenty-eight worksheets, four wrong on question three. You know the number.
            What you don’t know without reading every answer is that six of them added
            the denominators, and two of them just miscopied the problem. Those are
            different lessons.
          </p>
          <p>
            That reading is the part that eats the weekend. It’s also the part that
            matters most, because it’s the difference between reteaching the right thing
            to the right kids and re-running the whole lesson for everyone.
          </p>
          <p className="margin-note" aria-hidden="true">six added the denominators → one ten-minute reteach</p>
        </div>
      </Reveal>

      {/* ---------------- How it works ---------------- */}
      <section id="how" className="mk-wrap section">
        <Reveal>
          <SectionHead no="02">How it works</SectionHead>
        </Reveal>
        <div className="section-body">
          <Reveal>
            <Figure
              src="/images/scanning-worksheet.png"
              alt="A teacher photographing a worksheet on a classroom counter with a phone"
              width={1280}
              height={854}
              sizes="(max-width: 1200px) 100vw, 1160px"
              className="how-figure"
              placeholder
            />
          </Reveal>
          <StepsRail count={4}>
            <RevealGroup as="ol" className="steps">
              <RevealItem as="li">
                <h3>Photograph</h3>
                <p>
                  Snap the worksheet with your phone, or upload a PDF. Handwriting is fine.
                  You can scan a whole stack at once.
                </p>
              </RevealItem>
              <RevealItem as="li">
                <h3>Align</h3>
                <p>
                  Each question is matched to a standard from your state’s official list —
                  not recalled from memory, looked up. You confirm or change every match.
                </p>
              </RevealItem>
              <RevealItem as="li">
                <h3>Score</h3>
                <p>
                  Student answers are read and checked against your key. Every result is
                  shown to you before it’s recorded. Nothing about a student is decided
                  without you.
                </p>
              </RevealItem>
              <RevealItem as="li">
                <h3>Reteach</h3>
                <p>
                  For each wrong answer, you get the likely misconception and material aimed
                  at it — grouped so you can see that six students need the same ten
                  minutes.
                </p>
              </RevealItem>
            </RevealGroup>
          </StepsRail>
        </div>
      </section>

      {/* ---------------- Trust band: privacy at a glance ---------------- */}
      <Reveal as="section" className="mk-wrap trust-band" aria-label="Privacy at a glance">
        <ul className="trust-strip">
          <li>
            <ShieldCheck aria-hidden="true" />
            <span><strong>SOPIPA-compliant</strong>Covered whether or not your district signs anything.</span>
          </li>
          <li>
            <UserX aria-hidden="true" />
            <span><strong>Names optional</strong>Every feature works with initials or a seat number.</span>
          </li>
          <li>
            <Trash2 aria-hidden="true" />
            <span><strong>Photos auto-deleted</strong>The analysis stays. The photograph doesn’t.</span>
          </li>
          <li>
            <Ban aria-hidden="true" />
            <span><strong>Never trained on</strong>Not by us, not by our AI provider. In the contract.</span>
          </li>
        </ul>
      </Reveal>

      <hr className="hairline mk-wrap" />

      {/* ---------------- Privacy as the product ---------------- */}
      <section id="privacy" className="mk-wrap section privacy">
        <Reveal>
          <SectionHead no="03">Built to hold as little about your students as possible.</SectionHead>
        </Reveal>
        <div className="section-body">
          <Reveal>
            <p>
              Most classroom tools want a roster with full names on day one. This one
              works with initials, a seat number, whatever you already use — and it’s
              designed so that a real name is never required for anything.
            </p>
            <p>
              We’re covered by California’s student privacy law whether or not your
              district has signed anything with us. We wrote down exactly what that
              means, in language a technology director can check.
            </p>
            <p className="cta-link">
              <Link href="/legal/student-data-privacy">Read our student data commitments</Link>
            </p>
          </Reveal>
          <RevealGroup as="dl" className="privacy-facts">
            <RevealItem>
              <dt>Student names</dt>
              <dd>Optional. Every feature works without them.</dd>
            </RevealItem>
            <RevealItem>
              <dt>Worksheet photos</dt>
              <dd>Deleted automatically. The analysis stays; the photograph doesn’t.</dd>
            </RevealItem>
            <RevealItem>
              <dt>AI training</dt>
              <dd>Never. Not by us, not by our AI provider. It’s in the contract.</dd>
            </RevealItem>
            <RevealItem>
              <dt>Advertising</dt>
              <dd>None. Not here, not anywhere, not ever with student data.</dd>
            </RevealItem>
            <RevealItem>
              <dt>Who decides</dt>
              <dd>You. AI suggests; you confirm every score and every standard.</dd>
            </RevealItem>
            <RevealItem>
              <dt>District deletion</dt>
              <dd>Any school can direct us to delete student data. We comply.</dd>
            </RevealItem>
          </RevealGroup>
        </div>
      </section>

      {/* ---------------- Coverage, stated honestly ---------------- */}
      <Reveal as="section" className="mk-wrap section narrow">
        <div id="coverage" />
        <SectionHead no="04">Standards we cover today</SectionHead>
        <div className="section-body">
          <p>
            We’d rather tell you exactly what’s verified than imply everything is.
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
                <td><span className="pill pill-warn">[COVERAGE STATUS — e.g. “In progress, flagged for review”]</span></td>
              </tr>
              <tr>
                <td>Other states</td>
                <td><span className="pill pill-mute">[COVERAGE STATUS]</span></td>
              </tr>
            </tbody>
          </table>
          <p className="coverage-note">
            Where a set isn’t verified yet, the app says so on every result and asks you
            to check the code. Teaching a grade we don’t cover yet? Tell us — it moves
            up the list.
          </p>
        </div>
      </Reveal>

      {/* ---------------- Testimonials (placeholder) ---------------- */}
      <section className="mk-wrap testi-band" aria-label="What teachers say">
        <Reveal className="testi-head">
          <p className="story-kicker">What teachers tell us</p>
          <h2>The reteaching part, finally, is the fast part.</h2>
          <p className="testi-sub">
            Quotes are placeholders until we publish real ones — the photos are
            placeholders too.
          </p>
        </Reveal>
        <RevealGroup as="ul" className="testi-grid">
          <RevealItem as="li" className="testi-card">
            <p className="testi-quote">
              “[Placeholder quote — a teacher describing getting a Sunday back
              because the misconceptions were already grouped for her.]”
            </p>
            <p className="testi-by">[Placeholder Name] · 4th grade</p>
          </RevealItem>
          <RevealItem as="li" className="testi-photo">
            <Figure
              src="/images/one-on-one.png"
              alt="A teacher working through a math problem beside a young student"
              width={1280}
              height={854}
              sizes="(max-width: 700px) 100vw, 33vw"
              placeholder
            />
          </RevealItem>
          <RevealItem as="li" className="testi-card">
            <p className="testi-quote">
              “[Placeholder quote — a middle-school teacher on trusting the
              standard alignment because it comes from the official list.]”
            </p>
            <p className="testi-by">[Placeholder Name] · middle-school math</p>
          </RevealItem>
          <RevealItem as="li" className="testi-photo">
            <Figure
              src="/images/marking-work.png"
              alt="A teacher’s handwritten feedback in the margin of a student’s narrative writing"
              width={1280}
              height={854}
              sizes="(max-width: 700px) 100vw, 33vw"
              placeholder
            />
          </RevealItem>
          <RevealItem as="li" className="testi-card">
            <p className="testi-quote">
              “[Placeholder quote — an instructional coach on how the privacy
              stance made district approval a short conversation.]”
            </p>
            <p className="testi-by">[Placeholder Name] · instructional coach</p>
          </RevealItem>
        </RevealGroup>
      </section>

      <hr className="hairline mk-wrap" />

      {/* ---------------- Pricing ---------------- */}
      <section id="pricing" className="mk-wrap section">
        <Reveal>
          <SectionHead no="05">Pricing</SectionHead>
        </Reveal>
        <div className="section-body">
          <Reveal as="p" className="pricing-intro">
            Plans are measured in scans, because that’s what costs us money. One scan is
            one student’s worksheet. A class of thirty, two assignments a week, is about
            240 scans a month.
          </Reveal>
          <RevealGroup as="ul" className="plans">
            {plans.map((p) => (
              <RevealItem as="li" key={p.id} className={`plan${p.id === "pro" ? " plan-pro" : ""}`}>
                {p.id === "pro" && <span className="plan-tag">Recommended</span>}
                <span className="plan-name">{p.name}</span>
                <div className="plan-price">
                  <span className="price">{priceLabel(p.price_cents)}</span>
                  <span className="per">{p.price_cents === 0 ? "" : p.seat_based ? "/seat/month" : "/month"}</span>
                </div>
                <p className="plan-quota">
                  <strong className="tabular">{p.scan_quota}</strong> scans per month{p.seat_based ? " per seat" : ""}
                </p>
                <dl className="plan-rows">
                  <div>
                    <dt>Good for</dt>
                    <dd>{GOOD_FOR[p.id] ?? ""}</dd>
                  </div>
                  <div>
                    <dt>Standards alignment</dt>
                    <dd>Included</dd>
                  </div>
                  <div>
                    <dt>Reteaching material</dt>
                    <dd>Included</dd>
                  </div>
                  <div>
                    <dt>Mastery tracking over time</dt>
                    <dd>{p.id === "free" ? "30 days" : "Included"}</dd>
                  </div>
                  <div>
                    <dt>Shared reteaching groups</dt>
                    <dd>{p.id === "team" ? "Across the team" : p.id === "free" ? "—" : "Your classes"}</dd>
                  </div>
                </dl>
                <Link href={p.id === "team" ? "/contact" : `/signup?plan=${p.id}`} className={`btn ${p.id === "pro" ? "btn-mark" : "btn-quiet"}`}>
                  {p.id === "free" ? "Start free" : p.id === "team" ? "Talk to us" : "Choose " + p.name}
                </Link>
              </RevealItem>
            ))}
          </RevealGroup>
          <Reveal as="p" className="pricing-note">
            Running out mid-month? Add 100 scans for $5, or move up a plan. We’ll tell you
            before you hit the limit, not after.
          </Reveal>
        </div>
      </section>

      <hr className="hairline mk-wrap" />

      {/* ---------------- Districts ---------------- */}
      <section id="districts" className="mk-wrap section districts">
        <Reveal>
          <SectionHead no="06">For districts and schools</SectionHead>
        </Reveal>
        <div className="section-body">
          <Reveal>
            <p>
              If a teacher in your district has already signed up, every commitment on
              this page already applies to your students’ data. If you’d like it in
              writing, we’ll sign yours or ours.
            </p>
            <ul className="plain">
              <li>SOPIPA compliance statement, written for a privacy officer</li>
              <li>Ready to execute the California Student Data Privacy Agreement</li>
              <li>AB 1584 provisions on request, including your ownership of student records</li>
              <li>District-directed deletion, honored without a contract</li>
              <li>Site licensing with pooled scans and shared reteaching groups</li>
            </ul>
            <Link href="/contact?topic=district" className="btn btn-quiet">Talk to us about your district</Link>
          </Reveal>
          <Reveal className="districts-quote" delay={0.1}>
            <p>
              We put the whole policy on one page a technology director can read in
              ten minutes and check every line of. If something on it isn’t true of the
              running product, it doesn’t go on the page.”
            </p>
            <p>— [FOUNDER NAME], co-founder</p>
          </Reveal>
        </div>
      </section>

      {/* ---------------- FAQ ---------------- */}
      <Reveal as="section" className="mk-wrap section narrow faq">
        <SectionHead no="07">Questions teachers ask</SectionHead>
        <div className="section-body">
          <details>
            <summary>How well does it read handwriting?</summary>
            <p>
              Well enough to be useful, not well enough to trust blindly. Faint pencil,
              crossed-out work, and answers in the margins cause misreads. That’s why
              every score is shown to you before it’s recorded. Think of it as a very
              fast first pass, with you doing the judgment calls.
            </p>
          </details>
          <details>
            <summary>Do I have to enter my students’ names?</summary>
            <p>
              No. You need some way to tell students apart — initials, a number, a
              nickname — but a real name is never required, and we’d gently suggest not
              using one.
            </p>
          </details>
          <details>
            <summary>What happens to the photos?</summary>
            <p>
              They’re processed, the results are saved, and the photo is deleted
              automatically on a schedule. You can also delete anything yourself at any
              time.
            </p>
          </details>
          <details>
            <summary>My district hasn’t approved this. Can I still use it?</summary>
            <p>
              Check your district’s policy on classroom tools first — we can’t know it
              for you. Our privacy commitments apply either way, and we’re glad to talk
              to your district directly if it helps.
            </p>
          </details>
          <details>
            <summary>What if the standard it picks is wrong?</summary>
            <p>
              Change it. The app suggests from your state’s official list and you confirm
              each one. Your correction is what gets recorded.
            </p>
          </details>
          <details>
            <summary>Can it grade essays or open-ended work?</summary>
            <p>
              Not yet. It’s built for work with an answer key — math, short-answer,
              fill-in, multiple choice. Extended writing is a different problem and we’d
              rather do it right than early.
            </p>
          </details>
        </div>
      </Reveal>

      {/* ---------------- Close ---------------- */}
      <Reveal as="section" className="mk-wrap section close">
        <h2>Try it on one assignment.</h2>
        <p>Twenty scans free, every month, no card. If it saves you a Sunday, you’ll know.</p>
        <Link href="/signup" className="btn btn-mark">Start free</Link>
      </Reveal>
    </>
  );
}
