# Working agreements

## Push means ship. Never leave finished work sitting on a branch

When work is pushed to the working branch it is ready to go. Open the PR and
merge it — do not ask, do not park it pending a decision, do not report it as
"waiting on you" and stop. Netlify auto-publishes from `main`, so a merge is
the deploy.

Work that is tested and pushed but unmerged is the worst state to be in: it
looks done in every internal signal and is invisible to the person actually
using the app. That is how a correct fix sat unshipped for two days while a
pilot teacher kept reporting it as broken.

The only reason to hold a merge is a failing check or a merge conflict. Fix
those, then merge.

## Never announce work that is not verifiably live

Nothing is described as done, fixed, shipped, or ready — in Slack, to a pilot
teacher, or anywhere outside this repo — until all four are confirmed:

1. **Pushed.** The commit is on the remote, not just in a working tree.
2. **Tested.** `npx tsc --noEmit` clean, `npm run lint` at 0 errors, and
   `npm test` fully green. **There are no expected failures.** There were two,
   red since the day the app was imported, and "two failures are expected" sat
   in this file for long enough to become furniture. Both turned out to be
   asserting things the app has never done -- a meta tag whose name existed only
   inside its own test, and a CSS utility from a component nothing renders. A
   red suite you have learned to read past is how the third failure, the real
   one, gets ignored. If a test fails, it is telling you something: fix the code
   or fix the assertion, and do not add a line here.

   Read the summary line -- `✖ N problems (X errors, Y warnings)`. The last two
   lines of `npm run lint` are the count of *auto-fixable* problems, and
   "0 errors and 1 warning potentially fixable" has already been misread as a
   pass once, shipping a lint error.
3. **Merged to `main`.** A branch is not a delivery. Check with
   `git log --oneline origin/main..<branch>` — anything listed is NOT live.
4. **Deployed.** `main` builds to Netlify. A merge is not a deploy; confirm the
   deploy finished before saying a teacher can see it.

Work still in progress is described in the future tense, and the difference
between "built" and "planned" is made explicit every time.

Verify claims against the running system, not against memory of an earlier
conversation. A statement that was true last week may have been broken by the
feature that shipped since.

## Slack: address the person, in front of everyone

Unless it is a direct message to Troy, a reply goes to the channel with
`@channel` **and** speaks to the person who asked, in the second person. Not a
write-up about them — a reply to them that the others can read.

Both pilot teachers are building this with us and each learns from what the
other asks. A question answered in a DM, or a reply phrased as a report to the
room, teaches only one of them.

So: `@channel`, then "@Michael — you asked for X, here is where it lands."
Never "Michael raised X" when Michael is in the room.

## Talk the design through before building it

When a teacher asks for something and the obvious implementation has a cost, a
limit or a tradeoff they would not have thought of, that goes back to them in
Slack before any of it is built. Say what they asked for, what the naive way
would cost, what we would do instead, and what we still need from them.

They are teachers, not engineers. They cannot weigh a decision they were never
shown, and a cost they find out about from a bill is a cost we hid. Two
examples this project has already hit: a pilot teacher proposed students write
numeric codes instead of names (a misread digit misfiles a test invisibly,
where a misread name is obvious — worth saying, not worth silently overruling),
and attaching a reading passage to every student's grading call would have
tripled the cost of a class set for no benefit over reading it once.

Do not silently overrule the request either. Bring the tradeoff, propose the
pivot, keep the outcome they asked for.

## Workspace persistence: a new field is not saved until you save it

The Supabase deployment does not store the workspace as a blob. `sync_workspace()`
writes it into relational columns and `get_workspace_json()` reads it back, and
each maps a **fixed, hand-written list of columns**. A field on a response, an
assessment, a question -- any workspace type -- that those two functions do not
name is silently dropped on save and gone on reload. It looks perfect in the
browser until a refresh. This has shipped broken twice: `response.errorType`
(the Class-view error-type roll-up vanished on reload) and
`assessment.pointsPossible` (the points total reverted to a bare percentage).

So: **any new field on a workspace type must be added to BOTH `sync_workspace`
and `get_workspace_json` (in a migration), and proven with a save/reload round
trip before you call it done.** Adding it to the TypeScript type or the
`/api/workspace` Zod schema is not enough -- that schema is loose (`z.any()`)
and will happily accept a field the database then throws away.

Prove it the way the bug was found: a rolled-back transaction on production that
adds the column + patched functions, runs `sync_workspace` with the field set,
reads it back with `get_workspace_json`, confirms it survived, and `ROLLBACK`s.
`tests/workspace-persistence-guard.test.mjs` is the tripwire -- it fails the
moment a type's fields drift from the list of what is actually persisted, so you
cannot add a field and forget this step.

Writing rubric scores are keyed to rubric-trait ids, not question ids, so they
do **not** ride the `student_responses` path (which inner-joins
`assessment_questions`); they persist through their own table. Same rule: if it
is in the workspace, a function has to write it and a function has to read it.

## Where continuity lives

- `docs/student-data-flow.md` — every hop student data takes, what each vendor
  receives, retention windows. Carries a "last verified" date. **Re-read
  section 4 before shipping any change to an AI prompt or a new AI mode.**
  A mode that shipped without this check put a class roster in a prompt and
  silently contradicted four published pages for a day.
- `docs/incident-response.md`
- `content/legal/` — the published commitments. These must stay consistent with
  `docs/student-data-flow.md`. Changing what reaches the AI provider means
  updating both.

## Pilot context

Two pilot teachers, Ricky Munoz and Michael Zotzman, are actively testing and
report in Slack (`#all-a-teachers-best-friend`, `#testing-and-bugs`). They are
non-technical. Admin-facing numbers and labels get read by them, so plain
English and honest rounding matter more than precision of jargon.
