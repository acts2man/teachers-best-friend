"use client";

import { useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import {
  MotionConfig,
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
  type Variants,
} from "framer-motion";

const noop = () => () => {};
/** false during server render and hydration, true afterwards. */
function useHydrated() {
  return useSyncExternalStore(noop, () => true, () => false);
}

/* Shared motion vocabulary for the marketing surface. Every piece here is
   reduced-motion safe: under prefers-reduced-motion the final state renders
   immediately and nothing moves. */

export const rise: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 120, damping: 22, mass: 0.8 },
  },
};

export const riseGroup: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};

export function MarketingMotion({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** A section or block that rises into view once, 8–16px, never bouncy. */
export function Reveal({
  children,
  className,
  delay = 0,
  as = "div",
  style,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "section" | "li" | "figure" | "p" | "header";
  style?: CSSProperties;
}) {
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      style={style}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={{ type: "spring", stiffness: 110, damping: 22, mass: 0.9, delay }}
    >
      {children}
    </Tag>
  );
}

/** A container whose children (RevealItem) stagger in together. */
export function RevealGroup({
  children,
  className,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "ol" | "ul" | "dl" | "section";
}) {
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      variants={riseGroup}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
    >
      {children}
    </Tag>
  );
}

export function RevealItem({
  children,
  className,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "li" | "article";
}) {
  const Tag = motion[as];
  return (
    <Tag className={className} variants={rise}>
      {children}
    </Tag>
  );
}

/** The "how it works" rail: a hairline that draws itself as the steps scroll
    through, with each step's numeral filling as the line reaches it. */
export function StepsRail({ count, children }: { count: number; children: ReactNode }) {
  const hydrated = useHydrated();
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 82%", "end 55%"] });
  const progress = useTransform(scrollYProgress, [0, 1], [0, 1]);
  return (
    <div ref={ref} className="steps-wrap" style={{ "--steps": count } as CSSProperties}>
      <div className="steps-rail" aria-hidden="true">
        <motion.div className="steps-rail-fill" style={{ ["--p" as string]: hydrated && reduce ? 1 : progress }} />
      </div>
      {children}
    </div>
  );
}
