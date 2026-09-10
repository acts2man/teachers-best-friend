# Privacy Policy

**A Teacher's Best Friend**

Effective date: [EFFECTIVE DATE]
Last updated: [EFFECTIVE DATE]

> **DRAFT — not for publication.** Placeholders in brackets must be filled in, the
> commitments in this document must be true of the running system before it goes
> live, and an attorney experienced in student data privacy should review it.
> See the accompanying pre-publication checklist.

---

## The short version

A Teacher's Best Friend helps teachers check student work against state standards and
get reteaching suggestions. To do that, teachers photograph or upload student
worksheets, and we process those images with artificial intelligence.

We take a deliberately minimal approach to student information:

- **We do not require student names.** The app works with initials, a roster number,
  or any label a teacher chooses.
- **We do not use student work to train AI models**, and our AI provider is
  contractually prohibited from doing so with data sent through our account.
- **We do not sell student information**, and we do not serve advertising of any kind.
- **We delete uploaded worksheet images automatically** rather than keeping them
  indefinitely.
- **We are directly regulated by California's Student Online Personal Information
  Protection Act (SOPIPA)**, and we comply with it whether or not a school district
  has signed a contract with us. See our Student Data Privacy Commitments for detail.

The rest of this document explains all of it.

---

## 1. Who we are

A Teacher's Best Friend is operated by [LEGAL ENTITY NAME], [ENTITY TYPE, e.g. a
California limited liability company], located at [MAILING ADDRESS].

Questions about this policy, or requests concerning data, go to
**[PRIVACY CONTACT EMAIL]**.

## 2. Who this policy covers

This policy covers two different groups, and the distinction matters:

**Teachers and other account holders.** People who create an account, log in, and use
the service. You give us this information about yourself directly.

**Students.** Children whose schoolwork a teacher processes through the service.
Students do not have accounts, do not log in, and never interact with us directly. We
receive information about students only because a teacher submitted their work.

Information about students receives stricter treatment throughout this policy and under
the laws described in Section 9.

---

## 3. Information we collect

### 3.1 From teachers

| What | Why we have it | Required? |
|---|---|---|
| Email address | Account login, service notices | Yes |
| Password | Authentication (stored only as a cryptographic hash) | Yes |
| Name | Displayed in the app | Optional |
| School or district name | Context for standards selection | Optional |
| Grade levels and subjects taught | Selecting the right standards | Optional |
| Class names and structure | Organizing work | Created by you |
| Payment information | Billing | Only for paid plans — see Section 6 |
| Support messages | Answering your questions | Only if you write to us |

### 3.2 About students

| What | Why we have it | Required? |
|---|---|---|
| A label identifying the student to their teacher | Attaching work to the right student | Yes — but see below |
| Images of student work | The core function of the service | Yes |
| Text of student answers, extracted from those images | Scoring and analysis | Yes |
| Whether each answer was correct | Progress tracking | Yes |
| The apparent misconception behind a wrong answer | Generating reteaching material | Yes |
| Standards mastery records over time | Progress tracking | Yes |
| Teacher-written notes about a student | Teacher's own reference | No — optional |

**On the student label.** The app requires *some* way to distinguish one student from
another, but it does not require a real name. Teachers may use initials, first name and
last initial, a roster number, or any other label. A separate optional field exists for
a full legal name if a teacher chooses to enter one; the service functions completely
without it.

**On handwriting.** A photograph of student work may show a name the student wrote on
the page. We cannot prevent this. We address it in three ways: images are deleted
automatically on the schedule in Section 5, our AI instructions direct the model not to
reproduce names it encounters, and student names are not transmitted when student
responses are analyzed.

### 3.3 Collected automatically

Standard technical information: IP address, browser type, device type, pages visited,
and timestamps. We use this for security, debugging, and understanding which features
get used. We do not use it to build advertising profiles, and we do not use third-party
advertising or cross-site tracking technologies.

### 3.4 What we do not collect

We do not knowingly collect student home addresses, phone numbers, dates of birth,
government identification numbers, health or disability information, disciplinary
records, biometric data, or geolocation. We do not ask for them and the app has no
field for them. Teachers should not enter this information into free-text note fields.

---

## 4. How we use information

We use the information described above only to:

1. Provide the service — read submitted work, align it to standards, score it, and
   generate reteaching material.
2. Maintain records of student progress for the teacher who created them.
3. Authenticate users and secure accounts.
4. Meter usage against plan limits and process payment.
5. Provide customer support.
6. Diagnose errors and improve accuracy and reliability.
7. Comply with legal obligations.

**We do not:**

- Use student information to build a profile of a student for any purpose other than
  the school purposes above.
- Use student information for targeted advertising, on our service or anywhere else.
- Sell, rent, or trade student information.
- Use student work to train artificial intelligence models, ours or anyone else's.
- Disclose student information to third parties except as described in Section 7.

---

## 5. How long we keep things

| Data | Retention |
|---|---|
| Uploaded worksheet images | Automatically deleted [RETENTION WINDOW, e.g. 30 days] after upload |
| Roster photographs | Deleted immediately after names are read |
| Extracted answer text, scores, misconception records | Kept while the account is active |
| Standards mastery records | Kept while the account is active |
| Teacher notes about a student | Kept while the account is active, or until an expiry the teacher sets |
| Account and billing records | Kept while the account is active, then as required by law |
| Technical logs | [LOG RETENTION WINDOW] |

