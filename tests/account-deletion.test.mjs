// Deleting an account is a sequence where the order is the safety argument.
//
// The money is cancelled first and a failure there stops everything, because a
// deleted account that is still billed every month is the one outcome the
// teacher cannot even notice -- they have no login left to notice it with.
// Then the files, then the rows, then the sign-in.
//
// lib/account-deletion.ts holds that sequence and imports nothing, so every
// one of these runs in a millisecond with each step failing on purpose. The
// route is checked structurally against the real file, which is how the
// "an admin viewing as a teacher cannot do this" rule is held down.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

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

const D = bundle("lib/account-deletion.ts");
const route = fs.readFileSync(path.join(ROOT, "app/api/account/delete/route.ts"), "utf8");
const teacherServer = fs.readFileSync(path.join(ROOT, "lib/teacher-server.ts"), "utf8");

/**
 * A recording set of steps. `fail` names one step that throws; everything else
 * succeeds and appends its name to `calls`.
 */
function steps({ subscription = null, billing = true, fail = null, calls = [] } = {}) {
  const run = (name, value) => {
    calls.push(name);
    if (fail === name) throw new Error(`${name} exploded`);
    return value;
  };
  return {
    calls,
    stripeSubscriptionId: async () => run("stripeSubscriptionId", subscription),
    billingEnabled: () => billing,
    cancelSubscription: async () => run("cancelSubscription", "canceled"),
    purgeDocuments: async () => run("purgeDocuments", 3),
    deleteRows: async () => run("deleteRows", { plan: "free", scansUnlinked: 7 }),
    deleteAuthUser: async () => run("deleteAuthUser", "deleted"),
  };
}

// ---------------------------------------------------------------
// The order
// ---------------------------------------------------------------

test("cancels the subscription before anything is deleted", async () => {
  const s = steps({ subscription: "sub_123" });
  const report = await D.runAccountDeletion(s);
  assert.deepEqual(s.calls, [
    "stripeSubscriptionId",
    "cancelSubscription",
    "purgeDocuments",
    "deleteRows",
    "deleteAuthUser",
  ]);
  assert.equal(report.stripe, "canceled");
  assert.equal(report.scansUnlinked, 7);
  assert.equal(report.documentsRemoved, 3);
  assert.equal(report.authUser, "deleted");
});

test("an account with no subscription skips Stripe entirely", async () => {
  const s = steps({ subscription: null });
  const report = await D.runAccountDeletion(s);
  assert.ok(!s.calls.includes("cancelSubscription"));
  assert.equal(report.stripe, "none");
});

test("documents go before rows, because the rows are the index of the files", async () => {
  const s = steps({ subscription: null });
  await D.runAccountDeletion(s);
  assert.ok(
    s.calls.indexOf("purgeDocuments") < s.calls.indexOf("deleteRows"),
    "purging documents must precede deleting the rows that name them",
  );
});

// ---------------------------------------------------------------
// The refusals
// ---------------------------------------------------------------

test("a failed Stripe cancel stops the whole deletion", async () => {
  const s = steps({ subscription: "sub_123", fail: "cancelSubscription" });
  await assert.rejects(
    () => D.runAccountDeletion(s),
    (e) => {
      assert.equal(e.name, "DeletionRefused");
      assert.equal(e.status, 502);
      assert.equal(e.message, D.STRIPE_REFUSAL);
      return true;
    },
  );
  // The point of the test: nothing after it ran.
  assert.ok(!s.calls.includes("purgeDocuments"), "no documents were deleted");
  assert.ok(!s.calls.includes("deleteRows"), "no rows were deleted");
  assert.ok(!s.calls.includes("deleteAuthUser"), "the account still exists");
});

test("a subscription on file with billing switched off is refused, not ignored", async () => {
  // With billing disabled stripe_subscription_id is NULL on every row. Finding
  // one anyway means we cannot reach a live subscription, and deleting the
  // account would leave it billing forever.
  const s = steps({ subscription: "sub_orphan", billing: false });
  await assert.rejects(
    () => D.runAccountDeletion(s),
    (e) => {
      assert.equal(e.status, 503);
      assert.equal(e.message, D.UNREACHABLE_REFUSAL);
      return true;
    },
  );
  assert.deepEqual(s.calls, ["stripeSubscriptionId"]);
});

