/**
 * The product in one frame: a student's worked problem on ruled paper on
 * the left; what the teacher gets back on the right. The left side uses a
 * handwriting-style face and a highlighter wash on the error. The right side
 * is set in the app's own type. The two are joined by the ruled lines, which
 * run continuously across both halves.
 */
export function WorksheetHero() {
  return (
    <figure className="wh" aria-label="A student's fraction problem on a worksheet, and the analysis a teacher receives">
      <div className="wh-paper">
        <div className="wh-margin" aria-hidden="true" />
        <div className="wh-head">
          <span>Name: <span className="wh-hand">M.R.</span></span>
          <span>Fractions, practice 4</span>
        </div>

        <ol className="wh-problems">
          <li>
            <span className="wh-q">1. &nbsp;²⁄₅ + ¹⁄₅ =</span>
            <span className="wh-hand">³⁄₅</span>
            <span className="wh-tick" aria-label="correct">✓</span>
          </li>
          <li>
            <span className="wh-q">2. &nbsp;¹⁄₃ + ¹⁄₃ =</span>
            <span className="wh-hand">²⁄₃</span>
            <span className="wh-tick" aria-label="correct">✓</span>
          </li>
          <li className="wh-flag">
            <span className="wh-q">3. &nbsp;¹⁄₂ + ¹⁄₄ =</span>
            <span className="wh-hand wh-hl">²⁄₆</span>
            <span className="wh-x" aria-label="incorrect">✗</span>
          </li>
          <li>
            <span className="wh-q">4. &nbsp;³⁄₈ + ¹⁄₈ =</span>
            <span className="wh-hand">⁴⁄₈</span>
            <span className="wh-tick" aria-label="correct">✓</span>
          </li>
        </ol>
      </div>

      <div className="wh-result">
        <div className="wh-result-row">
          <span className="wh-label">Question 3</span>
          <span className="wh-code">4.NF.B.3a</span>
        </div>
        <p className="wh-finding">
          Added the denominators. The student treats ½ + ¼ as (1+1)/(2+4). Numerators
          were handled correctly in every other item, so this is a denominator
          concept, not an addition error.
        </p>
        <div className="wh-result-row wh-reteach">
          <span className="wh-label">Reteach</span>
          <span>
            Start with a physical model: fold one strip into halves, another into
            quarters, lay them side by side. Ask what one half is worth in quarters
            before adding anything.
          </span>
        </div>
        <div className="wh-result-foot">
          <span className="wh-pill">Same misconception: 6 of 28 students</span>
        </div>
      </div>

      <style>{`
        .wh {
          margin: 0;
          display: grid;
          grid-template-columns: 1fr 1.2fr;
          background-color: #fff;
          border: 1px solid var(--rule-faint);
          border-radius: var(--radius);
          box-shadow: 0 1px 0 var(--rule-faint), 0 24px 48px -32px rgba(27,42,65,.25);
          overflow: hidden;
          font-size: .95rem;
          /* ruled lines run through both panels */
          background-image: repeating-linear-gradient(
            to bottom, transparent 0 31px, var(--rule-faint) 31px 32px);
          background-position: 0 14px;
        }
        .wh-paper { position: relative; padding: 1.4rem 1.6rem 1.6rem 3.2rem; border-right: 1px solid var(--rule-faint); }
        .wh-margin { position: absolute; top: 0; bottom: 0; left: 2.4rem; width: 1px; background: #E8A9A9; }
        .wh-head { display: flex; justify-content: space-between; gap: 1rem; color: var(--ink-soft); font-size: .8rem; margin-bottom: 1.4rem; white-space: nowrap; height: 32px; align-items: baseline; }
        .wh-problems { list-style: none; margin: 0; padding: 0; }
        .wh-problems li { display: grid; grid-template-columns: 1fr auto auto; align-items: baseline; gap: .75rem; height: 32px; }
        .wh-q { font-variant-numeric: tabular-nums; }
        .wh-hand {
          font-family: "Caveat", "Segoe Print", "Bradley Hand", cursive;
          font-size: 1.35em; color: #2B2B2B; letter-spacing: .01em;
          transform: rotate(-1.5deg); display: inline-block; min-width: 2.4ch;
        }
        .wh-hl { background: var(--highlight); padding: 0 .3em; border-radius: 3px; }
        .wh-tick { color: var(--mark); font-weight: 700; }
        .wh-x { color: var(--correct-red); font-weight: 700; }
        .wh-flag .wh-q { font-weight: 600; }

        .wh-result { padding: 1.4rem 1.6rem 1.6rem; display: flex; flex-direction: column; gap: .8rem; background: rgba(251,251,249,.92); }
        .wh-result-row { display: grid; grid-template-columns: 4.6rem 1fr; gap: .75rem; align-items: baseline; }
        .wh-label { color: var(--ink-soft); font-size: .85rem; }
        .wh-code { font-family: var(--font-display); font-size: 1.35rem; color: var(--ink); }
        .wh-finding { margin: 0; line-height: 1.5; }
        .wh-reteach { padding-top: .6rem; border-top: 1px solid var(--rule); font-size: .95rem; }
        .wh-result-foot { margin-top: auto; }
        .wh-pill { display: inline-block; background: var(--mark-tint); color: var(--mark-deep); font-weight: 600; font-size: .8rem; padding: .25rem .6rem; border-radius: 999px; }

        @media (max-width: 720px) {
          .wh { grid-template-columns: 1fr; }
          .wh-paper { border-right: 0; border-bottom: 1px solid var(--rule-faint); }
        }
      `}</style>
    </figure>
  );
}
