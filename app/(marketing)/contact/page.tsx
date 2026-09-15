import type { Metadata } from "next";
import Link from "next/link";

/**
 * The landing page linked here from three places — the Team plan's "Talk to
 * us", the districts section, and the footer — and the route did not exist,
 * so every one of them was a 404. Those are the two highest-intent clicks on
 * the site.
 *
 * Static and dependency-free on purpose: there is no form backend wired up
 * yet, so this hands over a real address rather than pretending to submit.
 * Swap in a form once a destination exists.
 */
export const metadata: Metadata = {
  title: "Contact — A Teacher’s Best Friend",
  description:
    "Talk to us about a school or district rollout, student data privacy agreements, or anything else.",
};

const CONTACT_EMAIL = "hello@ateachersbestfriend.com";

const TOPICS: Record<string, { heading: string; blurb: string }> = {
  district: {
    heading: "Let’s talk about your district",
    blurb:
      "Tell us the district or school, roughly how many teachers, and which agreements your privacy officer needs to see. We’ll come back with a written answer, not a sales call.",
  },
  team: {
    heading: "Let’s talk about your team",
    blurb:
      "Tell us how many teachers, which grades and subjects, and when you’d like to start. We’ll come back with pooled scans and shared reteaching groups priced for the group.",
  },
};

const DEFAULT_TOPIC = {
  heading: "Get in touch",
  blurb:
    "Questions about the product, your account, a school or district rollout, or student data privacy — all of it reaches the same place.",
};

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string }>;
}) {
  const { topic } = await searchParams;
  const t = (topic && TOPICS[topic]) || DEFAULT_TOPIC;
  const subject = encodeURIComponent(
    topic === "district"
      ? "District enquiry"
      : topic === "team"
        ? "Team plan enquiry"
        : "Hello",
  );

  return (
    <article className="mk-wrap contact">
      <header>
        <h1>{t.heading}</h1>
        <p className="contact-lede">{t.blurb}</p>
      </header>

      <p className="contact-cta">
        <a className="btn btn-mark" href={`mailto:${CONTACT_EMAIL}?subject=${subject}`}>
          Email {CONTACT_EMAIL}
        </a>
      </p>

      <section className="contact-cols">
        <div>
          <h2>Schools and districts</h2>
          <p>
            Every commitment on the{" "}
            <Link href="/legal/student-data-privacy">student data privacy</Link>{" "}
            page already applies the moment one of your teachers signs up. If
            you need it in writing, we’ll sign yours or ours — including the
            California Student Data Privacy Agreement and AB 1584 provisions.
          </p>
        </div>
        <div>
          <h2>Already using it</h2>
          <p>
            Teachers on a paid or beta plan can reach us from inside the app
            under <strong>Support</strong>, which keeps the whole thread in one
            place. Email works too if you’d rather.
          </p>
        </div>
        <div>
          <h2>Privacy and deletion</h2>
          <p>
            Deletion requests are honored without a contract. Read{" "}
            <Link href="/legal/privacy">how we handle data</Link> and{" "}
            <Link href="/legal/how-we-use-ai">how we use AI</Link> first — most
            questions are answered there.
          </p>
        </div>
      </section>

      <style>{`
        .contact { padding: 4rem 1.5rem 5rem; max-width: 860px; }
        .contact header { max-width: var(--measure); }
        .contact h1 { margin-bottom: 1rem; }
        .contact-lede { color: var(--ink-soft); line-height: 1.6; font-size: var(--t-2); }
        .contact-cta { margin: 2rem 0 3rem; }
        .contact-cols { display: grid; gap: 2rem; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); border-top: 1px solid var(--rule); padding-top: 2.5rem; }
        .contact-cols h2 { font-size: var(--t-4); margin: 0 0 .6rem; }
        .contact-cols p { color: var(--ink-soft); line-height: 1.6; margin: 0; }
      `}</style>
    </article>
  );
}
