import type { AnswerRegion, Assessment, Student, StudentResponse } from "./teacher-types";
import {
  mergeStudentResponses,
  normalizeRecognizedResponses,
} from "./teacher-workflow";
import { classroomColors } from "./teacher-data";
import { ensureDistinctNames, isNameSuffix } from "./teacher-classes";
import { expectedParts, partsRead } from "./answer-parts";
import { sameReading } from "./math-answer";

/** One question's graded response as read off a scanned page, before it is
 * attached to a resolved student. Mirrors the "responses" AI mode's shape: the
 * transcribed answer and one verdict, no AI-guessed partial score. */
export type ScannedResponse = {
  questionId: string;
  answer: string;
  verdict: "match" | "blank" | "other" | "unsure";
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
  /** The name read for this page FAILED (a timeout, a rate limit) or the model
   * SKIPPED it -- unknown, which is not the same as a page with no name on it. */
  failed?: boolean;
  /** Set by the server on a page the model left out of its answer. */
  skipped?: boolean;
};

/** Name areas per name-reading request. The name pass returns a few tokens per
 * page, but it still has a ceiling, and it had the same shape of bug the
 * grading pass just had: every page in one request, however many there were.
 * Twelve since each answer also carries where the name sits on the page, which
 * roughly doubles what one page asks the model to write. Shared by the class
 * scan panel and the regression replay, so both batch the name pass the same. */
export const NAME_BATCH = 12;

/** One name-pass request: which pages its strips came from, in the order they
 * were sent. `slice[i]` is the page the strip at request position i was cut
 * from. */
export type NameSlice = { id: string; page: number }[];

/**
 * Splits the pages that have a name strip into name-pass requests: one request
 * per STUDENT when the teacher declared the piles, one per page when they did
 * not.
 *
 * It used to be twelve strips per request, trusting the model to say which
 * image each name came from. It does not reliably (12 Oct 2026, from the saved
 * name-pass results): on a pilot teacher's 3-student set the third student's
 * name came back on the second student's back page and the third student got
 * none; on another set, eight strips came back with every name one position
 * late; and a 26-student set put a classmate's name on another child's paper.
 * Inside one student's pile a misplaced name still lands on that student, so
 * the mistake can no longer cross from one child to another. Without declared
 * piles the name IS what splits the stack, so each page is read on its own.
 * A pile longer than `size` is still split, so no request grows unbounded.
 */
export function planNameBatches(
  stripIds: (string | null)[],
  piles: number[][] | null = null,
  size = NAME_BATCH,
): NameSlice[] {
  const withStrip = (pages: number[]) =>
    pages
      .filter((page) => !!stripIds[page])
      .map((page) => ({ id: stripIds[page] as string, page }));
  const groups = piles ?? stripIds.map((_, page) => [page]);
  const out: NameSlice[] = [];
  for (const pile of groups) {
    const slice = withStrip(pile);
    for (let i = 0; i < slice.length; i += size) out.push(slice.slice(i, i + size));
  }
  return out;
}

/** How many name-pass requests run at once. Per-student requests are small;
 * four at a time keeps a 26-student set about as quick as the old five
 * sequential batches of twelve. */
export const NAME_CONCURRENCY = 4;

/** How long to wait before each retry of a failed name read. */
export const NAME_RETRY_DELAYS_MS = [1500, 4000];

