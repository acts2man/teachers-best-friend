import { notFound } from "next/navigation";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const DOCS: Record<string, { file: string; title: string; audience: string }> = {
  "privacy":              { file: "privacy.md",              title: "Privacy Policy",                  audience: "Everyone" },
  "student-data-privacy": { file: "student-data-privacy.md", title: "Student Data Privacy Commitments", audience: "Schools and districts" },
  "how-we-use-ai":        { file: "how-we-use-ai.md",        title: "How We Use AI",                   audience: "Teachers" },
};

export function generateStaticParams() {
  return Object.keys(DOCS).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = DOCS[slug];
  return doc ? { title: `${doc.title} — A Teacher's Best Friend` } : {};
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = DOCS[slug];
  if (!doc) notFound();

  const raw = await readFile(path.join(process.cwd(), "content", "legal", doc.file), "utf8");
  // Strip the top-level H1 (the page sets its own) and the draft warning blockquote.
  const body = raw.replace(/^# .*\n/, "").replace(/^> \*\*DRAFT[\s\S]*?\n\n/m, "");

  return (
    <article className="mk-wrap legal">
      <nav className="legal-nav" aria-label="Policies">
        {Object.entries(DOCS).map(([s, d]) => (
          <Link key={s} href={`/legal/${s}`} aria-current={s === slug ? "page" : undefined}>{d.title}</Link>
        ))}
      </nav>
      <header>
        <p className="legal-audience">Written for: {doc.audience}</p>
        <h1>{doc.title}</h1>
      </header>
      <div className="legal-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
      </div>

      <style>{`
        .legal { padding: 3rem 1.5rem 4rem; max-width: 860px; }
        .legal-nav { display: flex; gap: 1.25rem; flex-wrap: wrap; margin-bottom: 2.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--rule); }
        .legal-nav a { text-decoration: none; color: var(--ink-soft); font-weight: 600; }
        .legal-nav a[aria-current="page"] { color: var(--mark-deep); border-bottom: 2px solid var(--mark); padding-bottom: .25rem; }
        .legal-audience { color: var(--ink-soft); margin-bottom: .5rem; }
        .legal header h1 { margin-bottom: 2rem; }
        .legal-body { max-width: var(--measure); line-height: 1.6; }
        .legal-body h2 { margin: 2.5rem 0 1rem; font-size: var(--t-4); }
        .legal-body h3 { margin: 1.75rem 0 .75rem; }
        .legal-body p { margin-bottom: 1rem; }
        .legal-body ul, .legal-body ol { padding-left: 1.4rem; margin-bottom: 1rem; }
        .legal-body li { margin-bottom: .4rem; }
        .legal-body table { width: 100%; border-collapse: collapse; margin: 1rem 0 1.5rem; font-size: .92rem; }
        .legal-body th, .legal-body td { text-align: left; padding: .55rem .6rem; border-bottom: 1px solid var(--rule-faint); vertical-align: top; }
        .legal-body th { color: var(--ink-soft); border-bottom-color: var(--rule); }
        .legal-body hr { border: 0; height: 1px; background: var(--rule); margin: 2.5rem 0; }
        .legal-body blockquote { margin: 1rem 0; padding: .75rem 1rem; border-left: 3px solid var(--mark); background: var(--mark-tint); }
        .legal-body strong { font-weight: 700; }
        .legal-body code { background: var(--paper-deep); padding: .1em .35em; border-radius: 3px; font-size: .9em; }
      `}</style>
    </article>
  );
}
