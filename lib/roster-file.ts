/**
 * Reading a roster file in the browser, and nowhere else.
 *
 * No fetch, no FormData, no /api/uploads, no model call. The bytes are read
 * with the File API and parsed in lib/roster-import.ts, so no scan is charged
 * and the file never leaves the teacher's computer. The UI says exactly that,
 * which is why this module has no network import in it to accidentally grow one.
 */
import { decodeRosterBytes, parseDelimited, type Row } from "./roster-import";

export const ROSTER_FILE_ACCEPT =
  ".csv,.tsv,.txt,.xlsx,.xls,text/csv,text/tab-separated-values,text/plain," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Anything bigger than this is not a class list. Guards the browser, not us. */
export const MAX_ROSTER_BYTES = 5 * 1024 * 1024;

export class RosterFileError extends Error {}

function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * Rows from a spreadsheet, as strings.
 *
 * The reader is loaded with a dynamic import() so it never enters the main
 * bundle: every teacher would otherwise download a zip and XML parser to open a
 * page that has nothing to do with rosters. It is `read-excel-file`, which is
 * maintained -- deliberately NOT the npm `xlsx` package, whose last published
 * version there (0.18.5) carries prototype-pollution and ReDoS advisories that
 * SheetJS now fixes only on its own CDN.
 */
async function rowsFromExcel(file: File): Promise<Row[]> {
  // "read-excel-file/browser", not "read-excel-file": the package's exports
  // map has no "." entry at all, so the bare specifier does not resolve --
  // caught at bundle time by the test rather than at run time by a teacher.
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const result = (await readXlsxFile(file)) as unknown;
  return normalizeExcelRows(result);
}

/**
 * read-excel-file's return shape, flattened.
 *
 * Its documented shape is an array of rows. Against a real .xlsx it returned
 * `[{ sheet, data }]` instead -- with and without an explicit `sheet` option --
 * so both are accepted rather than one of them assumed. Assuming would have
 * produced a roster of one student called "[object Object]".
 */
export function normalizeExcelRows(result: unknown): Row[] {
  const rows = Array.isArray(result) ? result : [];
  const wrapped =
    rows.length > 0 &&
    typeof rows[0] === "object" &&
    rows[0] !== null &&
    Array.isArray((rows[0] as { data?: unknown }).data);
  const grid = (wrapped ? (rows[0] as { data: unknown[] }).data : rows) as unknown[];

  // Cells come back typed -- numbers, dates, booleans. A roster only ever
  // wants the text, and a date cell reaching a name column is a column the
  // teacher picked by mistake, which the review list will show them.
  return (grid as unknown[][]).map((row) =>
    (Array.isArray(row) ? row : []).map((cell) =>
      cell === null || cell === undefined
        ? ""
        : cell instanceof Date
          ? cell.toISOString().slice(0, 10)
          : String(cell).trim(),
    ),
  );
}

/**
 * Every supported file, as rows of strings.
 *
 * .xls -- the pre-2007 binary format -- is accepted by the file picker because
 * teachers have them and would otherwise get a silent "nothing happened", but
 * no maintained reader handles it, so it is refused with the one instruction
 * that actually works.
 */
export async function rowsFromFile(file: File): Promise<Row[]> {
  if (file.size > MAX_ROSTER_BYTES)
    throw new RosterFileError(
      "That file is larger than 5 MB, which is much bigger than a class list. Export just the roster and try again.",
    );

  const ext = extension(file.name);
  if (ext === "xls")
    throw new RosterFileError(
      "This is an older Excel file (.xls). Open it in Excel or Google Sheets and save it as .xlsx or .csv, then try again.",
    );

  if (ext === "xlsx") {
    try {
      return await rowsFromExcel(file);
    } catch (e) {
      if (e instanceof RosterFileError) throw e;
      throw new RosterFileError(
        "That Excel file couldn’t be read. Saving it as .csv from Excel or Google Sheets usually works.",
      );
    }
  }

  const text = decodeRosterBytes(await file.arrayBuffer());
  const rows = parseDelimited(text);
  if (!rows.length)
    throw new RosterFileError("That file has no rows in it.");
  return rows;
}
