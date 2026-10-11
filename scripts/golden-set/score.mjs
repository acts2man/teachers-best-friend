// Pure scoring and cost maths for the golden-set eval (scripts/golden-set).
// Kept separate from the runner so it can be unit-tested without the provider
// or the network -- the runner feeds it model output and confirmed answers and
// it returns accuracy; the numbers in the report come straight from here.

/** Normalise a name for comparison: lowercase, letters only, collapsed. */
export function normName(s) {
  return String(s || "").toLowerCase().replace(/[^a-z]/g, "");
}

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** A read name "matches" the confirmed one if it is the same after
 * normalisation or a near-miss a teacher would accept without retyping (a
 * one-letter slip on a short name, or within 20% edits). */
export function nameMatches(read, confirmed) {
  const a = normName(read), b = normName(confirmed);
  if (!a || !b) return false;
  if (a === b) return true;
  const d = lev(a, b);
  return d <= 1 || d / Math.max(a.length, b.length) <= 0.2;
}

/** Normalise a short answer the way grading does: trim, lowercase, strip spaces
 * and commas so "12 cm" ~ "12cm" and "1,000" ~ "1000". */
export function normAnswer(s) {
  return String(s ?? "").toLowerCase().replace(/[\s,]/g, "").trim();
}

/** Did the model's solved answer key match the teacher-confirmed key for a
 * question? Equivalent forms count (normAnswer). */
export function keyMatches(modelAnswer, confirmedAnswer) {
  return normAnswer(modelAnswer) === normAnswer(confirmedAnswer) && normAnswer(confirmedAnswer) !== "";
}

/** Score a stage: fraction correct, plus the counts the report shows. `items`
 * is [{ correct: boolean, produced: boolean }]; produced=false means the model
 * returned nothing for that item (a gap), scored as not-correct. */
export function accuracy(items) {
  const total = items.length;
  const correct = items.filter((i) => i.correct).length;
  const produced = items.filter((i) => i.produced).length;
  return {
    total,
    correct,
    produced,
    missing: total - produced,
    pct: total ? Math.round((1000 * correct) / total) / 10 : 0,
  };
}

/** Cost of one request from its token usage and the model's per-1M-token price
 * (from the model_pricing table). Cached input is billed at the cached rate. */
export function requestCost(usage, price) {
  const input = usage.input_tokens ?? 0;
  const cached = usage.cached_input_tokens ?? usage.input_tokens_details?.cached_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const fresh = Math.max(0, input - cached);
  return (
    (fresh * price.input_per_mtok +
      cached * (price.cached_input_per_mtok ?? price.input_per_mtok) +
      output * price.output_per_mtok) /
    1e6
  );
}

/** Cost per class set: sum of request costs, scaled to `perClass` students from
 * the `students` the eval actually ran, so sets of different sizes compare. */
export function costPerClassSet(totalCost, students, perClass = 26) {
  if (!students) return 0;
  return (totalCost / students) * perClass;
}
