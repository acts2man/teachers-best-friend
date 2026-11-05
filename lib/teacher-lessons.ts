import type {Standard,Lesson,Resource,LessonFlow,TeachingApproach} from "./teacher-types";
import {gardenPassage} from "./teacher-data";
export type LessonContent=NonNullable<Lesson["custom"]>;
export function hasCuratedLesson(s:Standard){return ["4.OA.A.3","4.NBT.B.5","4.NBT.A.2","4.NBT.B.4","RI.4.2","RL.4.1","RI.4.4"].includes(s.code)}
export function lessonContent(s:Standard):LessonContent {
if(!hasCuratedLesson(s))throw new Error("This standard requires a specific reteach lesson.");
if(s.code==="4.OA.A.3")return {objective:"Students will identify the question, choose and sequence two operations, and explain what the final answer means.",materials:["Mini whiteboards","Two-color pencils","Problem cards"],phases:[{time:"0–2",name:"Activate",text:"Read: There are 6 boxes with 24 pencils each. Ask: Are we finding groups, a total, or a difference? Estimate the total before calculating."},{time:"2–5",name:"Model",text:"Add: Students use 38 pencils. Think aloud: First find the total, 6 × 24 = 144. Then find what remains, 144 − 38 = 106. Label each result with its meaning. Model a bar diagram and cross out irrelevant information."},{time:"5–9",name:"Guide",text:"Solve together: A teacher has 5 packs of 16 markers and gives away 27. Ask students to name each step before computing. Expected: 80 − 27 = 53 markers."},{time:"9–12",name:"Try independently",text:"Students solve the first two practice tasks. Before calculating, have them underline the question, circle useful numbers, and write their operation plan."},{time:"12–15",name:"Check & respond",text:"Use the two-question exit ticket. If the operation plan is wrong, repeat a number-free story. If the plan is right but arithmetic is wrong, provide separate calculation support."}],practice:[{q:"4 packs contain 12 pencils each. You use 9 pencils. How many remain? Write a two-step plan.",a:"4 × 12 = 48; 48 − 9 = 39 pencils."},{q:"A library buys 6 boxes of 18 books and lends 35 books. How many of the new books are left?",a:"6 × 18 = 108; 108 − 35 = 73 books."},{q:"There are 73 children. Each table seats 8. How many tables are needed? Explain.",a:"10 tables. Nine tables seat 72; one more is needed."},{q:"A club earns $144, spends $36, and divides the remainder equally among 6 projects. How much does each project receive?",a:"(144 − 36) ÷ 6 = $18."},{q:"Mina says 4 boxes of 18 stickers, with 25 stickers given away, leaves 97 stickers. Explain and correct her error.",a:"She added 25 instead of subtracting. 4 × 18 − 25 = 47 stickers."}],exit:[{q:"3 boxes contain 24 crayons each. You give away 17. How many are left? Show your plan.",a:"3 × 24 − 17 = 55 crayons."},{q:"41 children need cars that seat 6 children each. How many cars are needed, and why?",a:"7 cars: six cars seat 36, leaving five children who need another car."}]};
if(s.code==="4.NBT.B.5")return {objective:"Students will decompose a factor, calculate partial products, and combine them without losing regrouped tens.",materials:["Base-ten blocks","Grid paper","Two-color pencils"],phases:[{time:"0–2",name:"Activate",text:"Show 23 × 4. Ask for an estimate. If 20 × 4 is 80, should the product be greater or less than 80?"},{time:"2–5",name:"Model",text:"Partition 23 into 20 + 3. Draw an area model: 20 × 4 = 80 and 3 × 4 = 12. Combine 80 + 12 = 92. Exchange 10 ones for one ten and connect the exchange to the written calculation."},{time:"5–9",name:"Guide",text:"Solve 32 × 6 = 192 and 47 × 5 = 235 together. Ask: Where do the extra tens come from? Have every student explain one partial product."},{time:"9–12",name:"Try independently",text:"Students solve 43 × 6 and 127 × 4. Inspect the intermediate products. Separate fact errors from regrouping errors."},{time:"12–15",name:"Check & respond",text:"Give the exit ticket. Look for a correct model, correct partial products, and a reasonable final total. Ask a student to explain any discrepancy."}],practice:[{q:"Solve 23 × 4 using partial products.",a:"80 + 12 = 92."},{q:"Solve 43 × 6. Label the tens and ones products.",a:"240 + 18 = 258."},{q:"Solve 127 × 4 using three partial products.",a:"400 + 80 + 28 = 508."},{q:"7 trays hold 34 seedlings each. How many seedlings are there?",a:"7 × 34 = 238 seedlings."},{q:"A student writes 34 × 7 = 218. The partial products are 210 and 28. Explain the correction.",a:"210 + 28 = 238; combine all 28 ones, including the two tens."}],exit:[{q:"Solve 26 × 4. Show both partial products.",a:"80 + 24 = 104."},{q:"Explain why 38 × 3 is 114, not 94.",a:"90 + 24 = 114; the 24 ones include two tens."}]};
if(s.code==="RI.4.2")return {objective:"Students will distinguish a passage-wide main idea from a single detail and support it with evidence.",materials:["The school garden passage","Three-column organizer","Sentence strips"],phases:[{time:"0–2",name:"Activate",text:"Read the school garden passage aloud. Ask: What is the topic? Explain that a topic names the subject; a main idea tells what the author wants us to understand about it."},{time:"2–5",name:"Model",text:"Compare ‘Students measure plants’ with ‘The garden supports learning and community.’ Think aloud about which statement explains the entire passage. Connect science learning, math learning, and family participation to that idea."},{time:"5–9",name:"Guide",text:"Students sort details under two headings: learning and community. Ask how both categories connect to one main idea. Reject statements that describe only one sentence."},{time:"9–12",name:"Try independently",text:"Students write one main-idea sentence and select two supporting details. A partner checks that the details come from different parts of the passage."},{time:"12–15",name:"Check & respond",text:"Give the original river passage below as an exit ticket. Check that the response covers the whole passage and links two relevant details. Accept different wording supported by the text."}],practice:[{q:"Read: "+gardenPassage+"\nWhat is the topic?",a:"The school garden."},{q:"Which is the better main idea: A) Students measure plants. B) The garden supports learning and community. Why?",a:"B, because it connects activities throughout the passage; A is only one detail."},{q:"Find one detail about learning and one about community.",a:"Learning: students explore area. Community: families share recipes."},{q:"Write a two-sentence summary without adding an opinion.",a:"The garden helps students learn science and math. It also brings families together through shared recipes and harvest activities."},{q:"Why would ‘Vegetables taste good’ be a weak main idea for this passage?",a:"The passage does not develop that idea; most details concern learning and community."}],exit:[{q:"Read: Volunteers cleaned the riverbank, planted native trees, and built signs reminding visitors to protect wildlife. A month later, less litter lay on the path and birds nested in the new trees. What is the main idea?",a:"The volunteers' work helped improve and protect the river environment."},{q:"Identify two details supporting your main idea.",a:"There was less litter after cleanup; birds nested in the newly planted trees."}]};
if(s.code==="4.NBT.A.2"||s.code==="4.NBT.B.4")return {objective:s.code==="4.NBT.A.2"?"Students will compare whole numbers using the first place where their digits differ.":"Students will regroup across zeros while preserving the value of a whole number.",materials:["Place-value chart","Digit cards","Base-ten drawings"],phases:[{time:"0–2",name:"Activate",text:"Build 4,026 on a place-value chart. Ask students to explain the value of each digit, including zero."},{time:"2–5",name:"Model",text:s.code==="4.NBT.A.2"?"Compare 42,306 and 42,360 from the greatest place. The first difference is the tens place: 0 tens is less than 6 tens.":"Model 4,026 − 1,758. Exchange one thousand for ten hundreds, then regroup as needed. Keep each exchange visible. The result is 2,268."},{time:"5–9",name:"Guide",text:"Use digit cards to make and compare two numbers. Then use the same place-value chart to explain one regrouping exchange."},{time:"9–12",name:"Try independently",text:"Students solve the practice tasks and annotate the place that determines each decision."},{time:"12–15",name:"Check & respond",text:"Ask students to explain a comparison and verify a subtraction using addition. Reteach the exchange if the value of the number changes."}],practice:[{q:"Write 42,306 in expanded form.",a:"40,000 + 2,000 + 300 + 6."},{q:"Compare 42,306 and 42,360. Explain.",a:"42,306 < 42,360; the first unequal place is the tens."},{q:"Calculate 4,026 − 1,758.",a:"2,268."},{q:"Calculate 6,002 − 2,487.",a:"3,515."},{q:"Check 2,268 + 1,758. What does the result tell you?",a:"4,026; it confirms the subtraction."}],exit:[{q:"Compare 53,209 and 53,290.",a:"53,209 < 53,290."},{q:"Find 3,004 − 1,576 and check.",a:"1,428; 1,428 + 1,576 = 3,004."}]};
return {objective:"Students will "+s.skills.slice(0,2).join(" and ").toLowerCase()+", then support their response with a specific clue.",materials:["Short original passage","Highlighters","Response cards"],phases:[{time:"0–2",name:"Activate",text:"Read: Maya noticed the dry soil. She hurried home and returned with a watering can. Ask students to name what the text explicitly tells us."},{time:"2–5",name:"Model",text:s.code==="RI.4.4"?"Read: The class wanted to conserve water, so they collected rain in barrels instead of running the tap. Model substituting ‘save’ for ‘conserve’ and checking the meaning.":"Model an inference: Maya wants to care for the plants. Link it to the dry soil and her return with water. Separate a supported inference from a guess."},{time:"5–9",name:"Guide",text:"Students underline a clue, explain what it suggests, and check whether another part of the text supports their thinking."},{time:"9–12",name:"Try independently",text:"Use the practice passage. Ask for a response and the exact phrase that supports it."},{time:"12–15",name:"Check & respond",text:"Use the exit ticket. Check both the answer and its supporting evidence. Invite a second interpretation if it is justified by the text."}],practice:[{q:"Maya noticed the dry soil. She hurried home and returned with a watering can. What did Maya notice?",a:"The soil was dry."},{q:"Why did she probably return? Cite a clue.",a:"To water the plants; she returned with a watering can after noticing dry soil."},{q:"The class wanted to conserve water, so they collected rain instead of running the tap. What does conserve mean?",a:"Save or avoid wasting; collecting rain instead of running the tap is the clue."},{q:"Leo carried the heavy box slowly, pausing twice to rest. What suggests the task was difficult?",a:"The box was heavy, and he paused twice to rest."},{q:"Could we conclude that Leo dislikes helping? Explain.",a:"No. The passage shows difficulty, not how he feels about helping."}],exit:[{q:"Ana shielded the fragile glass from a falling book. What does fragile mean? Identify a clue.",a:"Easily broken; Ana protects the glass from a falling object."},{q:"What can you infer about Ana's action?",a:"She wanted to prevent the glass from breaking; shielding it is the evidence."}]};
}
export const adaptations:Record<string,string>={Visual:"Make the thinking visible. Use a two-color model, highlight relevant information, and connect each visual part to a written explanation.",Kinesthetic:"Move the ideas into your hands. Use manipulatives or sentence cards, have students arrange the steps, and ask them to explain each move.",Auditory:"Say the thinking out loud. Model a short think-aloud, invite partner explanations, and ask ‘How do you know?’ before writing."};
export function resourceCatalog():Resource[]{return [
{id:"r1",title:"Make the invisible thinking visible",category:"Watch",standard:"4.NBT.B.5",content:"Explore the interactive area model. Change the factors to see how tens and ones create partial products. Ask students to predict the total before revealing it."},
{id:"r2",title:"The two-step problem-solving routine",category:"Teach",standard:"4.OA.A.3",content:"1. Read the whole problem.\n2. Underline the question.\n3. Identify quantities and their meaning.\n4. Write a plan with two operations.\n5. Calculate and label the answer.\n6. Estimate to check.\n\nTry: Six boxes contain 24 pencils each. After 38 are used, how many remain?\nTeacher key: 6 × 24 − 38 = 106."},
{id:"r3",title:"Partial products, one step at a time",category:"Practice",standard:"4.NBT.B.5",content:"Draw an area model and label each part.\n\n1. 23 × 4\n2. 43 × 6\n3. 127 × 4\n4. 7 trays hold 34 plants each. How many plants?\n5. Explain why 34 × 7 = 238.\n\nTeacher key: 92; 258; 508; 238; 210 + 28 = 238."},
{id:"r4",title:"Build it. Break it. Multiply it.",category:"Manipulative",standard:"4.NBT.B.5",content:"Materials: base-ten blocks or paper rectangles.\nBuild 23 using two tens and three ones. Make four identical groups. Combine the tens (80) and ones (12). Trade ten ones for a ten. Count 92.\nRepeat with 32 × 3 = 96. Ask: What stayed the same when we traded?"}, 
{id:"r5",title:"Main idea detective",category:"Game",standard:"RI.4.2",content:"Read the school garden passage with a partner.\n\n"+gardenPassage+"\n\nWrite the main idea on one card and three supporting details on other cards. Add one unrelated detail. Shuffle and sort. Earn one point for a supported idea and one for explaining why the unrelated card does not fit.\nTeacher key: The garden supports learning and community."},
{id:"r6",title:"A fresh start with place value",category:"Intervention",standard:"4.NBT.A.2",content:"Start with two-digit numbers. Build 42 and 24 using tens and ones. Compare the tens before comparing the ones. Move to 402 and 420. Ask: What does the zero tell us?\nCheck: Compare 3,042 and 3,402.\nTeacher key: 3,042 < 3,402 because 0 hundreds < 4 hundreds."},
{id:"r7",title:"One problem. Two ways.",category:"Enrichment",standard:"4.OA.A.3",content:"Design two different multi-step stories with the same answer, 48. Use multiplication and subtraction in one story, and addition and division in the other. Write equations, solve them, and explain why both answers are reasonable.\nTeacher examples: 5 × 12 − 12 = 48; (72 + 24) ÷ 2 = 48."}
];}

