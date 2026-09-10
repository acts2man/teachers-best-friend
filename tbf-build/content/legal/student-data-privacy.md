# Student Data Privacy Commitments

**A Teacher's Best Friend**
California SOPIPA Compliance Statement

Effective date: [EFFECTIVE DATE]

> **DRAFT — not for publication.** Every commitment below must be verifiably true of
> the running system before this is posted. An attorney experienced in student data
> privacy should review it. See the accompanying pre-publication checklist.

---

## Purpose of this document

This document is written for school administrators, technology directors, and privacy
officers evaluating whether A Teacher's Best Friend may be used with student work. It
states plainly what we do with student information and what we are legally bound not to
do.

Our general Privacy Policy covers the whole service. This document covers student
information specifically, and states our compliance with California's Student Online
Personal Information Protection Act.

---

## 1. SOPIPA applies to us, with or without a contract

California Education Code § 22584 (SOPIPA) applies to operators of online services
designed, marketed, and used primarily for K–12 school purposes. A Teacher's Best
Friend is such a service.

**SOPIPA's obligations attach to us directly.** They do not depend on a district
contract, a purchase order, or a signed data agreement. If a single teacher in your
district signs up on their own and uses the service with student work, we are bound by
every commitment in this document with respect to that student information.

We state this explicitly because individual-teacher sign-up is a common path to our
service, and we do not want any ambiguity about whether protections apply. They do.

We are also aware that SOPIPA's protections cannot be waived by consent, including
parental consent. We do not seek any such waiver.

---

## 2. What we will never do

These are prohibitions, not preferences.

**We will not engage in targeted advertising.** We do not serve advertising on the
service at all. We do not use information acquired through the service to target
advertising anywhere else, on any other site, service, or application.

**We will not build student profiles for non-educational purposes.** We amass student
information only to serve K–12 school purposes — checking work against standards,
tracking mastery, and generating instructional material for the teacher.

**We will not sell, rent, or trade student information.** No exceptions. In the event
of a merger or acquisition, student information may transfer only to a successor entity
that agrees in writing to these same commitments, as SOPIPA requires.

**We will not disclose student information** except: at the direction of the school or
district; to service providers contractually bound to these same terms and prohibited
from any secondary use; where required by law; or to protect the safety or integrity of
the service.

**We will not use student work to train artificial intelligence models.** Not ours, not
a vendor's. Our AI provider is contractually prohibited from training on data submitted
through our account, and our requests are configured so the provider does not retain
request content. This commitment appears in Section 6 in more detail.

---

## 3. What student information we hold

The service is deliberately built to hold as little as possible.

**Required:**
- A label distinguishing one student from another, chosen by the teacher
- Images of student work, retained only transiently (Section 5)
- Text of student answers, extracted from those images
- Correctness of each answer, and the standard it addresses
- The apparent misconception behind an incorrect answer
- Standards mastery records over time

**Optional, at the teacher's discretion:**
- A student's full name
- Teacher-written notes about a student

**Never collected:**
Home address, phone number, date of birth, government identification number, health or
disability information, IEP or 504 status, disciplinary records, biometric information,
geolocation, socioeconomic data, or free or reduced lunch status.

### On student names

**A real student name is not required to use this service.** The identifying label may
be initials, a roster number, a first name and last initial, or any convention a
teacher or district prefers. Every feature works without a legal name.

We recommend districts direct teachers to use non-identifying labels. This is the
single most effective step available to reduce risk, and the product is designed to
make it costless.

Where a student has written their name on a worksheet, that name may appear in the
photograph. We mitigate this in three ways: images are deleted automatically
(Section 5); our AI instructions direct the model not to reproduce names it encounters
on a page; and when student responses are analyzed, only internal identifiers are
transmitted, never names.

---

## 4. Who owns the data

**The school and the teacher retain ownership and control of student information.** We
hold it to provide the service and for no other reason. We claim no ownership interest
in student work, student records, or any analysis derived from them.

Where we contract directly with a local educational agency, that contract will include
the provisions required by California Education Code § 49073.1 (AB 1584), including the
agency's retention of ownership and control of pupil records.

---

## 5. Retention and deletion

