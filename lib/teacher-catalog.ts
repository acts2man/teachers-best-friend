import california from "./california-grade-4.json";
import {standards} from "./teacher-data";
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
};

// Retain familiar CCSS codes for existing lessons; also show CDE's official identifier.
function commonCode(code: string) {
  return standards.find(s => s.subject === "Math" && s.code.replace(/\.[A-Z](?=\.\d+$)/, "") === code)?.code || code;
}

export const californiaStandards: Standard[] = california.map(record => {
  const code = commonCode(record.officialCode);
  const enriched = standards.find(s => s.code === code);
  return {...enriched, code, officialCode: record.officialCode, title: titles[record.officialCode] || record.cluster,
    subject: record.subject as Standard["subject"], grade: record.grade, domain: record.domain, cluster: record.cluster,
    framework: "California", summary: record.wording, wording: record.wording, source: record.source,
    skills: enriched?.skills || [], prerequisites: enriched?.prerequisites || [], next: enriched?.next || [],
    vocabulary: enriched?.vocabulary || [], misconception: enriched?.misconception || "Use the student’s written reasoning to identify the step that needs support.",
    example: enriched?.example || "Choose a task that directly demonstrates this standard.", dok: enriched?.dok || 2};
});

export function allStandards(w: Pick<Workspace, "customStandards">) {
  return [...standards, ...californiaStandards, ...w.customStandards];
}

export function catalogFor(w: Pick<Workspace, "customStandards">, grade: number, framework: string, subject?: string) {
  const seen = new Set<string>();
  return allStandards(w).filter(s => {
    if (s.grade !== grade || s.framework !== framework || (subject && subject !== "Mixed" && s.subject !== subject) || seen.has(s.code)) return false;
    seen.add(s.code); return true;
  });
}
