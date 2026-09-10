"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { animate, motion, useReducedMotion, type TargetAndTransition, type Variants } from "framer-motion";

/**
 * The product in one frame, and it performs itself once on load.
 *
 * A worksheet sits on the desk. A scanning light sweeps down it; as the
 * sweep crosses each answer a detection box draws itself, correct answers
 * get a check that pops, and the one wrong answer is highlighted and
 * underlined. As the sweep finishes, the analysis card writes itself in.
 * Under prefers-reduced-motion the final state renders immediately.
 */

const T = {
  sweepStart: 0.4,
  sweepDur: 1.6,
  // where each answer row sits down the page, as a fraction of the sweep
  rows: [0.34, 0.48, 0.62, 0.76],
  panel: 2.1,
};
const hit = (i: number) => T.sweepStart + T.sweepDur * T.rows[i];

const PROBLEMS = [
  { n: 1, a: ["2", "5"], b: ["1", "5"], answer: ["3", "5"], correct: true },
  { n: 2, a: ["1", "3"], b: ["1", "3"], answer: ["2", "3"], correct: true },
  { n: 3, a: ["1", "2"], b: ["1", "4"], answer: ["2", "6"], correct: false },
  { n: 4, a: ["3", "8"], b: ["1", "8"], answer: ["4", "8"], correct: true },
];

const FINDING =
  "Added the denominators. The student treats ½ + ¼ as (1+1)/(2+4). Numerators were handled correctly in every other item, so this is a denominator concept, not an addition error.";
const RETEACH =
  "Start with a physical model: fold one strip into halves, another into quarters, lay them side by side. Ask what one half is worth in quarters before adding anything.";

function groups(text: string, size = 3) {
  const words = text.split(" ");
  const out: string[] = [];
  for (let i = 0; i < words.length; i += size) out.push(words.slice(i, i + size).join(" "));
  return out;
}

function Frac({ n, d, hand }: { n: string; d: string; hand?: boolean }) {
  return (
    <span className={hand ? "frac frac-hand" : "frac"} role="img" aria-label={`${n} over ${d}`}>
      <span>{n}</span>
      <span>{d}</span>
    </span>
  );
}

const panel: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      delay: T.panel,
      type: "spring",
      stiffness: 150,
      damping: 24,
      when: "beforeChildren",
      staggerChildren: 0.16,
      delayChildren: 0.12,
    },
  },
};
const fadeUp: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 160, damping: 22 } },
};
const wordGroup: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};
const word: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } },
};
const slideUp: Variants = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 130, damping: 20 } },
};
const pop: Variants = {
  hidden: { opacity: 0, scale: 0.6 },
  show: { opacity: 1, scale: 1, transition: { type: "spring", stiffness: 520, damping: 22 } },
};

function ChipCount({ to, delay, reduce }: { to: number; delay: number; reduce: boolean }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const t = setTimeout(() => {
      animate(0, to, { duration: 0.55, ease: [0.16, 1, 0.3, 1], onUpdate: (x) => setV(Math.round(x)) });
    }, delay * 1000);
    return () => clearTimeout(t);
  }, [to, delay, reduce]);
  return <span className="tabular">{reduce ? to : v}</span>;
}

const PAPER_START = { y: 10, rotate: -2.6, scale: 0.985 };
const PAPER_REST = { y: 0, rotate: -1.6, scale: 1 };
const noop = () => () => {};

/* The server cannot know prefers-reduced-motion, so the figure renders a
   static worksheet until hydration, then mounts the animated version with
   the real preference. This keeps server and client markup identical. */
function StaticPaper() {
  return (
    <figure className="scan" aria-label="A student’s fraction worksheet, and the analysis a teacher receives">
      <div
        className="scan-paper"
        style={{ transform: `translateY(${PAPER_START.y}px) rotate(${PAPER_START.rotate}deg) scale(${PAPER_START.scale})` }}
      >
        <div className="scan-margin" aria-hidden="true" />
        <div className="scan-head">
          <span>
            Name: <span className="hand">M.R.</span>
          </span>
          <span>Fractions, practice 4</span>
        </div>
        <ol className="scan-problems">
          {PROBLEMS.map((p) => (
            <li key={p.n} className={p.correct ? "" : "is-wrong"}>
              <span className="scan-q">
                {p.n}.&nbsp; <Frac n={p.a[0]} d={p.a[1]} /> + <Frac n={p.b[0]} d={p.b[1]} /> =
              </span>
              <span className="scan-answer">
                <span className="hand scan-hand">
                  <Frac n={p.answer[0]} d={p.answer[1]} hand />
                </span>
              </span>
              <span />
            </li>
          ))}
        </ol>
      </div>
    </figure>
  );
}

