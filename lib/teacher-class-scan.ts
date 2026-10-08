import type { AnswerRegion, Assessment, Student, StudentResponse } from "./teacher-types";
import {
  mergeStudentResponses,
  normalizeRecognizedResponses,
} from "./teacher-workflow";
import { classroomColors } from "./teacher-data";
import { ensureDistinctNames, isNameSuffix } from "./teacher-classes";

/** One question's graded response as read off a scanned page, before it is
 * attached to a resolved student. Mirrors the "responses" AI mode's shape: the
 * transcribed answer and one verdict, no AI-guessed partial score. */
export type ScannedResponse = {
  questionId: string;
  answer: string;
  verdict: "match" | "blank" | "other";
  finalAnswer?: string;
  answerRegion?: AnswerRegion | null;
  suggestedErrorType?: string;
};

/** Where on the name-area image the name was written, as fractions of its
 * width and height. Absent when no name was read. */
export type NameBox = { x: number; y: number; width: number; height: number };

/** A name read off the top part of one page. */
export type PageName = {
  page: number;
  name: string;
  confidence: number;
  box?: NameBox | null;
};

/** Grading for one group, keyed by the group number the app supplied. */
export type GradedGroup = { group: number; responses: ScannedResponse[] };

/** One group of pages belonging to the same student. */
export type ScannedGroup = {
  pageIndexes: number[];
  detectedName: string;
  confidence: number;
  responses: ScannedResponse[];
};

/**
 * Splits a scanned stack into one group per student, using only the names read
 * off the top of each page.
 *
 * A page with a name starts a student. Pages after it with no name are that
 * student's continuation sheets -- which is what a blank name line means on a
 * multi-page worksheet. Pages before any name at all (a stray back side on top
 * of the pile) become their own group rather than being dropped, so nothing a
 * teacher scanned disappears silently.
 *
 * This is what lets grading happen without a name: the grouping is settled
 * here, from the strips, and the graded request is told the groups.
 */
export function groupPagesByName(pages: PageName[]): number[][] {
  const groups: number[][] = [];
  for (const page of pages) {
    if (page.name.trim() || !groups.length) groups.push([page.page]);
    else groups[groups.length - 1].push(page.page);
  }
  return groups;
}

/**
 * Splits a stack into one group per student using boundaries the teacher
 * declared while scanning -- "next student" -- rather than names the AI read.
 * `sizes[i]` is how many pages the teacher put in student i's pile, in scan
 * order, so the pages are numbered straight through the flattened stack.
 *
 * Preferred over groupPagesByName wherever the teacher scanned student by
 * student. A boundary the teacher drew is a fact; a boundary inferred from
 * whether a name was legible on a page is a guess, and when that guess is
 * wrong a page is graded against the wrong student's key. Empty piles are
 * skipped so a stray "next student" tap costs nothing.
 */
export function groupPagesByCapture(sizes: number[]): number[][] {
  const groups: number[][] = [];
  let page = 0;
  for (const size of sizes) {
    if (!Number.isInteger(size) || size <= 0) continue;
    groups.push(Array.from({ length: size }, () => page++));
  }
  return groups;
}

/** A scanned group after resolving it against the current roster, ready for
 * the teacher to confirm or correct before anything is saved. */
export type ResolvedGroup = ScannedGroup & {
  key: string;
  studentId: string | null;
  name: string;
  pageUploadIds: string[];
  /**
   * The students this paper could belong to, when the roster cannot narrow it
   * to one. Empty otherwise. A row with candidates has `studentId: null` on
   * purpose -- nothing is chosen for the teacher, because choosing wrongly
   * here puts a child's grades on another child.
   */
  candidateIds: string[];
  /**
   * How sure the app is that this paper is `studentId`'s (or, on an open
   * question, the best guess's), 0-100. It combines how confidently the name
   * was read with how closely it fits the roster name, so a clean read of an
   * exact name is high and a shaky read of a nickname is low. Shown to the
   * teacher as "match confidence".
   */
  matchConfidence: number;
  /**
   * The student the app would pick if it had to, on a row it is not sure
   * enough to pick for the teacher. Shown as "best guess", one tap to accept,
   * never preselected.
   */
  suggestedId: string | null;
  /** The name-area upload the name was read from, and where on it the name
   * sits, so the matching screen can show the teacher the handwriting. */
  nameUploadId: string | null;
  nameBox: NameBox | null;
};

