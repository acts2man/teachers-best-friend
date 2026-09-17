import californiaGrade4 from "./california-grade-4.json";
import californiaGrade7Math from "./california-grade-7-math.json";
import californiaGrade7Ela from "./california-grade-7-ela.json";
import californiaGradeKMath from "./california-grade-k-math.json";
import californiaGradeKEla from "./california-grade-k-ela.json";
import californiaGrade1Math from "./california-grade-1-math.json";
import californiaGrade1Ela from "./california-grade-1-ela.json";
import californiaGrade2Math from "./california-grade-2-math.json";
import californiaGrade2Ela from "./california-grade-2-ela.json";
import californiaGrade3Math from "./california-grade-3-math.json";
import californiaGrade3Ela from "./california-grade-3-ela.json";
import californiaGrade5Math from "./california-grade-5-math.json";
import californiaGrade5Ela from "./california-grade-5-ela.json";
import californiaGrade6Math from "./california-grade-6-math.json";
import californiaGrade6Ela from "./california-grade-6-ela.json";
import californiaGrade8Math from "./california-grade-8-math.json";
import californiaGrade8Ela from "./california-grade-8-ela.json";
import {standards} from "./teacher-data";

const california = [
  ...californiaGrade4,
  ...californiaGrade7Math,
  ...californiaGrade7Ela,
  ...californiaGradeKMath,
  ...californiaGradeKEla,
  ...californiaGrade1Math,
  ...californiaGrade1Ela,
  ...californiaGrade2Math,
  ...californiaGrade2Ela,
  ...californiaGrade3Math,
  ...californiaGrade3Ela,
  ...californiaGrade5Math,
  ...californiaGrade5Ela,
  ...californiaGrade6Math,
  ...californiaGrade6Ela,
  ...californiaGrade8Math,
  ...californiaGrade8Ela,
];
import type {Standard, Workspace} from "./teacher-types";

