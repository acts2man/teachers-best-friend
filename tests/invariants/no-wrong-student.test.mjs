// RULE R3: one student's pages and answers never land under another student.
// Leaving a page unassigned for the teacher is always allowed; assigning it to
// the wrong child never is. docs/system-map.md, rule R3.
//
// Incidents this guards:
//   - 10 Oct 2026 (#121): a class motto ("Hope Always") read as a name took
//     over two students' groups, and their answers went to the wrong child.
//   - 12 Oct 2026 (#125): the name pass sent twelve strips per request and the
//     model put names one position late; a classmate's name landed on another
//     child's paper.
//   - 13 Oct 2026 (#125 review): a motto-shaped name that was really a student
//     missing from the roster had their pages folded under three other kids.
//
// Fuzzed end to end through the real code: planNameBatches -> an adversarial
// name pass -> mergeNameReads -> groupPagesByName / groupPagesByCapture ->
// resolveScannedGroups -> applyScannedGroups. Every page has a true owner; the
// check is that no row the app pre-fills, and no response it saves, belongs to
// anyone else.
//
// Outside this fuzz, on purpose (each is in docs/system-map.md as an OPEN gap,
// because the code does misassign them today):
//   - A name page with NO name on it, after another student's pages, in a
//     stack without declared piles: it is read as that student's continuation
//     sheet. (By design; the camera's "next student" piles avoid it.)
//   - A student missing from the roster who writes only a first name a
//     rostered child shares ("Maria" when only Maria Garcia is enrolled).
import test from "node:test";
import assert from "node:assert/strict";
import { bundle, rng, RUNS } from "./lib/bundle.mjs";

const C = bundle("lib/teacher-class-scan.ts");

// Placeholder names only. Shared first names, shared surname initials and an
// accented name are deliberate: they are what the matcher has to tell apart.
const ROSTER_POOL = [
  "Maria Garcia", "Maria Guzman", "Maria Lopez", "Ana Torres", "Ben Okafor", "Cy Park",
  "Dee Ramos", "Eli Stone", "Jamal Turner", "Jamal Tate", "Sofía Núñez", "Kai Brooks",
  "Leo Grant", "Noor Haddad", "Omar Reyes", "Priya Shah", "Quinn Ward", "Rosa Diaz",
];
// Students missing from the roster: names no rostered child is a variant of.
const NEW_POOL = ["Zed Hollis", "Yara Quill", "Wes Fontaine", "Uma Vance", "Tobias Krell"];
// A rostered child and a DIFFERENT child missing from the roster whose name is
// a near-variant of theirs -- a sibling, or a new student (G12). The fuzzy fit
// scores these >= 0.9; they must reach the teacher as a suggestion only.
const NEAR_PAIRS = [
  ["Chris Lee", "Christina Lee"],
  ["Jose Ruiz", "Josefina Ruiz"],
  ["Daniel Kim", "Danielle Kim"],
  ["Maria Chen", "Mia Chen"],
  ["Maria Lopez", "Maria Lozano"],
  ["Omar Reyes", "Omar Reed"],
  ["Samantha Cole", "Sam Cole"],
];
const MOTTO = "Hope Always";

const student = (id, name) => ({ id, classId: "c", name, color: "#000", evidence: [], notes: "" });

/** How a child writes their own name on the name line. */
function written(R, full, roster) {
  const [first, ...rest] = full.split(" ");
  const shares = roster.filter((s) => s.name.split(" ")[0] === first).length > 1;
  const forms = [full, full.toUpperCase(), full.toLowerCase(), "  " + full.replace(" ", "   ") + " ", full.normalize("NFD").replace(/[̀-ͯ]/g, "")];
  if (rest.length) forms.push(first + " " + rest.join(" ")[0] + ".");
  // A first name alone is only fair when the child is on the roster: alone it
  // names a rostered namesake (see the gaps above).
  if (roster.some((s) => s.name === full) && !shares) forms.push(first);
  return R.pick(forms);
}

/**
 * A stack with its ground truth. Returns pages in scan order, each with the
 * true owner id and the name the name pass SHOULD read, plus the piles the
 * teacher declared (one per student hand-in).
 */
