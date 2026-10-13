// The in-app regression replay (PR 1, item B) and its access rule.
//
// What these prove without a live database or AI key:
//   - a normal teacher (and a signed-out visitor, and an admin who is not on
//     the allow-list) gets a 404 from both the page gate and the route, and the
//     route reads nothing before refusing;
//   - the scoring rules count exactly what the founders asked for;
//   - expected values come only from what the teacher confirmed;
//   - a whole case runs through the runner's step machine -- planning, one job
//     per step, the short-batch re-ask, scoring -- using the real prompt
//     builder, output validation, batching and name matching, with only the
//     model call and the database stood in for;
//   - the runner never reuses a stored read.
// What they do not prove: that it runs on production. That needs the migration
// applied and an allow-listed case; see docs/regression-replay.md.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);

function bundle(entry, { external = [], stubs = {} } = {}) {
  const r = buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    absWorkingDir: ROOT,
    external: ["pdfjs-dist/legacy/build/pdf.mjs", ...external],
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  const req = (id) => (id in stubs ? stubs[id] : require(id));
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, req);
  return m.exports;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ------------------------------------------------------------------ access
function gateWith({ userId = null, listed = false }) {
  const notFounds = [];
  const rpcCalls = [];
  const gate = bundle("lib/regression/gate.ts", {
    external: ["next/navigation", "@/lib/teacher-server", "@/lib/supabase/service"],
    stubs: {
      "next/navigation": {
        notFound: () => {
          notFounds.push(1);
          const e = new Error("NEXT_NOT_FOUND");
          e.digest = "NEXT_HTTP_ERROR_FALLBACK;404";
          throw e;
        },
      },
      "@/lib/teacher-server": {
        HttpError,
        owner: async () => {
          if (!userId) throw new HttpError(401, "Please sign in.");
          return userId;
        },
      },
      "@/lib/supabase/service": {
        createServiceClient: () => ({
          rpc: async (name, args) => {
            rpcCalls.push(name);
            return { data: name === "is_regression_admin" && args.p_user === userId && listed, error: null };
          },
          from: () => {
            throw new Error("the gate must not read any table");
          },
        }),
      },
    },
  });
  return { gate, notFounds, rpcCalls };
}

for (const [who, opts] of [
  ["a normal teacher account", { userId: "teacher-1", listed: false }],
  ["a signed-out visitor", { userId: null }],
]) {
  test(`${who} gets a 404 from the page gate`, async () => {
    const { gate, notFounds } = gateWith(opts);
    await assert.rejects(() => gate.requireRegressionAdmin(), /NEXT_NOT_FOUND/);
    assert.equal(notFounds.length, 1);
  });
  test(`${who} gets a 404 from the route gate`, async () => {
    const { gate } = gateWith(opts);
    await assert.rejects(
      () => gate.requireRegressionAdminApi(),
      (e) => e instanceof HttpError && e.status === 404,
    );
  });
}

test("an allow-listed admin is let through", async () => {
  const { gate } = gateWith({ userId: "admin-1", listed: true });
  assert.equal(await gate.requireRegressionAdminApi(), "admin-1");
  assert.equal(await gate.requireRegressionAdmin(), "admin-1");
});

test("the route refuses a normal teacher with 404 and touches no table or the AI", async () => {
  const touched = [];
  const svc = {
    rpc: async (name) => ({ data: name === "is_regression_admin" ? false : null, error: null }),
    from: (t) => {
      touched.push(t);
      throw new Error("read " + t);
    },
    storage: { from: () => touched.push("storage") },
  };
  const route = bundle("app/api/admin/regression/route.ts", {
    external: [
      "next/navigation",
      "@/lib/teacher-server",
      "@/lib/supabase/service",
      "@/lib/regression/runner",
      "@/lib/regression/fixtures",
    ],
    stubs: {
      "next/navigation": { notFound: () => { throw new Error("NEXT_NOT_FOUND"); } },
      "@/lib/teacher-server": {
        HttpError,
        owner: async () => "teacher-1",
        guardOrigin: () => {},
        aiConfig: async () => {
          touched.push("ai");
          return { key: "" };
        },
        normalizeWorkspace: (w) => w,
        apiError: (e) =>
          e instanceof HttpError
            ? Response.json({ error: e.message }, { status: e.status })
            : Response.json({ error: "x" }, { status: 503 }),
      },
      "@/lib/supabase/service": { createServiceClient: () => svc },
      "@/lib/regression/runner": { planCase: () => touched.push("plan"), stepCase: () => touched.push("step") },
      "@/lib/regression/fixtures": { copyFixtures: () => touched.push("copy"), createCases: () => touched.push("cases"), revokeFixtures: () => touched.push("revoke") },
    },
  });
  for (const action of ["summary", "start-run", "old-data-check"]) {
    const res = await route.POST(
      new Request("http://x/api/admin/regression", { method: "POST", body: JSON.stringify({ action, index: 0 }) }),
    );
    assert.equal(res.status, 404, action);
  }
  assert.deepEqual(touched, [], "nothing was read, planned, copied or sent to the AI");
});

