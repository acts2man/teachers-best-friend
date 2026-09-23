# A Teacher’s Best Friend

A private teaching workspace that connects assignment alignment, an accurate answer key, individual student review, and focused reteaching.

## The current workflow

1. Choose the grade, Math or ELA, and intended standards. Upload the blank assessment or paste its questions. Questions are read into the assessment automatically.
2. Review each question's alignment, DOK, and Costa's level. Use the improvement guidance and upload a revised assignment when needed.
3. Upload or photograph the teacher's answer key on the second tab; the answers fill in automatically. Confirm the key.
4. Upload or photograph one student's work on the third tab. Review answer-match percentages and flagged answers, confirm clear answers together, and print an individual standards report.
5. In Lesson plans, choose a missed problem or skill gap, pick a visual, hands-on, or auditory approach, generate an AI lesson plan for that approach, edit it, and save it to Saved lesson plans.

The home screen highlights the next useful action. Primary navigation is Overview, Assessments, Lesson plans, and Students, with a toolkit holding Standards and a step-by-step How to use guide. Student work lives inside each assessment. An original book logo, quieter cards, responsive layouts, contextual hover states, and reduced-motion support keep the workspace approachable.

See [current product alignment](docs/current-version-alignment.md) for the source-to-feature mapping and later ideas excluded from the main experience.

## Included

- PDF/image upload and mobile camera capture with persistent, owner-scoped document storage.
- Separate original assignment, teacher-key, and individual student documents, retained through manual and automatic review.
- Question and passage editing, skill/standard verification, alignment, exclusions, and intended-standard coverage.
- Explicit answer-key confirmation before automatic grading; changes invalidate affected student results.
- Uncertain, missing, and incorrect answer flags; teacher decisions replace stale evidence instead of duplicating it.
- Individual, provisional or confirmed assignment reports, observed misconceptions, and contextual reteaching.
- High/Mid/Low student bands and flexible groups based on shared standard gaps, with whole-class suggestions when at least half the class shares a gap.
- Seven prepared reteach lessons plus AI-generated lesson plans for any standard, all editable in place, with printable practice and exit tickets, saved teaching dates, and follow-up recording.
- Multiple classes (one per period or group) under Classes, with roster photo scanning, an always-visible switcher, and assessments that can be shared across classes while each class keeps its own student work.
- Every US state's standards framework in the dropdown. California Grade 4 Math and ELA are built in with official wording; other states and grades are retrieved with the AI service on request, saved to the teacher's library, and labeled for verification against the official source.
- Ten color themes under Settings, applied through hue-shiftable CSS so warnings and accents stay recognizable.
- Client-side text extraction for typed PDFs, so questions and answer keys populate even without the AI service.
- Teacher resources, curriculum uploads, and page references.
- Official California Grade 4 Math and ELA wording and source links, seven Common Core starter standards, AI-retrieved catalogs for any state and grade, and custom standards.
- A clearly labeled fictional 24-student sample, separate empty classrooms, roster entry, and individual learning histories.
- Workspace persistence, optimistic revision checks, export/deletion, accessible controls, and reduced motion.

## Runtime configuration

The Netlify deployment uses Supabase Auth, Postgres, and the private `teacher-documents` Storage bucket. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in both the build and runtime environments. Also set `SUPABASE_SERVICE_ROLE_KEY` (server-only; the workspace, metering, and pipeline-routing RPCs are granted to the service role only) and `ALLOWED_ORIGINS` (comma-separated site origins allowed to POST; behind Netlify's proxy the origin check uses the forwarded host and this list rather than the internal request URL) in the Functions and Runtime scopes. Set `CANONICAL_HOST` at **build** scope (it is inlined at build time, like `CONTEXT`) to the one host the app is allowed to serve from in production, e.g. `teachersbestfriend.netlify.app`. Every public table and Storage object has owner-scoped row-level security based on `auth.uid()`.

### Every deploy permalink is a full copy of the app, carrying production credentials

Netlify keeps an immutable permalink for **every** deploy, e.g. `https://<deploy-id>--teachersbestfriend.netlify.app`. That URL is not a preview of static files — it is a complete, permanently reachable copy of that build's serverless functions, running with the **production environment it was built with, including `SUPABASE_SERVICE_ROLE_KEY`**. Anyone with the link can use the app, and its server routes can read and write the production database with the service role. This is not hypothetical: a pilot teacher used a two-week-old permalink for nine days, and its scans ran against production with no metering, because that older build predated the page ledger. See [`docs/incident-response.md`](docs/incident-response.md).

Three things contain this, and all three matter:

- **The host guard** (`lib/canonical-host.ts`): in the `production` deploy context, any request whose host is not `CANONICAL_HOST` is refused server-side (`/api/*` and `/auth/*` via `proxy.ts`) and redirected to the canonical host client-side. This protects **every deploy built from now on**, because a build has to carry this code to enforce it. It can never reach *back* into a permalink that already exists.
- **Deleting old deploys** removes their permalinks (a deleted permalink 404s everywhere), which is the only thing that neutralises permalinks of builds that predate the guard.
- **Limiting Netlify's deploy retention** so old permalinks stop accumulating.

Deploy previews (`deploy-preview`), branch deploys (`branch-deploy`) and local development are deliberately exempt from the host guard — their hostnames are legitimately not canonical and are how PR/branch checks reach the app. If `CANONICAL_HOST` is unset in production the app fails loud (refuses) rather than silently allowing every host.

ChatGPT Sites retains its managed private audience, D1 `DB`, and R2 `BUCKET` bindings when the Supabase variables are absent. API routes select the available backend, validate authenticated ownership, and reject cross-origin writes.

The existing server-side Responses adapter uses the hosted OPENAI_API_KEY secret and OPENAI_MODEL setting. Keys are never requested in a public browser form. Without a configured key, uploads and manual workflows work and automatic actions show their unconnected status. Sample results are explicitly labeled and are never substituted for analysis of uploaded work.

AI requests use strict structured outputs, uploaded-file ownership checks, supplied standards, store:false, bounded document sizes, and teacher review before results contribute to student evidence.

### Background analysis (optional)

Netlify serverless functions are capped at ~26 seconds, so a long assessment scan can outlast the request. Setting `ANALYZE_ASYNC=1` (Supabase deployment only) switches `/api/analyze` to OpenAI background mode: the route starts the model job, returns a scan id immediately, and the client polls `/api/analyze/{scanId}` until the analysis finishes. The scan row (from the `scans` table) tracks the job; apply the `supabase/migrations/20260910195927_scan_async_results.sql` migration before enabling the flag. Background jobs are stored on OpenAI (`store:true`, required for polling) and deleted by the poll route as soon as the result is read. With the flag unset the synchronous path is unchanged and stores nothing on the provider.

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

For confirmed email signups, add the production Netlify URL and `/auth/callback` route to the Supabase Auth URL configuration. Keep `OPENAI_API_KEY` server-only in Netlify and set `OPENAI_MODEL=gpt-5.6-luna` as the fallback model; the Supabase deployment routes each stage through the `pipeline_config` table, editable on the admin AI pipeline page.
