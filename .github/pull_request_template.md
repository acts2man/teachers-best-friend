<!--
Fill in every section. "N/A" is an answer only where the section says it may be.
Read docs/system-map.md first; the rule numbers (R1, R2, ...) and gap numbers (G1, ...) refer to it.
-->

## Design note

**What changes:**
<!-- One paragraph in plain English: what a teacher will see or not see differently. -->

**System-map rules this touches:**
<!-- e.g. "R1 (save sends everything), R3 (no wrong student)". "None" is allowed only if you checked section 2 and say why. -->

**How it could fail:**
<!-- The realistic ways this change could hurt a teacher or a student's data. Which hop in docs/system-map.md section 1 does it affect? -->

**Proven when:**
<!-- The test that fails before this change and passes after it. Name the file and the test. For a fix, show it failing on the old code. -->

**How to undo it:**
<!-- Revert the PR? A migration that must also be reversed? Data that cannot be restored? -->

## Proof

- [ ] `npx tsc --noEmit` clean
- [ ] `npm run lint`: summary line reads `0 errors` (quote it: `✖ N problems (0 errors, M warnings)`)
- [ ] `npm test` fully green, `tests/invariants/` included (quote the `# pass` / `# fail` lines)

**Browser checks:**
<!-- What you clicked through, at which widths, on which device. Screenshots use placeholder names only (rule R8). -->

**Before / after on real cases:**
<!-- Numbers from real scans where the change affects grading or matching: e.g. "the 10 Oct Percentages set: 2 rows misnamed before, 0 after". No student names. N/A only if no grading, matching or save behaviour changes. -->

## Database changes

<!-- N/A if the PR changes no SQL. Otherwise all three: -->

**Exact SQL:**
<!-- The migration file(s). Patch style (pg_get_functiondef, fragment found exactly once), `set lock_timeout`, no DROP: rule R9. -->

**Dry-run result:**
<!-- Applied inside a transaction that was rolled back, on production or a copy: what it printed. -->

**Round-trip check:**
<!-- For any workspace field (rule R2): save with the field set, read back with get_workspace_json, ROLLBACK. Paste the result, or name the supabase/checks/*.sql you ran. Applied to production? yes/no. Migrations are applied by hand; merging does not apply them. -->

## System map updated

- [ ] Yes: `docs/system-map.md` changed in this PR, and its "last verified" line is updated
- [ ] No: behaviour covered by the map does not change (say why)