test("the page lives outside /admin so a non-admin is not redirected (which would confirm it exists)", () => {
  const src = readFileSync("app/regression/page.tsx", "utf8");
  assert.match(src, /await requireRegressionAdmin\(\)/);
});

// ------------------------------------------------------------------ scoring
const score = bundle("lib/regression/score.ts");

test("names: right, wrongly pre-filled, and left open are counted apart", () => {
  const piles = ["a", "b", "c", "d"].map((studentId) => ({ studentId, strips: ["n"] }));
  const s = score.scoreNames(piles, [
    { studentId: "a", suggestedId: null },
    { studentId: "c", suggestedId: null }, // wrong student, pre-filled
    { studentId: null, suggestedId: "c" }, // open, right suggestion
    { studentId: null, suggestedId: null },
  ]);
  assert.deepEqual(
    { correct: s.correct, wrongConfident: s.wrongConfident, unassigned: s.unassigned, rightSuggestion: s.rightSuggestion },
    { correct: 1, wrongConfident: 1, unassigned: 2, rightSuggestion: 1 },
  );
  assert.equal(s.passed, false);
});

test("names: 24 of 26 right with none filled in wrongly passes; one wrong pre-fill fails", () => {
  const piles = Array.from({ length: 26 }, (_, i) => ({ studentId: "s" + i, strips: ["n" + i] }));
  const resolved = piles.map((p, i) => ({ studentId: i < 24 ? p.studentId : null, suggestedId: null }));
  assert.equal(score.scoreNames(piles, resolved).passed, true);
  resolved[25] = { studentId: "s0", suggestedId: null };
  assert.equal(score.scoreNames(piles, resolved).passed, false);
});

const resp = (studentId, questionId, o) => ({
  id: studentId + questionId, studentId, questionId, answer: "", correct: false, misconception: "", confidence: 100, verified: false, ...o,
});
const want = (studentId, questionId, finalAnswer, match) => ({ studentId, questionId, finalAnswer, answer: finalAnswer, match, verified: true });

test("answers: each miss lands in its own category", () => {
  const expected = [
    want("s1", "q1", "1/2", 100), // read as 0.5: equivalent, still its own group
    want("s2", "q1", "2x/(x^2-4)", 0), // wrong, but marked correct
    want("s3", "q1", "7", 50), // work on the page, marked blank
    want("s4", "q1", "9", 0), // the model was unsure
    want("s5", "q1", "12", 100), // read right
    want("s6", "q1", "3", 0), // read as 8
  ];
  const replayed = [
    resp("s1", "q1", { answer: "0.5", finalAnswer: "0.5" }),
    resp("s2", "q1", { answer: "2x/(x^2+4)", finalAnswer: "2x/(x^2+4)", correct: true, match: 100 }),
    resp("s3", "q1", { answer: "", match: 0 }),
    resp("s4", "q1", { answer: "?", confidence: 0 }),
    resp("s5", "q1", { answer: "12", finalAnswer: "12", correct: true, match: 100 }),
    resp("s6", "q1", { answer: "8", finalAnswer: "8" }),
  ];
  const s = score.scoreAnswers(expected, replayed, "grouping");
  assert.equal(s.inGroup, 2, "12, and 0.5 for 1/2");
  assert.equal(s.wronglyCorrect, 1);
  assert.equal(s.wronglyBlank, 1);
  assert.equal(s.misses.unsure, 1);
  assert.equal(s.misses.wrong_final, 2, "the sign flip and the 8");
  assert.equal(s.missedCorrect, 1, "0.5 for 1/2 got full credit but was not pre-marked");
  assert.equal(s.readRight, 2);
  assert.equal(s.passed, false);
});