/**
 * Who an exit check is recorded for (review of #198): the lesson's students,
 * or -- for a whole-class lesson, which saves with none picked -- every
 * student in the lesson's class, by name. A whole-class lesson used to open
 * an empty list, so its exit ticket could not be recorded at all.
 */
export function exitCheckStudents<S extends { id: string; classId: string; name: string }>(
  lesson: { studentIds: string[]; classId: string },
  students: S[],
): S[] {
  if (lesson.studentIds.length)
    return lesson.studentIds.map((id) => students.find((s) => s.id === id)).filter((s): s is S => !!s);
  return students
    .filter((s) => s.classId === lesson.classId)
    .sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: "base" }));
}

/** The three teaching approaches, in the order the builder shows them. */
export const TEACHING_APPROACHES = ["Visual", "Kinesthetic", "Auditory"] as const satisfies readonly TeachingApproach[];
export const approachLabel = (a: string) => (a === "Kinesthetic" ? "Hands-on" : a);

/** The lesson flow in one approach: its own version, or -- a lesson from
 * before versions, or a version that did not come back -- the lesson's one
 * flow. */
export function flowFor(content: LessonContent, approach: string): LessonFlow {
  return content.flows?.[approach as TeachingApproach] ?? { materials: content.materials, phases: content.phases };
}

