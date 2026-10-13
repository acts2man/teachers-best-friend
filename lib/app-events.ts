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
    "and or but if then else when while after before during only also more less than into out up down over " +
    "this that these it its your you please select choose classroom latest version first sign signed session expired " +
    "account credits left plan limit reached video source start started camera minified visit full message see " +
    "observer loop completed undelivered notifications already exists gone"
  ).split(/\s+/),
);

/** Error class names a browser, fetch, React or this app actually throw. A
 * name ending in "Error" is not enough ("MariaError" would pass). */
const ERROR_CLASSES = new Set(
  (
    "Error TypeError RangeError SyntaxError ReferenceError EvalError URIError AggregateError DOMException " +
    "AbortError TimeoutError NetworkError ChunkLoadError HttpError ZodError AiCallError QuotaExceededError " +
    "NotAllowedError NotFoundError SecurityError InvalidStateError DataCloneError NotReadableError " +
    "OverconstrainedError NotSupportedError UnknownError"
  ).split(" "),
);

/** Upper-case words allowed through: acronyms, not a name in capitals. */
const ACRONYMS = new Set("JSON HTTP HTTPS API URL PDF JPEG JPG PNG HEIC HTML CSS DOM ID OK AI CORS UTF GET POST PUT PATCH DELETE".split(" "));

/** The app's own AI request modes, as its messages name them. */
const MODES = new Set(
  (
    "class_scan name_strip answer_key key_check assignment passage roster rubric writing lesson reteaching responses catalog support embedding " +
    "sync_workspace get_workspace_json"
  ).split(" "),
);

/** Property names code is written in, for "e.map", "res.json", "x.length". */
const CODE_PROPS = new Set("length map filter forEach find reduce then catch json text slice split trim push id name type value data error message status body headers current target style".split(" "));

/**
 * Code with internal structure -- never a bare word with a stray dot. A dotted
 * token is code only when it looks like code: a short receiver ("e.map"), a
 * known property at the end ("res.json"), or a camelCase / $ / _ segment --
 * so a lower-case "maria.lopez" username is not taken for one (#124 review).
 */
function codeShaped(token: string): boolean {
  if (ERROR_CLASSES.has(token) || ACRONYMS.has(token) || MODES.has(token)) return true;
  if (/^ERR_[A-Z_]+$/.test(token)) return true; // ERR_NETWORK
  if (/^#\d{1,5}$/.test(token)) return true; // "Minified React error #418"
  if (/^\d{1,5}(\.\d+)?$/.test(token)) return true; // statuses, positions, counts
  const dotted = token.match(/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/);
  if (dotted) {
    const seg = token.split(".");
    return seg[0].length <= 2 || CODE_PROPS.has(seg[seg.length - 1]) || seg.some((x) => /[A-Z_$]/.test(x.slice(1)) || /^[_$]/.test(x));
  }
  return false;
}

/** A URL or path in a message, reduced to its route template. */
function pathToken(token: string): string | null {
  if (/^https?:\/\//i.test(token) || /^\/[\w\-./:%?=&]*$/.test(token)) return routeTemplate(token) || "…";
  return null;
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
    .map((token, i, all) => {
      const path = pathToken(token);
      if (path) return path;
      const m = token.match(/^([,;:!?("'“‘\[<]*)(.*?)([,;:!?)."'”’\]>]*)$/);
      const [lead, word, trail] = m ? [m[1], m[2], m[3]] : ["", token, ""];
      if (!word || word === "…" || word === "\"…\"" || word === "<email>" || word === "<n>") return token;
      // Vocabulary counts in lower case; a capital only where a sentence
      // starts (the first word, after "SomeError:", or after a full stop),
      // so "May" or "Page" as a name mid-sentence does not pass.
      const lower = word.toLowerCase();
      const prev = all[i - 1] ?? "";
      const sentenceStart = i === 0 || /(Error|Exception):$/.test(prev) || /[.!?]$/.test(prev);
      const capitalised = word === lower.charAt(0).toUpperCase() + lower.slice(1);
      const vocab = ERROR_WORDS.has(lower) && (word === lower || (sentenceStart && capitalised));
      if (vocab || codeShaped(word)) return lead + word + trail;
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
    else if (typeof v === "string") {
      const value = k === "endpoint" ? routeTemplate(v) : v;
      if (DETAIL_STRINGS[k]?.test(value)) out[k] = value;
    }
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

/** Every path segment the app's own routes use. Anything else in a path --
 * "/students/maria-lopez" -- becomes ":seg", so a route can carry no name. */
const ROUTE_WORDS = new Set(
  (
    "account accounts admin analyze api app assessments audit auth billing callback candidates checkout classes clear " +
    "contact delete diagnostics events export guide impersonation legal lessons library login pipeline portal quota " +
    "regression release reserve resources reteach scan scans session settings signout signup standards state students " +
    "support tickets uploads usage version webhook workspace errors privacy terms student-data ai"
  ).split(" "),
);

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
    .map((seg) => (/\d{3,}|^[A-Za-z0-9_-]{20,}$/.test(seg) ? ":id" : !seg || seg.startsWith(":") || ROUTE_WORDS.has(seg) ? seg : ":seg"))
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