test("grouping is judged against the teacher's groups: a same-answer group the teacher split by credit is a miss", () => {
  // The 12 Oct "Percents" pattern: three students wrote 27, the teacher gave
  // 25, 75, 75 -- the work differed, the final answer did not.
  const expected = [want("a", "q6", "27", 25), want("b", "q6", "27", 75), want("c", "q6", "27", 75), want("d", "q6", "156.52", 25)];
  const replayed = ["a", "b", "c"].map((id) => resp(id, "q6", { answer: "27", finalAnswer: "27" })).concat(resp("d", "q6", { answer: "156.52", finalAnswer: "156.52" }));
  const s = score.scoreAnswers(expected, replayed, "grouping");
  assert.equal(s.inGroup, 1, "only the 156.52 group matches the teacher's");
  assert.equal(s.misses.teacher_split_same_answer, 3);
  assert.equal(s.readRight, 4, "every read agrees -- grouping is what differs");
});

test("names: a pile with no name photo is counted apart, not blamed on the read", () => {
  const piles = [{ studentId: "a", strips: ["n0"] }, { studentId: "b", strips: [null] }];
  const s = score.scoreNames(piles, [{ studentId: "a", suggestedId: null }, { studentId: null, suggestedId: null }]);
  assert.equal(s.noStrip, 1);
  assert.equal(s.accuracy, 1);
});

test("answers: one wrongly-correct fails the case even at 100% grouping", () => {
  const expected = [want("s1", "q1", "5", 50)];
  const replayed = [resp("s1", "q1", { answer: "5", finalAnswer: "5", correct: true, match: 100 })];
  const s = score.scoreAnswers(expected, replayed, "grouping");
  assert.equal(s.groupAccuracy, 1);
  assert.equal(s.passed, false);
});

test("answers: multi-part answers count parts read against parts confirmed", () => {
  const expected = [want("s1", "q2", "right 1; reflect; stretch 2; up 4; y=4; (0,10/3)", 100)];
  const replayed = [resp("s1", "q2", { answer: "x", finalAnswer: "y=4; (0,10/3)" })];
  const s = score.scoreAnswers(expected, replayed, "answer_reading");
  assert.equal(s.partsExpected, 6);
  assert.equal(s.partsReturned, 2);
});

test("answer key and standards compare by value and by tag", () => {
  assert.equal(score.scoreKey([{ number: 1, answer: "x = 2" }, { number: 2, answer: "1/2" }], [{ number: 1, answer: "2" }, { number: 2, answer: "0.5" }]).right, 2);
  const st = score.scoreStandards([{ number: 1, standard: "HSF-LE.A.4" }], [{ number: 1, standard: "hsf-le.a.4" }]);
  assert.equal(st.right, 1);
});

// ------------------------------------------------------------------ expected values
const ex = bundle("lib/regression/expected.ts");

test("name strips pair with their page by name and upload time, even when names repeat across scans", () => {
  const pairs = ex.pairStrips([
    { id: "p-old", name: "scan-1-1.jpg", createdAt: "2026-10-10T16:00:00Z" },
    { id: "s-old", name: "scan-1-1-name.jpg", createdAt: "2026-10-10T16:00:02Z" },
    { id: "p-new", name: "scan-1-1.jpg", createdAt: "2026-10-12T03:07:40Z" },
    { id: "s-new", name: "scan-1-1-name.jpg", createdAt: "2026-10-12T03:07:41Z" },
  ]);
  assert.equal(pairs.get("p-new"), "s-new");
  assert.equal(pairs.get("p-old"), "s-old");
});

function workspaceFor({ keyVerified = true, removeStudent = false } = {}) {
  const q = (n) => ({ id: "q" + n, number: n, text: "", passage: "", answer: String(n), standard: "S." + n, secondary: "", skill: "", dok: 1, alignment: 90, confidence: 90, level: "On grade", reasoning: "", verified: true, excluded: false });
  return {
    students: removeStudent ? [{ id: "st1", classId: "c", name: "One" }] : [{ id: "st1", classId: "c", name: "One" }, { id: "st2", classId: "c", name: "Two" }],
    assessments: [{
      id: "a1", classId: "c", title: "t", subject: "Math", grade: 11, framework: "California", createdAt: "", status: "Ready", source: "ai",
      questions: [q(1), q(2)], targetStandards: ["S.1"], answerKeyVerified: keyVerified,
      uploadIds: ["w1", "p1", "p2"], assignmentUploadIds: undefined,
      studentUploadIds: { st1: ["p1"], st2: ["p2"] }, studentOrder: ["st1", "st2"],
      responses: [
        { id: "r1", studentId: "st1", questionId: "q1", answer: "1", finalAnswer: "1", correct: true, match: 100, misconception: "", confidence: 100, verified: true },
        { id: "r2", studentId: "st2", questionId: "q1", answer: "4", finalAnswer: "4", correct: false, misconception: "", confidence: 100, verified: false },
      ],
    }],
  };
}
const uploads = [
  { id: "w1", name: "worksheet.jpg", createdAt: "2026-10-12T03:00:00Z" },
  { id: "p1", name: "scan-1-1.jpg", createdAt: "2026-10-12T03:07:40Z" },
  { id: "s1", name: "scan-1-1-name.jpg", createdAt: "2026-10-12T03:07:41Z" },
  { id: "p2", name: "scan-2-1.jpg", createdAt: "2026-10-12T03:07:45Z" },
  { id: "s2", name: "scan-2-1-name.jpg", createdAt: "2026-10-12T03:07:46Z" },
];