function stack(R) {
  const roster = R.shuffle(ROSTER_POOL).slice(0, R.int(2, 12)).map((n, i) => student("s" + i, n));
  const newcomers = R.shuffle(NEW_POOL).slice(0, R.int(0, 2)).map((n, i) => ({ id: "new" + i, name: n }));
  if (R.chance(0.5)) {
    const [onRoster, near] = R.pick(NEAR_PAIRS);
    roster.push(student("s-near", onRoster));
    newcomers.push({ id: "new-near", name: near });
  }
  const motto = R.chance(0.3);
  let order = R.shuffle([...roster, ...newcomers].filter(() => R.chance(0.85)));
  if (!order.length) order = [roster[0]];
  // A re-scan: a student handed in (or scanned) twice.
  if (R.chance(0.3)) order.splice(R.int(0, order.length), 0, R.pick(order));
  const pages = [];
  const piles = [];
  for (const s of order) {
    const pile = [];
    const n = R.int(1, 3);
    for (let p = 0; p < n; p++) {
      let name;
      if (p === 0) name = written(R, s.name, roster); // the name line is filled in
      else name = R.pick(["", "", motto ? MOTTO : "", written(R, s.name, roster)]);
      const failed = R.chance(0.1);
      pile.push(pages.length);
      pages.push({ owner: s.id, name: failed ? "" : name, failed, confidence: R.int(40, 100) });
    }
    piles.push(pile);
  }
  return { roster, pages, piles };
}

/**
 * A name pass that gets positions wrong INSIDE one request -- the 12 Oct
 * failure: names rotated by one, or reversed -- but never invents a name.
 */
function adversarialNamePass(R, slices, pages) {
  return slices.map((slice) => {
    if (R.chance(0.05)) return { failed: true };
    const reads = slice.map((src) => pages[src.page]);
    const shuffle = R.pick(["none", "none", "rotate", "reverse"]);
    const out = shuffle === "rotate" ? [...reads.slice(1), reads[0]] : shuffle === "reverse" ? reads.slice().reverse() : reads;
    return {
      pages: out.map((r, i) => (r.failed ? { page: i, name: "", confidence: 0, skipped: true } : { page: i, name: r.name, confidence: r.confidence })),
    };
  });
}

const QUESTIONS = ["q1", "q2"];
const assessment = () => ({
  id: "quiz", classId: "c", title: "Quiz", subject: "Math", grade: 6, framework: "California", createdAt: "", status: "Ready",
  questions: QUESTIONS.map((id, i) => ({ id, number: i + 1, text: "", passage: "", answer: "4", standard: "", secondary: "", skill: "", dok: 1, alignment: 100, confidence: 100, level: "On grade", reasoning: "", verified: true, excluded: false })),
  responses: [], uploadIds: [], source: "manual", targetStandards: [], studentUploadIds: {},
});

/**
 * One scan, end to end. `declared`: the teacher scanned student by student
 * (camera piles), so the name pass is per pile and the groups are the piles.
 * Otherwise one strip per page and the names split the stack. Returns any
 * misassignment found, or null.
 */
