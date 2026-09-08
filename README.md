# A Teacher’s Best Friend

A private teaching workspace that connects assignment alignment, an accurate answer key, individual student review, and focused reteaching.

## The current workflow

1. Choose the grade, Math or ELA, and intended standards. Upload the blank assignment or paste its questions.
2. Review each question's alignment, DOK, and Costa's level. Use the improvement guidance and upload a revised assignment when needed.
3. Upload or enter the teacher's answer key and confirm it.
4. Scan one student's work. Review answer-match percentages and flagged answers, confirm clear answers together, and print an individual standards report.
5. Choose an assessment and missed problem in Reteach, or carry an individual/shared skill gap into a visual, hands-on, or auditory plan.

The home screen highlights the next useful action. Primary navigation is Overview, Assignments, Student work, Reteach, and Students, with a separate standards toolkit. An original book logo, quieter cards, responsive layouts, contextual hover states, and reduced-motion support keep the workspace approachable.

See [current product alignment](docs/current-version-alignment.md) for the source-to-feature mapping and later ideas excluded from the main experience.

## Included

- PDF/image upload and mobile camera capture with persistent, owner-scoped document storage.
- Separate original assignment, teacher-key, and individual student documents, retained through manual and automatic review.
- Question and passage editing, skill/standard verification, alignment, exclusions, and intended-standard coverage.
- Explicit answer-key confirmation before automatic grading; changes invalidate affected student results.
- Uncertain, missing, and incorrect answer flags; teacher decisions replace stale evidence instead of duplicating it.
- Individual, provisional or confirmed assignment reports, observed misconceptions, and contextual reteaching.
- High/Mid/Low student bands and flexible groups based on shared standard gaps, with whole-class suggestions when at least half the class shares a gap.
- Seven prepared reteach lessons with visual, hands-on, and auditory approaches, printable practice and exit tickets, saved teaching dates, and follow-up recording.
- Teacher resources, curriculum uploads, and page references.
- Official California Grade 4 Math and ELA wording and source links, seven Common Core starter standards, and custom standards for other grades/frameworks.
- A clearly labeled fictional 24-student sample, separate empty classrooms, roster entry, and individual learning histories.
- Workspace persistence, optimistic revision checks, export/deletion, accessible controls, and reduced motion.

## Runtime configuration

The Netlify deployment uses Supabase Auth, Postgres, and the private `teacher-documents` Storage bucket. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in both the build and runtime environments. Every public table and Storage object has owner-scoped row-level security based on `auth.uid()`.

ChatGPT Sites retains its managed private audience, D1 `DB`, and R2 `BUCKET` bindings when the Supabase variables are absent. API routes select the available backend, validate authenticated ownership, and reject cross-origin writes.

The existing server-side Responses adapter uses the hosted OPENAI_API_KEY secret and OPENAI_MODEL setting. Keys are never requested in a public browser form. Without a configured key, uploads and manual workflows work and automatic actions show their unconnected status. Sample results are explicitly labeled and are never substituted for analysis of uploaded work.

AI requests use strict structured outputs, uploaded-file ownership checks, supplied standards, store:false, bounded document sizes, and teacher review before results contribute to student evidence.

## Scope and data notes

California Grade 4 official wording is sourced from the [California Department of Education](https://www2.cde.ca.gov/cacs/). Full catalogs for other grades are not preloaded. Curriculum page mappings are teacher-entered. No district-content indexing, SIS integration, or separate photo deskew/shadow-removal pipeline is implied.

An assignment report describes confirmed responses to that assignment. Existing learning histories use the arithmetic mean of the three latest dated observations; a mastered label additionally requires three records and a mean of at least 80%. An isolated score does not establish mastery or a diagnosis. Visual, hands-on, and auditory modes are flexible teaching approaches, not fixed learner types.

## Development and verification

Use the retained Sites installation/build scripts and logical hosting manifest. Generate schema changes with npm run db:generate and inspect migrations before publishing. Applied migrations are immutable.

Run node --test tests/teacher-workflows.test.mjs for focused workflow checks and npx tsc --noEmit for TypeScript validation. Use the Sites build helper for the deployable build. The focused checks cover review gates, recognition omissions/duplicates, corrected-key evidence invalidation, intended-standard alignment, catalog scope, and prepared-lesson matching.

This update has not undergone live browser testing or a real AI-provider call without a configured service key.

## Netlify deployment

Netlify uses `npm run build:netlify` to create the native `.next` output required by its Next.js adapter. The regular `npm run build` command remains the ChatGPT Sites / Cloudflare Worker build.

Netlify is connected to the dedicated `Teachers Best Friend` Supabase project. Unauthenticated visitors are sent to the branded `/login` experience. Authenticated teachers receive an owner-scoped workspace, revision-safe saving, and private document uploads.

For confirmed email signups, add the production Netlify URL and `/auth/callback` route to the Supabase Auth URL configuration. Keep `OPENAI_API_KEY` server-only in Netlify and use `OPENAI_MODEL=gpt-6-astra` when AI analysis is enabled.