/**
 * A name reduced to what two people can be compared on.
 *
 * Accents are folded rather than deleted. The old version dropped every
 * character outside a-z, so "María González" became "mara gonzlez" and matched
 * nobody -- a child whose name is spelled correctly on the roster was the one
 * the scanner could not find. NFD splits the letter from its accent and only
 * the accent is removed.
 *
 * Digits and punctuation still go: "Maria G." and "Maria G" are one name, and
 * a page number written next to a name is not part of it.
 */
function normalizeName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The given name and the family name, normalized, suffixes dropped. */
type NameParts = { first: string; last: string };

function nameParts(name: string): NameParts | null {
  const key = normalizeName(name);
  if (!key) return null;
  const tokens = key.split(" ").filter(Boolean);
  let end = tokens.length - 1;
  while (end > 0 && isNameSuffix(tokens[end])) end -= 1;
  // Middle names are not part of the comparison, for the same reason the
  // shortener ignores them: the roster holds "Maria G.", not "Maria Elena G."
  return { first: tokens[0], last: end > 0 ? tokens[end] : "" };
}

const partsKey = (p: NameParts) => (p.last ? p.first + " " + p.last : p.first);

/**
 * Whether two family names can be the same one, written to different lengths.
 *
 * The roster stores an abbreviation the app itself chose -- "Ga.", "Go.",
 * "Gu." -- and the page carries whatever the child wrote. Neither is wrong, so
 * the shorter one has to be a prefix of the longer: "Go" fits Gonzalez, "Ga"
 * does not, and a bare "G" fits all of them.
 *
 * This is the whole fix. The old rule compared only the FIRST LETTER of the
 * surname, so Gonzalez, Garcia and Guzman were indistinguishable, and it then
 * returned whichever of them had been added to the class first.
 */
function surnamesFit(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a.length <= b.length ? b.startsWith(a) : a.startsWith(b);
}

/**
 * Given names that are the same person. A child writes "Mike" on a test and is
 * "Michael" on the roster; "Lupe" is "Guadalupe". Each row is one family of
 * names; any two names in a row are treated as the same given name. Kept short
 * and common on purpose -- a wrong entry here would make two different children
 * look like one.
 */
