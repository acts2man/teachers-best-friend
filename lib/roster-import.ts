/**
 * Turning a school system's export into a list of first names.
 *
 * Everything here is pure and runs in the browser. The file is never uploaded,
 * never reaches /api/uploads, never reaches a model, and is never charged as a
 * scan -- the bytes are read with FileReader and parsed in this module. That is
 * a promise the UI makes out loud ("Your file stays on your computer"), so it
 * has to be true of the code and not only of the intention.
 *
 * What a district export actually contains is student IDs, birthdates, home
 * addresses, guardian names and phone numbers. None of it is wanted and none of
 * it is kept: extractNames() returns strings, the parsed rows live in component
 * state for as long as the dialog is open, and nothing else is ever read out of
 * them. The tests assert that no ID and no birthdate survives into the output,
 * because "we only use the name column" is a claim about every other column too.
 *
 * Imports only shortenName, which imports only types. Kept that way so the
 * whole module can be bundled and run in a test in a millisecond.
 */
import { shortenName } from "./teacher-classes";

export type Row = string[];

/**
 * One name on its way to the review list.
 *
 * `preferred` is shown to the teacher rather than applied quietly: a roster
 * that says a child is called Bo when the office record says Bao is telling you
 * something you should see, not something to paper over.
 *
 * `first` and `last` are the roster's own columns when the file had them, so a
 * short name is built from what the school said rather than from re-splitting
 * the joined string. "Maria de la Cruz" split back apart gives "Maria C.";
 * the Last column gives "Maria D.", which is her name.
 *
 * `occurrence` tells two students of the same name apart -- see extractNames.
 */
export type ImportedName = {
  name: string;
  preferred?: boolean;
  first?: string;
  last?: string;
  occurrence?: number;
};

// ---------------------------------------------------------------
// Bytes to text
// ---------------------------------------------------------------

/**
 * Excel on Windows still writes CSV as Windows-1252 unless told otherwise, so
 * "José Muñoz" arrives as bytes that are not valid UTF-8 at all. Decoding them
 * as UTF-8 with the default (lenient) decoder silently produces "Jos<?> Mu<?>oz"
 * -- a replacement character where a child's name was, saved to their record
 * and printed on their report.
 *
 * So: strip a UTF-8 byte-order mark, try UTF-8 strictly, and fall back to
 * Windows-1252 only when the bytes prove they are not UTF-8. That order matters
 * -- most files really are UTF-8, and Windows-1252 accepts any byte sequence,
 * so trying it first would never fail and would mangle every accented name in a
 * correct file.
 */
export function decodeRosterBytes(input: ArrayBuffer | Uint8Array): string {
  let bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  // UTF-8 BOM. TextDecoder strips it for utf-8, but not for windows-1252, and
  // it would otherwise become a stray character on the first header.
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    bytes = bytes.subarray(3);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

// ---------------------------------------------------------------
// Text to rows
// ---------------------------------------------------------------

/** Tab if the first line has more tabs than commas; comma otherwise. */
export function sniffDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const semis = (firstLine.match(/;/g) || []).length;
  if (tabs > commas && tabs >= semis) return "\t";
  // Some European locales export CSV with semicolons, because the comma is
  // their decimal separator. Cheap to accept, confusing to refuse.
  if (semis > commas) return ";";
  return ",";
}

/**
 * A CSV/TSV reader, hand-written rather than a dependency.
 *
 * The format is small and the awkward parts are all here: a quoted field can
 * contain the delimiter, a newline and an escaped quote (""), and files arrive
 * with CRLF, a trailing newline, and blank rows in the middle where somebody
 * left a gap. Those are the cases the tests cover, one each.
 */
export function parseDelimited(text: string, delimiter = sniffDelimiter(text)): Row[] {
  const rows: Row[] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // A row of nothing but empty cells is a blank line, however many commas
    // the exporter put on it.
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // CRLF and a lone CR both end the row.
      if (text[i + 1] === "\n") i += 1;
      endRow();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== "" || row.length) endRow();
  return rows.map((r) => r.map((cell) => cell.trim()));
}

