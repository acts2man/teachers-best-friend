/**
 * Where the browser logger (lib/app-events-client.ts) sends what went wrong.
 *
 * Written with the signed-in teacher's own Supabase session, not the service
 * role, so the app_events RLS policy is what decides: a teacher can insert rows
 * for themselves and read none. Signed out, nothing is stored -- there is no
 * teacher to attribute it to and no policy that would accept it.
 *
 * Every field is validated and scrubbed again here (lib/app-events.ts), so a
 * modified or stale client still cannot put free text in the table. It always
 * answers 204: the logger never waits on it and has nothing to do with an
 * error.
 */
import { BUILD_REF } from "@/lib/build-info";
import { clientEventsBody, eventRow } from "@/lib/app-events";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/server";
import { guardOrigin } from "@/lib/teacher-server";

export const dynamic = "force-dynamic";

const NOTHING = () => new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

export async function POST(request: Request) {
  try {
    guardOrigin(request);
    if (!hasSupabaseConfig()) return NOTHING();
    const text = await request.text();
    if (text.length > 60000) return NOTHING();
    const parsed = clientEventsBody.safeParse(JSON.parse(text));
    if (!parsed.success) return NOTHING();
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const teacherId = data?.claims?.sub;
    if (!teacherId) return NOTHING();
    const { sessionId, userAgent, events } = parsed.data;
    const rows = events.map((e) =>
      eventRow(e, { teacherId, sessionId, userAgent, serverBuild: BUILD_REF }),
    );
    const { error } = await supabase.from("app_events").insert(rows);
    if (error) console.error("app_events insert failed", error.code ?? "", error.message);
  } catch (error) {
    console.error("app_events route failed", error instanceof Error ? error.name : "unknown");
  }
  return NOTHING();
}