function scanOnce(seed, declared, plan = C.planNameBatches) {
  const R = rng(seed);
  const { roster, pages, piles } = stack(R);
  const stripIds = pages.map((p, i) => "strip-" + i);
  const bodyIds = pages.map((p, i) => "body-" + i);
  const slices = plan(stripIds, declared ? piles : null);
  const names = C.mergeNameReads(pages.length, slices, adversarialNamePass(R, slices, pages));
  const groups = declared
    ? C.groupPagesByCapture(piles.map((p) => p.length))
    : C.groupPagesByName(names, (n) => C.rosterMatchCount(n, roster));
  // The grader answers each group with the TRUE owner of its first page tagged
  // into the answer, so a response that ends up under someone else is visible.
  const graded = groups.map((g, i) => ({
    group: i,
    responses: QUESTIONS.map((q) => ({ questionId: q, answer: "owner:" + pages[g[0]].owner, verdict: "other", finalAnswer: "owner:" + pages[g[0]].owner })),
  }));
  const rows = C.resolveScannedGroups(groups, names, graded, bodyIds, roster, stripIds);
  for (const row of rows) {
    if (!row.studentId) continue;
    for (const p of row.pageIndexes)
      if (pages[p].owner !== row.studentId)
        return `seed ${seed} (${declared ? "piles" : "names"}): page ${p} of ${pages[p].owner} pre-filled as ${row.studentId}; reads ${JSON.stringify(names.map((n) => n.name))}`;
  }
  // Every page reaches the matching screen exactly once.
  const seen = rows.flatMap((r) => r.pageIndexes).sort((a, b) => a - b);
  assert.deepEqual(seen, pages.map((_, i) => i), `seed ${seed}: a scanned page is missing or shown twice`);
  // Save what the app pre-filled (the teacher would match the rest; here they
  // are discarded), and check every saved answer is its own student's.
  const confirmed = rows.filter((r) => r.studentId).map((r) => ({ studentId: r.studentId, name: r.name, pageUploadIds: r.pageUploadIds, responses: r.responses }));
  const result = C.applyScannedGroups(assessment(), roster, "c", confirmed);
  const pairs = new Set();
  for (const r of result.assessment.responses) {
    if (r.answer !== "owner:" + r.studentId) return `seed ${seed}: an answer of ${r.answer} was saved under ${r.studentId}`;
    const key = r.studentId + "/" + r.questionId;
    // Two rows for one student+question would make sync_workspace's ON
    // CONFLICT fail the WHOLE save (student_responses is unique on it).
    assert.ok(!pairs.has(key), `seed ${seed}: two responses for ${key} in one save`);
    pairs.add(key);
  }
  return null;
}

test(`no page is ever pre-filled under a student it does not belong to -- names split the stack (${RUNS} stacks)`, () => {
  for (let seed = 1; seed <= RUNS; seed++) {
    const bad = scanOnce(seed, false);
    assert.equal(bad, null, bad);
  }
});

test(`no page is ever pre-filled under a student it does not belong to -- declared piles (${RUNS} stacks)`, () => {
  for (let seed = 1; seed <= RUNS; seed++) {
    const bad = scanOnce(seed, true);
    assert.equal(bad, null, bad);
  }
});

test("the 12-strips-per-request name pass (before #125) fails this check", () => {
  // The old plan: strips in batches of twelve across students, whatever the
  // piles. A rotated answer then moves a name onto the NEXT child's pages.
  const oldPlan = (stripIds, _piles, size = 12) => {
    const all = stripIds.map((id, page) => ({ id, page })).filter((s) => s.id);
    const out = [];
    for (let i = 0; i < all.length; i += size) out.push(all.slice(i, i + size));
    return out;
  };
  let caught = null;
  for (let seed = 1; seed <= RUNS && !caught; seed++) caught = scanOnce(seed, true, oldPlan);
  assert.ok(caught, "the old batching never misassigned a page -- the adversary is too weak to prove anything");
});

test("a motto on every paper never names a student (the 10 Oct incident)", () => {
  const roster = ["Run Lowhill", "Peter Parker", "Ana Torres", "Ben Okafor"].map((n, i) => student("s" + i, n));
  // Fronts carry the child's name, backs carry the printed motto.
  const reads = [];
  roster.forEach((s) => reads.push(s.name, MOTTO));
  const names = reads.map((name, page) => ({ page, name, confidence: 95 }));
  const groups = C.groupPagesByName(names, (n) => C.rosterMatchCount(n, roster));
  const rows = C.resolveScannedGroups(groups, names, [], reads.map((_, i) => "p" + i), roster);
  for (const row of rows) {
    if (!row.studentId) continue;
    const owner = roster[Math.floor(row.pageIndexes[0] / 2)].id;
    for (const p of row.pageIndexes) assert.equal(roster[Math.floor(p / 2)].id, row.studentId, `page ${p} under ${row.studentId}, owner ${owner}`);
  }
  assert.ok(rows.every((r) => r.name !== MOTTO || !r.studentId), "the motto is never a matched student");
});