// ---------------------------------------------------------------
// Which column is which
// ---------------------------------------------------------------

/** Lowercase, and drop everything that is not a letter or a digit. */
export function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const FULL_NAME_HEADERS = new Set(
  ["name", "studentname", "student", "fullname", "studentfullname", "legalname", "pupil", "pupilname"],
);
const FIRST_NAME_HEADERS = new Set(["firstname", "first", "givenname", "forename", "studentfirstname"]);
const LAST_NAME_HEADERS = new Set(["lastname", "last", "surname", "familyname", "studentlastname"]);
const PREFERRED_HEADERS = new Set(["preferredname", "preferred", "nickname", "goesby", "knownas", "chosenname"]);
const PERIOD_HEADERS = new Set(["period", "section", "course", "class", "classperiod", "coursesection", "block", "hour", "homeroom"]);

export type HeaderMap = {
  full: number[];
  first: number | null;
  last: number | null;
  preferred: number | null;
  period: number | null;
};

export function classifyHeaders(headers: string[]): HeaderMap {
  const map: HeaderMap = { full: [], first: null, last: null, preferred: null, period: null };
  headers.forEach((raw, index) => {
    const h = normalizeHeader(raw);
    if (FULL_NAME_HEADERS.has(h)) map.full.push(index);
    else if (FIRST_NAME_HEADERS.has(h)) map.first ??= index;
    else if (LAST_NAME_HEADERS.has(h)) map.last ??= index;
    else if (PREFERRED_HEADERS.has(h)) map.preferred ??= index;
    else if (PERIOD_HEADERS.has(h)) map.period ??= index;
  });
  return map;
}

/**
 * "Nguyen, Bo" and "Nguyen, Bo Minh" become "Bo Nguyen" and "Bo Minh Nguyen".
 *
 * Exactly one comma, or it is left alone. Two commas is not a name shape we can
 * read confidently -- "Nguyen, Bo, Jr" could be reordered three ways -- and
 * guessing wrong here renames a child.
 */
export function flipLastFirst(value: string): string {
  const parts = value.split(",");
  if (parts.length !== 2) return value.trim();
  const last = parts[0].trim();
  const first = parts[1].trim();
  if (!last || !first) return value.trim();
  return `${first} ${last}`;
}

// ---------------------------------------------------------------
// The plan
// ---------------------------------------------------------------

export type ImportPlan = {
  /** Rows below the header, or every row when there is no header. */
  body: Row[];
  headers: string[] | null;
  /** How the names will be built, or "choose" when the teacher must say. */
  mode: "full" | "firstLast" | "choose";
  nameColumn: number | null;
  firstColumn: number | null;
  lastColumn: number | null;
  preferredColumn: number | null;
  /** Only set when the column exists AND holds more than one value. */
  periodColumn: number | null;
  periods: string[];
  /** For the picker: every column, with up to three rows of what is in it. */
  candidates: { index: number; header: string; samples: string[] }[];
};

/**
 * Decide how to read a table, or decide that we cannot and must ask.
 *
 * Deliberately not clever. A header we recognise is used; anything else stops
 * and shows the teacher the first three rows so they can point at the right
 * column. A wrong guess here silently fills a class with student ID numbers,
 * and that is worse than one extra click.
 */