const titles: Record<string, string> = {
  "4.MD.5.a":"Angles as turns around a circle", "4.MD.5.b":"Measure angles in degrees", "4.NF.3.a":"Join & separate fractional parts", "4.NF.3.b":"Decompose fractions", "4.NF.3.c":"Add & subtract mixed numbers", "4.NF.3.d":"Fraction word problems", "4.NF.4.a":"Fractions as multiples of unit fractions", "4.NF.4.b":"Multiply a fraction by a whole number", "4.NF.4.c":"Fraction multiplication problems", "RL.4.8":"Not applicable to literature",
  "4.G.1":"Lines, angles & shapes", "4.G.2":"Classify two-dimensional shapes", "4.G.3":"Lines of symmetry",
  "4.MD.1":"Measurement units & conversions", "4.MD.2":"Solve measurement problems", "4.MD.3":"Area & perimeter", "4.MD.4":"Fractional measurements on line plots", "4.MD.5":"Understand angle measurement", "4.MD.6":"Measure & draw angles", "4.MD.7":"Additive angle measures",
  "4.NBT.1":"Place value relationships", "4.NBT.2":"Place value & comparison", "4.NBT.3":"Round whole numbers", "4.NBT.4":"Whole-number addition & subtraction", "4.NBT.5":"Multi-digit multiplication", "4.NBT.6":"Division with place-value models",
  "4.NF.1":"Equivalent fractions", "4.NF.2":"Compare fractions", "4.NF.3":"Add & subtract fractions", "4.NF.4":"Multiply fractions by whole numbers", "4.NF.5":"Tenths & hundredths", "4.NF.6":"Fractions in decimal notation", "4.NF.7":"Compare decimals",
  "4.OA.1":"Multiplicative comparisons", "4.OA.2":"Comparison word problems", "4.OA.3":"Multi-step word problems", "4.OA.4":"Factors & multiples", "4.OA.5":"Number & shape patterns",
  "L.4.1":"Grammar & sentence structure", "L.4.2":"Capitalization, punctuation & spelling", "L.4.3":"Purposeful language choices", "L.4.4":"Word meanings & reference tools", "L.4.5":"Figurative language & word relationships", "L.4.6":"Academic vocabulary",
  "RF.4.3":"Decode multisyllabic words", "RF.4.4":"Reading fluency",
  "RI.4.1":"Evidence in informational text", "RI.4.2":"Main idea & supporting details", "RI.4.3":"Events, procedures & concepts", "RI.4.4":"Vocabulary in context", "RI.4.5":"Informational text structure", "RI.4.6":"Compare accounts & perspectives", "RI.4.7":"Interpret visual information", "RI.4.8":"Reasons & evidence", "RI.4.9":"Combine information from two texts", "RI.4.10":"Read grade-level informational text",
  "RL.4.1":"Inference & textual evidence", "RL.4.2":"Theme & summary", "RL.4.3":"Characters, settings & events", "RL.4.4":"Literary words & allusions", "RL.4.5":"Poetry, drama & prose", "RL.4.6":"Narrator & point of view", "RL.4.7":"Connect text & visual presentation", "RL.4.9":"Compare themes & story patterns", "RL.4.10":"Read grade-level literature",
  "SL.4.1":"Collaborative discussion", "SL.4.2":"Paraphrase spoken information", "SL.4.3":"Evaluate a speaker’s evidence", "SL.4.4":"Organized oral presentations", "SL.4.5":"Support ideas with media", "SL.4.6":"Formal & informal speaking",
  "W.4.1":"Opinion writing", "W.4.2":"Informative writing", "W.4.3":"Narrative writing", "W.4.4":"Clear, purposeful writing", "W.4.5":"Plan, revise & edit", "W.4.6":"Use technology to publish", "W.4.7":"Short research projects", "W.4.8":"Gather & organize sources", "W.4.9":"Support writing with text evidence", "W.4.10":"Write for varied purposes",
  "7.RP.1":"Unit rates with fractions", "7.RP.2.a":"Identify proportional relationships", "7.RP.2.b":"Constant of proportionality", "7.RP.2.c":"Equations for proportions", "7.RP.2.d":"Interpret proportional graphs", "7.RP.3":"Multistep ratio & percent problems",
  "7.NS.1.a":"Opposite quantities combine to zero", "7.NS.1.b":"Add rational numbers on a number line", "7.NS.1.c":"Subtract as adding the inverse", "7.NS.1.d":"Properties of addition & subtraction", "7.NS.2.a":"Multiply rational numbers", "7.NS.2.b":"Divide rational numbers", "7.NS.2.c":"Properties of multiplication & division", "7.NS.2.d":"Rational numbers as decimals", "7.NS.3":"Four operations with rational numbers",
  "7.EE.1":"Add, factor & expand linear expressions", "7.EE.2":"Equivalent expressions reveal meaning", "7.EE.3":"Multistep rational-number problems", "7.EE.4.a":"Solve px + q = r problems", "7.EE.4.b":"Solve & graph inequalities",
  "7.G.1":"Scale drawings", "7.G.2":"Draw & construct figures", "7.G.3":"Cross sections of solids", "7.G.4":"Area & circumference of circles", "7.G.5":"Angle relationships", "7.G.6":"Area, volume & surface area",
  "7.SP.1":"Representative & random samples", "7.SP.2":"Inferences from random samples", "7.SP.3":"Compare two data distributions", "7.SP.4":"Compare populations with statistics", "7.SP.5":"Probability from 0 to 1", "7.SP.6":"Long-run relative frequency", "7.SP.7.a":"Uniform probability models", "7.SP.7.b":"Probability models from data", "7.SP.8.a":"Probability of compound events", "7.SP.8.b":"Represent compound sample spaces", "7.SP.8.c":"Simulate compound events",
  "RL.7.1":"Cite evidence & inferences", "RL.7.2":"Theme & objective summary", "RL.7.3":"How story elements interact", "RL.7.4":"Word meaning & sound devices", "RL.7.5":"Form & structure in drama/poetry", "RL.7.6":"Contrasting points of view", "RL.7.7":"Compare text to media version", "RL.7.8":"Not applicable to literature", "RL.7.9":"Fiction vs. historical account", "RL.7.10":"Read grade-level literature",
  "RI.7.1":"Cite evidence in nonfiction", "RI.7.2":"Two or more central ideas", "RI.7.3":"Interactions of people & ideas", "RI.7.4":"Word choice, tone & technical terms", "RI.7.5":"Text structure & sections", "RI.7.6":"Author's point of view & purpose", "RI.7.7":"Compare text to audio/video", "RI.7.8":"Trace & evaluate an argument", "RI.7.9":"Compare two authors on one topic", "RI.7.10":"Read grade-level nonfiction",
  "W.7.1":"Argument writing", "W.7.2":"Informative/explanatory writing", "W.7.3":"Narrative writing", "W.7.4":"Clear, purposeful writing", "W.7.5":"Plan, revise & edit", "W.7.6":"Publish & cite with technology", "W.7.7":"Short research projects", "W.7.8":"Assess sources & avoid plagiarism", "W.7.9":"Draw evidence from texts", "W.7.10":"Write for varied purposes",
  "SL.7.1":"Collaborative discussion", "SL.7.2":"Analyze ideas across media", "SL.7.3":"Evaluate a speaker's argument", "SL.7.4":"Present claims & findings", "SL.7.5":"Multimedia in presentations", "SL.7.6":"Adapt speech to context",
  "L.7.1":"Phrases, clauses & sentence types", "L.7.2":"Commas & spelling", "L.7.3":"Precise, concise language", "L.7.4":"Determine word meanings", "L.7.5":"Figurative language & connotation", "L.7.6":"Academic vocabulary",
};

