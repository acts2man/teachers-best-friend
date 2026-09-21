// When to try the model again, and when trying again is throwing money away.
//
// Every case below is one that used to end as a failed scan in front of a
// teacher holding a stack of paper, or would end as a wasted call if the
// policy were naive. None of them are things you want to discover by watching
// OpenAI have a bad afternoon.
//
// The clock and the sleeper are injected, so the deadline cases run instantly
// instead of actually waiting.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";
import path from "node:path";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);

function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    absWorkingDir: ROOT,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

const R = bundle("lib/ai-retry.ts");

/** A fake fetch: hands back the queued responses in order. */
function fakeFetch(queue) {
  let i = 0;
  const calls = [];
  return {
    calls,
    fetch: async () => {
      calls.push(i);
      const next = queue[Math.min(i, queue.length - 1)];
      i += 1;
      if (next instanceof Error) throw next;
      return {
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        headers: { get: (n) => next.headers?.[n.toLowerCase()] ?? null },
        text: async () => next.body ?? "",
        json: async () => JSON.parse(next.body ?? "{}"),
      };
    },
  };
}

/** The call shape the real code uses: throw an AiCallError on a bad status. */
function callerFor(f) {
  return async () => {
    const res = await f();
    if (!res.ok) throw await R.errorFromResponse(res, "test");
    return res.json();
  };
}

/** A controllable clock, so deadline cases do not wait in real time. */
function clock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    advance: (ms) => {
      t += ms;
    },
  };
}

const NO_JITTER = () => 0.5;

// ---------------------------------------------------------------
// Retry, and succeed
// ---------------------------------------------------------------

test("a 429 then a 200 succeeds on the second attempt", async () => {
  const f = fakeFetch([
    { status: 429, body: '{"error":{"code":"rate_limit_exceeded"}}' },
    { status: 200, body: '{"id":"resp_1"}' },
  ]);
  const c = clock();
  const out = await R.withRetry(callerFor(f.fetch), {
    deadline: c.now() + 60_000,
    now: c.now,
    sleep: c.sleep,
    random: NO_JITTER,
  });
  assert.equal(out.value.id, "resp_1");
  assert.equal(out.attempts, 2, "the attempt count is what lands on the scans row");
  assert.equal(f.calls.length, 2);
});

test("a 503 is retried", async () => {
  const f = fakeFetch([{ status: 503, body: "upstream" }, { status: 200, body: "{}" }]);
  const c = clock();
  const out = await R.withRetry(callerFor(f.fetch), {
    deadline: c.now() + 60_000, now: c.now, sleep: c.sleep, random: NO_JITTER,
  });
  assert.equal(out.attempts, 2);
});

test("a dropped connection is retried", async () => {
  // fetch rejects with a TypeError for a reset socket or a DNS failure.
  const boom = new TypeError("fetch failed");
  const f = fakeFetch([boom, { status: 200, body: '{"ok":true}' }]);
  const c = clock();
  const out = await R.withRetry(callerFor(f.fetch), {
    deadline: c.now() + 60_000, now: c.now, sleep: c.sleep, random: NO_JITTER,
  });
  assert.equal(out.attempts, 2);
  assert.equal(out.value.ok, true);
});

test("ECONNRESET is recognised as a network failure", () => {
  assert.equal(R.isNetworkError(new Error("read ECONNRESET")), true);
  assert.equal(R.isNetworkError(new Error("getaddrinfo ENOTFOUND api.openai.com")), true);
  assert.equal(R.isNetworkError(Object.assign(new Error("x"), { name: "TimeoutError" })), true);
  assert.equal(R.isNetworkError(new Error("something else entirely")), false);
});

// ---------------------------------------------------------------
// Retry-After
// ---------------------------------------------------------------

test("Retry-After in seconds is honored instead of the backoff", async () => {
  const f = fakeFetch([
    { status: 429, body: "slow down", headers: { "retry-after": "4" } },
    { status: 200, body: "{}" },
  ]);
  const c = clock();
  const start = c.now();
  await R.withRetry(callerFor(f.fetch), {
    deadline: start + 60_000, now: c.now, sleep: c.sleep, random: NO_JITTER,
  });
  // The fake sleep advances the clock, so this is the wait that was taken.
  // Coming back sooner than asked gets the second attempt refused too, and
  // an attempt is spent learning nothing.
  assert.equal(c.now() - start, 4000);
});

