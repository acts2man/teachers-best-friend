# Working agreements

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
