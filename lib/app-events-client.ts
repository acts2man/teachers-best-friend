"use client";
/**
 * Sends what goes wrong in a teacher's browser to app_events.
 *
 * Until this existed the only way to learn that a screen broke on a pilot
 * teacher's phone was for them to tell us, and the only evidence was their
 * description of it. Now an uncaught error, an unhandled promise rejection, a
 * failed API call or a failed save is recorded with the route, the viewport,
 * the browser family and the build the page was compiled from -- the four
 * things every one of those reports was missing.
 *
 * Never a student name or answer: see lib/app-events.ts. Requests to
 * /api/events are fire-and-forget and never throw; a logger that can break the
 * page it is watching is worse than none.
 */
import {
  EVENTS_PER_POST,
  SESSION_EVENT_CAP,
  routeTemplate,
  scrubEventText,
  scrubStack,
  type ClientEvent,
  type EventType,
} from "./app-events";

const BUILT_FROM = process.env.COMMIT_REF || "";
const ENDPOINT = "/api/events";
const FLUSH_MS = 2000;

type Pending = ClientEvent & { type: EventType };

let installed = false;
let sent = 0;
let queue: Pending[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const seen = new Set<string>();
let sessionId = "";
// The real fetch, captured before the API-failure observer wraps it, so
// sending an event can never observe (and re-log) its own failure.
let rawFetch: typeof fetch | null = null;

function newSessionId() {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

function flush() {
  timer = null;
  if (!queue.length || !rawFetch) return;
  const batch = queue.slice(0, EVENTS_PER_POST);
  queue = queue.slice(EVENTS_PER_POST);
  const body = JSON.stringify({ sessionId, userAgent: navigator.userAgent, events: batch });
  rawFetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => {});
  if (queue.length) timer = setTimeout(flush, FLUSH_MS);
}

/**
 * Records one event. Safe to call from anywhere, any number of times: repeats
 * of the same failure on the same route are sent once, and a page load sends at
 * most SESSION_EVENT_CAP events in total.
 */
export function logAppEvent(
  type: EventType,
  fields: Omit<ClientEvent, "type" | "route" | "viewportW" | "viewportH" | "build"> = {},
) {
  if (typeof window === "undefined") return;
  try {
    if (sent >= SESSION_EVENT_CAP) return;
    const route = routeTemplate(location.pathname);
    const message = scrubEventText(fields.message ?? "");
    const key = [type, route, message.slice(0, 120), JSON.stringify(fields.detail ?? {})].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    sent++;
    queue.push({
      ...fields,
      type,
      message,
      stack: fields.stack ? scrubStack(fields.stack) : undefined,
      route,
      viewportW: Math.round(window.innerWidth),
      viewportH: Math.round(window.innerHeight),
      build: BUILT_FROM || undefined,
    });
    if (!timer) timer = setTimeout(flush, FLUSH_MS);
  } catch {
    // Never let logging break the page.
  }
}

/** Which of the app's own API calls count as a save, so their failure is a
 * sync failure rather than a generic API one. */
function apiEventType(path: string, method: string): EventType {
  if (path === "/api/workspace" && method !== "GET") return "sync_failure";
  if (path.startsWith("/api/scans/session")) return "sync_failure";
  return "api_failure";
}

/**
 * Starts listening. Called once from the signed-in app shell; later calls are
 * no-ops.
 *
 * API failures are observed by wrapping window.fetch for same-origin /api/
 * calls only: a 5xx, a 409 on a save (another device's change won), or a
 * network failure. 4xx answers that are part of normal use -- a 401 on a
 * signed-out page, a 402 when credits run out -- are not errors in the app.
 */
export function installAppEventLogging() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  sessionId = newSessionId();
  rawFetch = window.fetch.bind(window);

  window.addEventListener("error", (e) => {
    // A failed <img>/<script> load also fires "error", with no message: that
    // is a resource, not the app, and the photos the app shows fail to load
    // whenever retention has purged them.
    if (!e.message) return;
    logAppEvent("client_error", { message: e.message, stack: e.error?.stack });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason as { message?: string; stack?: string } | string | undefined;
    logAppEvent("unhandled_rejection", {
      message: typeof r === "string" ? r : r?.message || "Unhandled rejection",
      stack: typeof r === "object" ? r?.stack : undefined,
    });
  });

  const original = rawFetch;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    let path = "";
    try {
      const u = new URL(url, location.href);
      if (u.origin === location.origin) path = u.pathname;
    } catch {
      path = "";
    }
    const watched = path.startsWith("/api/") && path !== ENDPOINT;
    try {
      const response = await original(input, init);
      if (watched && (response.status >= 500 || (response.status === 409 && method !== "GET")))
        logAppEvent(apiEventType(path, method), {
          message: `${method} ${routeTemplate(path)} answered ${response.status}`,
          detail: { status: response.status, method, endpoint: routeTemplate(path) },
        });
      return response;
    } catch (error) {
      // An aborted request was cancelled on purpose (the app's own timeouts and
      // navigations); everything else is a network failure worth knowing about.
      if (watched && !(error instanceof DOMException && error.name === "AbortError"))
        logAppEvent(apiEventType(path, method), {
          message: `${method} ${routeTemplate(path)} failed: ${(error as Error)?.message ?? "network error"}`,
          detail: { status: 0, method, endpoint: routeTemplate(path) },
        });
      throw error;
    }
  };

  // Whatever is still queued goes out when the tab is hidden: on a phone that
  // is the last chance before the page may be discarded.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}