| Data | Retention |
|---|---|
| Uploaded worksheet images | Automatically deleted [RETENTION WINDOW] after upload |
| Roster photographs | Deleted immediately after processing |
| Extracted answers, scores, misconception records | Held while the account is active |
| Standards mastery records | Held while the account is active |
| Teacher notes about a student | Held while active, or until a teacher-set expiry |

Automatic image deletion runs on a scheduled job, not on request. Worksheet photographs
are the highest-risk item we hold and we do not keep them indefinitely.

### Deletion at a school's request

**A school or district may direct us to delete student information under its control at
any time, and we will comply.** This right exists whether or not the district has a
contract with us, and whether or not the teacher who created the account agrees.

To make a request, contact [PRIVACY CONTACT EMAIL] from a district email address,
identifying the teacher accounts or students concerned. We will:

1. Acknowledge within [ACK WINDOW, e.g. 5 business days]
2. Verify the requester's authority
3. Complete deletion from active systems within [DELETION WINDOW, e.g. 30 days]
4. Complete deletion from backups within [BACKUP WINDOW, e.g. 90 days]
5. Provide written confirmation

Teachers may also delete any student, class, assessment, or their entire account
themselves at any time.

---

## 6. How artificial intelligence is used

The service uses AI to read student work, align it to standards, and generate
reteaching material. Because this is the question districts ask most often, here is the
detail:

**Where processing happens.** All AI requests are made from our servers. Our
credentials are never present in a browser, and no request goes directly from a
student's or teacher's device to an AI provider.

**Which provider.** OpenAI, through its API. This is the business API, not a consumer
chat product.

**Retention by the provider.** Requests are configured with retention disabled. The
provider does not store the content of our requests beyond what is needed to return a
response.

**Training.** Our agreement with the provider prohibits the use of data submitted
through our account to train or improve their models. This is the default for API
customers and we have not opted out of it.

**What is sent.** The image of the work, the question text, and the relevant academic
standards. When analyzing student responses, student names are not sent — only internal
identifiers meaningless outside our system.

**Human review.** AI output is a suggestion. Every standard alignment and every score
is presented to the teacher for confirmation before it is recorded. No determination
about a student is made by AI alone.

**Accuracy.** AI misreads handwriting. We tell teachers this plainly and design the
workflow to require verification. Results are a first pass, not an assessment of record.

---

## 7. Security

- Encryption in transit (TLS 1.2+) and at rest
- Row-level database security isolating each teacher's data
- Private file storage, never publicly addressable
- Passwords stored only as cryptographic hashes
- Administrative credentials restricted, rotated, and never in client-side code
- Access to production data limited to [NUMBER] authorized personnel
- [PENETRATION TESTING / AUDIT CADENCE, if any]

### Breach notification

In the event of unauthorized access to student information, we will notify affected
schools and account holders within [BREACH NOTIFICATION WINDOW, e.g. 72 hours] of
confirming the breach, and will provide what is known about scope, cause, affected
records, and remediation.

---

## 8. Subprocessors

| Provider | Role | Location | Student data? |
|---|---|---|---|
| [HOSTING PROVIDER] | Database and file storage | [REGION] | Yes — at rest |
| [DEPLOYMENT PROVIDER] | Application hosting | [REGION] | In transit only |
| OpenAI | AI processing | United States | Transiently, not retained |
| [PAYMENT PROCESSOR] | Billing | United States | No |

Each is contractually bound to use information only to provide services to us and is
prohibited from secondary use. We will give [SUBPROCESSOR NOTICE PERIOD] notice of
changes to this list to districts under contract.

---

## 9. For districts considering a contract

We welcome direct agreements and can execute:

- A district's own data privacy agreement
- The California Student Data Privacy Agreement (CSDPA), or a comparable regional
  template
- A contract meeting AB 1584 requirements

Contact [PRIVACY CONTACT EMAIL] to begin.

---

## 10. Contact

**Student data privacy inquiries**
[PRIVACY CONTACT EMAIL]
[LEGAL ENTITY NAME], [MAILING ADDRESS]

We will respond to inquiries from schools and districts within
[RESPONSE WINDOW, e.g. 5 business days].