export function planImport(rows: Row[]): ImportPlan {
  const first = rows[0] ?? [];
  const map = classifyHeaders(first);
  const looksLikeHeader =
    map.full.length > 0 || map.first !== null || map.last !== null || map.preferred !== null;

  const headers = looksLikeHeader ? first : null;
  const body = looksLikeHeader ? rows.slice(1) : rows;

  // A period column is only worth asking about when it actually separates
  // anything. One period in the file means the teacher exported one class.
  let periodColumn: number | null = null;
  let periods: string[] = [];
  if (looksLikeHeader && map.period !== null) {
    const values = [...new Set(body.map((r) => (r[map.period as number] ?? "").trim()).filter(Boolean))];
    if (values.length > 1) {
      periodColumn = map.period;
      periods = values.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }
  }

  const width = Math.max(first.length, ...body.slice(0, 3).map((r) => r.length), 0);
  const candidates = Array.from({ length: width }, (_, index) => ({
    index,
    header: headers?.[index] ?? "",
    samples: body.slice(0, 3).map((r) => r[index] ?? ""),
  }));

  // First + last is preferred over a full-name column when both exist: it is
  // the more precise reading, and it is the only one a preferred-name column
  // can be applied to.
  let mode: ImportPlan["mode"] = "choose";
  if (map.first !== null && map.last !== null) mode = "firstLast";
  else if (map.full.length === 1) mode = "full";

  return {
    body,
    headers,
    mode,
    nameColumn: mode === "full" ? map.full[0] : null,
    firstColumn: mode === "firstLast" ? map.first : null,
    lastColumn: mode === "firstLast" ? map.last : null,
    preferredColumn: mode === "firstLast" ? map.preferred : null,
    periodColumn,
    periods,
    candidates,
  };
}

export type ExtractChoice = {
  /** Set by the picker when the plan could not decide. */
  nameColumn?: number | null;
  /** Which period to keep. Empty or undefined keeps everything. */
  period?: string;
};

export type ExtractResult = {
  names: ImportedName[];
  /** How many rows the chosen period actually had, before any cap. */
  total: number;
};

/**
 * Pull the names out, and nothing else.
 *
 * Every other column -- ID, email, birthdate, address, guardian, phone -- is
 * simply never read. Not filtered afterwards: never read. That is why the test
 * that greps the output for a birthdate is worth having.
 *
 * The one thing the other columns are used for, and it leaves nothing behind:
 * telling two children of the same name apart. Two rows reading "Maria Garcia"
 * are either one girl the office listed twice or two girls in the same class,
 * and the only evidence either way is in the columns we refuse to keep. So each
 * row's other cells are compared with each other, in this function, and thrown
 * away; what survives is `occurrence`, a small integer:
 *
 *   - rows whose other columns agree are the same child listed twice, share an
 *     occurrence, and become one row in the review list
 *   - rows that differ anywhere -- a student ID, a birthdate, a homeroom -- are
 *     two children, get 1 and 2, and both reach the teacher
 *
 * A file with no columns but the name has nothing to distinguish anyone by, so
 * a repeated name there collapses. That is the safer default of the two: a
 * teacher who really does have two Maria Garcias can add the second by hand and
 * will notice she is missing, where an invented duplicate is a second empty
 * record that quietly collects half her work.
 */
export function extractNames(plan: ImportPlan, choice: ExtractChoice = {}): ExtractResult {
  const column = choice.nameColumn ?? plan.nameColumn;
  const rows =
    plan.periodColumn !== null && choice.period
      ? plan.body.filter((r) => (r[plan.periodColumn as number] ?? "").trim() === choice.period)
      : plan.body;

  // Columns the name itself was read out of. Everything else is what makes one
  // row a different student from another row that reads the same.
  const nameColumns = new Set(
    [column, plan.firstColumn, plan.lastColumn, plan.preferredColumn].filter(
      (i): i is number => typeof i === "number",
    ),
  );
  const restOfRow = (row: Row) =>
    row
      .map((cell, i) => (nameColumns.has(i) ? "" : cell.trim().toLowerCase()))
      .join("\u0000");

  // name key -> the distinct rows seen under it -> which one this is.
  const distinct = new Map<string, Map<string, number>>();
  const occurrenceOf = (name: string, row: Row) => {
    const key = matchKey(name);
    const seen = distinct.get(key) ?? new Map<string, number>();
    distinct.set(key, seen);
    const rest = restOfRow(row);
    const known = seen.get(rest);
    if (known !== undefined) return known;
    const next = seen.size + 1;
    seen.set(rest, next);
    return next;
  };

  const names: ImportedName[] = [];
  for (const row of rows) {
    if (plan.mode === "firstLast" && plan.firstColumn !== null && plan.lastColumn !== null) {
      const officialFirst = (row[plan.firstColumn] ?? "").trim();
      const preferred =
        plan.preferredColumn !== null ? (row[plan.preferredColumn] ?? "").trim() : "";
      const last = (row[plan.lastColumn] ?? "").trim();
      const first = preferred || officialFirst;
      const name = [first, last].filter(Boolean).join(" ").trim();
      if (name)
        names.push({
          name,
          first,
          last,
          // Only flagged when it actually differs: a preferred-name column
          // that repeats the legal name is noise, not information.
          preferred: Boolean(preferred && preferred !== officialFirst),
          occurrence: occurrenceOf(name, row),
        });
      continue;
    }
    if (column === null || column === undefined) continue;
    const cell = (row[column] ?? "").trim();
    if (!cell) continue;
    const name = flipLastFirst(cell);
    names.push({ name, occurrence: occurrenceOf(name, row) });
  }
  return { names, total: names.length };
}

