import type { RubricDimension } from "./teacher-types";

/**
 * Default writing rubrics, from California's Smarter Balanced full-write rubrics.
 *
 * Two genres for now (Opinion/Argument come later): Informational (science lab
 * reports count as Informational) and Narrative. SBAC scores three traits:
 *   - Purpose / Organization   — 4 points (4 highest, 1 lowest)
 *   - Evidence / Elaboration    (Narrative: Development / Elaboration) — 4 points
 *   - Conventions               — 2 points (2, 1, 0)
 * SBAC publishes these for grade bands 3-5, 6-8, and 9-11 (we extend 9-11 to
 * cover 9-12). SBAC does NOT publish a K-2 full-write rubric, so K-2 uses a
 * simple, age-appropriate version written here (see K2_* below) -- flagged so a
 * teacher knows it is ours, not SBAC's.
 *
 * Each trait carries a CA CCSS anchor standard so a confirmed score flows into a
 * student's mastery: Purpose/Organization -> W.<g>.4 (clear, organized writing),
 * Evidence/Elaboration -> W.<g>.2 (informative) or Development -> W.<g>.3
 * (narrative), Conventions -> L.<g>.2. Class view breaks writing down by trait
 * directly, so this mapping only affects the per-student mastery total.
 *
 * The rubric is a default: it is copied onto the assessment at creation and the
 * teacher can view and edit every trait's descriptor there.
 */

export type WritingGenre = "informational" | "narrative" | "response";

export type GradeBand = "K-2" | "3-5" | "6-8" | "9-12";

export function gradeBand(grade: number): GradeBand {
  if (grade <= 2) return "K-2";
  if (grade <= 5) return "3-5";
  if (grade <= 8) return "6-8";
  return "9-12";
}

/** True when the rubric for this grade is our simple version, not SBAC's. */
export function isSimplifiedBand(grade: number): boolean {
  return gradeBand(grade) === "K-2";
}

/** The CCSS grade token used in standard codes ("K" for kindergarten). */
function ccssGrade(grade: number): string {
  return grade <= 0 ? "K" : String(grade);
}

// Concise trait descriptors by band. A teacher can expand or rewrite any of
// these on the assessment; they are the starting point, not a straitjacket.
const PURPOSE: Record<GradeBand, string> = {
  "K-2":
    "Does the writing stay on topic with a clear beginning, middle, and end? (Simple K-2 version — not an SBAC rubric.) 4 = clear order throughout; 1 = little or no order.",
  "3-5":
    "SBAC Purpose/Organization (3-5): a clear focus and structure, with an effective opening, logical sequence, transitions, and closure. 4 highest, 1 lowest.",
  "6-8":
    "SBAC Purpose/Organization (6-8): consistent focus and a coherent structure with effective transitions and a strong introduction and conclusion. 4 highest, 1 lowest.",
  "9-12":
    "SBAC Purpose/Organization (9-11): a sustained focus and a logical, well-controlled structure with purposeful transitions. 4 highest, 1 lowest.",
};
const EVIDENCE_INFO: Record<GradeBand, string> = {
  "K-2":
    "Are there facts or details about the topic? (Simple K-2 version — not an SBAC rubric.) 4 = several clear details; 1 = few or none.",
  "3-5":
    "SBAC Evidence/Elaboration (3-5, informative): relevant facts, details, and examples that develop the topic, with mostly precise language. 4 highest, 1 lowest.",
  "6-8":
    "SBAC Evidence/Elaboration (6-8, informative): thorough, relevant evidence and elaboration with precise, content-appropriate language. 4 highest, 1 lowest.",
  "9-12":
    "SBAC Evidence/Elaboration (9-11, informative): comprehensive, well-chosen evidence and elaboration with precise academic language. 4 highest, 1 lowest.",
};
const DEVELOPMENT_NARR: Record<GradeBand, string> = {
  "K-2":
    "Does the story have characters, a setting, and events with some detail? (Simple K-2 version — not an SBAC rubric.) 4 = developed with details; 1 = little development.",
  "3-5":
    "SBAC Development/Elaboration (3-5, narrative): developed experiences, characters, and events using details, dialogue, and description. 4 highest, 1 lowest.",
  "6-8":
    "SBAC Development/Elaboration (6-8, narrative): effective narrative techniques (dialogue, pacing, description) and sensory detail that develop the story. 4 highest, 1 lowest.",
  "9-12":
    "SBAC Development/Elaboration (9-11, narrative): skillful narrative techniques and precise details that build a vivid, coherent experience. 4 highest, 1 lowest.",
};
const CONVENTIONS: Record<GradeBand, string> = {
  "K-2":
    "Capitalization, end punctuation, and spelling of common words. (Simple K-2 version — not an SBAC rubric.) 2 = mostly correct; 1 = some; 0 = little command.",
  "3-5":
    "SBAC Conventions (3-5): command of grade-level grammar, usage, capitalization, punctuation, and spelling. 2 highest, 0 lowest.",
  "6-8":
    "SBAC Conventions (6-8): command of grade-level grammar, usage, capitalization, punctuation, and spelling. 2 highest, 0 lowest.",
  "9-12":
    "SBAC Conventions (9-11): command of grade-level grammar, usage, capitalization, punctuation, and spelling. 2 highest, 0 lowest.",
};

