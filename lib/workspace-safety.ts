import type { Assessment, Workspace } from "./teacher-types";

/**
 * Make an assessment safe to open, whatever the database left out.
 *
 * `get_workspace_json` wraps every assessment in `jsonb_strip_nulls`, so a
 * column that is NULL comes back with its key ABSENT, not as `[]`. The one
 * required-typed array this bites is `targetStandards`: it is emitted as
 * `to_jsonb(target_standards)` with no `coalesce`, so a freshly scanned
 * assessment (whose standards haven't been chosen yet) arrives with no
 * `targetStandards` key at all. The Assessment type says it is always there and
 * the assessment views read `a.targetStandards.length` / `.includes` / `.map`,
 * so the dropped key throws `Cannot read properties of undefined (reading
 * 'length')` during render -- the whole assessment screen is replaced by the
 * error boundary, which is what a teacher sees as "I click to open it and
 * nothing happens."
 *
 * The fix is to treat every such field as optional at the edge: default it once
 * here, where the workspace enters the app, so no screen downstream has to. The
 * upload lists and questions/responses are already coalesced to `[]` in SQL, but
 * they are defaulted here too so a hand-built or older payload can never
 * white-screen on the same shape.
 */
export function withAssessmentDefaults(a: Assessment): Assessment {
  return {
    ...a,
    targetStandards: Array.isArray(a.targetStandards) ? a.targetStandards : [],
    uploadIds: Array.isArray(a.uploadIds) ? a.uploadIds : [],
    questions: Array.isArray(a.questions) ? a.questions : [],
    responses: Array.isArray(a.responses) ? a.responses : [],
  };
}

/** Apply {@link withAssessmentDefaults} to every assessment in a workspace. */
export function withWorkspaceDefaults(w: Workspace): Workspace {
  return {
    ...w,
    assessments: Array.isArray(w.assessments)
      ? w.assessments.map(withAssessmentDefaults)
      : [],
  };
}