export function LiveScanHero() {
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const prefersReduced = useReducedMotion() ?? false;
  if (!hydrated) return <StaticPaper />;
  return <AnimatedScan reduce={prefersReduced} />;
}

function AnimatedScan({ reduce }: { reduce: boolean }) {
  const init = <V extends TargetAndTransition | string>(v: V): V | false => (reduce ? false : v);
  const spring = (delay: number, stiffness = 260, damping = 22) =>
    reduce ? { duration: 0 } : { delay, type: "spring" as const, stiffness, damping };

  return (
    <figure
      className="scan"
      aria-label="A student’s fraction worksheet being scanned, and the analysis a teacher receives"
    >
      {/* ---- the worksheet, set down on the desk ---- */}
      <motion.div
        className="scan-paper"
        initial={init(PAPER_START)}
        animate={PAPER_REST}
        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 90, damping: 18, mass: 1.1 }}
      >
        <div className="scan-margin" aria-hidden="true" />
        <div className="scan-head">
          <span>
            Name: <span className="hand">M.R.</span>
          </span>
          <span>Fractions, practice 4</span>
        </div>
        <ol className="scan-problems">
          {PROBLEMS.map((p, i) => (
            <li key={p.n} className={p.correct ? "" : "is-wrong"}>
              <span className="scan-q">
                {p.n}.&nbsp; <Frac n={p.a[0]} d={p.a[1]} /> + <Frac n={p.b[0]} d={p.b[1]} /> =
              </span>
              <span className="scan-answer">
                {!p.correct && (
                  <motion.span
                    className="scan-hl"
                    aria-hidden="true"
                    initial={init({ scaleX: 0 })}
                    animate={{ scaleX: 1 }}
                    transition={reduce ? { duration: 0 } : { delay: hit(i) + 0.18, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                  />
                )}
                <span className="hand scan-hand">
                  <Frac n={p.answer[0]} d={p.answer[1]} hand />
                </span>
                {!p.correct && (
                  <motion.span
                    className="scan-underline"
                    aria-hidden="true"
                    initial={init({ scaleX: 0 })}
                    animate={{ scaleX: 1 }}
                    transition={reduce ? { duration: 0 } : { delay: hit(i) + 0.3, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  />
                )}
                <svg className="scan-box" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
                  <motion.rect
                    x="1.5"
                    y="1.5"
                    width="97"
                    height="37"
                    rx="4"
                    vectorEffect="non-scaling-stroke"
                    initial={init({ pathLength: 0, opacity: 0 })}
                    animate={{ pathLength: 1, opacity: 1 }}
                    transition={reduce ? { duration: 0 } : { delay: hit(i), type: "spring", stiffness: 110, damping: 18 }}
                  />
                </svg>
              </span>
              <motion.span
                className={p.correct ? "scan-mark scan-tick" : "scan-mark scan-x"}
                aria-label={p.correct ? "correct" : "incorrect"}
                initial={init({ scale: 0, opacity: 0 })}
                animate={{ scale: 1, opacity: 1 }}
                transition={spring(hit(i) + 0.26, 520, 18)}
              >
                {p.correct ? "✓" : "✗"}
              </motion.span>
            </li>
          ))}
        </ol>
        {!reduce && (
          <motion.div
            className="scan-sweep"
            aria-hidden="true"
            initial={{ top: "-14%", opacity: 0 }}
            animate={{ top: ["-14%", "-8%", "98%", "106%"], opacity: [0, 1, 1, 0] }}
            transition={{ delay: T.sweepStart, duration: T.sweepDur, ease: "easeInOut", times: [0, 0.06, 0.94, 1] }}
          />
        )}
      </motion.div>

      {/* ---- what the teacher gets back ---- */}
      <motion.div className="scan-panel" variants={panel} initial={init("hidden")} animate="show">
        <motion.div className="scan-row" variants={fadeUp}>
          <span className="scan-label">Question 3</span>
          <span className="scan-code">4.NF.B.3a</span>
        </motion.div>
        <motion.p className="scan-finding" variants={wordGroup}>
          {groups(FINDING).map((g, i) => (
            <span key={i} className="scan-word-wrap">
              {i > 0 ? " " : null}
              <motion.span variants={word} className="scan-word">
                {g}
              </motion.span>
            </span>
          ))}
        </motion.p>
        <motion.div className="scan-row scan-reteach" variants={slideUp}>
          <span className="scan-label">Reteach</span>
          <span>{RETEACH}</span>
        </motion.div>
        <motion.div className="scan-foot" variants={pop}>
          <span className="scan-chip">
            Same misconception: <ChipCount to={6} delay={T.panel + 0.12 + 0.16 * 3} reduce={reduce} /> of 28 students
          </span>
        </motion.div>
      </motion.div>
    </figure>
  );
}
