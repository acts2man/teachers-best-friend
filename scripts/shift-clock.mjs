// Moves the clock by SHIFT_DAYS (negative: back) for a test run, so a test
// that quietly depends on today's date fails here instead of on the day the
// calendar reaches its fixed date (tests/stale-failed-count.test.mjs did, on
// 5 Nov 2026). Used by `npm run test:clock` and tests/clock-independence.test.mjs:
//   SHIFT_DAYS=-400 node --import ./scripts/shift-clock.mjs --test ...
const shift = Number(process.env.SHIFT_DAYS || 0) * 24 * 60 * 60 * 1000;
if (shift) {
  const RealDate = Date;
  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + shift);
      else super(...args);
    }
    static now() {
      return RealDate.now() + shift;
    }
  }
  globalThis.Date = ShiftedDate;
}
