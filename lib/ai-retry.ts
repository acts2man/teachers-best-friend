/**
 * One retry policy for every call to the model provider.
 *
 * There was none. Any hiccup at OpenAI -- a rate limit, a 503, a connection
 * reset -- became a failed scan in front of a teacher standing at a
 * photocopier with a stack of papers. Most of those would have worked on the
 * second try half a second later.
 *
 * Deliberately free of imports: no `server-only`, no Supabase, no fetch of its
 * own. It is handed a function to call and a clock, which is what makes every
 * branch below testable with a fake fetch instead of by waiting for OpenAI to
 * have a bad afternoon.
 *
 * What it will NOT do is as important as what it will. Retrying something that
 * cannot succeed costs money, costs the teacher time, and hides the real
 * error. A 400 will be a 400 again. A schema validation failure will fail the
 * same way. And an account that is out of credit will stay out of credit --
 * see insufficient_quota below, which is the trap in this whole area.
 */

/** Statuses worth trying again. Everything else is the provider saying no. */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/** Total attempts, first included. Three is enough for a blip and cheap enough to be safe. */
export const MAX_ATTEMPTS = 3;

/** First backoff step. Doubles each time, with full jitter applied on top. */
export const BASE_DELAY_MS = 500;

/**
 * The least time an attempt is worth starting with.
 *
 * The synchronous path runs inside a Netlify function capped at 26 seconds and
 * aborts the model call at 24. Starting a retry with two seconds left buys a
 * guaranteed timeout instead of the error we already had, and the teacher
 * waits longer to be told the same thing. Below this, stop and report.
 */
export const MIN_ATTEMPT_MS = 6000;

export type AiFailureKind =
  | "rate_limit"
  | "server"
  | "network"
  | "timeout"
  | "out_of_credit"
  | "permanent";

export class AiCallError extends Error {
  constructor(
    public kind: AiFailureKind,
    /** HTTP status, or 0 for a network-level failure. */
    public status: number,
    /** Provider detail, for the logs and the scans row. Never shown to a teacher. */
    public detail: string,
    /** How many attempts were made in total, including this one. */
    public attempts: number,
  ) {
    super(detail);
    this.name = "AiCallError";
  }
}

/** What a teacher is told, by failure kind. Never a provider message. */
export const TEACHER_MESSAGES: Record<AiFailureKind, string> = {
  // The account itself is out of credit. Every teacher is affected at once and
  // none of them can do anything about it, so it does not read as their fault
  // and does not suggest trying again.
  out_of_credit:
    "Grading is temporarily unavailable. Your pages are saved and nothing was charged.",
  rate_limit:
    "The AI service is busy right now. Your pages are saved — please try again in a minute.",
  server:
    "The AI service couldn’t complete this analysis. Your documents are saved; please try again later.",
  network:
    "We couldn’t reach the AI service. Your documents are saved — please try again.",
  timeout:
    "This analysis took too long to finish. Your documents are saved — please try again with fewer pages.",
  permanent:
    "The AI service couldn’t complete this analysis. Your documents are saved; please try again later.",
};

/**
 * Is this response body OpenAI saying the account has no credit left?
 *
 * THE TRAP. `insufficient_quota` arrives as a 429, and 429 otherwise means
 * "too fast, slow down" -- exactly the thing retrying is for. This one is not
 * that. It means the billing account is empty. Retrying cannot help, it burns
 * the teacher's time, and because it affects every teacher at once the only
 * useful response is to stop and shout at an operator.
 *
 * Matched on the error code rather than the prose, which OpenAI rewords.
 */
export function isOutOfCredit(status: number, body: string): boolean {
  if (status !== 429) return false;
  return /insufficient_quota/i.test(body);
}

/**
 * A refusal on policy grounds. Same content, same refusal, every time.
 */
export function isContentRefusal(status: number, body: string): boolean {
  if (status !== 400) return false;
  return /content_policy|content_filter|invalid_prompt|safety/i.test(body);
}

export function classify(status: number, body: string): AiFailureKind {
  if (isOutOfCredit(status, body)) return "out_of_credit";
  if (isContentRefusal(status, body)) return "permanent";
  if (status === 429) return "rate_limit";
  if (RETRYABLE_STATUS.has(status)) return status === 408 ? "timeout" : "server";
  return "permanent";
}

export function isRetryableKind(kind: AiFailureKind): boolean {
  return kind === "rate_limit" || kind === "server" || kind === "network" || kind === "timeout";
}

/**
 * A network-level failure rather than an HTTP response.
 *
 * fetch rejects with a TypeError for a dropped connection, a DNS failure or a
 * refused socket, and with an AbortError/TimeoutError when our own deadline
 * fires. All of them are worth one more go.
 */
export function isNetworkError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e.name === "TimeoutError" || e.name === "AbortError") return true;
  if (e.name === "TypeError") return true;
  return /ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|network|fetch failed/i.test(
    e.message,
  );
}

