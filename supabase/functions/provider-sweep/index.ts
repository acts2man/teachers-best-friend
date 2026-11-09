import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Hourly trigger for the provider-retention sweep (review of #203).
//
// The sweep itself runs in the Next.js app (app/api/cron/provider-sweep),
// because deleting the AI provider's stored copy of a background job needs the
// OpenAI key, which lives only in the app -- not in the database and not here.
// This function is a thin, scheduled trigger: pg_cron calls it over pg_net
// (job "sweep-provider-copies"), it POSTs to the app with a shared secret, and
// passes the app's count-only report back. It holds no OpenAI key and reads no
// job content.
//
// Secrets (set as edge-function secrets, not in the repo):
//   APP_SWEEP_URL   the app's sweep route, e.g.
//                   https://teachersbestfriend.netlify.app/api/cron/provider-sweep
//                   (the app is the Netlify site; ateachersbestfriend.com is the
//                   separate WordPress marketing site and must NOT be used here)
//   CRON_SECRET     the same value the app route checks

Deno.serve(async () => {
  const url = Deno.env.get("APP_SWEEP_URL");
  const secret = Deno.env.get("CRON_SECRET");
  if (!url || !secret) {
    return new Response(JSON.stringify({ ok: false, error: "missing APP_SWEEP_URL or CRON_SECRET" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + secret, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(55000),
    });
    const body = await r.text();
    return new Response(body, { status: r.status, headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.name : "unknown" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
});
