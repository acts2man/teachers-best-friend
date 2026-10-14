/**
 * Grading decisions the founders make, each in one place.
 *
 * REQUIRE_CONFIRM_MATCHES (Ricky, 11 Oct 2026): after giving credit on a
 * question, a green "Confirm N answers that match the key" button appears right
 * there, and the app does not move on to class analysis while any question has
 * matching answers left unconfirmed. Matching answers stay pre-marked correct
 * the whole time (Michael's request), so it is one tap and nothing has to be
 * revisited. Set to false to go back to counting clean matches without a
 * confirmation, exactly as before.
 */
export const REQUIRE_CONFIRM_MATCHES = true;
