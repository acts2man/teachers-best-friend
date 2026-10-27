"use client";

import { createElement, Fragment, useSyncExternalStore, type ReactNode } from "react";
import { mathSegments, type MathNode } from "@/lib/math-text";
import { supportsMathML } from "@/lib/mathml-support";

const noChange = () => () => {};

/** One MathML node as React elements (built from parsed nodes, never from an
 * HTML string, so text written by the AI or the teacher cannot inject markup). */
function render(n: MathNode, key?: number): ReactNode {
  switch (n.t) {
    case "mi":
    case "mn":
    case "mo":
      return createElement(n.t, { key }, n.v);
    case "mrow":
      return createElement("mrow", { key }, n.c.map((c, i) => render(c, i)));
    case "msup":
      return createElement("msup", { key }, render(n.base, 0), render(n.exp, 1));
    case "mfrac":
      return createElement("mfrac", { key }, render(n.num, 0), render(n.den, 1));
  }
}

/**
 * Lesson text with its math typeset (lib/math-text.ts): a power gets a real
 * exponent and a fraction stacks; every other character is shown as written.
 */
export function MathText({ text }: { text: string }) {
  // Exactly as typed until this browser is known to lay MathML out (and
  // always where it cannot): never "(x−2)2" with the exponent run in.
  const mathml = useSyncExternalStore(noChange, supportsMathML, () => false);
  if (!mathml) return <>{text}</>;
  return (
    <>
      {mathSegments(text).map((seg, i) =>
        seg.kind === "text" ? (
          <Fragment key={i}>{seg.text}</Fragment>
        ) : (
          createElement("math", { key: i, alttext: seg.source, className: "math-inline" }, render(seg.node))
        ),
      )}
    </>
  );
}