test("Retry-After as an HTTP date is honored", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  const header = new Date(now + 7000).toUTCString();
  const ms = R.retryAfterMs(header, now);
  // Whole-second resolution in the date format.
  assert.ok(ms >= 6000 && ms <= 7000, `got ${ms}`);
});

test("an absent or nonsense Retry-After falls back to backoff", () => {
  assert.equal(R.retryAfterMs(null, Date.now()), null);
  assert.equal(R.retryAfterMs("soon please", Date.now()), null);
});

test("backoff uses full jitter, not a fixed schedule", () => {
  // Fixed backoff reassembles the stampede that caused the rate limit: every
  // refused request retries at the same instant. Full jitter spreads them.
  assert.equal(R.backoffMs(1, () => 0), 0);
  assert.equal(R.backoffMs(1, () => 0.999), 499);
  assert.equal(R.backoffMs(2, () => 0), 0);
  assert.equal(R.backoffMs(2, () => 0.999), 999);
});

// ---------------------------------------------------------------
// Never retry
// ---------------------------------------------------------------

test("a 400 is not retried", async () => {
  const f = fakeFetch([{ status: 400, body: '{"error":{"message":"bad request"}}' }]);
  const c = clock();
  await assert.rejects(
    () => R.withRetry(callerFor(f.fetch), { deadline: c.now() + 60_000, now: c.now, sleep: c.sleep }),
    (e) => e.kind === "permanent" && e.attempts === 1,
  );
  // It would fail identically and cost the same money again.
  assert.equal(f.calls.length, 1);
});

test("401, 403, 404 and 422 are not retried", async () => {
  for (const status of [401, 403, 404, 422]) {
    const f = fakeFetch([{ status, body: "no" }]);
    const c = clock();
    await assert.rejects(
      () => R.withRetry(callerFor(f.fetch), { deadline: c.now() + 60_000, now: c.now, sleep: c.sleep }),
      (e) => e.kind === "permanent",
      `${status} should not be retried`,
    );
    assert.equal(f.calls.length, 1, `${status} was called twice`);
  }
});

test("a content-policy refusal is not retried", async () => {
  const f = fakeFetch([
    { status: 400, body: '{"error":{"code":"content_policy_violation"}}' },
  ]);
  const c = clock();
  await assert.rejects(
    () => R.withRetry(callerFor(f.fetch), { deadline: c.now() + 60_000, now: c.now, sleep: c.sleep }),
    (e) => e.kind === "permanent",
  );
  assert.equal(f.calls.length, 1);
});

test("a schema validation failure is not retried", async () => {
  // Thrown by our own parsing after a 200, not by the provider. The same
  // output will fail the same way, so retrying buys another identical bill.
  const c = clock();
  let calls = 0;
  await assert.rejects(
    () =>
      R.withRetry(
        async () => {
          calls += 1;
          throw new Error("schema validation failed: expected integer");
        },
        { deadline: c.now() + 60_000, now: c.now, sleep: c.sleep },
      ),
    (e) => e.kind === "permanent",
  );
  assert.equal(calls, 1);
});

// ---------------------------------------------------------------
// The trap
// ---------------------------------------------------------------

test("insufficient_quota is a 429 that must NOT be retried", async () => {
  // It arrives as 429, and 429 otherwise means "slow down" -- the one thing
  // retrying is for. This one means the billing account is empty. Retrying
  // cannot help, and it is failing for every teacher at the same moment.
  const f = fakeFetch([
    {
      status: 429,
      body: '{"error":{"message":"You exceeded your current quota","type":"insufficient_quota","code":"insufficient_quota"}}',
    },
    { status: 200, body: "{}" },
  ]);
  const c = clock();
  let alerted = null;
  await assert.rejects(
    () =>
      R.withRetry(callerFor(f.fetch), {
        deadline: c.now() + 60_000,
        now: c.now,
        sleep: c.sleep,
        onOutOfCredit: (d) => {
          alerted = d;
        },
      }),
    (e) => e.kind === "out_of_credit" && e.attempts === 1,
  );
  assert.equal(f.calls.length, 1, "an empty account must not be retried");
  assert.ok(alerted, "an operator alert must fire: no teacher can fix this");
  assert.match(alerted, /insufficient_quota/);
});

