# Student data flow

Internal record. Not a published policy page, but the published pages must stay
consistent with it. Update this file whenever a hop, a vendor, or a retention window
changes.

Last verified against the running system: 2026-09-15.

---

## The hops

```
Teacher's browser
  └─(1)─> Netlify (Next.js app)
            ├─(2)─> Supabase Postgres        (rosters, questions, scores, mastery)
            ├─(3)─> Supabase Storage         (uploaded images and PDFs)
            └─(4)─> OpenAI Responses API     (analysis of the uploaded work)
                      └─(5)─> back to the app, then to the teacher
```

A daily job (6) deletes uploaded work once its retention window passes.

---

## 1. Browser to application

| Question | Answer |
|---|---|
| What is transmitted | Teacher credentials, roster entries, uploaded files, teacher corrections |
| Encrypted | Yes, TLS |
| Stored here | No. Netlify functions are stateless; nothing persists on the node |
| Retained | Duration of the request |
| Used for training | No |
| Other use | No |
| Deletable | Not applicable, nothing is retained |

Cross-origin writes are rejected by an origin allow-list (`guardOrigin`), and every
request is authenticated against the teacher's Supabase session.

## 2. Application to Postgres

| Question | Answer |
|---|---|
| What is transmitted | Roster labels, question text, answer keys, scores, standards, misconceptions, teacher notes |
| Encrypted | Yes, TLS in transit and at rest on disk |
| Stored here | Yes, this is the system of record |
| Retained | While the account is active; teacher notes may carry an earlier expiry |
| Used for training | No |
| Other use | No |
| Deletable | Yes, per student, class, assessment, or whole account |
| Backups | Supabase automated backups, purged within the documented backup window |

Row-level security scopes every table to the owning teacher, so one teacher's data is
unreachable from another teacher's session even if the application layer had a bug.

## 3. Application to Storage

| Question | Answer |
|---|---|
| What is transmitted | Photographs and PDFs of assessments and completed student work |
| Encrypted | Yes, TLS in transit, encrypted at rest |
| Stored here | Bucket `teacher-documents`, private, no public URLs |
| Retained | **30 days from upload**, then deleted by the job in step 6 |
| Used for training | No |
| Other use | No |
| Deletable | Yes, immediately by the teacher, and automatically at 30 days |

Object paths are namespaced by owner (`<teacher id>/<upload id>`) and the bucket is not
public, so a file is reachable only through an authenticated, authorised request.

## 4. Application to OpenAI

This is the hop districts ask about, so it is the most specific.

| Question | Answer |
|---|---|
| What is transmitted | The uploaded work, grade level, subject, the relevant standards, and question IDs |
| What is **not** transmitted | Student name, teacher name, school name, district name |
| Encrypted | Yes, TLS |
| Stored there | Per the OpenAI API data policy for API traffic |
| Retained | Per that policy; not used to build a profile for us |
| Used for training | No. API data is excluded from training by OpenAI's API terms |
| Other use | No |
| Deletable | The request payload is not something we can recall once sent, which is exactly why identity is stripped before it leaves |

Endpoint: `https://api.openai.com/v1/responses`.

The grading prompt instructs the model not to reproduce student names, and the
application sends a question ID rather than a student identity. The honest limit,
stated in the published pages too: the image itself is a photograph of a child's work
and may carry a name the student wrote on the page. We minimise identifiers, we do not
claim uploads are anonymous.

## 5. Results back to the teacher

Returned scores, standards, and misconceptions are written to Postgres against the
internal student record, which is where the teacher's chosen label is reattached. The
teacher reviews and confirms before anything counts as final.

## 6. The deletion job

| Item | Detail |
|---|---|
| What | `purge-expired-uploads` Supabase edge function |
| Schedule | Daily at 09:00 UTC, via `pg_cron` calling the function over `pg_net` |
| Scope | `teacher_uploads` and the legacy `uploads` table |
| Method | Supabase Storage API, so the stored file is removed, not just its database row |
| Failure behaviour | A row is only marked purged after its file is confirmed deleted, so a failed run retries on the next night rather than reporting work as gone while it is still there |

**Why an edge function rather than SQL.** Postgres blocks direct `DELETE` against
`storage.objects`. The documented escape hatch removes the metadata row but leaves the
file orphaned in the bucket, which would satisfy the audit trail while failing the
actual promise. The edge function goes through the Storage API instead.

---

## Payment

Billing is handled by the payment processor named in the Privacy Policy. Card details
do not reach our systems; we store a customer reference, plan, and status. No student
data is involved in this path.

---

## Things to re-check when the system changes

- Adding a new vendor that touches student data means updating the subprocessor table
  in the Data Processing Addendum and giving districts notice.
- Changing the retention window means updating four published pages: Privacy Policy,
  Student Data Privacy Commitments, How We Use AI, and the Data Processing Addendum.
  They currently all say 30 days.
- Changing the AI provider or model means re-checking the training and retention terms
  before the change ships, not after.
