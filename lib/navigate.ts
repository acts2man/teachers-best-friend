/**
 * Go to an in-app URL (the app's go()).
 *
 * Ricky (phone, 26 Oct 2026): inside a test, "All assessments" did nothing.
 * The screens are force-static pages (app/[view]/page.tsx). On Next 16.2.6,
 * once such a page has been loaded in full with a query -- a refresh, a
 * shared link, the phone reloading the tab after the camera --
 * router.push() to any URL on that same page (/assessments from
 * /assessments?id=...) leaves the URL and the screen exactly where they
 * were. Pushes to another page are fine, and so is the same push when the
 * test was opened from inside the app, which is why it never showed on a
 * computer that clicked its way in.
 *
 * So a URL on the current page goes through history.pushState, which Next
 * keeps in step with useSearchParams (and the browser's Back button still
 * returns to the test). Every other URL goes through the router as before.
 */
export function navigate(
  router: { push: (url: string) => void },
  url: string,
  loc: Pick<Location, "href" | "origin" | "pathname"> = window.location,
  hist: Pick<History, "pushState"> = window.history,
) {
  const next = new URL(url, loc.href);
  if (next.origin === loc.origin && next.pathname === loc.pathname) {
    hist.pushState(null, "", next.pathname + next.search + next.hash);
    return;
  }
  router.push(url);
}
