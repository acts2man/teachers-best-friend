# Incident response plan

One page, on purpose. If student information may have been exposed, this is what
happens and who does it.

Last reviewed: 2026-09-15.

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

## Useful in a hurry

- Audit trail of admin actions: `admin_audit_log`
- Impersonation sessions, who viewed which account and when:
  `impersonation_sessions`
- Uploads and their deletion state: `teacher_uploads` (`expires_at`, `purged_at`)
- Deletion job history: `cron.job_run_details`
- Revoke an admin or app manager: `admin_set_admin`, `admin_set_app_manager`
- Suspend a teacher account: `admin_set_status`

Security reports from outside should reach [SECURITY CONTACT EMAIL], which is
published in the Privacy Policy, Terms of Service, and Data Processing Addendum.