/**
 * Runs `fn`, and on a failure that `retryable` says is worth it, tries again
 * after each of `delays` (with up to a quarter of it added at random, so four
 * requests failing together do not all retry at the same instant). Throws the
 * error when it is not retryable or the tries run out. `onRetry` is told about
 * every failure that is retried, so a retry never hides one from the log.
 *
 * For the per-page name reads (#125 follow-up c): a page whose read fails is
 * left for the teacher to match, one tap each, and a burst of failures -- a
 * rate limit, as on 25 Sep -- cost a whole class set. A name read is free to
 * the teacher (the page ledger never charges name_strip), so a retry costs
 * only a second or two.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  {
    delays = NAME_RETRY_DELAYS_MS,
    retryable = () => true,
    onRetry = () => {},
    wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    random = Math.random,
  }: {
    delays?: number[];
    retryable?: (e: unknown) => boolean;
    onRetry?: (e: unknown, attempt: number) => void;
    wait?: (ms: number) => Promise<void>;
    random?: () => number;
  } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= delays.length || !retryable(e)) throw e;
      onRetry(e, attempt + 1);
      await wait(Math.round(delays[attempt] * (1 + random() / 4)));
    }
  }
}

/**
 * Runs `fn` over `items` with at most `limit` in flight, keeping order. A
 * failed item gives `onError(error, item)`'s value instead of stopping the
 * others -- one of 26 name reads failing should leave that page unnamed for the
 * teacher, not throw away the other 25 -- and when EVERY item fails the first
 * error is thrown, as one request failing used to.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onError?: (error: unknown, item: T) => R,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  const errors: unknown[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i], i);
      } catch (e) {
        if (!onError) {
          next = items.length; // start nothing more
          throw e;
        }
        errors.push(e);
        out[i] = onError(e, items[i]);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (items.length && errors.length === items.length) throw errors[0];
  return out;
}

/**
 * Puts the name-pass answers back on the pages they were read from.
 *
 * Each request numbers its answers within the strips it was shown; the model's
 * `page` is a position in that request, mapped back through the slice to the
 * page the strip was cut from. A page with no answer reads as no name.
 */
export function mergeNameReads(
  pageCount: number,
  slices: NameSlice[],
  results: { pages?: PageName[]; failed?: boolean }[],
): PageName[] {
  const found = new Map<number, Omit<PageName, "page">>();
  slices.forEach((slice, i) => {
    // Every page this request was asked about starts as unread; an answer for
    // it replaces that. A failed request, or one that left a page out, leaves
    // the page unread (failed) rather than "no name" (#125 review).
    for (const source of slice) found.set(source.page, { name: "", confidence: 0, failed: true });
    if (results[i]?.failed) return;
    for (const r of results[i]?.pages ?? []) {
      const source = slice[r.page];
      if (source)
        found.set(
          source.page,
          r.skipped
            ? { name: "", confidence: 0, failed: true }
            : { name: r.name, confidence: r.confidence, box: r.box ?? null },
        );
    }
  });
  // A page no request was asked about (a PDF page, or one the browser could
  // not cut a name area from) is unread too: unknown, not "no name" (#125
  // review, round 3).
  return Array.from({ length: pageCount }, (_, page) => {
    const hit = found.get(page);
    return hit ? { page, ...hit } : { page, name: "", confidence: 0, failed: true };
  });
}

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
 * A page with a name starts a student, unless it is the same name as the
 * student before it (a name written on every page). Pages after it with no
 * name are that student's continuation sheets -- which is what a blank name
 * line means on a multi-page worksheet. A page whose name read FAILED starts
 * its own unnamed group for the teacher to match. Pages before any name at all (a stray back side on top
 * of the pile) become their own group rather than being dropped, so nothing a
 * teacher scanned disappears silently.
 *
 * This is what lets grading happen without a name: the grouping is settled
 * here, from the strips, and the graded request is told the groups.
 */
export function groupPagesByName(
  pages: PageName[],
  /** How many students on the roster this name could be (0, 1, or more for a
   * shared first name). Without it, no name is excluded as a roster student
   * when looking for repeated names (repeatedOffRoster). */
  rosterMatches?: (name: string) => number,
): number[][] {
  // The rule for every choice below: a page never joins another student's
  // group on a guess. Where the app cannot tell, the page is left as its own
  // group for the teacher to match on the next screen -- one extra tap -- rather
  // than graded silently as someone else's (#125 review, 13 Oct 2026).
  const keys = pages.map((p) => (p.failed ? "" : nameKey(p.name)));
  const repeated = repeatedOffRoster(keys, rosterMatches);
  const groups: number[][] = [];
  let current = "";
  pages.forEach((page, i) => {
    const k = keys[i];
    // A name that recurs after a different student each time, and is not on
    // the roster: a printed motto, or a real student the roster lacks. Its
    // page is never put under the student before it -- it starts a group of
    // its own, which resolveScannedGroups marks for the teacher to match
    // (#125 follow-up b; it used to be folded in as a motto).
    if (k && repeated.has(k)) {
      groups.push([page.page]);
      current = "\u0000repeated" + i;
      return;
    }
    // A name that fits more than one student on the roster (two Marias) is
    // never taken as "the same student as the page before": Maria, Maria
    // could be two children, so each starts a group and the teacher picks.
    const ambiguous = !!k && !!rosterMatches && rosterMatches(k) > 1;
    // A failed read is unknown, not blank: it never continues the student
    // before it. It starts an unnamed group, and the pages after it with no
    // name follow it, as a student's continuation sheets do.
    const starts = page.failed || (!!k && (k !== current || ambiguous)) || !groups.length;
    if (starts) groups.push([page.page]);
    else groups[groups.length - 1].push(page.page);
    if (page.failed) current = "\u0000failed" + i;
    else if (k) current = k;
  });
  return groups;
}