/**
 * The default rubric for a genre at a grade. Three traits, each with a fresh id
 * so a teacher can edit or reorder them without collisions across assessments.
 */
/**
 * Response writing (constructed response / RACES): a student answers a question
 * in writing, citing and explaining text evidence. Five traits, all on a 4-point
 * scale (4 Excellent, 3 Proficient, 2 Developing, 1 Beginning). Not an SBAC
 * rubric -- it is ours, from Michael's ask -- and grade-agnostic; a teacher who
 * uses a different RACES variant can upload their own with the rubric upload.
 */
function responseRubric(grade: number): RubricDimension[] {
  const g = ccssGrade(grade);
  const levels =
    " (4 Excellent, 3 Proficient, 2 Developing, 1 Beginning.)";
  return [
    {
      id: crypto.randomUUID(),
      name: "Answer",
      max: 4,
      descriptor: "Answers all parts of the question accurately." + levels,
      standard: `W.${g}.1`,
    },
    {
      id: crypto.randomUUID(),
      name: "Cite Evidence",
      max: 4,
      descriptor: "Uses strong, accurate text evidence to support the answer." + levels,
      standard: `RI.${g}.1`,
    },
    {
      id: crypto.randomUUID(),
      name: "Explain",
      max: 4,
      descriptor: "Explains how the evidence supports the answer." + levels,
      standard: `W.${g}.9`,
    },
    {
      id: crypto.randomUUID(),
      name: "Organization",
      max: 4,
      descriptor: "Logical order, complete sentences, ideas that flow." + levels,
      standard: `W.${g}.4`,
    },
    {
      id: crypto.randomUUID(),
      name: "Conventions",
      max: 4,
      descriptor: "Capitalization, punctuation, spelling, and grammar." + levels,
      standard: `L.${g}.2`,
    },
  ];
}

export function defaultRubric(genre: WritingGenre, grade: number): RubricDimension[] {
  if (genre === "response") return responseRubric(grade);
  const band = gradeBand(grade);
  const g = ccssGrade(grade);
  const elaboration =
    genre === "narrative"
      ? { name: "Development / Elaboration", descriptor: DEVELOPMENT_NARR[band], standard: `W.${g}.3` }
      : { name: "Evidence / Elaboration", descriptor: EVIDENCE_INFO[band], standard: `W.${g}.2` };
  return [
    {
      id: crypto.randomUUID(),
      name: "Purpose / Organization",
      max: 4,
      descriptor: PURPOSE[band],
      standard: `W.${g}.4`,
    },
    {
      id: crypto.randomUUID(),
      name: elaboration.name,
      max: 4,
      descriptor: elaboration.descriptor,
      standard: elaboration.standard,
    },
    {
      id: crypto.randomUUID(),
      name: "Conventions",
      max: 2,
      descriptor: CONVENTIONS[band],
      standard: `L.${g}.2`,
    },
  ];
}

export const WRITING_GENRES: { value: WritingGenre; label: string; hint: string }[] = [
  {
    value: "informational",
    label: "Informational",
    hint: "Explains a topic with facts and details. Science lab reports count as Informational.",
  },
  {
    value: "narrative",
    label: "Narrative",
    hint: "Tells a real or imagined story with characters and events.",
  },
  {
    value: "response",
    label: "Response writing",
    hint: "A written answer to a question (constructed response): answer, cite evidence, explain. RACES-style.",
  },
];

export function genreLabel(genre?: WritingGenre): string {
  return WRITING_GENRES.find((g) => g.value === genre)?.label ?? "";
}
