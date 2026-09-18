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
   `npm test` showing no new failures. Two failures are pre-existing and
   expected: `renders development preview metadata` and
   `emits the catalog's animation and scrolling utilities`. Any others are new.
3. **Merged to `main`.** A branch is not a delivery. Check with
   `git log --oneline origin/main..<branch>` — anything listed is NOT live.
4. **Deployed.** `main` builds to Netlify. A merge is not a deploy; confirm the
   deploy finished before saying a teacher can see it.

Work still in progress is described in the future tense, and the difference
between "built" and "planned" is made explicit every time.

Verify claims against the running system, not against memory of an earlier
conversation. A statement that was true last week may have been broken by the
feature that shipped since.

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
