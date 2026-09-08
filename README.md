# A Teacher’s Best Friend

A private instructional workspace built from the full 28-page product brief.

## Included
- Teach Tomorrow dashboard with priorities, class understanding, recent assessments, saved lessons, and learning momentum.
- PDF/image upload and mobile camera capture with persistent R2 document storage.
- Assignment and student-response analysis through a server-side GPT-6 Astra adapter when an OpenAI API key is configured.
- Manual question entry, editable answer keys and passages, standard verification, secondary standards, DOK, alignment, exclusions, and coverage reports.
- Fictional 24-student sample classroom, separate empty classrooms, roster entry, diagnostics, cross-skill overlap, editable instructional groups, and standards heatmaps.
- Multi-observation student mastery and teacher observations. Verified response corrections replace evidence rather than adding duplicate observations.
- Reteach studio with original lessons, visual/hands-on/auditory approaches, an interactive multiplication area model, targeted practice, printable exit tickets, saved teaching dates, and follow-up result recording.
- Original resource library across Watch, Teach, Practice, Manipulative, Game, Intervention, and Enrichment; teacher curriculum uploads and page references.
- Grade 4 Common Core starter library with source links and custom framework/standard entry.
- Workspace-scoped persistence, optimistic revision checks, data export/deletion, responsive navigation, keyboard-accessible controls, and reduced motion.

## Runtime configuration
Logical bindings are DB (D1) and BUCKET (R2). Use the Sites-managed private audience. API routes require the platform-provided authenticated-user ID, scope every read/write to that ID, and validate write origins.

Configure OPENAI_API_KEY as a hosted secret and OPENAI_MODEL=gpt-6-astra. The application never requests an API key in a public browser form. Without the key, uploads and manual workflows operate normally and AI actions report their unconnected status. Sample results are explicitly labeled and are never generated for arbitrary uploaded work.

AI requests use Responses with strict structured outputs, uploaded-file ownership checks, a catalog-constrained prompt, store:false, bounded document size, and teacher review before results contribute to mastery.

## Scope and data notes
The included standard text is a teacher-friendly summary with links to official wording. California, Texas, Florida, Virginia, and district frameworks can be added by the teacher; their complete catalogs are not preloaded. Curriculum page mappings are entered by the teacher. There is no claim of automatic district-content indexing, guaranteed OCR accuracy, district SIS integration, or regulatory certification. Document photographs are passed to the vision model; a separate deskew/shadow-removal pipeline is not included.

Mastery is the arithmetic mean of the three most recent dated records. A mastered label additionally requires at least three records and a mean of 80% or higher. Reteach groups target scores under 70%; the heatmap highlights scores under 65%. Priority is a transparent planning heuristic, not a calibrated predictive model. Cross-skill overlap is an investigative prompt, not a causal diagnosis.

## Development
Use the retained Sites installation/build scripts and logical hosting manifest. Generate schema changes with npm run db:generate and inspect migrations before publishing. Applied migrations are immutable.

The focused domain checks are in tests/teacher-workflows.test.mjs. Run node --test tests/teacher-workflows.test.mjs. TypeScript can be checked with npx tsc --noEmit. This build has not undergone a live browser test or a real AI-provider call without an API key.