const NICKNAMES: string[][] = [
  ["michael", "mike", "mikey", "micheal", "miguel"],
  ["alexander", "alex", "xander", "alejandro", "alexandra", "alexa", "alejandra", "sasha"],
  ["christopher", "chris", "topher", "cristopher", "cristian", "christian"],
  ["christina", "christine", "tina", "chrissy", "cristina"],
  ["daniel", "dan", "danny"],
  ["daniela", "daniella", "dani"],
  ["david", "dave", "davey"],
  ["anthony", "tony", "antonio", "tono"],
  ["joseph", "joe", "joey", "jose", "pepe"],
  ["joshua", "josh"],
  ["matthew", "matt", "matty", "mateo"],
  ["nicholas", "nick", "nicky", "nico", "nicolas"],
  ["samuel", "sam", "sammy"],
  ["samantha", "sam", "sammy"],
  ["benjamin", "ben", "benny", "benji"],
  ["william", "will", "willy", "bill", "billy", "liam", "guillermo", "memo"],
  ["elizabeth", "liz", "lizzy", "beth", "betsy", "eliza", "lisa"],
  ["katherine", "catherine", "kathryn", "kate", "katie", "kat", "cathy", "kathy"],
  ["jennifer", "jen", "jenny"],
  ["jessica", "jess", "jessie"],
  ["abigail", "abby", "abbie"],
  ["gabriel", "gabe", "gabi"],
  ["gabriela", "gabriella", "gabby", "gabi"],
  ["isabella", "isabel", "izzy", "bella", "isa"],
  ["maximilian", "maximus", "maxwell", "max"],
  ["zachary", "zach", "zack"],
  ["jacob", "jake"],
  ["andrew", "andy", "drew", "andres"],
  ["thomas", "tom", "tommy", "tomas"],
  ["james", "jim", "jimmy", "jamie", "diego"],
  ["robert", "rob", "robbie", "bob", "bobby", "roberto", "beto"],
  ["richard", "rick", "ricky", "rich", "ricardo"],
  ["manuel", "manny", "manolo"],
  ["guadalupe", "lupe", "lupita"],
  ["ignacio", "nacho"],
  ["francisco", "frank", "frankie", "paco", "pancho", "cisco"],
  ["edward", "ed", "eddie", "eduardo", "lalo"],
  ["jesus", "chuy"],
  ["alberto", "beto", "al"],
  ["jonathan", "jon", "jonny", "johnny", "john"],
  ["steven", "stephen", "steve", "esteban"],
  ["victoria", "vicky", "tori"],
  ["rebecca", "becca", "becky"],
  ["margaret", "maggie", "meg", "peggy"],
  ["madison", "maddie", "maddy"],
  ["madeline", "madeleine", "maddie", "maddy"],
  ["natalie", "nat", "natalia"],
  ["olivia", "liv", "livvy"],
  ["sophia", "sofia", "sophie"],
  ["emily", "em", "emmy"],
  ["emma", "em", "emmy"],
  ["ashley", "ash"],
  ["jacqueline", "jackie"],
  ["jackson", "jack", "jax"],
  ["timothy", "tim", "timmy"],
  ["kenneth", "ken", "kenny"],
  ["patrick", "pat"],
  ["patricia", "pat", "patty", "tricia"],
  ["dominic", "dom"],
  ["nathaniel", "nathan", "nate"],
  ["leonardo", "leo"],
  ["elijah", "eli"],
  ["josephine", "josie", "jo"],
  ["valentina", "vale", "val"],
  ["fernando", "nando"],
  ["alejandro", "ale"],
];

/** Whether two given names are written forms of the same name. */
function sameGivenName(a: string, b: string): boolean {
  if (a === b) return true;
  return NICKNAMES.some((family) => family.includes(a) && family.includes(b));
}

/**
 * Jaro-Winkler similarity, 0..1. The standard measure for short names: it
 * forgives a swapped or dropped letter ("Micheal", "Jaden"/"Jayden") and rewards
 * a shared start, which is where handwriting is usually clearest.
 */
