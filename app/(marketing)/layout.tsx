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
            <div className="mk-foot-brand">
              <Link href="/" className="mk-brand" aria-label="A Teacher’s Best Friend — home">
                <span className="mk-brand-mark">
                  <img src="/brand/teacher-book.png" alt="" width="40" height="40" />
                </span>
                <span className="mk-brand-word">
                  A Teacher’s <em>Best Friend</em>
                </span>
              </Link>
              <p className="mk-foot-tagline">
                Photograph the worksheet. See what to reteach. Built by two
                teachers who were tired of Sunday nights.
              </p>
              <Link href="/signup" className="btn btn-mark btn-sm mk-foot-cta">
                Start free
              </Link>
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
              <p className="mk-foot-head">Company</p>
              <Link href="/#districts">For districts</Link>
              <a href="mailto:privacy@ateachersbestfriend.com">privacy@ateachersbestfriend.com</a>
              <Link href="/contact">Contact us</Link>
            </div>
          </div>
          <div className="mk-wrap mk-foot-copy">
            <span>© {new Date().getFullYear()} A Teacher’s Best Friend. All rights reserved.</span>
            <span className="mk-foot-legal">
              SOPIPA-compliant · No advertising · Never trained on student work
            </span>
          </div>
        </footer>
      </MarketingMotion>
    </div>
  );
}