/**
 * How long the provider asked us to wait, in milliseconds.
 *
 * Retry-After is either seconds or an HTTP date. Honouring it matters: when
 * OpenAI says four seconds and we come back in half a second, the second
 * attempt is refused too and we have spent an attempt learning nothing.
 * Returns null when absent or unparseable.
 */
export function retryAfterMs(header: string | null, now: number): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const ms = Number(trimmed) * 1000;
    return Number.isFinite(ms) && ms >= 0 ? ms : null;
  }
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

/**
 * Exponential backoff with FULL jitter: a random wait in [0, window).
 *
 * Not "exponential plus a little noise". When a rate limit clears, every
 * request that was refused retries at once, and a fixed backoff schedules them
 * all for the same instant -- the stampede that caused the rate limit
 * reassembles itself. Full jitter spreads them across the window instead.
 */
export function backoffMs(attempt: number, random = Math.random): number {
  const window = BASE_DELAY_MS * 2 ** (attempt - 1);
  return Math.floor(random() * window);
}

export type RetryOptions = {
  /** Wall-clock instant after which no new attempt may start. */
  deadline: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Called when the account is out of credit, so an operator alert can fire. */
  onOutOfCredit?: (detail: string) => void | Promise<void>;
  /** Named in logs so a failure can be traced to a call site. */
  label?: string;
};

export type Attempted<T> = { value: T; attempts: number };

/**
 * Runs `call` until it succeeds, is refused for a reason retrying cannot fix,
 * or runs out of attempts or time.
 *
 * `call` returns the parsed value, or throws. An HTTP failure should be thrown
 * as an AiCallError so the kind is already decided; anything else is treated
 * as a network error if it looks like one and as permanent if it does not.
 */
export async function withRetry<T>(
  call: () => Promise<T>,
  options: RetryOptions,
): Promise<Attempted<T>> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = options.random ?? Math.random;

  let attempts = 0;
  let last: AiCallError | null = null;

  while (attempts < MAX_ATTEMPTS) {
    attempts += 1;
    try {
      return { value: await call(), attempts };
    } catch (e) {
      const failure = toAiCallError(e, attempts);
      last = failure;

      if (failure.kind === "out_of_credit") {
        // Never retried. Reported once, loudly, because no teacher can fix it
        // and every one of them is about to hit it.
        await options.onOutOfCredit?.(failure.detail);
        throw failure;
      }
      if (!isRetryableKind(failure.kind)) throw failure;
      if (attempts >= MAX_ATTEMPTS) throw failure;

      // Wait as long as the provider asked, or back off with jitter.
      const wait =
        (failure.retryAfterMs ?? null) !== null
          ? (failure.retryAfterMs as number)
          : backoffMs(attempts, random);

      // The budget check, and the reason this takes a deadline rather than an
      // attempt count. Starting an attempt that cannot finish inside the
      // function's own lifetime turns a reportable error into a gateway
      // timeout, which is strictly worse for the teacher.
      const remaining = options.deadline - now() - wait;
      if (remaining < MIN_ATTEMPT_MS) {
        failure.detail += ` (gave up after ${attempts}: ${Math.max(0, Math.round(remaining))}ms left, needs ${MIN_ATTEMPT_MS}ms)`;
        throw failure;
      }
      if (wait > 0) await sleep(wait);
    }
  }

  /* c8 ignore next */
  throw last ?? new AiCallError("permanent", 0, "no attempt was made", attempts);
}

/** An AiCallError carries its own Retry-After; anything else is classified here. */
function toAiCallError(e: unknown, attempts: number): AiCallError & { retryAfterMs?: number } {
  if (e instanceof AiCallError) {
    e.attempts = attempts;
    return e;
  }
  if (isNetworkError(e)) {
    const err = e as Error;
    return new AiCallError(
      err.name === "TimeoutError" || err.name === "AbortError" ? "timeout" : "network",
      0,
      `${err.name}: ${err.message}`,
      attempts,
    );
  }
  return new AiCallError(
    "permanent",
    0,
    e instanceof Error ? e.message : String(e),
    attempts,
  );
}

/**
 * Turns a failed provider Response into the error the policy above understands.
 * Reads the body once, for the error code and for the logs.
 */
export async function errorFromResponse(
  response: { status: number; headers: { get(name: string): string | null }; text(): Promise<string> },
  where: string,
  now = Date.now(),
): Promise<AiCallError & { retryAfterMs?: number }> {
  let body = "";
  try {
    body = (await response.text()).slice(0, 400);
  } catch {
    // The status alone is still enough to classify it.
  }
  const kind = classify(response.status, body);
  const err = new AiCallError(
    kind,
    response.status,
    `openai ${where} ${response.status}${body ? ": " + body : ""}`,
    1,
  ) as AiCallError & { retryAfterMs?: number };
  const after = retryAfterMs(response.headers.get("retry-after"), now);
  if (after !== null) err.retryAfterMs = after;
  return err;
}