// ---------------------------------------------------------------
// The paste box
// ---------------------------------------------------------------

/**
 * Names typed or pasted into the box.
 *
 * This used to be `names.split(/[\n,]/)`, which turned "Nguyen, Bo" -- the form
 * every school system exports -- into two students called "Nguyen" and "Bo",
 * saved immediately with nothing to review. Commas are no longer a separator by
 * default.
 *
 * The comma still has to mean something, so:
 *   - a block of lines that each hold exactly one comma is a column of
 *     "Last, First", and each line is flipped
 *   - a single line holding several commas is a list, and is split
 *   - one line with one comma is "Last, First": one student, not two. That is
 *     the regression this function exists for.
 *
 * Tabs separate names on a single line. A multi-line block containing tabs is
 * spreadsheet rows, and the caller sends that through parseDelimited instead --
 * splitting it here would turn two columns into twice as many students.
 */
export function namesFromPaste(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const commaCount = (l: string) => (l.match(/,/g) || []).length;
  const singleCommaLines = lines.filter((l) => commaCount(l) === 1).length;
  // "A column of Last, First" -- most of the lines look that way.
  const columnOfLastFirst = lines.length > 1 && singleCommaLines >= lines.length / 2;

  const out: string[] = [];
  for (const line of lines) {
    const commas = commaCount(line);
    if (commas === 1 && (columnOfLastFirst || lines.length === 1)) {
      out.push(flipLastFirst(line));
      continue;
    }
    if (commas >= 1 && !columnOfLastFirst) {
      for (const part of line.split(",")) {
        const value = part.trim();
        if (value) out.push(value);
      }
      continue;
    }
    // Tabs on a single line separate names.
    for (const part of line.split("\t")) {
      const value = part.trim();
      if (value) out.push(value);
    }
  }
  return out;
}

/** Spreadsheet rows pasted in, rather than a list of names. */
export function pasteLooksLikeTable(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return lines.length > 1 && lines.filter((l) => l.includes("\t")).length >= lines.length / 2;
}

// ---------------------------------------------------------------
// The review list
// ---------------------------------------------------------------

/**
 * The most a single add may carry.
 *
 * Not a storage limit -- the workspace accepts 3000 students -- but the review
 * list is the safety net this whole feature rests on, and a teacher cannot
 * meaningfully check 400 checkboxes in one sitting. It also keeps one save
 * inside the 3.5 MB the workspace PUT accepts, which a whole district export
 * pasted at once would not.
 *
 * Whatever the number, going over it is said out loud. The old code did
 * .slice(0, 100) with no message, so names 101 onward simply never appeared and
 * nobody was told.
 */
export const MAX_PER_ADD = 100;

