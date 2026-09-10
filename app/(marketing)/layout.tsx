import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces, Atkinson_Hyperlegible, Caveat } from "next/font/google";
import { SiteHeader } from "@/components/marketing/site-header";
import { MarketingMotion } from "@/components/marketing/motion";
import "../tbf-tokens.css";
import "./marketing.css";

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
  title: "A Teacher’s Best Friend — Photograph a worksheet. See what to reteach.",
  description:
    "Photograph student work, get it aligned to California standards, and get reteaching material aimed at the exact misconception. No student names required. Nothing used to train AI.",
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`tbf mk ${fraunces.variable} ${atkinson.variable} ${caveat.variable}`}>
      <MarketingMotion>
        <SiteHeader />

        <main>{children}</main>

        <footer className="mk-footer">
          <div className="mk-wrap mk-footer-grid">
            <div>
              <p className="mk-brand" style={{ marginBottom: ".6rem" }}>A Teacher’s <em>Best Friend</em></p>
              <p style={{ color: "var(--ink-soft)", maxWidth: "30ch", fontSize: ".95rem" }}>
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
            </div>
            <div>
              <p className="mk-foot-head">Contact</p>
              <a href="mailto:[PRIVACY CONTACT EMAIL]">[PRIVACY CONTACT EMAIL]</a>
              <p style={{ color: "var(--ink-soft)", fontSize: ".85rem", marginTop: ".5rem" }}>
                SOPIPA-compliant. No advertising. No training on student work.
              </p>
            </div>
          </div>
          <div className="mk-wrap mk-foot-copy">
            <span>© {new Date().getFullYear()} [LEGAL ENTITY NAME]</span>
          </div>
        </footer>
      </MarketingMotion>
    </div>
  );
}
