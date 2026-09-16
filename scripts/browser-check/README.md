# Browser check

A real browser clicking through the real app. This exists because the rest of
the checks in this repo (typecheck, lint, the module tests) all pass on code
that renders a blank screen -- "it compiles" and "the teacher can use it" are
different claims, and only one of them was ever being verified.

Nothing here runs in CI yet. It is a harness you point at a running build when
you want to answer "does the thing I just changed still work when clicked".

## Running it

```bash
npm run build
NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... npx next start -p 3100

node scripts/browser-check/routes.mjs        # every route loads, no console errors
node scripts/browser-check/make-fixture.mjs  # writes out/fixture.json
node scripts/browser-check/click-through.mjs # drives the signed-in UI, writes out/*.png
```

`BASE_URL` overrides the server address, `CHROMIUM` the browser binary.
Everything written lands in `out/`, which is ignored.

## What each script covers

**`routes.mjs`** walks every public and app route, and reports the HTTP status,
where it finally landed after redirects, how much text rendered, and any
console error. It catches the two failures that are easy to ship: a route that
500s, and a route that returns 200 but paints nothing. Redirects are part of
the assertion -- an app route must land on `/login?next=<route>`, so this also
proves the auth guard is on and the return path is preserved.

**`make-fixture.mjs`** builds the mock workspace by bundling and calling the
app's own `createDemoWorkspace()`. The fixture is therefore the exact shape
`get_workspace_json` returns. A fixture written by hand drifts from the schema
and starts passing tests the app would fail.

**`click-through.mjs`** intercepts `/api/workspace` and `/api/quota`, serves
that fixture, and then uses the UI the way a teacher does: clicks each sidebar
destination, waits for the URL, and checks the screen that arrives. The two
route mocks are the only fiction; the components, routing and state are real.

Both endpoints are mocked rather than signed into because a signed-in session
needs credentials this harness should not carry. That is also the limit of what
it proves: rendering, routing and navigation. Saving, uploading and analysis go
through those two mocked endpoints and are *not* covered here.

## `make-two-class-fixture.mjs` + `class-switch.mjs`

A teacher with two classes at different grades, which is the case the database
cannot speak to. `get_workspace_json` returns the same payload whether the
teacher signs in or an app manager views their account — `readWorkspace` reads
through the service client either way — so when one person sees standards and
another does not on the *same* account, the difference is in the browser, not
the data.

```bash
node scripts/browser-check/make-two-class-fixture.mjs
node scripts/browser-check/class-switch.mjs
```

It opens Standards on a Grade 7 California class, switches to a Grade 4 Common
Core class, and switches back, printing the codes on screen each time.

This was written to test the theory that `StandardsView` froze on whichever
class it first mounted with, since it seeds `framework` and `grade` from
`classroom` via `useState`. **The theory was wrong.** The view wrapper in
`teacher-app.tsx` is keyed `view + "-" + classroom.id`, so changing class
remounts the subtree and the seed is re-read. Verified by running this against
builds either side of that change: both follow the switch, identically.

Worth keeping as a regression test — the correctness of the Standards screen
currently depends on that `key`, which is not obvious from the component, and
this is what would catch it if the key ever moved.