/** Whether a lesson has its own version of the flow for an approach. */
export function hasFlow(content: LessonContent, approach: string): boolean {
  return !!content.flows?.[approach as TeachingApproach];
}

/** The lesson with one approach's flow replaced (editing that version). A
 * lesson without versions keeps its one flow in materials/phases. */
export function withFlow(content: LessonContent, approach: string, flow: LessonFlow): LessonContent {
  if (!content.flows) return { ...content, ...flow };
  return { ...content, flows: { ...content.flows, [approach]: flow } };
}

/**
 * One generate's three answers put together (Ricky, 27 Oct 2026): the full
 * lesson written in `base` (its flow, plus the one set of practice, exit
 * ticket, game and task) and the other approaches' flows. A flow that did not
 * come back (null) is left out; the builder says so.
 */
export function assembleLesson(
  full: LessonContent,
  base: TeachingApproach,
  others: [TeachingApproach, LessonFlow | null][],
): LessonContent {
  const flows: Partial<Record<TeachingApproach, LessonFlow>> = {
    [base]: { materials: full.materials, phases: full.phases },
  };
  for (const [approach, flow] of others) if (flow) flows[approach] = flow;
  return { ...full, flows };
}

/** A section's questions, then its answer key: what the teacher prints. */
function questionsThenKey(title: string, items: { q: string; a: string }[]): string {
  return (
    title.toUpperCase() +
    "\n" +
    items.map((q, i) => i + 1 + ". " + q.q).join("\n\n") +
    "\n\nANSWER KEY · " +
    title.toUpperCase() +
    "\n" +
    items.map((q, i) => i + 1 + ". " + q.a).join("\n")
  );
}

