/**
 * The AI-spend list in the admin (Ricky, 19 Oct 2026): "it gave me multiple
 * whole-class scans … It is hard to know what it cost. Bc I scanned 66 pages
 * in a set, did it split into many scans? It did the same thing with the name
 * read scans. Also, could we see the ai spend beyond 50 recent? Or could we
 * click on a section like 'whole-class scans' and see more info on each".
 *
 * One class set is many AI calls by design: a name read per few pages and a
 * grading call per batch of students (lib/teacher-class-scan.ts). The scans
 * table keeps one row per call and does not record which set a call belonged
 * to, so a set is found the way a person would: the same teacher's name reads
 * and grading calls, each within SET_GAP of the one before, on the same test
 * where the row names one. Checked against production (read-only, 5 Nov
 * 2026): calls inside a set are under a minute apart, sets are 20 minutes or
 * more apart, and the 66-page set of 20 Oct reads as one set of 44 calls.
 *
 * The list is paged by ITEM -- a set counts once -- newest first, so a page
 * never cuts a set in two. Pure: the caller hands in how to fetch rows.
 */

/** The kinds of work a class set is made of. */
export const SET_STAGES = ["class_scan", "name_strip"] as const;
const SET_STAGE = new Set<string>(SET_STAGES);
/** A longer pause than this between two calls starts a new set. */
export const SET_GAP_MS = 15 * 60 * 1000;
export const PAGE_SIZE = 50;

export type SpendRow = {
  id: string;
  teacher_id: string;
  stage: string | null;
  status: string;
  created_at: string;
  cost_usd: number | string | null;
  assessment_id: string | null;
  charge_keys: string[] | null;
};

export type SpendSet<R extends SpendRow = SpendRow> = {
  kind: "set";
  teacherId: string;
  /** Newest first, as listed. */
  rows: R[];
  start: string;
  end: string;
  assessmentId: string | null;
  /** Pages charged: the distinct page keys on its grading calls. */
  pages: number;
  nameReads: number;
  gradingCalls: number;
  failed: number;
  cost: number;
};
export type SpendCall<R extends SpendRow = SpendRow> = { kind: "call"; row: R; cost: number };
export type SpendItem<R extends SpendRow = SpendRow> = SpendSet<R> | SpendCall<R>;

const money = (v: number | string | null) => Number(v ?? 0) || 0;

function finish<R extends SpendRow>(rows: R[]): SpendSet<R> {
  const keys = new Set<string>();
  for (const r of rows) if (r.stage === "class_scan") for (const k of r.charge_keys ?? []) keys.add(k);
  return {
    kind: "set",
    teacherId: rows[0].teacher_id,
    rows,
    start: rows[rows.length - 1].created_at,
    end: rows[0].created_at,
    assessmentId: rows.find((r) => r.assessment_id)?.assessment_id ?? null,
    pages: keys.size,
    nameReads: rows.filter((r) => r.stage === "name_strip").length,
    gradingCalls: rows.filter((r) => r.stage === "class_scan").length,
    failed: rows.filter((r) => r.status === "failed" || r.status === "canceled").length,
    cost: rows.reduce((n, r) => n + money(r.cost_usd), 0),
  };
}

/** Rows (newest first) as list items: each class set as one, every other call on its own. */
export function groupSpend<R extends SpendRow>(rows: R[]): SpendItem<R>[] {
  const items: SpendItem<R>[] = [];
  let open: R[] = [];
  let openTest: string | null = null;
  const close = () => {
    if (open.length) items.push(finish(open));
    open = [];
    openTest = null;
  };
  for (const r of rows) {
    if (!r.stage || !SET_STAGE.has(r.stage)) {
      close();
      items.push({ kind: "call", row: r, cost: money(r.cost_usd) });
      continue;
    }
    const last = open[open.length - 1];
    const continues =
      !!last &&
      last.teacher_id === r.teacher_id &&
      Date.parse(last.created_at) - Date.parse(r.created_at) <= SET_GAP_MS &&
      !(openTest && r.assessment_id && r.assessment_id !== openTest);
    if (!continues) close();
    open.push(r);
    openTest = openTest ?? r.assessment_id;
  }
  close();
  return items;
}

/** Fetches `size` rows, newest first, starting `from` rows in. */
export type FetchRows = (from: number, size: number) => Promise<SpendRow[]>;

/**
 * One page of the list: up to `size` items starting `from` rows in, and where
 * the next page starts (null on the last). Fetches more rows while the last
 * set on the page might still go on, so a set is never split across pages.
 */
export async function spendPage(
  fetchRows: FetchRows,
  { from = 0, size = PAGE_SIZE, chunk = 100, maxRows = 5000 }: { from?: number; size?: number; chunk?: number; maxRows?: number } = {},
): Promise<{ items: SpendItem[]; next: number | null }> {
  const rows: SpendRow[] = [];
  let more = true;
  // Enough rows for size + 1 items: the extra one shows the last item ended.
  while (more && rows.length < maxRows) {
    const got = await fetchRows(from + rows.length, chunk);
    rows.push(...got);
    more = got.length === chunk;
    if (groupSpend(rows).length > size) break;
  }
  const items = groupSpend(rows);
  const page = items.slice(0, size);
  const used = page.reduce((n, it) => n + (it.kind === "set" ? it.rows.length : 1), 0);
  const next = items.length > size || (more && used === rows.length) ? from + used : null;
  return { items: page, next };
}

export type SpendSearch = { teacher?: string; stage?: string; from?: string };

/** The spend list's address (app/admin/usage/spend) with some filters changed. */
export function spendHref(base: SpendSearch, change: SpendSearch = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...change })) if (v) p.set(k, v);
  const q = p.toString();
  return "/admin/usage/spend" + (q ? "?" + q : "");
}