test("only answers the teacher confirmed become expected values", () => {
  const e = ex.buildExpected("grouping", workspaceFor(), "a1", uploads);
  assert.deepEqual(e.answers.map((a) => a.studentId + a.questionId), ["st1q1"], "the unconfirmed answer is left out");
  assert.deepEqual(e.piles.map((p) => [p.studentId, p.pages, p.strips]), [["st1", ["p1"], ["s1"]], ["st2", ["p2"], ["s2"]]]);
});

test("pages recorded at copy time keep a confirmed student in the case after their pages were unlinked", () => {
  const w = workspaceFor();
  // Confirming st1 unlinked (and deleted) their page from studentUploadIds.
  w.assessments[0].studentUploadIds = { st2: ["p2"] };
  const e = ex.buildExpected("grouping", w, "a1", uploads, { st1: ["p1"], st2: ["p2"] });
  assert.deepEqual(e.piles.map((p) => p.studentId), ["st1", "st2"]);
  assert.deepEqual(e.answers.map((a) => a.studentId), ["st1"], "st1's confirmed answer is the expected value");
});

test("the worksheet is the assessment's pages minus the student pages", () => {
  assert.deepEqual(ex.buildExpected("answer_key", workspaceFor(), "a1", uploads).worksheet, ["w1"]);
});

test("a case is refused where the teacher has not confirmed what it would test", () => {
  assert.throws(() => ex.buildExpected("answer_key", workspaceFor({ keyVerified: false }), "a1", uploads), ex.CaseRefused);
  assert.throws(() => ex.buildExpected("names", workspaceFor({ removeStudent: true }), "a1", uploads), /no longer on the roster/);
});

// ------------------------------------------------------------------ the runner, end to end
function runnerWith(model) {
  const calls = { start: [], poll: 0, deleted: 0 };
  const settings = { model: "gpt-5.6-luna", effort: "medium", maxOutput: 32000 };
  const analyzeServer = {
    modelSettingsFor: async () => settings,
    documentContent: (f) => ({ type: "input_image", image_url: "data:" + f.mime + ";base64,AA", detail: "high" }),
    labelledContent: (mode, images) => (mode === "name_strip" ? images.flatMap((im, i) => [{ type: "input_text", text: `Image at position ${i}:` }, im]) : images),
    startModelBackground: async (s, content, mode) => {
      calls.start.push({ mode, images: content.filter((c) => c.type === "input_image").length, text: content.at(-1).text });
      return { value: "resp-" + calls.start.length, attempts: 1 };
    },
    getBackgroundResponse: async (id) => {
      calls.poll++;
      const n = Number(id.split("-")[1]);
      const body = model(calls.start[n - 1]);
      return { status: "completed", usage: { input_tokens: 1000, output_tokens: 500 }, output: [{ content: [{ type: "output_text", text: JSON.stringify(body) }] }] };
    },
    deleteBackgroundResponse: async () => { calls.deleted++; },
  };
  const svc = {
    rpc: async () => ({ data: { customStandards: [], sharedStandards: [] }, error: null }),
    from: (table) => {
      const q = {
        select: () => q, eq: () => q, in: () => q, order: () => q,
        then: (resolve) =>
          resolve(
            table === "model_pricing"
              ? { data: [{ model: "gpt-5.6-luna", input_per_mtok: 0.2, cached_input_per_mtok: 0.02, output_per_mtok: 1.2 }], error: null }
              : table === "regression_fixtures"
                ? { data: ["p1", "p2"].map((id) => ({ source_upload_id: id, object_path: "t/a1/" + id, mime: "image/jpeg", size_bytes: 400000 })), error: null }
                : { data: [], error: null },
          ),
      };
      return q;
    },
    storage: { from: () => ({ download: async () => ({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null }) }) },
  };
  const runner = bundle("lib/regression/runner.ts", {
    external: ["@/lib/analyze-server", "@/lib/supabase/service"],
    stubs: { "@/lib/analyze-server": analyzeServer, "@/lib/supabase/service": { createServiceClient: () => svc } },
  });
  return { runner, calls, svc };
}