/**
 * The whole lesson as printed: the flow in the approach on screen, then the
 * targeted practice and its answer key, the exit ticket and its answer key,
 * Game-Based Learning and the Performance Task -- Ricky's order (27 Oct). Pure.
 */
export function lessonPrintText(
  content: LessonContent,
  o: { code: string; duration: string; approach: string; adaptation: string; notes: string; phaseTime: (i: number) => string },
): string {
  const flow = flowFor(content, o.approach);
  const g = content.game;
  const t = content.performanceTask;
  return (
    o.code +
    " · " +
    o.duration +
    " minutes · " +
    approachLabel(o.approach) +
    "\n\nGOAL\n" +
    content.objective +
    "\n\nMATERIALS\n" +
    flow.materials.join(", ") +
    "\n\n" +
    flow.phases.map((p, i) => o.phaseTime(i) + " MIN · " + p.name.toUpperCase() + "\n" + p.text).join("\n\n") +
    "\n\n" +
    approachLabel(o.approach).toUpperCase() +
    " APPROACH\n" +
    o.adaptation +
    "\n\n" +
    questionsThenKey("Targeted practice", content.practice) +
    "\n\n" +
    questionsThenKey("Exit ticket", content.exit) +
    (g
      ? "\n\nGAME-BASED LEARNING · " +
        g.title +
        "\n" +
        (g.materials.length ? "Materials: " + g.materials.join(", ") + "\n" : "") +
        g.steps.map((s, i) => i + 1 + ". " + s).join("\n") +
        "\nHow it practises the standard: " +
        g.connection
      : "") +
    (t
      ? "\n\nPERFORMANCE TASK · " +
        t.title +
        " · " +
        t.minutes +
        " minutes · " +
        t.groupSize +
        "\n" +
        t.scenario +
        "\n" +
        t.steps.map((s, i) => i + 1 + ". " + s).join("\n") +
        "\nSuccess looks like:\n" +
        t.success.map((s) => "- " + s).join("\n")
      : "") +
    "\n\nTEACHER NOTES\n" +
    o.notes
  );
}