export function nameSimilarity(a: string, b: string): number {
  if (a === b) return a ? 1 : 0;
  if (!a || !b) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aHit = new Array(a.length).fill(false);
  const bHit = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(b.length - 1, i + range);
    for (let j = lo; j <= hi; j++) {
      if (bHit[j] || a[i] !== b[j]) continue;
      aHit[i] = bHit[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aHit[i]) continue;
    while (!bHit[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix])
    prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** How well a written given name fits a roster given name, 0..1. */
function givenFit(written: string, roster: string): number {
  if (sameGivenName(written, roster)) return written === roster ? 1 : 0.92;
  return nameSimilarity(written, roster);
}

/** How well a written family name fits a roster family name, 0..1. The roster
 * often stores only an abbreviation ("Go."), so a prefix fit is a full fit. */
function surnameFit(written: string, roster: string): number {
  if (surnamesFit(written, roster)) return 1;
  // Compare against no more of the written name than the roster holds, plus a
  // letter, so "Gonzales" against a stored "Gonz" is judged on "gonza".
  const cut = roster.length < written.length ? written.slice(0, roster.length + 1) : written;
  return nameSimilarity(cut, roster);
}

/**
 * How well a name read off a page fits one roster name, 0..1. 1 is the same
 * name; a nickname, a small misspelling or a missing surname scores a little
 * lower; a different person scores well under FUZZY_FLOOR.
 */
export function rosterFit(written: string, roster: string): number {
  const w = nameParts(written);
  const r = nameParts(roster);
  if (!w || !r) return 0;
  if (partsKey(w) === partsKey(r)) return 1;
  const direct = (() => {
    const first = givenFit(w.first, r.first);
    // A first name on its own fits every namesake equally, a little short of
    // a full match so a full name on the paper always wins over it.
    if (!w.last || !r.last) return first * 0.9;
    return first * 0.6 + surnameFit(w.last, r.last) * 0.4;
  })();
  // Written family name first ("Gonzalez Maria"), or a lone surname ("Gonzalez").
  const reversed = (() => {
    if (!r.last) return 0;
    if (!w.last) return surnameFit(w.first, r.last) >= 0.95 && r.last.length > 2 ? 0.8 : 0;
    return (givenFit(w.last, r.first) * 0.6 + surnameFit(w.first, r.last) * 0.4) * 0.95;
  })();
  return Math.max(direct, reversed);
}

/** Below this a roster name is not offered at all. Set so that a shared first
 * name with a plainly different surname ("Maria Fernandez" against "Maria
 * Ga.") stays unmatched. */
const FUZZY_FLOOR = 0.8;
/** How far ahead of the next roster name a fuzzy best guess must be before the
 * app picks it for the teacher. Closer than this and the teacher is asked. */
const FUZZY_LEAD = 0.06;

/**
 * What the roster can tell us about a name read off a page.
 *
 * Three answers, and the middle one is the reason this exists:
 *   - `{ student }`  exactly one student on the roster can be this person
 *   - `{ candidates }`  several can, and only the teacher can say which
 *   - `{}`  nobody on the roster fits
 *
 * It used to return a student in all three cases. A name it could not resolve
 * came back as `students.find(...)` -- the first student in roster order who
 * shared a first name and a last initial -- and the review list then showed
 * that as a confident match, already selected, next to a stack of graded
 * pages. Maria Gonzalez's and Maria Guzman's tests both landed on Maria
 * Garcia, and nothing on the screen said a choice had been made at all.
 *
 * An ambiguous answer is not a failure of the matcher. It is the matcher
 * telling the truth about a class that contains two children it cannot tell
 * apart from what is written on the paper.
 *
 * When nothing fits exactly, the name is matched loosely (October, after
 * Michael's class sets): a nickname, a first name alone, or a misspelling
 * ("Micheal", "Gonzales") still finds the student, with a `score` below 1 that
 * the matching screen shows as lower match confidence. Candidates come back
 * best first.
 */
export type RosterMatch = {
  student?: Student;
  candidates?: Student[];
  /** How well the name fits `student` (or the first candidate), 0..1. */
  score?: number;
};

export function matchRosterStudent(
  name: string,
  students: Student[],
): RosterMatch {
  const wanted = nameParts(name);
  if (!wanted) return {};

  const roster = students
    .map((student) => ({ student, parts: nameParts(student.name) }))
    .filter((r): r is { student: Student; parts: NameParts } => r.parts !== null);

  // The name as written is exactly a roster name. Still checked for more than
  // one hit: a class can hold two students stored under the same name, and
  // picking either without asking is the bug this function was rewritten for.
  const key = partsKey(wanted);
  const exact = roster.filter((r) => partsKey(r.parts) === key);
  if (exact.length === 1) return { student: exact[0].student, score: 1 };
  if (exact.length > 1) return { candidates: exact.map((r) => r.student), score: 1 };

  const fits = roster.filter((r) => {
    if (r.parts.first !== wanted.first) return false;
    // A first name on its own -- or a roster entry that is only a first name.
    // It fits every namesake, which is an answer as long as there is one.
    if (!wanted.last || !r.parts.last) return true;
    return surnamesFit(wanted.last, r.parts.last);
  });
  // A surname that fits the stored abbreviation is as good as exact; a first
  // name alone is a little less certain, since a namesake may be absent today.
  const fitScore = wanted.last ? 1 : 0.9;
  if (fits.length === 1) return { student: fits[0].student, score: fitScore };
  if (fits.length > 1)
    return { candidates: fits.map((r) => r.student), score: fitScore };

  // Nothing fits as written: a nickname, a misspelling, a reversed name.
  const scored = roster
    .map((r) => ({ student: r.student, score: rosterFit(name, r.student.name) }))
    .filter((r) => r.score >= FUZZY_FLOOR)
    .sort((x, y) => y.score - x.score);
  if (!scored.length) return {};
  const best = scored[0];
  const close = scored.filter((r) => best.score - r.score < FUZZY_LEAD);
  if (close.length === 1) return { student: best.student, score: best.score };
  return { candidates: close.map((r) => r.student), score: best.score };
}

/**
 * Turns the model's raw page groups into editable review rows: each group is
 * matched against the current roster here, on our side, so the teacher only
 * has to confirm or fix names, never re-enter them from scratch.
 * `pageUploadIds[i]` is the uploaded file id for page `i`, in the order the
 * pages were scanned.
 *
 * Joins the two passes of a scan: `names` come from reading the top part of
 * each page, `graded` from grading the whole pages. The roster is sent to
 * neither -- matching a transcribed name to a student happens only here. See
 * docs/student-data-flow.md section 4. `nameUploadIds[i]` is page `i`'s
 * name-area upload, so the matching screen can show the handwriting.
 *
 * A group with no grading still comes back, empty, so a student whose pages
 * the model skipped appears in the review list for the teacher to notice
 * rather than vanishing from the stack.
 */
export function resolveScannedGroups(
  pageGroups: number[][],
  names: PageName[],
  graded: GradedGroup[],
  pageUploadIds: string[],
  students: Student[],
  nameUploadIds: (string | null)[] = [],
): ResolvedGroup[] {
  const nameOf = new Map(names.map((n) => [n.page, n]));
  const gradedByGroup = new Map(graded.map((g) => [g.group, g.responses]));
  const rows = pageGroups.map((pages, i) => {
    const validPages = [
      ...new Set(
        pages.filter(
          (p) => Number.isInteger(p) && p >= 0 && p < pageUploadIds.length,
        ),
      ),
    ].sort((a, b) => a - b);
    // The name is whichever of this group's pages carried one -- in practice
    // the first, since that is what opened the group.
    const read = validPages.map((p) => nameOf.get(p)).find((n) => n?.name.trim());
    const detectedName = read?.name.trim() ?? "";
    const match = matchRosterStudent(detectedName, students);
    const readConfidence = read?.confidence ?? 0;
    const namePage = read ? read.page : validPages[0];
    return {
      row: {
        pageIndexes: validPages,
        detectedName,
        confidence: readConfidence,
        responses: gradedByGroup.get(i) ?? [],
        pageUploadIds: validPages.map((p) => pageUploadIds[p]),
        key: "group-" + i,
        // Left unset when the roster offers several: an ambiguous paper must
        // reach the teacher as a question, not as an answer they have to notice
        // is wrong.
        studentId: match.student?.id ?? null,
        name: match.student?.name || detectedName || "Student " + (i + 1),
        candidateIds: (match.candidates ?? []).map((c) => c.id),
        matchConfidence: Math.round(readConfidence * (match.score ?? 0)),
        suggestedId: null as string | null,
        nameUploadId: (namePage !== undefined ? nameUploadIds[namePage] : null) ?? null,
        nameBox: read?.box ?? null,
      } satisfies ResolvedGroup,
      exact: match.score === 1 && !!match.student,
    };
  });

  // A best guess for every open question, using what the rest of the stack
  // already settled: a student whose paper was matched exactly elsewhere is
  // unlikely to be this one too. If that leaves one candidate, it is the
  // suggestion -- shown as a guess, never chosen for the teacher.
  const claimed = new Set(rows.filter((r) => r.exact).map((r) => r.row.studentId as string));
  for (const { row } of rows) {
    if (!row.candidateIds.length) continue;
    const open = row.candidateIds.filter((id) => !claimed.has(id));
    row.suggestedId = open.length === 1 ? open[0] : (open[0] ?? row.candidateIds[0]);
    // A guess the rest of the stack could not narrow is a weaker one.
    if (open.length !== 1)
      row.matchConfidence = Math.round(row.matchConfidence / Math.max(2, open.length));
  }
  return rows.map((r) => r.row);
}

/**
 * The students of a class in the order their work was scanned.
 *
 * Teachers grade in the order the papers sit in the pile in front of them, and
 * Michael asked for that order everywhere: the matching screen, the review
 * list and Grade by question. `Assessment.studentOrder` records it as each scan
 * is saved; anyone not in it (entered by hand, or scanned before the order was
 * kept) follows, in the order they were already in.
 */
export function inScanOrder<T extends { id: string }>(
  students: T[],
  a: Pick<Assessment, "studentOrder">,
): T[] {
  const order = a.studentOrder ?? [];
  if (!order.length) return students;
  const at = new Map(order.map((id, i) => [id, i]));
  return students
    .map((s, i) => ({ s, i }))
    .sort((x, y) => {
      const ax = at.get(x.s.id);
      const ay = at.get(y.s.id);
      if (ax !== undefined && ay !== undefined) return ax - ay;
      if (ax !== undefined) return -1;
      if (ay !== undefined) return 1;
      return x.i - y.i;
    })
    .map(({ s }) => s);
}

export type ConfirmedGroup = {
  studentId: string | null;
  name: string;
  pageUploadIds: string[];
  responses: ScannedResponse[];
};

/**
 * Applies teacher-confirmed groups to the workspace: creates a Student
 * record for any group with no matched student, merges each group's graded
 * responses into the assessment (replacing that student's prior responses
 * for this assessment, matching the single-student upload flow), and links
 * the scanned pages. Pure — the caller is responsible for persisting the
 * returned workspace slice.
 */
export function applyScannedGroups(
  a: Assessment,
  students: Student[],
  classId: string,
  groups: ConfirmedGroup[],
) {
  const newStudents: Student[] = [];
  const responsesByStudent = new Map<string, StudentResponse[]>();
  const studentUploadIds: Record<string, string[]> = {};
  let colorOffset = students.length;
  // The review list is matched when the scan finishes and saved when the
  // teacher is ready, which can be a while later and need not be the same tab.
  // A student removed in between leaves a group pointing at somebody who is no
  // longer on the roster, and attaching a child's work to an id nothing renders
  // puts it beyond reach without anything looking wrong. Treat that group as
  // unmatched instead, so the work lands on a real student.
  const onRoster = new Set(students.map((s) => s.id));
  // The other way a class gains two students under one name. matchRosterStudent
  // finds an enrolled student by first name and last initial, so two children
  // saved as "Maria G." make every later scan of this class a coin toss over
  // whose work a page is. A created student is numbered instead.
  const usedNames = students.map((s) => s.name);
  const scanned: string[] = [];
  for (const group of groups) {
    if (!group.pageUploadIds.length || !group.responses.length) continue;
    let studentId =
      group.studentId && onRoster.has(group.studentId) ? group.studentId : null;
    if (!studentId) {
      const [name] = ensureDistinctNames(
        [group.name.trim() || "Unnamed student"],
        usedNames,
      );
      usedNames.push(name);
      const created: Student = {
        id: crypto.randomUUID(),
        classId,
        name,
        color: classroomColors[colorOffset % classroomColors.length],
        evidence: [],
        notes: "",
      };
      colorOffset++;
      newStudents.push(created);
      studentId = created.id;
    }
    // Same rule as the single-student path: a later batch is another page of
    // the same test unless it actually answers the question, so keep what an
    // earlier pass found where this one saw nothing.
    scanned.push(studentId);
    responsesByStudent.set(
      studentId,
      mergeStudentResponses(
        a.responses.filter((r) => r.studentId === studentId),
        normalizeRecognizedResponses(a, studentId, group.responses),
      ),
    );
    studentUploadIds[studentId] = [
      ...new Set([
        ...(a.studentUploadIds?.[studentId] || []),
        ...group.pageUploadIds,
      ]),
    ];
  }
  const touchedIds = new Set(responsesByStudent.keys());
  const responses = [
    ...a.responses.filter((r) => !touchedIds.has(r.studentId)),
    ...[...responsesByStudent.values()].flat(),
  ];
  const pageIds = groups.flatMap((g) => g.pageUploadIds);
  // The order the papers were scanned in. A student already placed by an
  // earlier scan keeps their place; everyone new follows, in this scan's order.
  const studentOrder = [...(a.studentOrder ?? [])];
  for (const id of scanned) if (!studentOrder.includes(id)) studentOrder.push(id);
  const assessment: Assessment = {
    ...a,
    uploadIds: [...new Set([...a.uploadIds, ...pageIds])],
    studentUploadIds: { ...a.studentUploadIds, ...studentUploadIds },
    responses,
    ...(studentOrder.length ? { studentOrder } : {}),
  };
  return {
    students: [...students, ...newStudents],
    assessment,
    newStudents,
    studentCount: touchedIds.size,
  };
}

/**
 * How much room one student's grading needs, and how many students therefore
 * fit in a single request.
 *
 * Measured, not guessed: across the real scans this app has run, grading one
 * student averaged 1,173 output tokens and peaked at 4,933, for ten-question
 * tests -- roughly 120 tokens per answer typically and near 500 when the model
 * writes a long misconception for every question. A whole-class request was
 * capped at 12,000 output tokens, so a stack of twelve students -- one class
 * set, front and back, inside the 24-page limit the UI already allowed --
 * asked for more than the ceiling and came back `incomplete`. The teacher lost
 * the scan and was told only to "try fewer pages".
 *
 * So the app decides how many students fit instead of finding out afterwards.
 * The estimate is deliberately pessimistic, because the cost of overestimating
 * is one extra request and the cost of underestimating is a failed class set.
 */
export const TOKENS_PER_ANSWER = 250;

/** Planning budget, kept well under the stage's real ceiling so a verbose
 * batch has somewhere to go. */
export const BATCH_OUTPUT_BUDGET = 16000;

/**
 * Pages per grading request. The analyze route refuses more than 12 MB of
 * images in one request, and since the 28 Sep decision a class-scan page is
 * graded whole rather than with its top 18% cut off, so each page is bigger
 * than it was. Twelve whole phone photos sit comfortably under the limit.
 */
export const MAX_PAGES_PER_BATCH = 12;

/**
 * Bytes of page images per grading request, under the analyze route's 12 MB
 * refusal with room to spare. Measured 8 Oct on production uploads: whole
 * class-scan pages averaged 383 KB (largest 456 KB); the largest page ever
 * uploaded to a class scan, scaled up to a whole page, is about 834 KB, so
 * twelve of those (9.8 MB) fit -- but a sharper camera or a PDF could tip a
 * batch over, and a refused request costs the teacher the batch. So batches are
 * also filled by size.
 */
export const MAX_BATCH_BYTES = 10 * 1024 * 1024;

/** What a page of unknown size is assumed to weigh: above the largest seen. */
export const ASSUMED_PAGE_BYTES = 900 * 1024;

export function studentsPerBatch(
  questionCount: number,
  budget = BATCH_OUTPUT_BUDGET,
) {
  const perStudent = Math.max(1, questionCount) * TOKENS_PER_ANSWER;
  // At least one student per request even for an enormous test: a single
  // student who does not fit is a different problem, and splitting a student
  // across requests would put half their answers in each.
  return Math.max(1, Math.floor(budget / perStudent) || 1);
}

/** One request's worth of a class scan. `groups` are re-numbered from zero
 * against `uploadIds`, because the model is told about this batch alone and
 * answers in its own numbering. `groupIndexes` maps each back to the group it
 * is in the whole scan. */
export type ScanBatch = {
  uploadIds: string[];
  groups: number[][];
  groupIndexes: number[];
};

/**
 * Splits a class scan into requests that will fit, keeping every student's
 * pages together in one request. A student is never split across two: their
 * answers have to be graded against the whole of their work at once, which is
 * the entire point of grouping pages by student in the first place.
 */
export function planScanBatches(
  pageGroups: number[][],
  pageUploadIds: string[],
  questionCount: number,
  budget = BATCH_OUTPUT_BUDGET,
  maxPages = MAX_PAGES_PER_BATCH,
  pageBytes: (number | undefined)[] = [],
  maxBytes = MAX_BATCH_BYTES,
): ScanBatch[] {
  const perBatch = studentsPerBatch(questionCount, budget);
  const batches: ScanBatch[] = [];
  let current: ScanBatch = { uploadIds: [], groups: [], groupIndexes: [] };
  let currentBytes = 0;
  const flush = () => {
    if (current.uploadIds.length) batches.push(current);
    current = { uploadIds: [], groups: [], groupIndexes: [] };
    currentBytes = 0;
  };
  const weight = (page: number) => {
    const b = pageBytes[page];
    return typeof b === "number" && b > 0 ? b : ASSUMED_PAGE_BYTES;
  };
  pageGroups.forEach((pages, index) => {
    const valid = pages.filter((p) => p >= 0 && p < pageUploadIds.length);
    const bytes = valid.reduce((sum, p) => sum + weight(p), 0);
    // A student never straddles two requests: if this one does not fit beside
    // the students already in the batch, the batch is sent without them.
    if (
      current.groups.length &&
      (current.groups.length >= perBatch ||
        current.uploadIds.length + valid.length > maxPages ||
        currentBytes + bytes > maxBytes)
    )
      flush();
    currentBytes += bytes;
    current.groups.push(
      valid.map((page) => {
        current.uploadIds.push(pageUploadIds[page]);
        return current.uploadIds.length - 1;
      }),
    );
    current.groupIndexes.push(index);
  });
  flush();
  return batches;
}

/**
 * Runs a class scan's batches and puts the answers back into whole-scan
 * numbering.
 *
 * This lives here rather than inside the component because it is where the
 * scan can go quietly wrong. Each request is told about its own handful of
 * students and answers in its own numbering, starting at zero; every batch
 * therefore returns a "group 0", and if those are not mapped back, the whole
 * class collapses onto the first few students -- every child holding somebody
 * else's grades, with nothing on screen to suggest anything went wrong. That is
 * the one failure in this flow that a teacher would not catch.
 *
 * `grade` is the request. Passing it in keeps this function free of the network
 * so the mapping can be tested against a whole simulated class.
 *
 * `onBatch` is called after each one with the answers so far, so a caller can
 * bank progress and resume rather than re-grading what is already done.
 */
/**
 * The reserved pages a class scan never graded, given which groups did grade.
 *
 * A whole stack is reserved (and charged) up front, before the name pass and
 * before any grading, so that a teacher who cannot afford the set is turned
 * away with nothing spent. If the run then dies partway -- the name pass
 * errors, or grading stops at student 18 -- the pages it never graded are still
 * reserved. They fall out of the meter on their own after ~2h, but that is two
 * hours of a teacher seeing scans they did not spend; Ricky's Sept 25 stack
 * left 28+ reservations sitting that whole time. This says exactly which upload
 * ids to hand back so the caller can release them at once.
 *
 * `pageGroups` is null when the run failed before the pages were grouped (the
 * name pass is the usual culprit): nothing graded, so every reserved page is
 * stranded. `gradedGroups` are the group indexes that completed; their pages
 * were confirmed by the analyze route and are deliberately left out -- work
 * that graded stays charged, and release_pages would skip them anyway.
 */
export function ungradedReservations(
  pageGroups: number[][] | null,
  gradedGroups: number[],
  pageUploadIds: string[],
): string[] {
  if (!pageGroups)
    return [...new Set(pageUploadIds.filter((id): id is string => !!id))];
  const done = new Set(gradedGroups);
  const stranded = new Set<string>();
  pageGroups.forEach((pages, group) => {
    if (done.has(group)) return;
    for (const page of pages) {
      const id = pageUploadIds[page];
      if (id) stranded.add(id);
    }
  });
  return [...stranded];
}

export async function gradeInBatches(
  batches: ScanBatch[],
  grade: (batch: ScanBatch, index: number) => Promise<{ groups?: GradedGroup[] }>,
  onBatch?: (graded: GradedGroup[], nextBatch: number) => void,
  startAt = 0,
  already: GradedGroup[] = [],
): Promise<GradedGroup[]> {
  const graded: GradedGroup[] = [...already];
  for (const [index, batch] of batches.entries()) {
    if (index < startAt) continue;
    const result = await grade(batch, index);
    for (const g of result.groups ?? []) {
      const at = batch.groupIndexes[g.group];
      // A group number the batch was never told about is dropped rather than
      // guessed at: attaching it to the wrong student is worse than losing it,
      // because the teacher sees a grade either way.
      if (at !== undefined) graded.push({ ...g, group: at });
    }
    onBatch?.(graded, index + 1);
  }
  return graded;
}
