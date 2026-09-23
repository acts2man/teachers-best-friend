# Incident response plan

One page, on purpose. If student information may have been exposed, this is what
happens and who does it.

Last reviewed: 2026-09-23.

> Fill in the names and phone numbers below before launch. A plan with blank owners is
> not a plan.

---

## Roles

| Role | Who | Reachable at |
|---|---|---|
| Incident lead — decides, coordinates, owns the timeline | [NAME] | [PHONE / EMAIL] |
| Technical responder — investigates and contains | [NAME] | [PHONE / EMAIL] |
| Communications — talks to schools and users | [NAME] | [PHONE / EMAIL] |
| Legal counsel — notification obligations | [FIRM / ATTORNEY] | [PHONE / EMAIL] |

Anyone who notices a problem can start this. You do not need permission to raise an
incident, and raising one that turns out to be nothing carries no penalty.

---

## What counts as an incident

- Student work or student information visible to the wrong account
- Credentials, API keys, or the service role key exposed or suspected exposed
- Unauthorised access to the database, storage bucket, or admin dashboard
- A vendor tells us they had a breach affecting our data
- Uploaded work that should have been deleted is found to still exist
- Any report from a teacher that they can see another teacher's students

---

## The first hour

1. **Write down the time** and what was observed. Start a running log; every later
   step appends to it.
2. **Tell the incident lead.** If unreachable within 15 minutes, escalate to whoever
   is reachable and proceed.
3. **Contain before investigating.** Revoke the exposed credential, disable the
   affected account, or take the affected surface offline. A brief outage is cheaper
   than continued exposure.
4. **Preserve evidence.** Do not delete logs, rows, or storage objects while working.
   Snapshot first. Deleting the evidence makes the next steps guesswork.

---

## Then

5. **Establish scope.** Which students, which teachers, which districts, what data,
   over what window. Use the audit log (`admin_audit_log`), Supabase logs, and storage
   access logs. Write down what you checked, including the checks that came back clean.
6. **Fix the cause**, not just the symptom. Ship the fix, then confirm from the
   outside that the hole is closed.
7. **Decide on notification with counsel.** Student data triggers obligations that
   vary by state and by district contract. The Data Processing Addendum commits us to
   telling an affected district within its stated notice period of determining an
   incident occurred, so the clock starts at determination, not at resolution.
8. **Notify.** Districts first where a contract requires it, then affected teachers.
   Say what happened, what data was involved, what we did, and what they should do.
   Do not speculate and do not minimise.
9. **Write the postmortem** within a week: timeline, cause, what made it possible,
   what changed so it cannot recur. Blame the system, not the person.

---

## Standing commitments these steps exist to keep

- Notify an affected district without unreasonable delay, and in any event within the
  period stated in the Data Processing Addendum.
- Cooperate with the district's own investigation and notification duties.
- Do not push our share of notification cost onto a district for an incident that
  arose in our systems.

---

## Recorded incidents

### 2026-09-22 — a deploy permalink served production for nine days

**What happened.** A pilot teacher (Ricky) was using
`https://6aa86be8b9484a000816ae63--teachersbestfriend.netlify.app`, a Netlify deploy
permalink of a build from 2026-09-14. A deploy permalink is a complete, permanently
reachable copy of that build's serverless functions running with the production
environment, `SUPABASE_SERVICE_ROLE_KEY` included, so it read and wrote the production
database with the service role. The build predated the page ledger, so its scans charged
nothing. Proven side by side before the permalink was deleted: on the old copy
`GET /api/version` → 404 and `POST /api/scans/reserve` → 404 (both routes postdate that
build) while `GET /login` → 200 (fully usable); on the real site `/api/version` reported
the live commit and `/api/scans/reserve` → 401. The result was **25 scans on 2026-09-22
with no `spend_gate`, no `charge_pages` row, no `content_sha256`, and no build stamp**.
Production itself was always correct: one scan run on the real site the same day was
stamped, hashed, counted, and metered as expected.

**Cause.** A permalink is same-origin with itself, so `guardOrigin()` — which trusted the
request's own forwarded host — passed every check inside it. And the charge lived in the
route, so a build that did not call `charge_pages` (an old copy is exactly that) got free
scans.

**What changed so it cannot recur.**
- **Host guard** (`lib/canonical-host.ts`): in the production deploy context, any request
  whose host is not `CANONICAL_HOST` is refused server-side and redirected client-side.
  This makes a permalink of any build from the guard onward inert. It cannot reach into
  permalinks of older builds.
- **The charge moved into the database.** `create_scan` now performs the page charge as it
  opens the scan row, in one transaction, so a scan cannot exist uncharged regardless of
  which copy of the app calls it (`supabase/migrations/20260923170000_...`). Proven by
  `supabase/checks/pages-charged.sql`.
- **Uploads must carry their content hash** (`teacher_uploads_require_hash` trigger),
  proven by `supabase/checks/uploads-hashed.sql`.
- **Deploy retention limited** and the offending permalink deleted (it now 404s
  everywhere). The host guard contains new permalinks; deletion and retention are what
  contain the ones that predate it.

**The 25 uncounted scans — decision: leave them, do not backfill charges.** They are on
a comped beta plan (5,000-scan quota), so nothing reconciles against a bill either way;
they were caused by our leaked permalink, not by the teacher's own usage, so retroactively
charging his meter would bill him for our mistake; and their uploads carry null
`content_sha256`, so there is no real ledger key to charge against — a backfill would be
synthetic. The metering invariant is forward-looking (prevent recurrence), so
`pages-charged.sql` and `uploads-hashed.sql` start their window at 2026-09-23 and exclude
this date range by construction, with a comment saying why. The scans remain in the raw
cost log, correctly attributed for cost.

---

## Useful in a hurry

- Audit trail of admin actions: `admin_audit_log`
- Impersonation sessions, who viewed which account and when:
  `impersonation_sessions`
- Uploads and their deletion state: `teacher_uploads` (`expires_at`, `purged_at`)
- Deletion job history: `cron.job_run_details`
- Revoke an admin or app manager: `admin_set_admin`, `admin_set_app_manager`
- Suspend a teacher account: `admin_set_status`
- A copy of the app at the wrong address (a deploy permalink): confirm `CANONICAL_HOST`
  is set on production, delete the offending deploy in the Netlify dashboard (a deleted
  permalink 404s everywhere), and check `scans.build_ref_start` / `content_sha256` to
  scope what a stale build touched.

Security reports from outside should reach [SECURITY CONTACT EMAIL], which is
published in the Privacy Policy, Terms of Service, and Data Processing Addendum.
