/**
 * What is actually running right now.
 *
 * On 17 Sep a pilot teacher reported alignment showing as "1%". The fix had
 * been merged two days earlier and was correct; it had simply never been
 * deployed. Nothing in the app could say which build was live, so the only
 * way to find out was to read the model's stored output out of the database
 * and infer the build from its shape. That took an hour and a complaint.
 *
 * This endpoint makes the same question a five-second check. Netlify sets
 * COMMIT_REF at build time; compare it against `git rev-parse origin/main`.
 * Public on purpose -- a commit SHA is already visible in the repository, and
 * an endpoint that needs a login cannot be checked when login is what broke.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      commit: process.env.COMMIT_REF ?? null,
      branch: process.env.BRANCH ?? null,
      builtAt: process.env.BUILD_TIME ?? null,
      context: process.env.CONTEXT ?? null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