test("an already-cancelled subscription is a success, not a failure", async () => {
  // The second run of a resumed deletion cancels a subscription the first run
  // already cancelled. Treating that as an error would make the account
  // permanently undeletable.
  const s = steps({ subscription: "sub_123" });
  s.cancelSubscription = async () => "already-canceled";
  const report = await D.runAccountDeletion(s);
  assert.equal(report.stripe, "already-canceled");
  assert.equal(report.authUser, "deleted");
});

// ---------------------------------------------------------------
// Resumability
// ---------------------------------------------------------------

test("a deletion that dies after the documents finishes when run again", async () => {
  // First attempt: files are gone, then the database step fails.
  const first = steps({ subscription: null, fail: "deleteRows" });
  await assert.rejects(() => D.runAccountDeletion(first));
  assert.deepEqual(first.calls, ["stripeSubscriptionId", "purgeDocuments", "deleteRows"]);

  // Second attempt, against the state the first one left: no subscription row
  // to read, no files left to remove. Nothing errors on what is already gone.
  const second = steps({ subscription: null });
  second.purgeDocuments = async () => {
    second.calls.push("purgeDocuments");
    return 0; // already emptied
  };
  second.deleteAuthUser = async () => {
    second.calls.push("deleteAuthUser");
    return "already-gone";
  };
  const report = await D.runAccountDeletion(second);
  assert.equal(report.documentsRemoved, 0);
  assert.equal(report.authUser, "already-gone");
  assert.equal(report.scansUnlinked, 7);
});

// ---------------------------------------------------------------
// The confirmation
// ---------------------------------------------------------------

test("the typed email must name this account", () => {
  assert.equal(D.emailsMatch("teacher@school.org", "teacher@school.org"), true);
  // A phone keyboard capitalises the first letter of everything.
  assert.equal(D.emailsMatch("  Teacher@School.org ", "teacher@school.org"), true);
  assert.equal(D.emailsMatch("someone@else.org", "teacher@school.org"), false);
  assert.equal(D.emailsMatch("", "teacher@school.org"), false);
  assert.equal(D.emailsMatch("teacher@school.org", ""), false);
  // Not a prefix, not a suffix, not a contains.
  assert.equal(D.emailsMatch("teacher@school.or", "teacher@school.org"), false);
  assert.equal(D.emailsMatch("xteacher@school.org", "teacher@school.org"), false);
});

// ---------------------------------------------------------------
// The route, structurally
// ---------------------------------------------------------------

test("the route refuses while an admin is viewing as a teacher", () => {
  // writingTeacherId() throws a 403 whenever the impersonation cookie is
  // present -- not merely when it still resolves. Using it here is what makes
  // "you cannot delete an account you are only looking at" true, so both
  // halves are asserted: that the route uses it, and that it still refuses.
  assert.ok(
    /const teacherId = await writingTeacherId\(\)/.test(route),
    "the route must take the id from writingTeacherId()",
  );
  assert.ok(
    !/owningTeacherId/.test(route),
    "owningTeacherId would resolve to the impersonated teacher and allow the delete",
  );
  // The cookie check moved into assertNotImpersonating() when downloads
  // needed the same rule with a different sentence. Both halves are still
  // asserted: that writingTeacherId defers to the guard, and that the guard
  // refuses on the cookie's presence with a 403.
  assert.ok(
    /export async function writingTeacherId\(\) \{\s*await assertNotImpersonating\("write"\);/.test(
      teacherServer,
    ),
    "writingTeacherId must go through the shared impersonation guard",
  );
  assert.ok(
    /export async function assertNotImpersonating[\s\S]*?IMPERSONATION_COOKIE[\s\S]*?throw new HttpError\(403/.test(
      teacherServer,
    ),
    "the guard must still refuse on the impersonation cookie",
  );
});

test("the account id never comes from the request body", () => {
  const body = route.slice(route.indexOf("const body"), route.indexOf("const report"));
  assert.ok(!/teacherId\s*=/.test(body), "nothing between reading the body and acting re-assigns the id");
  assert.ok(
    /body\.email/.test(route) && !/body\.teacherId|body\.teacher_id|body\.id\b/.test(route),
    "the body supplies the typed email and nothing else",
  );
});

test("the email is confirmed before anything is deleted", () => {
  const confirmAt = route.indexOf("emailsMatch");
  const deleteAt = route.indexOf("deleteTeacherAccount(teacherId");
  assert.ok(confirmAt > 0 && deleteAt > 0);
  assert.ok(confirmAt < deleteAt, "the confirmation must come first");
});

test("the route guards its origin", () => {
  assert.ok(/guardOrigin\(request\)/.test(route));
});
