# Integration — A Teacher's Best Friend landing page + admin

Everything in this folder is a drop-in for the existing Next.js App Router repo.
All 23 files typecheck and `next build` succeeds against Next 15 / React 19.
Exactly one function needs wiring to the existing codebase.

## Claude Code prompt

```
Integrate the landing page, legal pages, and admin dashboard from the
tbf-build folder into this repo. Do not rewrite any of it — copy it in and
make the connections below.

1. COPY FILES
   Copy these directories into the repo root, merging with what's there:
     app/(marketing)/        -> app/(marketing)/
     app/admin/              -> app/admin/
     app/tbf-tokens.css      -> app/tbf-tokens.css
     components/marketing/   -> components/marketing/
     components/admin/       -> components/admin/
     content/legal/          -> content/legal/
     lib/supabase-admin.ts   -> lib/supabase-admin.ts
     lib/admin-gate.ts       -> lib/admin-gate.ts

2. INSTALL
   npm i react-markdown remark-gfm server-only
   (@supabase/supabase-js is already present.)

3. ROUTING
   The marketing group defines app/(marketing)/page.tsx as "/". If the
   current app root (app/page.tsx) is the teacher workspace, move it into
   a route group so it no longer claims "/":
     app/page.tsx -> app/(app)/app/page.tsx   (served at /app)
   or whatever path the existing nav expects. Keep the existing app
   layout as-is inside its own group. Update any internal links that
   pointed to "/" for the workspace.

   Leave app/layout.tsx (root) alone — the marketing and admin layouts
   each carry their own font loading and tokens import.

4. THE ONE INTEGRATION POINT
   In lib/admin-gate.ts, replace the body of getSessionUserId() with the
   same server-side session lookup that app/api/analyze/route.ts uses to
   identify the signed-in owner (from lib/teacher-server.ts). Return the
   auth user's UUID, or null if nobody is signed in. Delete the throw.

   Do not change requireAdmin(). It calls the database's is_admin()
   function, which is the authoritative check.

5. ENV
   The admin reads SUPABASE_SERVICE_ROLE_KEY. Add it to Netlify's
   environment with scope set to Functions/Runtime ONLY — never Builds.
   It must not be referenced anywhere in client code. Verify with:
     grep -r SERVICE_ROLE app components lib --include=*.tsx --include=*.ts
   Only lib/supabase-admin.ts should match, and it has "server-only" at top.

6. NAV
   Add a link to /admin in the teacher app's account menu, shown only
   when the signed-in profile has is_admin = true. Read it from the
   profiles table with the user's own session — RLS allows selecting
   your own row.

7. FOOTER
   The three legal pages are at /legal/privacy, /legal/student-data-privacy,
   and /legal/how-we-use-ai. Link them from the teacher app's footer too,
   not just the marketing footer. Add a /legal/terms placeholder or remove
   that footer link.

8. VERIFY
   - npm run build succeeds
   - / renders the landing page
   - /legal/student-data-privacy renders the SOPIPA document
   - /admin redirects to /login when signed out
   - /admin renders the overview when signed in as troy@reputationguardians.net
   - /admin redirects to / when signed in as mikezotzman@gmail.com
   - On /admin/accounts, click Mike's account, change plan to Pro with a
     reason, confirm it appears in /admin/audit, then change it back.

Report what you moved, what you wired, and the results of each verify step.
```

## What's in here

| Path | What |
|---|---|
| `app/(marketing)/page.tsx` | Landing page. Pricing table reads live from the `plans` table. |
| `app/(marketing)/layout.tsx` | Nav + footer + fonts (Fraunces, Atkinson Hyperlegible, Caveat via next/font). |
| `app/(marketing)/legal/[slug]/page.tsx` | Renders the three markdown docs in `content/legal/` as pages. |
| `components/marketing/worksheet-hero.tsx` | The hero illustration. Pure CSS. |
| `app/admin/layout.tsx` | Sidebar shell. Calls `requireAdmin()` on every page. Live badge counts. |
| `app/admin/page.tsx` | Overview: KPI strip, 30-day chart, attention items, top teachers. |
| `app/admin/accounts/` | All accounts with filters/sort; per-account detail with every admin action. |
| `app/admin/usage/` | 90-day chart, cost by model, unit economics per teacher. |
| `app/admin/tickets/` | Queue with threads and inline reply. |
| `app/admin/pipeline/` | Change model / reasoning / output cap per stage with live cost projection. |
| `app/admin/library/` | Review reteaching entries, approve/flag/retire. |
| `app/admin/standards/` | Seed coverage; codes in use with no matching standard. |
| `app/admin/audit/` | Every admin action, permanently. |
| `app/admin/actions.ts` | Server actions. Each re-checks admin and calls an audited DB function. |
| `lib/supabase-admin.ts` | Service-role client + typed readers for the admin views. Server-only. |
| `lib/admin-gate.ts` | `requireAdmin()`. One TODO to wire. |
| `app/tbf-tokens.css` | Design tokens shared by both surfaces. |

## Security model

- Every admin page and action calls `requireAdmin()`, which calls the
  database's `is_admin(uuid)` function. A user cannot self-promote: the
  `profiles` trigger blocks any user-initiated write to `is_admin`, `status`,
  `status_reason`, or `internal_notes`.
- Every admin write goes through a `SECURITY DEFINER` function that
  re-verifies `is_admin()` server-side and writes to `admin_audit_log`.
  The app check is belt; the database check is braces.
- All `admin_*` views are revoked from `anon` and `authenticated`. Only the
  service role can read them, and only server code holds that key.
- Admins cannot suspend or demote themselves.

## Before publishing the legal pages

The docs still carry `[PLACEHOLDER]` brackets and describe commitments the
app doesn't fully meet yet (auto-deletion of new uploads, delete-assessment
action, note expiry). Fill the placeholders, close those gaps, get attorney
review, then remove the draft warning at the top of each file — the page
strips it automatically on render, but it's still in the source.