const nameKey = (n: string) => n.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Names that recur after a different student each time and are not on the
 * roster -- what a line printed on every paper looks like ("Hope Always", read
 * as a name on 10 Oct 2026), and equally what a real student missing from the
 * roster looks like ([Ana, Dee, Ben, Dee, Cy, Dee]). The app cannot tell the
 * two apart, so it guesses neither: groupPagesByName gives each such page a
 * group of its own and resolveScannedGroups marks it for the teacher to match
 * (#125 follow-up b, 13 Oct 2026). It used to fold them in as a motto, which
 * put a real student's pages under three other children.
 *
 * The pattern, all of it required:
 *   - not a student on the roster (a recurring roster name is a real student:
 *     fronts then backs, a re-scan, two students sharing a first name). With
 *     no roster, or an empty one, nothing is excluded this way;
 *   - THREE or more pages, never two in a row;
 *   - before its first page and between each pair of its pages, exactly one
 *     other name, all of them DIFFERENT. Fronts-then-backs of a student the
 *     roster lacks repeats the same neighbours (Avery, Newkid, Avery, Newkid)
 *     and is grouped as usual instead.
 * Anything short of the pattern is grouped as usual -- a page with a name
 * starts a student -- so it reaches the matching screen as its own row anyway.
 */
export function repeatedOffRoster(keys: string[], rosterMatches?: (name: string) => number): Set<string> {
  const out = new Set<string>();
  const at = new Map<string, number[]>();
  keys.forEach((k, i) => k && at.set(k, [...(at.get(k) ?? []), i]));
  for (const [k, idx] of at) {
    if (idx.length < 3 || (rosterMatches && rosterMatches(k) > 0)) continue;
    if (idx.some((v, j) => j > 0 && v === idx[j - 1] + 1)) continue;
    const runs: string[] = [];
    let ok = true;
    for (let j = 0; j < idx.length && ok; j++) {
      const from = j === 0 ? 0 : idx[j - 1] + 1;
      const names = new Set(keys.slice(from, idx[j]).filter((x) => x && x !== k));
      if (names.size !== 1) ok = false;
      else runs.push([...names][0]);
    }
    if (ok && new Set(runs).size === runs.length) out.add(k);
  }
  return out;
}

/**
 * Where a group could be two students: the first page whose name reads the same
 * as the page before it, when that name is a first name only ("Maria").
 * groupPagesByName keeps such pages together -- a student often writes their
 * name on every page -- but two different Marias handed in one after the other
 * read exactly the same. Returns the position in `pageIndexes` to split at
 * (the second Maria's first page), or -1. The matching screen offers "These
 * are 2 different students" there (#125 follow-up a). A full name ("Maria
 * Lopez") on both pages is taken as one student and not offered.
 */
export function sameFirstNameSplit(pageIndexes: number[], names: PageName[]): number {
  const byPage = new Map(names.map((n) => [n.page, n]));
  // Each name read against the previous name read in the group, skipping pages
  // with no name: two Marias with a two-page test each read [Maria, "", Maria,
  // ""] (review). A failed read breaks the run -- it is not "no name".
  let previous = "";
  for (let j = 0; j < pageIndexes.length; j++) {
    const n = byPage.get(pageIndexes[j]);
    if (!n || n.failed) {
      previous = "";
      continue;
    }
    const k = nameKey(n.name);
    if (!k) continue;
    if (j > 0 && k === previous && !k.includes(" ")) return j;
    previous = k;
  }
  return -1;
}

/**
 * How a grading run that may be resuming groups its pages (gap G3).
 *
 * A saved progress records the pages its run graded and how it grouped them.
 * Resuming over the SAME pages, the run must grade the same students: the
 * groups come back as they were, and a by-name run reads names one page per
 * request again (explicit null) even though the caller passes the panel's one
 * pile. Over different pages the banked answers belong to other pages, so the
 * run starts over. Progress saved before this was recorded resumes as before.
 */
export function resumePlan(
  resume: {
    graded: GradedGroup[];
    nextBatch: number;
    scanId: string | null;
    pageIds?: string[];
    pageGroups?: number[][];
    byName?: boolean;
  } | null,
  ids: string[],
  explicit: number[] | null,
): { resume: typeof resume; pageGroups: number[][] | null; explicit: number[] | null } {
  if (!resume) return { resume: null, pageGroups: null, explicit };
  if (!resume.pageIds || !resume.pageGroups) return { resume, pageGroups: null, explicit };
  const same = resume.pageIds.length === ids.length && resume.pageIds.every((id, i) => id === ids[i]);
  if (!same) return { resume: null, pageGroups: null, explicit };
  return {
    resume,
    pageGroups: resume.pageGroups,
    explicit: resume.byName ? null : resume.pageGroups.map((g) => g.length),
  };
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
  /** The teacher must say whose paper this is before saving; nothing is
   * matched or suggested. "repeated": a name read after a different student
   * each time and not on the roster (repeatedOffRoster) -- printed text, or a
   * student the roster lacks. "split": the second half of a row the teacher
   * split ("These are 2 different students"). */
  unassigned?: "repeated" | "split" | false;
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
/** A roster match is pre-filled (chosen for the teacher) only at or above this
 * fit score: exact names (1), a confident surname fit (1) and a unique
 * first-name (0.9) pre-fill; a looser fuzzy fit (a misspelling or nickname that
 * scored 0.8-0.89) is only ever a suggestion. */
const PREFILL_SCORE = 0.9;
/** ...and only when the model read the handwriting this confidently (0-100). A
 * name the model wasn't sure it read is never pre-filled, however well the
 * string happens to fit the roster. */
const PREFILL_READ = 70;

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

/** How many students on this roster a read name could be: 0 (not on it), 1,
 * or more (a first name two students share). */
export function rosterMatchCount(name: string, students: Student[]): number {
  const m = matchRosterStudent(name, students);
  return m.student ? 1 : (m.candidates?.length ?? 0);
}

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

  const validPagesByGroup = pageGroups.map((pages) =>
    [
      ...new Set(
        pages.filter(
          (p) => Number.isInteger(p) && p >= 0 && p < pageUploadIds.length,
        ),
      ),
    ].sort((a, b) => a - b),
  );

  // How many distinct groups each read name turns up on. A student is scanned
  // once, so a name that recurs across groups is almost certainly NOT a student
  // -- it is a printed worksheet motto, header or instruction that the name pass
  // mistook for a name. Ricky's 2026-10-10 "Percentages" scan read "Hope Always"
  // (a phrase on the sheet) on two students' back pages; the old "first page
  // with any text names the group" rule then let it override the real names on
  // those groups (Run Lowhill, Peter Parker), so two groups showed "Hope Always"
  // and those students lost their identity -- which is what sent their answers
  // to the wrong child when the teacher matched names.
  const groupsWithName = new Map<string, Set<number>>();
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  validPagesByGroup.forEach((pages, g) => {
    for (const p of pages) {
      const nm = nameOf.get(p)?.name.trim();
      if (!nm) continue;
      const key = norm(nm);
      (groupsWithName.get(key) ?? groupsWithName.set(key, new Set()).get(key)!).add(g);
    }
  });
  const recurs = (nm: string) => (groupsWithName.get(norm(nm))?.size ?? 0) > 1;

  // The group's name is the best of its pages' reads, not simply the first with
  // text: a name unique to this group beats one that recurs across groups (the
  // motto above), and within that, the most confident read wins; ties keep the
  // earliest page so the choice is stable. Falls back to a recurring name only
  // when the group has nothing else -- best effort, and it will not pre-fill.
  const pickRead = (validPages: number[]): PageName | undefined => {
    const named = validPages
      .map((p) => nameOf.get(p))
      .filter((n): n is PageName => !!n && !!n.name.trim());
    if (!named.length) return undefined;
    const unique = named.filter((n) => !recurs(n.name));
    const pool = unique.length ? unique : named;
    return pool
      .slice()
      .sort((a, b) => b.confidence - a.confidence || a.page - b.page)[0];
  };

  const rows = pageGroups.map((_, i) => {
    const validPages = validPagesByGroup[i];
    const read = pickRead(validPages);
    const detectedName = read?.name.trim() ?? "";
    const match = matchRosterStudent(detectedName, students);
    const readConfidence = read?.confidence ?? 0;
    const namePage = read ? read.page : validPages[0];
    // Pre-fill (pick) a roster name for the teacher ONLY on a strong match:
    // the roster fit is near-exact AND the model read the handwriting with
    // confidence. A weak match -- a loose fuzzy fit, or a name the model wasn't
    // sure it read -- is demoted to a SUGGESTION the teacher taps, not a chosen
    // name they have to notice is wrong (Ricky: a pre-filled wrong name is worse
    // than a blank, because it rides through unless spotted). The misread can
    // come from either pass: a bad name read (low readConfidence) or a loose
    // roster fit (low score); this gate catches both.
    const strongMatch =
      !!match.student && (match.score ?? 0) >= PREFILL_SCORE && readConfidence >= PREFILL_READ;
    // A single roster student that wasn't strong enough to pre-fill still rides
    // along as the suggestion, so the teacher confirms with one tap.
    const weakSingle = !!match.student && !strongMatch ? [match.student.id] : [];
    return {
      row: {
        pageIndexes: validPages,
        detectedName,
        confidence: readConfidence,
        responses: gradedByGroup.get(i) ?? [],
        pageUploadIds: validPages.map((p) => pageUploadIds[p]),
        key: "group-" + i,
        // Left unset on anything but a strong match: an ambiguous or shaky paper
        // must reach the teacher as a question, not as an answer they have to
        // notice is wrong.
        studentId: strongMatch ? (match.student as Student).id : null,
        name: strongMatch
          ? (match.student as Student).name
          : detectedName || "Student " + (i + 1),
        candidateIds: strongMatch
          ? []
          : [...weakSingle, ...(match.candidates ?? []).map((c) => c.id)],
        matchConfidence: Math.round(readConfidence * (match.score ?? 0)),
        suggestedId: null as string | null,
        nameUploadId: (namePage !== undefined ? nameUploadIds[namePage] : null) ?? null,
        nameBox: read?.box ?? null,
      } satisfies ResolvedGroup,
      exact: strongMatch && match.score === 1,
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
  // A name the stack repeats after a different student each time, off the
  // roster: the teacher decides whose paper each one is (#125 follow-up b).
  const repeated = repeatedOffRoster(
    pageGroups.flatMap((g) => g).sort((x, y) => x - y).map((p) => {
      const n = nameOf.get(p);
      return n && !n.failed ? nameKey(n.name) : "";
    }),
    students.length ? (nm) => rosterMatchCount(nm, students) : undefined,
  );
  for (const { row } of rows)
    if (row.detectedName && repeated.has(nameKey(row.detectedName)))
      Object.assign(row, { unassigned: "repeated", studentId: null, candidateIds: [], suggestedId: null, matchConfidence: 0 });
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

/**
 * The whole roster to save after a class scan: every student of the teacher's
 * OTHER classes exactly as they were, plus this class's students as the scan
 * left them.
 *
 * applyScannedGroups works on one class -- the panel hands it the active
 * class's students -- and returns that class's roster. Saving that as
 * `w.students` told sync_workspace that every student in every other class had
 * been deleted, and it deleted them, responses and all (a pilot teacher with
 * five classes, 12 Oct 2026). `before` is the class roster the scan was given;
 * `after` is what it returned. Existing students keep their place in the
 * roster; students the scan created follow.
 */
export function keepOtherClassStudents(
  all: Student[],
  before: Student[],
  after: Student[],
): Student[] {
  const handedIn = new Set(before.map((s) => s.id));
  const returned = new Map(after.map((s) => [s.id, s]));
  const kept: Student[] = [];
  const placed = new Set<string>();
  for (const s of all) {
    if (!handedIn.has(s.id)) {
      kept.push(s);
      placed.add(s.id);
      continue;
    }
    const next = returned.get(s.id);
    if (next) {
      kept.push(next);
      placed.add(s.id);
    }
  }
  for (const s of after) if (!placed.has(s.id)) kept.push(s);
  return kept;
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
/**
 * Two groups of one scan matched to the same student, question by question:
 * an answer one group read wins over a blank or missing one from the other;
 * two DIFFERENT answers read for the same question go to the teacher as
 * Unsure, never silently one or the other.
 */
export function mergeSplitGroups(first: StudentResponse[], second: StudentResponse[]): StudentResponse[] {
  const byQuestion = new Map(second.map((r) => [r.questionId, r]));
  const read = (r?: StudentResponse) => (r?.finalAnswer?.trim() || r?.answer.trim() || "");
  const merged = first.map((a) => {
    const b = byQuestion.get(a.questionId);
    byQuestion.delete(a.questionId);
    if (!b) return a;
    const ra = read(a);
    const rb = read(b);
    if (!rb) return a;
    if (!ra) return b;
    if (ra === rb || sameReading(ra, rb)) return a.confidence >= b.confidence ? a : b;
    return {
      ...a,
      correct: false,
      match: undefined,
      confidence: 0,
      verified: false,
      misconception: "Two pages of this student were read with different answers (" + ra + " / " + rb + "). Check both pages.",
    };
  });
  return [...merged, ...byQuestion.values()];
}

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
    const incoming = normalizeRecognizedResponses(a, studentId, group.responses);
    const earlier = responsesByStudent.get(studentId);
    responsesByStudent.set(
      studentId,
      earlier
        ? // A second group of THIS scan for the same student -- fronts then
          // backs, a re-scanned page, an unread page matched by the teacher.
          // Merged with the first group, not with what was saved before the
          // scan: the last group used to win, so a correct front-page answer
          // became a blank from the back page (#125 review).
          mergeSplitGroups(earlier, incoming)
        : mergeStudentResponses(a.responses.filter((r) => r.studentId === studentId), incoming),
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
  /** Set only on a multi-part re-ask: the questions to look at again. */
  onlyQuestionIds?: string[];
  /** A multi-part re-ask: the "group|questionId" pairs (whole-scan group
   * indexes) it was asked for. Only these are taken back from its answer. */
  reaskPairs?: string[];
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

/** A short batch: one the model answered incompletely. `missing` are the
 * whole-scan group indexes it did not return at all or returned with fewer than
 * the expected answers; `retried` says whether another attempt followed. */
export type ShortBatch = {
  batch: number;
  missing: number[];
  attempt: number;
  retried: boolean;
};

/** A reduced request covering only some of a batch's groups, renumbered from
 * zero against their own pages -- used to re-ask for the groups a batch left
 * out or cut short. */
function subBatch(batch: ScanBatch, wantWhole: number[]): ScanBatch {
  const sub: ScanBatch = { uploadIds: [], groups: [], groupIndexes: [] };
  for (const whole of wantWhole) {
    const localPos = batch.groupIndexes.indexOf(whole);
    if (localPos < 0) continue;
    sub.groups.push(
      batch.groups[localPos].map((p) => {
        sub.uploadIds.push(batch.uploadIds[p]);
        return sub.uploadIds.length - 1;
      }),
    );
    sub.groupIndexes.push(whole);
  }
  return sub;
}

/**
 * Folds one grading answer into the best answer seen so far for each of the
 * batch's groups, in whole-scan numbering. A group number the request was
 * never told about is dropped rather than guessed at; a retry that comes back
 * shorter never replaces a fuller earlier answer.
 */
export function absorbGraded(
  best: Map<number, GradedGroup>,
  attemptBatch: ScanBatch,
  groups: GradedGroup[] | undefined,
) {
  for (const g of groups ?? []) {
    const at = attemptBatch.groupIndexes[g.group];
    if (at === undefined) continue;
    const prev = best.get(at);
    if (!prev || (g.responses?.length ?? 0) >= (prev.responses?.length ?? 0))
      best.set(at, { ...g, group: at });
  }
}

/** The batch's groups still missing, or short of a full set of answers. Empty
 * when no question count is given (older callers: nothing to judge against). */
export function shortGroups(
  batch: ScanBatch,
  best: Map<number, GradedGroup>,
  questionCount: number,
): number[] {
  if (questionCount <= 0) return [];
  return batch.groupIndexes.filter((at) => (best.get(at)?.responses?.length ?? 0) < questionCount);
}

/** The request that re-asks a batch for just the groups it left short. */
export function retryBatch(batch: ScanBatch, missing: number[]): ScanBatch {
  return subBatch(batch, missing);
}

/** A graded answer with fewer parts than its key asks for. `group` is the
 * whole-scan group index. */
export type PartsShort = { group: number; questionId: string; expected: number; got: number };

/** The answers in these groups that came back with fewer parts than their
 * question's key has (Ricky, 12 Oct: question 2 read 4 of 8 parts). */
export function partsShortfall(a: Assessment, groups: GradedGroup[]): PartsShort[] {
  const wanted = new Map(
    a.questions.filter((q) => !q.excluded).map((q) => [q.id, expectedParts(q)] as const),
  );
  const out: PartsShort[] = [];
  for (const g of groups)
    for (const r of g.responses ?? []) {
      const expected = wanted.get(r.questionId) ?? 1;
      if (expected < 2 || r.verdict === "blank") continue;
      const got = partsRead(r.finalAnswer?.trim() || r.answer || "");
      if (got < expected) out.push({ group: g.group, questionId: r.questionId, expected, got });
    }
  return out;
}

/** The re-ask for short multi-part answers: each student is asked again only
 * for the questions THEY came back short on. Students short on the same
 * questions share a request, so there is one request per distinct set of short
 * questions -- usually one. Each request also carries the exact (student,
 * question) pairs it is for, and only those are taken back from it. */
export function planPartsReask(batch: ScanBatch, shorts: PartsShort[]): ScanBatch[] {
  const byGroup = new Map<number, string[]>();
  for (const x of shorts) byGroup.set(x.group, [...new Set([...(byGroup.get(x.group) ?? []), x.questionId])].sort());
  const bySet = new Map<string, { groups: number[]; questions: string[] }>();
  for (const [group, questions] of byGroup) {
    const k = questions.join("\u0000");
    const entry = bySet.get(k) ?? { groups: [], questions };
    entry.groups.push(group);
    bySet.set(k, entry);
  }
  return [...bySet.values()].map(({ groups, questions }) => ({
    ...subBatch(batch, groups),
    onlyQuestionIds: questions,
    reaskPairs: groups.flatMap((g) => questions.map((q) => g + "|" + q)),
  }));
}

/**
 * Takes from a re-ask an answer that now has more parts than before -- only for
 * the (student, question) pairs that request was for, and never a "blank": a
 * question that showed work and came back short stays for the teacher (Unsure
 * after settleShortParts), it is not turned into a zero by a second look that
 * saw nothing.
 */
export function absorbPartsReask(
  best: Map<number, GradedGroup>,
  reask: ScanBatch,
  groups: GradedGroup[] | undefined,
) {
  const only = new Set(reask.onlyQuestionIds ?? []);
  const pairs = reask.reaskPairs ? new Set(reask.reaskPairs) : null;
  for (const g of groups ?? []) {
    const at = reask.groupIndexes[g.group];
    const current = at === undefined ? undefined : best.get(at);
    if (!current) continue;
    for (const fresh of g.responses ?? []) {
      if (!only.has(fresh.questionId)) continue;
      if (pairs && !pairs.has(at + "|" + fresh.questionId)) continue;
      if (fresh.verdict === "blank") continue;
      const i = current.responses.findIndex((r) => r.questionId === fresh.questionId);
      const before = i < 0 ? -1 : partsRead(current.responses[i].finalAnswer?.trim() || current.responses[i].answer || "");
      if (partsRead(fresh.finalAnswer?.trim() || fresh.answer || "") > before) {
        const responses = [...current.responses];
        if (i < 0) responses.push(fresh);
        else responses[i] = fresh;
        best.set(at, { ...current, responses });
      }
    }
  }
}

/**
 * After the re-ask: any answer still short of its parts goes to Unsure for the
 * teacher -- never blank, never wrong, never matched on the parts that were
 * read. Returns how many were sent there.
 */
export function settleShortParts(best: Map<number, GradedGroup>, groupIndexes: number[], a: Assessment): number {
  const shorts = partsShortfall(a, groupIndexes.map((at) => best.get(at)).filter((g): g is GradedGroup => !!g));
  for (const s of shorts) {
    const g = best.get(s.group)!;
    best.set(s.group, {
      ...g,
      responses: g.responses.map((r) => (r.questionId === s.questionId ? { ...r, verdict: "unsure" as const } : r)),
    });
  }
  return shorts.length;
}

export async function gradeInBatches(
  batches: ScanBatch[],
  grade: (batch: ScanBatch, index: number) => Promise<{ groups?: GradedGroup[] }>,
  onBatch?: (graded: GradedGroup[], nextBatch: number) => void,
  startAt = 0,
  already: GradedGroup[] = [],
  // How many answers a fully-graded group should carry (the active question
  // count). A group that comes back with fewer than this -- or does not come
  // back at all -- was cut short by the model, and is re-asked rather than
  // banked with gaps that save as blanks. 0 disables the check (older callers).
  questionCount = 0,
  maxRetries = 2,
  onShortBatch?: (info: ShortBatch) => void,
  // The assessment, to check multi-part answers against their keys: a short
  // one is re-asked once, then sent to Unsure. Absent: no parts check.
  partsOf?: Assessment,
  onShortParts?: (info: { batch: number; reasked: number; unsure: number }) => void,
): Promise<GradedGroup[]> {
  const graded: GradedGroup[] = [...already];

  for (const [index, batch] of batches.entries()) {
    if (index < startAt) continue;

    // Keep the best answer seen for each of this batch's groups across attempts:
    // a retry that still comes up short never loses a fuller earlier answer.
    const best = new Map<number, GradedGroup>();
    let attemptBatch = batch;
    let attempt = 0;
    while (true) {
      const result = await grade(attemptBatch, index);
      // A group number the batch was never told about is dropped rather than
      // guessed at: attaching it to the wrong student is worse than losing it.
      absorbGraded(best, attemptBatch, result.groups);
      // Which of THIS batch's groups are still missing or short of a full set.
      // Only judged when a question count was given; without one (older callers)
      // there is nothing to retry against, so the old no-retry behavior stands.
      const missing = shortGroups(batch, best, questionCount);
      if (!missing.length || attempt >= maxRetries) {
        if (missing.length) onShortBatch?.({ batch: index, missing, attempt, retried: false });
        break;
      }
      attempt++;
      // Log before re-asking, so a run that is watched shows the retry happening.
      onShortBatch?.({ batch: index, missing, attempt, retried: true });
      attemptBatch = subBatch(batch, missing);
    }

    if (partsOf) {
      const shorts = partsShortfall(partsOf, batch.groupIndexes.map((at) => best.get(at)).filter((g): g is GradedGroup => !!g));
      for (const reask of shorts.length ? planPartsReask(batch, shorts) : []) {
        try {
          absorbPartsReask(best, reask, (await grade(reask, index)).groups);
        } catch {
          // A failed re-ask must not lose the batch: what is still short goes
          // to Unsure below, which is where it was headed anyway.
        }
      }
      const unsure = settleShortParts(best, batch.groupIndexes, partsOf);
      if (shorts.length) onShortParts?.({ batch: index, reasked: shorts.length, unsure });
    }

    for (const at of batch.groupIndexes) {
      const g = best.get(at);
      if (g) graded.push(g);
    }
    onBatch?.(graded, index + 1);
  }
  return graded;
}