export type ReviewRow = {
  /** The full name, as the roster wrote it. */
  name: string;
  /** Stable identity for this row: the checkbox, the edit box, the React key. */
  key: string;
  /** The roster's own columns, when it had them. */
  first?: string;
  last?: string;
  /** The same child is already on the roster: shown unticked, with a label. */
  existing: boolean;
  preferred: boolean;
  /** A student already in the class this MIGHT be. Shown; never acted on. */
  possibleMatch?: string;
};

/** The key two names are compared on: case, spacing and punctuation ignored. */
export function matchKey(name: string): string {
  return name.toLowerCase().replace(/[.’']/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Merge what was imported with what the class already has.
 *
 * Identity is the FULL name, and only the full name. This used to compare the
 * shortened form -- what would actually be saved -- which sounds right and is
 * how Maria Garcia, Maria Gonzalez and Maria Guzman arrived as a single row
 * called "Maria Garcia", with two children dropped in silence. A shortened name
 * is a label the app prints; it is not who somebody is, and it can never be the
 * thing two students are judged the same by.
 *
 * Against the class it is less tidy, because students already enrolled are
 * stored in whatever form they were saved in -- often "Maria G." already, the
 * surname gone for good. So when an imported name shortens to exactly an
 * enrolled student's stored name, we cannot tell whether it is her or a
 * classmate, and we say so rather than decide: the row stays ticked, with a
 * "Possible match" note naming who she might be. The teacher knows which of
 * their students is which; we do not. Deciding it here is what left Maria
 * Gonzalez unticked and unimported because Maria Garcia was already in the
 * class.
 *
 * Duplicates inside the file still collapse, on the full name together with the
 * occurrence that came with it -- see extractNames for why the second Maria
 * Garcia sometimes survives and sometimes does not.
 */
export function buildReviewRows(
  imported: ImportedName[],
  existingNames: string[],
): ReviewRow[] {
  const enrolled = new Map(existingNames.map((n) => [matchKey(n), n.trim()]));
  const seen = new Set<string>();
  const rows: ReviewRow[] = [];
  for (const item of imported) {
    const nameKey = matchKey(item.name);
    if (!nameKey) continue;
    const key = `${nameKey}#${item.occurrence ?? 1}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const existing = enrolled.has(nameKey);
    // Only worth raising when it is not already a certainty, and only when
    // shortening actually changes the name -- otherwise every exact match
    // would report itself as a possible one. Checked whichever way the switch
    // is set: the question is whether this is the same child, and that does
    // not change with how we intend to print her name.
    const shortKey = matchKey(shortenName(item.name));
    const possible =
      !existing && shortKey !== nameKey ? enrolled.get(shortKey) : undefined;

    rows.push({
      name: item.name,
      key,
      first: item.first,
      last: item.last,
      existing,
      preferred: Boolean(item.preferred),
      ...(possible ? { possibleMatch: possible } : {}),
    });
  }
  return rows;
}

/**
 * What a screen reader is told this row is.
 *
 * Two children called Maria Garcia are now two rows, which is the point -- but
 * two checkboxes both announcing "Include Maria Garcia" is a list a blind
 * teacher cannot tick correctly, and the bug this change fixes would have been
 * traded for a quieter one. The number is only added where there really is a
 * second of her.
 */
export function rowLabel(row: ReviewRow): string {
  const nth = Number(row.key.slice(row.key.lastIndexOf("#") + 1));
  return nth > 1 ? `${row.name} (${nth})` : row.name;
}

/** "This file has 142 names..." -- or "" when everything fits. */
export function overLimitMessage(total: number, selectable: number, hasPeriods: boolean): string {
  if (selectable <= MAX_PER_ADD) return "";
  return (
    `This file has ${total} names. ` +
    (hasPeriods ? "Choose a period or untick some; " : "Untick some; ") +
    `up to ${MAX_PER_ADD} can be added at once.`
  );
}

/** The sample a teacher can download to see the shape we expect. */
export const SAMPLE_CSV =
  "First Name,Last Name\r\n" +
  "Amelia,Rivera\r\n" +
  "Benjamin,Okafor\r\n" +
  "Chloe,Delacroix\r\n";
