/**
 * Auto-snap decision logic, kept pure so the timing can be tested without a
 * camera.
 *
 * Rule (Ricky's ask): when a page is detected and the phone is held steady for
 * about a second, capture automatically; then wait for the page to change
 * before arming again, so the same page is never snapped twice. Manual shutter
 * is unaffected — the component always allows a tap.
 */
import { quadDrift, type Quad } from "@/lib/edge-detect";

export type AutoSnapState = {
  /** When the current steady period began (ms), or null while moving. */
  steadySince: number | null;
  /** The quad from the previous frame, for drift comparison. */
  lastQuad: Quad | null;
  /** True after a snap: waiting for the page to change before arming again. */
  cooling: boolean;
};

export type AutoSnapConfig = {
  /** How long the page must hold steady before auto-capture (ms). */
  holdMs: number;
  /** Corner movement (detection-space px) that counts as "the page changed". */
  driftTol: number;
};

export const AUTO_SNAP_DEFAULTS: AutoSnapConfig = { holdMs: 900, driftTol: 14 };

export const initialAutoSnapState: AutoSnapState = {
  steadySince: null,
  lastQuad: null,
  cooling: false,
};

/**
 * Advance the auto-snap machine by one detection frame.
 * Returns the next state and whether to fire the shutter now.
 */
export function autoSnapStep(
  state: AutoSnapState,
  input: { quad: Quad | null; now: number },
  config: AutoSnapConfig = AUTO_SNAP_DEFAULTS,
): { state: AutoSnapState; fire: boolean } {
  const { quad, now } = input;
  const { holdMs, driftTol } = config;

  // No page in view: nothing to hold, and losing the page clears any cooldown
  // so the next page can arm fresh.
  if (!quad) {
    return { state: { steadySince: null, lastQuad: null, cooling: false }, fire: false };
  }

  const drift = quadDrift(quad, state.lastQuad);

  // After a snap, wait until the page meaningfully changes (or leaves) before
  // arming again — this is what stops a double-snap of the same page.
  if (state.cooling) {
    if (drift > driftTol) {
      return { state: { steadySince: now, lastQuad: quad, cooling: false }, fire: false };
    }
    return { state: { ...state, lastQuad: quad }, fire: false };
  }

  // Moving: (re)start the steady window on the next still frame.
  if (drift > driftTol) {
    return { state: { steadySince: null, lastQuad: quad, cooling: false }, fire: false };
  }

  // Steady. Start timing, or fire once the hold has elapsed.
  const since = state.steadySince ?? now;
  if (now - since >= holdMs) {
    return { state: { steadySince: null, lastQuad: quad, cooling: true }, fire: true };
  }
  return { state: { steadySince: since, lastQuad: quad, cooling: false }, fire: false };
}
