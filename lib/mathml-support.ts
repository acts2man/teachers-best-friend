/**
 * Whether this browser lays out MathML (#186 review). MathML Core is in
 * Chrome 109+, Safari and Firefox; older Chrome, old Android WebViews and
 * out-of-support Chromebooks show a <math> element's letters run together,
 * so "(x-2)^2" would read "(x−2)2". There the lesson text is shown, and
 * printed, exactly as typed.
 *
 * The test is the usual one: an <mspace> of a set size measures that size
 * only where MathML is laid out. Measured once, then remembered.
 */
let known: boolean | null = null;

export function supportsMathML(): boolean {
  if (known !== null) return known;
  if (typeof document === "undefined" || !document.body) return false;
  try {
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:absolute;visibility:hidden;left:-9999px;top:0";
    probe.innerHTML = '<math><mspace height="23px" width="77px"></mspace></math>';
    document.body.appendChild(probe);
    const box = probe.querySelector("mspace")?.getBoundingClientRect();
    probe.remove();
    known = !!box && Math.abs(box.width - 77) <= 1 && Math.abs(box.height - 23) <= 1;
  } catch {
    known = false;
  }
  return known;
}