Deleting the underlying image while keeping the extracted result is deliberate: the
analysis is what the teacher needs, and the photograph is the part that carries the
most risk.

**Deletion on request.** A teacher may delete any student, class, assessment, or their
entire account at any time from within the app. A school or district may request
deletion of student information and we will comply — see Section 9.

When an account is deleted, associated data is removed from active systems within
[DELETION WINDOW, e.g. 30 days] and from backups within [BACKUP WINDOW, e.g. 90 days].

---

## 6. Payment

Payment is processed by [PAYMENT PROCESSOR, e.g. Stripe]. We do not receive or store
full payment card numbers. We store a customer reference, the subscription plan, and
billing status.

---

## 7. Who we share information with

We do not sell information. We share it only in these situations:

**Service providers who help us operate.** Each is bound by contract to use the
information only to provide services to us:

| Provider | Role | What it handles |
|---|---|---|
| [HOSTING PROVIDER, e.g. Supabase / AWS] | Database and file storage | All stored data |
| [DEPLOYMENT PROVIDER, e.g. Netlify] | Application hosting | Requests in transit |
| OpenAI | AI processing | Submitted work, transiently — see Section 8 |
| [PAYMENT PROCESSOR] | Billing | Teacher payment details only |

**At a school's direction.** If a school or district has a contract with us covering a
teacher's use, we share information with that school as the contract provides.

**Legal requirements.** If required by law, subpoena, or court order — and where
permitted, we will notify the affected account holder first.

**Business transfer.** If the service is acquired, student information transfers only
to a successor that agrees in writing to be bound by these same commitments. This is
required by SOPIPA and we treat it as non-negotiable.

---

## 8. Artificial intelligence

Submitted work is sent to OpenAI's API for analysis. Specifically:

- Requests are made server-side. Our credentials are never exposed to a browser.
- Requests are configured so the provider does not retain the content of the request.
- Our agreement with the provider prohibits using data submitted through our account to
  train their models.
- When student responses are analyzed, student names are not sent — only internal
  identifiers.
- The AI's output is a suggestion, not a determination. Teachers review and can correct
  every standard alignment and every score before it is recorded.

A fuller description is in our companion document, *How A Teacher's Best Friend Uses
AI*.

**Accuracy.** AI systems make mistakes, particularly when reading handwriting. Results
should be treated as a first pass for a teacher to verify, never as an authoritative
assessment of a student. We design the app to require teacher confirmation for this
reason.

---

## 9. Legal framework

### California — SOPIPA

We are an operator under the Student Online Personal Information Protection Act
(California Education Code § 22584). SOPIPA applies to us because our service is
designed and marketed for K–12 school purposes, and it applies **regardless of whether
a school or district has signed a contract with us** — including when an individual
teacher signs up on their own. Our specific commitments are set out in our Student Data
Privacy Commitments document.

### California — AB 1584

When we contract directly with a local educational agency, that contract will include
the provisions required by California Education Code § 49073.1, including the agency's
retention of ownership and control of student records.

### FERPA

The Family Educational Rights and Privacy Act governs schools rather than vendors
directly. Where a school or district designates us a "school official" with a
legitimate educational interest, we accept the corresponding obligations: we use
education records only for the purposes authorized, we do not redisclose them, and we
remain under the school's direct control with respect to those records.

**Teachers signing up individually should be aware:** if your district has a policy
governing which online services may be used with student work, that policy applies to
this service. We are not in a position to know your district's rules. Please check.

### COPPA

The Children's Online Privacy Protection Act governs collection of personal information
from children under 13. Students do not create accounts or interact with us directly.
Where a school provides consent on behalf of parents for an educational service, we
rely on that consent and limit use to the educational purpose.

### Parent requests

Parents seeking to review, correct, or delete their child's information should contact
the child's teacher or school first, since the school controls the educational record.
We will support any school-directed request promptly. Parents may also contact us at
[PRIVACY CONTACT EMAIL] and we will work with the school to respond.

---

## 10. Security

- Encryption in transit (TLS) and at rest.
- Row-level database security so each teacher's data is reachable only by that teacher.
- Uploaded files held in a private store, never publicly addressable.
- Passwords stored only as cryptographic hashes.
- Administrative credentials restricted and never present in client-side code.
- [BREACH NOTIFICATION WINDOW] notification to affected accounts and, where student
  information is involved, to the relevant school, in the event of a breach.

No system is perfectly secure, and we will not claim otherwise.

---

## 11. Your rights

Teachers may access, correct, export, or delete their information from within the app,
or by contacting us. California residents have additional rights under the California
Consumer Privacy Act; note that information covered by SOPIPA and FERPA is subject to
those laws rather than the CCPA.

We do not discriminate against anyone for exercising a privacy right.

---

## 12. Changes

If we make a material change to this policy — particularly one affecting student
information — we will notify account holders by email at least [NOTICE PERIOD, e.g. 30
days] before it takes effect. Continued use after that constitutes acceptance. Prior
versions will be available on request.

---

## 13. Contact

[LEGAL ENTITY NAME]
[MAILING ADDRESS]
[PRIVACY CONTACT EMAIL]

For student data privacy inquiries from schools or districts, please use the same
address and mark the message for the attention of student data privacy.
