/**
 * What an app_events row may carry, shared by the browser logger, the
 * /api/events route and the server-side AI-failure logger.
 *
 * The rule everything here serves: an event says WHAT broke, WHERE, on WHICH
 * device and WHICH build -- never anything a student wrote and never a
 * student's name. The fields are fixed; the only free text is an error message
 * and a stack, and both go through scrubEventText before they leave the page
 * and again on the server. See the app_events migration for the size backstop.
 */
import { z } from "zod";

export const EVENT_TYPES = [
  "client_error",
  "unhandled_rejection",
  "api_failure",
  "ai_failure",
  "sync_failure",
  "forced_test",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const DEVICE_CLASSES = ["phone", "tablet", "desktop", "server", "unknown"] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

/** Most events one page load sends. The database caps a session at 40 per 10
 * minutes as well; this keeps a looping error from even trying. */
export const SESSION_EVENT_CAP = 25;
/** Most events in one POST to /api/events. */
export const EVENTS_PER_POST = 10;

/**
 * Words an error message is allowed to keep: the vocabulary browsers, fetch,
 * JSON, React and this app's own errors are written in. Anything else that is
 * not code-shaped becomes "…" (#124 review: unquoted text such as "Student
 * Maria Lopez not found" used to pass straight through).
 */
const ERROR_WORDS = new Set(
  (
    "a an the of to in on at for from by with without is are was were be been not no cannot can't could " +
    "read reading properties property undefined null nan object function is not a valid invalid unexpected token end " +
    "json input position line column parse syntax type reference range error errors exception failed failure fail " +
    "fetch network request response timeout timed out aborted abort abortsignal load loading chunk module script " +
    "missing found exceeded maximum call stack size memory quota storage access denied permission forbidden " +
    "unauthorized unavailable service server client status code http https offline connection reset refused closed " +
    "upload download file image page pages photo scan scans grading grade name names class student students " +
    "assessment workspace save saving sync conflict revision changed another tab reload try again later " +
    "short batch retry retries attempt still some answers may blank empty unread result results model mode kind " +
    "stopped incomplete unparseable too many large small long minified react hydration render rendering hook hooks " +
    "mismatch element child children key keys unique prop props state update unmounted component components " +
    "and or but if then else when while after before during only also more less than into out up down over"
  ).split(/\s+/),
);

/** Code, not words: identifiers, paths, numbers, status codes, constants. */
function codeShaped(token: string): boolean {
  return (
    /^[A-Z][a-zA-Z]*(Error|Exception)$/.test(token) || // TypeError, DOMException
    /^[A-Z]{2,}[A-Z0-9_]*$/.test(token) || // JSON, HTTP, ERR_NETWORK
    /^[a-z]+[A-Z][A-Za-z0-9]*$/.test(token) || // camelCase identifiers
    /[_.()[\]/:<>=#]/.test(token) || // a.b, fn(), /api/x, key:value
    /^\d{1,5}$/.test(token) // statuses, positions, counts
  );
}

/**
 * Error text with anything that could be a student's words taken out.
 *
 * An error message is code talking -- "Cannot read properties of undefined
 * (reading 'length')" -- but it can echo data: a failed JSON.parse quotes the
 * text it choked on, a validation error quotes the value, and an app message
 * can name a student. So: quoted spans go, email addresses and long digit runs
 * go, and then every remaining word that is neither error vocabulary nor
 * code-shaped is replaced by "…". What is left says what failed, never who or
 * what was being processed.
 */
export function scrubEventText(text: unknown, max = 500): string {
  if (typeof text !== "string") return "";
  return text
    .replace(/"[^"]{0,400}"|'[^']{0,400}'|`[^`]{0,400}`|“[^”]{0,400}”|‘[^’]{0,400}’/g, "\"…\"")
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "<email>")
    .replace(/\d{6,}/g, "<n>")
    .split(/\s+/)
    .map((token) => {
      const word = token.replace(/^[,;:!?(]+|[,;:!?)]+$/g, "");
      if (!word || word === "\"…\"" || word === "<email>" || word === "<n>") return token;
      if (ERROR_WORDS.has(word.toLowerCase()) || codeShaped(word)) return token;
      return "…";
    })
    .join(" ")
    .replace(/…(\s+…)+/g, "…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** detail keys that may carry a string, and the shape each must have. Any
 * other string is dropped: a detail is small structured facts, never text. */
const DETAIL_STRINGS: Record<string, RegExp> = {
  mode: /^[a-z_]{1,24}$/,
  kind: /^[a-z_]{1,24}$/,
  effort: /^[a-z]{1,12}$/,
  model: /^[a-z0-9][a-z0-9.\-]{0,39}$/,
  method: /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/,
  endpoint: /^\/[a-z0-9_\-/:]{0,120}$/i,
};

/** The detail object as stored: numbers and booleans as given, strings only
 * under the keys above and in their shape, at most 12 entries. */
export function scrubDetail(detail: unknown): Record<string, string | number | boolean> | null {
  if (!detail || typeof detail !== "object") return null;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(detail as Record<string, unknown>).slice(0, 12)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,29}$/.test(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "string" && DETAIL_STRINGS[k]?.test(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * A stack trace reduced to code locations: one "fn@file:line:col" per frame.
 * Function names and bundle paths are code, not data; the message line at the
 * top of a stack is dropped here because it is logged (scrubbed) separately.
 */
export function scrubStack(stack: unknown, max = 4000): string {
  if (typeof stack !== "string") return "";
  const frames = stack
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^at\s|@|:\d+:\d+/.test(l) && !/^[A-Za-z]*Error[:\s]/.test(l))
    .map((l) => l.replace(/^at\s+/, "").replace(/\?[^\s:)]*/g, "").slice(0, 200))
    .slice(0, 30);
  return frames.join("\n").slice(0, max);
}

const UUIDISH = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * The route as a template: no query string (that is where ids and names ride),
 * no fragment, and every id-like path segment replaced by ":id". "/assessments"
 * stays itself; "/api/analyze/3f0c…" becomes "/api/analyze/:id".
 */
export function routeTemplate(urlOrPath: unknown): string {
  if (typeof urlOrPath !== "string" || !urlOrPath) return "";
  let path = urlOrPath;
  try {
    path = new URL(urlOrPath, "http://x").pathname;
  } catch {
    path = urlOrPath.split(/[?#]/)[0];
  }
  return path
    .replace(UUIDISH, ":id")
    .split("/")
    .map((seg) => (/\d{3,}|^[A-Za-z0-9_-]{20,}$/.test(seg) ? ":id" : seg))
    .join("/")
    .slice(0, 200);
}

/** phone / tablet / desktop from the viewport width, with the user agent as a
 * tie-break for a desktop browser shrunk to phone width. */
export function deviceClass(width: number, userAgent = ""): DeviceClass {
  if (!Number.isFinite(width) || width <= 0) return "unknown";
  const mobileUa = /Mobi|Android|iPhone|iPod/i.test(userAgent);
  const tabletUa = /iPad|Tablet/i.test(userAgent) || (/Android/i.test(userAgent) && !/Mobi/i.test(userAgent));
  if (width < 600) return mobileUa || !userAgent ? "phone" : "desktop";
  if (width < 1024) return tabletUa || mobileUa ? "tablet" : "desktop";
  return "desktop";
}

/** "Safari 18 / iOS", "Chrome 131 / Android", "Brave / Windows"... a family
 * and major version, never the full user-agent string. */
export function browserName(userAgent: unknown): string {
  if (typeof userAgent !== "string" || !userAgent) return "unknown";
  const ua = userAgent;
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "other";
  const pick = (re: RegExp, name: string) => {
    const m = ua.match(re);
    return m ? `${name} ${m[1]}` : null;
  };
  const family =
    (/Brave/.test(ua) ? "Brave" : null) ||
    pick(/EdgA?\/(\d+)/, "Edge") ||
    pick(/SamsungBrowser\/(\d+)/, "Samsung") ||
    pick(/Firefox\/(\d+)|FxiOS\/(\d+)/, "Firefox") ||
    pick(/CriOS\/(\d+)/, "Chrome") ||
    pick(/Chrome\/(\d+)/, "Chrome") ||
    pick(/Version\/(\d+).*Safari/, "Safari") ||
    "other";
  return `${family} / ${os}`.slice(0, 80);
}

const shortText = (max: number) => z.string().max(max * 4).transform((s) => scrubEventText(s, max));

/** One event as the browser sends it. Everything optional but the type; every
 * string scrubbed and capped on the way in, whatever the client already did. */
export const clientEventSchema = z.object({
  type: z.enum(EVENT_TYPES),
  message: shortText(500).optional(),
  stack: z.string().max(16000).transform((s) => scrubStack(s)).optional(),
  route: z.string().max(2000).transform(routeTemplate).optional(),
  viewportW: z.number().int().min(0).max(20000).optional(),
  viewportH: z.number().int().min(0).max(20000).optional(),
  build: z.string().regex(/^[0-9a-f]{0,40}$/i).optional(),
  assessmentId: z.string().max(80).regex(/^[A-Za-z0-9_-]*$/).optional(),
  scanId: z.string().max(80).regex(/^[A-Za-z0-9_-]*$/).optional(),
  // Small, structured facts only: numbers, booleans and short enum-like words.
  detail: z
    .record(z.union([z.number(), z.boolean(), z.string().max(60).regex(/^[A-Za-z0-9_.:/ -]*$/)]))
    .refine((d) => Object.keys(d).length <= 12)
    // Then narrower still: only known keys may carry a string, in their shape.
    .transform(scrubDetail)
    .optional(),
});
export type ClientEvent = z.input<typeof clientEventSchema>;

export const clientEventsBody = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  userAgent: z.string().max(400).optional(),
  events: z.array(clientEventSchema).min(1).max(EVENTS_PER_POST),
});

/** The row written to app_events, from one validated client event. */
export function eventRow(
  e: z.output<typeof clientEventSchema>,
  ctx: { teacherId: string; sessionId: string; userAgent?: string; serverBuild: string },
) {
  return {
    teacher_id: ctx.teacherId,
    session_id: ctx.sessionId,
    build_commit: (e.build || ctx.serverBuild || "").slice(0, 64) || null,
    route: e.route || null,
    device_class: deviceClass(e.viewportW ?? 0, ctx.userAgent ?? ""),
    viewport_w: e.viewportW ?? null,
    viewport_h: e.viewportH ?? null,
    browser: browserName(ctx.userAgent),
    event_type: e.type,
    message: e.message || null,
    stack: e.stack || null,
    assessment_id: e.assessmentId || null,
    scan_id: e.scanId || null,
    detail: e.detail ?? null,
  };
}