/** Targeted practice alone, as printed: the questions, then -- with the key
 * switched on -- the answer key after them. */
export function practicePrintText(content: LessonContent, withKey: boolean): string {
  return withKey
    ? questionsThenKey("Targeted practice", content.practice)
    : content.practice.map((q, i) => i + 1 + ". " + q.q).join("\n\n");
}

/**
 * What one Generate's three requests came back as (review of #199): the
 * lesson to show, if anything did, and which versions are missing. If any of
 * the three failed, the Generate's one credit is asked back
 * (lib/lesson-billing.ts).
 */
export function generateOutcome(
  chosen: TeachingApproach,
  full: LessonContent | null,
  others: [TeachingApproach, LessonFlow | null][],
): { lesson: LessonContent | null; missing: TeachingApproach[]; fullMissing: boolean } {
  const missing = [...(full ? [] : [chosen]), ...others.filter(([, f]) => !f).map(([a]) => a)];
  if (full) return { lesson: assembleLesson(full, chosen, others), missing, fullMissing: false };
  // The full lesson did not come back: show the flows that did, so nothing
  // already written is lost. The practice and exit ticket can then be filled
  // with "Add question", or by generating again.
  const came = others.filter((o): o is [TeachingApproach, LessonFlow] => !!o[1]);
  if (!came.length) return { lesson: null, missing, fullMissing: true };
  const flows: Partial<Record<TeachingApproach, LessonFlow>> = {};
  for (const [a, f] of came) flows[a] = f;
  const [, first] = came[0];
  return {
    lesson: { objective: "", materials: first.materials, phases: first.phases, practice: [], exit: [], flows },
    missing,
    fullMissing: true,
  };
}

const listOf = (names: string[]) =>
  names.length <= 1 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];

/**
 * The message after a Generate: what came back, and whether the credit was
 * given back (`refunded`: null when nothing failed, so nothing was asked).
 */
export function generateMessage(
  o: { lesson: LessonContent | null; missing: TeachingApproach[]; fullMissing: boolean },
  refunded: boolean | null,
): string {
  if (!o.missing.length)
    return "Your lesson plan is ready in Visual, Hands-on and Auditory. Review it, edit anything, then save it.";
  // The full lesson failing released its own credit when it failed: nothing
  // was charged, whatever else happened (review of #199). Only a version
  // missing beside a delivered lesson asks for the credit back.
  const credit = o.fullMissing
    ? " Nothing was charged."
    : refunded === null
      ? ""
      : refunded
        ? " You weren’t charged for this Generate."
        : " The credit couldn’t be given back automatically — contact support and we will.";
  const missing = o.missing.map(approachLabel);
  if (!o.lesson) return "The lesson couldn’t be created: none of the three versions came back." + credit + " Try again in a moment.";
  if (o.fullMissing)
    return (
      "The " + listOf(missing) + (missing.length === 1 ? " version" : " versions") +
      " didn’t come back, and the practice and exit ticket come with the first one — they are empty below. Use Add question, or generate again." + credit
    );
  return (
    "Your lesson plan is ready, but the " + listOf(missing) + (missing.length === 1 ? " version didn’t" : " versions didn’t") +
    " come back." + credit + " Generate again to try once more."
  );
}