test("a grouping case runs start->poll per batch, re-asks a short batch once, and scores", async () => {
  const expected = ex.buildExpected("grouping", workspaceFor(), "a1", uploads);
  let firstAnswer = true;
  // The first answer leaves the second student short; the re-ask completes it.
  const { runner, calls, svc } = runnerWith((req) => {
    const groups = JSON.parse(req.text.match(/Groups, as page positions: (\[.*?\])\./)[1]);
    const short = firstAnswer;
    firstAnswer = false;
    return {
      groups: groups.map((g, i) => ({
        group: g.group,
        responses: (short && i === 1 ? ["q1"] : ["q1", "q2"]).map((questionId) => ({
          questionId, answer: "1", verdict: "match", finalAnswer: "1",
          region: { page: g.pages[0], x: 0.1, y: 0.1, width: 0.2, height: 0.1 }, errorType: "",
        })),
      })),
    };
  });
  const c = { id: "c1", code: "case-abc123", teacherId: "t", assessmentLegacyId: "a1", kind: "grouping", expected };
  const usage = { costUsd: 0, model: "", effort: "" };
  let state = await runner.planCase(svc, c);
  assert.equal(state.stage, "grade");
  let result;
  for (let i = 0; i < 20; i++) {
    const out = await runner.stepCase(svc, c, "key", state, usage);
    state = out.state;
    result = out.result;
    if (result.status !== "running") break;
  }
  assert.equal(calls.start.length, 2, "one request, then one re-ask for the short student");
  assert.equal(calls.start[1].images, 1, "the re-ask carries only the short student's page");
  assert.match(calls.start[0].text, /check every sign, exponent and digit/, "the production grading prompt");
  assert.equal(calls.deleted, 2, "stored provider responses are deleted after reading");
  assert.ok(usage.costUsd > 0);
  assert.equal(usage.model, "gpt-5.6-luna");
  assert.equal(usage.effort, "medium");
  assert.equal(result.metrics.answers.answers, 1);
  assert.equal(result.metrics.answers.inGroup, 1);
});

test("the runner never reuses a stored read", () => {
  const src = readFileSync("lib/regression/runner.ts", "utf8");
  assert.doesNotMatch(src, /reusablePriorResult|readReuseFingerprint/);
  assert.match(src, /freshRead: true/);
});

test("undeclared piles: a pile is credited only when the app grouped exactly its pages", () => {
  const { runner } = runnerWith(() => ({}));
  const piles = [{ pages: ["a", "b"] }, { pages: ["c", "d"] }, { pages: ["e", "f"] }];
  // The app merged the first two piles (a name was missed) and got the third right.
  const groups = [[0, 1, 2, 3], [4, 5]];
  const resolved = [{ studentId: "s0", suggestedId: null }, { studentId: "s2", suggestedId: null }];
  const out = runner.pilesAsResolved(piles, groups, resolved);
  assert.equal(out[0].studentId, "\u0000wrong-pile", "a merged group is not a right answer, and a pre-fill there counts as wrong");
  assert.equal(out[1].studentId, "\u0000wrong-pile");
  assert.equal(out[2].studentId, "s2");
});

test("#124 follow-up d: the old-data check reaches teacher 1,201 of 1,500 (the 1,000-row cap is not a limit)", async () => {
  const { workspaceOwnerAt } = bundle("lib/regression/old-data.ts");
  const owners = Array.from({ length: 1500 }, (_, i) => ({ owner_id: "t" + String(i).padStart(5, "0") }));
  // A stand-in that behaves like PostgREST: a plain select returns at most
  // 1,000 rows; range() and count work as documented.
  const svc = {
    from: () => {
      let range = null;
      let head = false;
      const q = {
        select(_c, opts) { head = !!opts?.head; return q; },
        order() { return q; },
        range(a, b) { range = [a, b]; return q; },
        then(resolve) {
          if (head) return resolve({ count: owners.length, error: null });
          const rows = range ? owners.slice(range[0], range[1] + 1) : owners.slice(0, 1000);
          return resolve({ data: rows, error: null });
        },
      };
      return q;
    },
  };
  assert.deepEqual(await workspaceOwnerAt(svc, 1200), { teacher: "t01200", total: 1500 });
  assert.deepEqual(await workspaceOwnerAt(svc, 1500), { teacher: null, total: 1500 });
});
