# How A Teacher's Best Friend Uses AI

Effective date: [EFFECTIVE DATE]

> **DRAFT — not for publication.** Every statement here must be true of the running
> system before it is posted. See the accompanying pre-publication checklist.

---

Teachers ask two questions about the AI in this app, and both deserve a straight
answer:

**"Is my students' work being used to train an AI?"** No.

**"Can I trust what it tells me?"** Partly, and we'll be specific about where.

---

## What the AI actually does

When you photograph a worksheet and submit it, three things happen in sequence:

1. **It reads the page.** The image goes to an AI model that transcribes the questions
   and the student's written answers.
2. **It matches to standards.** We look up the relevant state standards in our own
   database and give the model a short list of candidates to choose from. It does not
   recall standards from memory.
3. **It suggests reteaching.** For each wrong answer, it identifies the likely
   misconception and produces material aimed at that specific misunderstanding.

Then it stops and shows you the result. Nothing is recorded about a student until you
confirm it.

---

## Your students' work is not training data

**We do not use student work to train AI models. Neither does our AI provider.**

The detail, since this is the part that matters:

We use OpenAI's API — the business interface, not the consumer chat product. For API
customers, submitted data is not used to train models by default. We have not opted
into any program that would change that.

We also send our requests with retention switched off, meaning the provider does not
store the content of what we send beyond producing a response.

And we don't train models ourselves. We have no model of our own, no plans for one, and
no pipeline that would collect student work for that purpose.

---

## What gets sent, and what doesn't

**Sent:**
- The image of the work
- The question text
- A short list of candidate academic standards
- The expected answer, when you have provided an answer key

**Not sent:**
- Student names. When the app analyzes student responses, it transmits an internal
  identifier — a random string meaningless outside our system.
- Your students' history, mastery records, or notes you have written about them.
- Anything about other students, other classes, or other teachers.

There is one honest exception. If a student wrote their name on the worksheet, that
name is in the photograph, and the photograph is what gets sent. We can't crop what we
can't predict. What we do instead: the model is instructed not to reproduce names it
sees on a page, and the image is deleted automatically on a schedule rather than kept.

---

## Where your work is stored

Uploaded images go to private storage that only your account can reach. They are
**deleted automatically [RETENTION WINDOW] after upload.**

The results — the extracted answers, the scores, the mastery records — stay as long as
your account is active, because that's the part you actually need. The photograph is
the part that carries risk, so it goes.

Roster photos are deleted immediately after names are read.

---

## Where it gets things wrong

We would rather tell you this than have you discover it.

**Handwriting.** This is the weak point. Messy handwriting, faint pencil, crossed-out
work, and answers written in unexpected places all cause misreads. Elementary
handwriting is harder than secondary.

**Partially correct answers.** Work that shows correct reasoning with an arithmetic
slip, or a right answer reached by a wrong method, is where automated scoring is least
reliable. Your judgment is better than the model's here and it isn't close.

**Standards alignment.** We constrain the model to a list of candidate standards from
our database, which prevents invented standard codes. But choosing among near-neighbor
standards still involves judgment, and it will sometimes pick the wrong one.

**Standards coverage.** [CURRENT COVERAGE STATEMENT — e.g. "We currently have verified
standards for California Grade 4 mathematics and English language arts. For other
grades and states, results are less reliable and are flagged for your review."]

**Misconception identification.** A plausible-sounding explanation of why a student
made a mistake may simply be wrong. Treat it as a hypothesis worth checking, not a
diagnosis.

---

## This is why you confirm everything

The app asks you to verify each standard alignment and each score before it's recorded.
That isn't a formality and it isn't us covering ourselves. It's the design.

The AI's job is to do the tedious first pass — reading thirty worksheets, sorting who
missed what — so that your attention goes to the judgment calls. It is not qualified to
make a determination about a child, and we have not built it as though it were.

**Do not use these results as the sole basis for a grade, a placement decision, an
intervention referral, or anything communicated to a family, without reviewing the
underlying work yourself.**

---

## Questions

[PRIVACY CONTACT EMAIL]

For the full legal picture, see our Privacy Policy and our Student Data Privacy
Commitments.
