# A Teacher’s Best Friend

A private teaching workspace that connects assignment alignment, an accurate answer key, individual student review, and focused reteaching.

## The current workflow

1. Choose the grade, Math or ELA, and intended standards. Upload the blank assignment or paste its questions.
2. Review what each question measures. Upload or enter the teacher's answer key and confirm it.
3. Scan one student's work. Review flagged answers, confirm clear answers together, and print an individual standards report.
4. Carry the student and observed skill gap into a visual, hands-on, or auditory reteach plan.

The home screen highlights the next useful action. Primary navigation is Overview, Assignments, Student work, Reteach, and Students, with a separate standards toolkit. An original book logo, quieter cards, responsive layouts, contextual hover states, and reduced-motion support keep the workspace approachable.

See [current product alignment](docs/current-version-alignment.md) for the source-to-feature mapping and later ideas excluded from the main experience.

## Included

- PDF/image upload and mobile camera capture with persistent, owner-scoped document storage.
- Separate original assignment, teacher-key, and individual student documents, retained through manual and automatic review.
- Question and passage editing, skill/standard verification, alignment, exclusions, and intended-standard coverage.
- Explicit answer-key confirmation before automatic grading; changes invalidate affected student results.
- Uncertain, missing, and incorrect answer flags; teacher decisions replace stale evidence instead of duplicating it.
- Individual, provisional or confirmed assignment reports, observed misconceptions, and contextual reteaching.
- Seven prepared reteach lessons with visual, hands-on, and auditory approaches, printable practice and exit tickets, saved teaching dates, and follow-up recording.
- Teacher resources, curriculum uploads, and page references.
- Official California Grade 4 Math and ELA wording and source links, seven Common Core starter standards, and custom standards for other grades/frameworks.
- A clearly labeled fictional 24-student sample, separate empty classrooms, roster entry, and individual learning histories.
- Workspace persistence, optimistic revision checks, export/deletion, accessible controls, and reduced motion.

## Runtime configuration

Logical bindings are DB (D1) and BUCKET (R2). Use the Sites-managed private audience. API routes require the platform-provided authenticated-user ID, scope reads and writes to that ID, and validate write origins.

The existing server-side Responses adapter uses the hosted OPENAI_API_KEY secret and OPENAI_MODEL setting. Keys are never requested in a public browser form. Without a configured key, uploads and manual workflows work and automatic actions show their unconnected status. Sample results are explicitly labeled and are never substituted for analysis of uploaded work.

AI requests use strict structured outputs, uploaded-file ownership checks, supplied standards, store:false, bounded document sizes, and teacher review before results contribute to student evidence.

## Scope and data notes

California Grade 4 official wording is sourced from the [California Department of Education](https://www2.cde.ca.gov/cacs/). Full catalogs for other grades are not preloaded. Curriculum page mappings are teacher-entered. No district-content indexing, SIS integration, or separate photo deskew/shadow-removal pipeline is implied.

An assignment report describes confirmed responses to that assignment. Existing learning histories use the arithmetic mean of the three latest dated observations; a mastered label additionally requires three records and a mean of at least 80%. An isolated score does not establish mastery or a diagnosis. Visual, hands-on, and auditory modes are flexible teaching approaches, not fixed learner types.

## Development and verification

Use the retained Sites installation/build scripts and logical hosting manifest. Generate schema changes with npm run db:generate and inspect migrations before publishing. Applied migrations are immutable.

Run node --test tests/teacher-workflows.test.mjs for focused workflow checks and npx tsc --noEmit for TypeScript validation. Use the Sites build helper for the deployable build. The focused checks cover review gates, recognition omissions/duplicates, corrected-key evidence invalidation, intended-standard alignment, catalog scope, and prepared-lesson matching.

This update has not undergone live browser testing or a real AI-provider call without a configured service key.
