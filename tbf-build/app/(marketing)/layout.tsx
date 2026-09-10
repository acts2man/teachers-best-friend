import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces, Atkinson_Hyperlegible, Caveat } from "next/font/google";
import "../tbf-tokens.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  axes: ["opsz", "SOFT"],
  variable: "--font-fraunces",
  display: "swap",
});
const atkinson = Atkinson_Hyperlegible({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-atkinson",
  display: "swap",
});
const caveat = Caveat({ subsets: ["latin"], weight: ["500"], variable: "--font-caveat", display: "swap" });

export const metadata: Metadata = {
  title: "A Teacher's Best Friend — Photograph a worksheet. See what to reteach.",
  description:
    "Photograph student work, get it aligned to California standards, and get reteaching material aimed at the exact misconception. No student names required. Nothing used to train AI.",
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`tbf ${fraunces.variable} ${atkinson.variable} ${caveat.variable}`}>
      <header className="mk-header">
        <div className="mk-wrap mk-nav">
          <Link href="/" className="mk-brand">
            A Teacher's <em>Best Friend</em>
          </Link>
          <nav aria-label="Main">
            <Link href="/#how">How it works</Link>
            <Link href="/#privacy">Privacy</Link>
            <Link href="/#pricing">Pricing</Link>
            <Link href="/#districts">For districts</Link>
          </nav>
          <div className="mk-nav-actions">
            <Link href="/login" className="mk-login">Sign in</Link>
            <Link href="/signup" className="btn btn-mark">Start free</Link>
          </div>
        </div>
        <hr className="rule" />
      </header>

      <main>{children}</main>

      <footer className="mk-footer">
        <hr className="rule" />
        <div className="mk-wrap mk-footer-grid">
          <div>
            <p className="mk-brand" style={{ marginBottom: ".5rem" }}>A Teacher's <em>Best Friend</em></p>
            <p style={{ color: "var(--ink-soft)", maxWidth: "36ch" }}>
              Built by two teachers who were tired of Sunday nights.
            </p>
          </div>
          <div>
            <p className="mk-foot-head">Product</p>
            <Link href="/#how">How it works</Link>
            <Link href="/#pricing">Pricing</Link>
            <Link href="/#coverage">Standards coverage</Link>
            <Link href="/login">Sign in</Link>
          </div>
          <div>
            <p className="mk-foot-head">Privacy</p>
            <Link href="/legal/student-data-privacy">Student data privacy</Link>
            <Link href="/legal/how-we-use-ai">How we use AI</Link>
            <Link href="/legal/privacy">Privacy policy</Link>
            <Link href="/legal/terms">Terms</Link>
          </div>
          <div>
            <p className="mk-foot-head">Contact</p>
            <a href="mailto:[PRIVACY CONTACT EMAIL]">[PRIVACY CONTACT EMAIL]</a>
            <p style={{ color: "var(--ink-soft)", fontSize: ".85rem", marginTop: ".5rem" }}>
              SOPIPA-compliant. No advertising. No training on student work.
            </p>
          </div>
        </div>
        <div className="mk-wrap" style={{ color: "var(--ink-mute)", fontSize: ".8rem", paddingBottom: "2rem" }}>
          © {new Date().getFullYear()} [LEGAL ENTITY NAME]
        </div>
      </footer>

      <style>{`
        .mk-wrap { max-width: 1120px; margin: 0 auto; padding: 0 1.5rem; }
        .mk-header { position: sticky; top: 0; background: var(--paper); z-index: 20; }
        .mk-nav { display: flex; align-items: center; gap: 2rem; height: 64px; }
        .mk-nav nav { display: flex; gap: 1.5rem; margin-left: auto; }
        .mk-nav nav a, .mk-login { color: var(--ink); text-decoration: none; font-weight: 600; }
        .mk-nav nav a:hover, .mk-login:hover { color: var(--mark-deep); }
        .mk-nav-actions { display: flex; align-items: center; gap: 1.25rem; }
        .mk-brand { font-family: var(--font-display); font-size: 1.35rem; color: var(--ink); text-decoration: none; font-variation-settings: "opsz" 48, "SOFT" 30; white-space: nowrap; }
        .mk-brand em { font-style: italic; color: var(--mark-deep); }
        .mk-footer { margin-top: 6rem; }
        .mk-footer-grid { display: grid; grid-template-columns: 1.4fr 1fr 1fr 1fr; gap: 2rem; padding: 3rem 1.5rem 2rem; }
        .mk-footer-grid a { display: block; text-decoration: none; color: var(--ink); margin-bottom: .45rem; }
        .mk-footer-grid a:hover { color: var(--mark-deep); }
        .mk-foot-head { font-weight: 700; margin-bottom: .75rem; }
        @media (max-width: 860px) {
          .mk-nav nav { display: none; }
          .mk-footer-grid { grid-template-columns: 1fr 1fr; }
        }
        @media (max-width: 520px) { .mk-footer-grid { grid-template-columns: 1fr; } .mk-login { display: none; } .mk-brand { font-size: 1.15rem; } .mk-nav-actions .btn { padding: .55rem .9rem; white-space: nowrap; } }
      `}</style>
    </div>
  );
}