test("an ordinary 429 is still classified as a rate limit", () => {
  assert.equal(R.classify(429, '{"error":{"code":"rate_limit_exceeded"}}'), "rate_limit");
  assert.equal(R.classify(429, '{"error":{"code":"insufficient_quota"}}'), "out_of_credit");
  assert.equal(R.isOutOfCredit(500, "insufficient_quota"), false, "only a 429 carries it");
});

test("the teacher message for an empty account blames nobody and promises nothing", () => {
  const m = R.TEACHER_MESSAGES.out_of_credit;
  assert.equal(
    m,
    "Grading is temporarily unavailable. Your pages are saved and nothing was charged.",
  );
  // It must not tell them to try again: it will fail again until someone pays.
  assert.ok(!/try again/i.test(m));
});

// ---------------------------------------------------------------
// The time budget
// ---------------------------------------------------------------

test("a retry that cannot fit in the remaining budget is not started", async () => {
  // The sync path lives inside a 26s function and aborts the model at 24. A
  // retry begun with two seconds left buys a guaranteed timeout instead of
  // the error we already had, and the teacher waits longer for it.
  const f = fakeFetch([{ status: 503, body: "busy" }, { status: 200, body: "{}" }]);
  const c = clock();
  const deadline = c.now() + 3000; // less than MIN_ATTEMPT_MS
  await assert.rejects(
    () => R.withRetry(callerFor(f.fetch), { deadline, now: c.now, sleep: c.sleep, random: NO_JITTER }),
    (e) => e.kind === "server" && /gave up after 1/.test(e.detail),
  );
  assert.equal(f.calls.length, 1, "no second attempt should have started");
});

test("a retry that does fit is started", async () => {
  const f = fakeFetch([{ status: 503, body: "busy" }, { status: 200, body: "{}" }]);
  const c = clock();
  const out = await R.withRetry(callerFor(f.fetch), {
    deadline: c.now() + 30_000, now: c.now, sleep: c.sleep, random: NO_JITTER,
  });
  assert.equal(out.attempts, 2);
});

test("a long Retry-After that would overrun the budget stops instead", async () => {
  // The provider asks for 30s; we have 10. Waiting would blow the function's
  // own ceiling and return a gateway page instead of a readable error.
  const f = fakeFetch([
    { status: 429, body: "slow", headers: { "retry-after": "30" } },
    { status: 200, body: "{}" },
  ]);
  const c = clock();
  await assert.rejects(
    () => R.withRetry(callerFor(f.fetch), { deadline: c.now() + 10_000, now: c.now, sleep: c.sleep }),
    (e) => /gave up after 1/.test(e.detail),
  );
  assert.equal(f.calls.length, 1);
});

// ---------------------------------------------------------------
// Giving up
// ---------------------------------------------------------------

test("three failures stop, and surface the right sentence for the kind", async () => {
  const f = fakeFetch([
    { status: 503, body: "a" },
    { status: 503, body: "b" },
    { status: 503, body: "c" },
    { status: 200, body: "{}" },
  ]);
  const c = clock();
  await assert.rejects(
    () =>
      R.withRetry(callerFor(f.fetch), {
        deadline: c.now() + 120_000, now: c.now, sleep: c.sleep, random: NO_JITTER,
      }),
    (e) => e.kind === "server" && e.attempts === R.MAX_ATTEMPTS,
  );
  assert.equal(f.calls.length, 3, "three attempts total, not three retries");
  assert.match(R.TEACHER_MESSAGES.server, /documents are saved/);
});

test("a rate limit that never clears tells the teacher to wait, not that they broke something", async () => {
  const f = fakeFetch([{ status: 429, body: "busy" }]);
  const c = clock();
  await assert.rejects(
    () =>
      R.withRetry(callerFor(f.fetch), {
        deadline: c.now() + 120_000, now: c.now, sleep: c.sleep, random: NO_JITTER,
      }),
    (e) => e.kind === "rate_limit",
  );
  assert.match(R.TEACHER_MESSAGES.rate_limit, /busy right now/);
  assert.match(R.TEACHER_MESSAGES.rate_limit, /saved/);
});

test("a successful first call reports one attempt", async () => {
  const f = fakeFetch([{ status: 200, body: '{"id":"x"}' }]);
  const c = clock();
  const out = await R.withRetry(callerFor(f.fetch), { deadline: c.now() + 60_000, now: c.now, sleep: c.sleep });
  assert.equal(out.attempts, 1);
  assert.equal(f.calls.length, 1);
});