/**
 * The short name a teacher sees in a standards picker.
 *
 * Grades 4 and 7 have hand-written titles above. Everywhere else the old
 * fallback was the cluster heading, which a whole domain shares -- so a
 * grade 5 teacher saw nine standards all called "Apply and extend previous
 * understandings of multiplication", and had nothing to pick between them.
 * Deriving the name from the standard's own opening clause keeps it accurate
 * (it is the official wording, just trimmed) and makes every row distinct.
 */
function displayTitle(record: { officialCode: string; wording: string; cluster: string }) {
  const hand = titles[record.officialCode];
  if (hand) return hand;
  const wording = (record.wording || "").trim();
  if (!wording) return record.cluster;
  // First sentence or clause. Sub-standards often repeat their parent's stem
  // followed by the part that is actually theirs, so prefer the later clause
  // when the first one is shared boilerplate ending in a colon.
  const parts = wording.split(/(?<=[.;:])\s+/).filter(Boolean);
  let pick = parts[0] || wording;
  // A lettered sub-standard's wording opens with its parent's stem, which all
  // of its siblings repeat -- so 3.MD.7.a-d would all be called "Relate area
  // to the operations of multiplication and addition". Skip the stem and name
  // the part that actually belongs to this one.
  const isSubStandard = /\.[a-z]$/.test(record.officialCode);
  if (parts.length > 1 && (isSubStandard || /[:;]$/.test(pick))) pick = parts[1];
  pick = pick.replace(/[.;:]$/, "").trim();
  if (pick.length <= 68) return pick;
  const cut = pick.slice(0, 68);
  const space = cut.lastIndexOf(" ");
  return (space > 30 ? cut.slice(0, space) : cut) + "\u2026";
}

// Retain familiar CCSS codes for existing lessons; also show CDE's official identifier.
function commonCode(code: string) {
  return standards.find(s => s.subject === "Math" && s.code.replace(/\.[A-Z](?=\.\d+$)/, "") === code)?.code || code;
}

export const californiaStandards: Standard[] = california.map(record => {
  const code = commonCode(record.officialCode);
  const enriched = standards.find(s => s.code === code);
  return {...enriched, code, officialCode: record.officialCode, title: displayTitle(record),
    subject: record.subject as Standard["subject"], grade: record.grade, domain: record.domain, cluster: record.cluster,
    framework: "California", summary: record.wording, wording: record.wording, source: record.source,
    skills: enriched?.skills || [], prerequisites: enriched?.prerequisites || [], next: enriched?.next || [],
    vocabulary: enriched?.vocabulary || [], misconception: enriched?.misconception || "Use the student’s written reasoning to identify the step that needs support.",
    example: enriched?.example || "Choose a task that directly demonstrates this standard.", dok: enriched?.dok || 2};
});

/**
 * Whether this grade and subject ship with the app, carrying official wording,
 * rather than being fetched with AI on first use. Screens use it to decide
 * whether to show the "check this against the official document" caution --
 * which is true of an AI lookup and misleading about a built-in catalog.
 */
export function isBuiltInCatalog(framework: string, grade: number, subject?: string) {
  return californiaStandards.some(
    (s) =>
      s.framework === framework &&
      s.grade === grade &&
      (!subject || s.subject === subject),
  );
}

export function allStandards(
  w: Pick<Workspace, "customStandards" | "sharedStandards">,
) {
  // A teacher's own copy of a standard (added by hand, or fetched before it
  // was shared) always wins over the shared-library version of the same
  // code, so nothing shows twice.
  const own = new Set(
    w.customStandards.map((s) => `${s.framework}|${s.grade}|${s.code}`),
  );
  const shared = (w.sharedStandards ?? []).filter(
    (s) => !own.has(`${s.framework}|${s.grade}|${s.code}`),
  );
  return [...standards, ...californiaStandards, ...w.customStandards, ...shared];
}

export function catalogFor(w: Pick<Workspace, "customStandards" | "sharedStandards">, grade: number, framework: string, subject?: string) {
  const seen = new Set<string>();
  return allStandards(w).filter(s => {
    if (s.grade !== grade || s.framework !== framework || (subject && subject !== "Mixed" && s.subject !== subject) || seen.has(s.code)) return false;
    seen.add(s.code); return true;
  });
}
