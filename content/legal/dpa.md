# Data Processing Addendum

**A Teacher's Best Friend**

Effective date: [EFFECTIVE DATE]
Last updated: [EFFECTIVE DATE]

> **DRAFT — not for publication.** Placeholders in brackets must be filled in, the
> commitments in this document must be true of the running system before it goes
> live, and an attorney experienced in student data privacy should review it.
> See the accompanying pre-publication checklist.

---

## What this document is for

This is the agreement a school or district signs when it wants a contract in place
before its teachers use A Teacher's Best Friend with student work.

It is written to be readable by the person who actually has to approve it. Where a
term matters legally, it says so plainly rather than hiding it.

If your district has its own required form, including the
[Student Data Privacy Consortium](https://privacy.a4l.org/) National Data Privacy
Agreement or a state alternative, send it to [PRIVACY CONTACT EMAIL]. We will sign a
district's own form where we can meet its terms, and tell you plainly where we cannot.

**How to execute this one.** Fill in the district details in Section 1, sign at
Section 14, and return it to [PRIVACY CONTACT EMAIL]. We countersign and send a copy
back.

---

## 1. The parties

**Provider:** [LEGAL ENTITY NAME], [ENTITY TYPE], [MAILING ADDRESS] ("we", "Provider").

**Local Education Agency:** ____________________________________ ("LEA", "District"),
[DISTRICT ADDRESS].

This Addendum attaches to and forms part of the agreement between the parties for use
of the Service. Where this Addendum conflicts with our
[Terms of Service](/legal/terms) or [Privacy Policy](/legal/privacy), this Addendum
controls for LEA student data.

---

## 2. What the Service does

Teachers upload assessments and completed student work. The Service uses artificial
intelligence to propose scores, map questions to state standards, identify likely
misconceptions, and suggest reteaching. The teacher reviews and confirms results.

Students do not have accounts and do not interact with the Service.

---

## 3. We are a school official under FERPA

We receive personally identifiable information from education records only to perform
an institutional service the LEA would otherwise perform itself. We meet the
conditions of the school official exception at 34 CFR § 99.31(a)(1)(i)(B):

- We perform an institutional service or function for which the LEA would otherwise
  use its own employees.
- We are **under the direct control of the LEA** with respect to the use and
  maintenance of education records.
- We use education records only for the authorized purpose in Section 4.
- We do not redisclose personally identifiable information to any third party except
  as this Addendum permits.

The LEA determines that our access serves a legitimate educational interest. The LEA
remains responsible for its annual notification of FERPA rights.

---

## 4. Authorized purpose, and nothing else

We process LEA student data **only** to provide and support the Service for the LEA:
analyzing uploaded work, producing standards and mastery results, generating
instructional recommendations, providing support, keeping the Service secure, and
meeting legal obligations.

We will not:

- Sell LEA student data
- Use it for targeted advertising, or to build an advertising profile
- Use it to train general-purpose artificial intelligence models
- Use it to create a commercial product or profile unrelated to the authorized purpose
- Disclose it except as Section 8 permits

These restrictions survive termination.

---

## 5. Ownership stays with the LEA

LEA student data remains the property of, and under the control of, the LEA and the
student or parent as applicable. We claim no ownership of it.

The LEA may access, correct, export, and delete LEA student data at any time through
the Service, or by asking us at [PRIVACY CONTACT EMAIL]. We support a parent's or
eligible student's request to review or correct records by working through the LEA,
which is the party that holds the relationship with the family.

---

## 6. What data the Service holds

| Category | Examples | Notes |
|---|---|---|
| Teacher account | Name, school email, school, grade and subject | Provided by the teacher |
| Student identifiers | First name, initials, or a teacher-chosen label; grade level | We do not require a legal name and never require a last name |
| Uploaded work | Photographs or PDFs of assessments and completed student work | Deleted on the schedule in Section 7 |
| Derived results | Scores, standards mastery, misconception records, reteaching plans | Retained while the account is active |
| Teacher notes | Free text a teacher writes about a student | Optional; teacher may set an expiry |

We instruct teachers, in the product at the point of upload, not to include last
names, student ID numbers, addresses, dates of birth, medical information, or IEP and
504 records.

**A caution we would rather state than hide.** A first name plus a classroom, a
school, handwriting, and a score can still identify a student. We therefore treat
everything in the table above as education record data governed by this Addendum,
rather than claiming any of it is anonymous.

---

## 7. Retention and deletion

| Data | Retention |
|---|---|
| Uploaded images of student work | Deleted once the teacher confirms that student's grading, and automatically 30 days after upload in any case |
| Grading results held for delivery | Cleared 48 hours after the scan |
| Derived results and mastery records | Retained while the account is active |
| Teacher notes about a student | Retained while the account is active, or until a teacher-set expiry |
| Backups | Purged within [BACKUP WINDOW, e.g. 90 days] |

A teacher may delete any student, class, assessment, or their whole account at any
time from within the Service.

**On the LEA's request** we will delete or return LEA student data within
[DPA DELETION WINDOW, e.g. 30 days], and confirm in writing when it is done. On
termination we do the same without needing to be asked, except where law requires us
to keep something, in which case we will say what and why.

---

## 8. Subprocessors

We use a small number of vendors to run the Service. Each is bound by terms no less
protective than this Addendum, and none may use LEA student data for its own purposes
or to train models.

| Subprocessor | Role | Data it touches |
|---|---|---|
| [HOSTING PROVIDER] | Application hosting | Data in transit through the application |
| [DATABASE AND STORAGE PROVIDER] | Database, file storage, authentication | Account data, uploads, derived results |
| [AI PROVIDER] | Analysis of uploaded work | Uploaded work and grade or subject context, with a pseudonymous identifier in place of the student's name |
| Stripe | Subscription billing | Teacher billing details only; no student data |

The current list is maintained at this page. We will give the LEA at least
[SUBPROCESSOR NOTICE PERIOD, e.g. 30 days] notice before adding or replacing a
subprocessor that handles LEA student data, and the LEA may object.

---

## 9. What the AI provider receives

This is the part districts ask about most, so it is spelled out.

The AI provider receives the uploaded work, the grade level, the subject, the relevant
standards, and a pseudonymous identifier. It does **not** receive the student's name,
the teacher's name, or the school's name from our application.

The AI provider is contractually prohibited from training on data sent through our
account and from retaining it beyond what is needed to return a result.

One honest limitation: the uploaded image is a photograph of a child's work and may
contain a name the student wrote on the page. We instruct teachers to avoid this, and
we do not represent that uploads are anonymous. What we commit to is minimizing
identifiers and never sending the student's identity as data.

---

## 10. Security

We maintain administrative, technical, and physical safeguards appropriate to the
sensitivity of student data, including:

- Encryption in transit (TLS) and at rest
- Row-level access controls so one teacher's data is unreachable from another
  teacher's account
- Role-based administrative access, limited to staff who need it
- Audit logging of administrative actions
- Secure credential handling and least-privilege service credentials
- Dependency updates and security testing before release

[SECURITY CERTIFICATIONS OR ASSESSMENTS, IF ANY — do not claim a certification the
company does not hold.]

---

## 11. Incident response and breach notification

If we determine that LEA student data has been subject to unauthorized access,
disclosure, or acquisition, we will:

1. Notify the LEA without unreasonable delay and in any event within
   [BREACH NOTICE PERIOD, e.g. 72 hours] of determining that an incident occurred.
2. Describe what happened, what data was involved, and what we are doing about it.
3. Cooperate with the LEA's own investigation and notification obligations, including
   any notification required by [APPLICABLE STATE BREACH LAW].
4. Take steps to contain the incident and prevent its recurrence, and report back on
   what we changed.

We will not require the LEA to shoulder our share of notification cost where the
incident arose from our systems.

Report a suspected incident to [SECURITY CONTACT EMAIL].

---

## 12. Other laws we accept as applying to us

- **SOPIPA** (California Business and Professions Code § 22584) and its equivalents in
  other states, which bind us directly as an operator whether or not a contract exists.
- **California Education Code § 49073.1**, for the terms a district contract must
  contain.
- **COPPA**, where it applies to the Service. We do not ask the LEA to take on our
  obligations as operator.
- **[OTHER STATE STUDENT PRIVACY LAWS AS IDENTIFIED BY COUNSEL].**

---

## 13. Term

This Addendum takes effect on the date of the last signature and continues while the
LEA uses the Service, plus the period needed to complete deletion under Section 7.
Sections 4, 5, 7, 11, and 12 survive termination.

---

## 14. Signatures

**Local Education Agency**

Name: ____________________________  Title: ____________________________

Signature: _______________________  Date: _____________________________

**[LEGAL ENTITY NAME]**

Name: ____________________________  Title: ____________________________

Signature: _______________________  Date: _____________________________

---

## 15. Contact

Privacy and this Addendum: [PRIVACY CONTACT EMAIL]
Security incidents: [SECURITY CONTACT EMAIL]
[LEGAL ENTITY NAME], [MAILING ADDRESS]
