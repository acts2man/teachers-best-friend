import { createClient, hasSupabaseConfig } from "@/lib/supabase/server";
import { owner, guardOrigin, apiError, HttpError } from "@/lib/teacher-server";

type QuotaRow = {
  plan_id: string | null;
  quota: number;
  used: number;
  remaining: number;
  can_scan: boolean;
};

export async function GET(request: Request) {
  try {
    guardOrigin(request);
    await owner();
    if (!hasSupabaseConfig())
      throw new HttpError(503, "Plans are not available on this host yet.");
    // my_scan_quota is granted to authenticated and scopes itself to
    // auth.uid(), so it runs with the signed-in user's session client.
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("my_scan_quota");
    if (error) {
      console.error("my_scan_quota failed", error.code ?? "", error.message);
      throw new HttpError(500, "Couldn’t load your plan. Please try again.");
    }
    const row = (Array.isArray(data) ? data[0] : data) as
      | Partial<QuotaRow>
      | undefined;
    const quota: QuotaRow = row
      ? {
          plan_id: row.plan_id ?? null,
          quota: Number(row.quota ?? 0),
          used: Number(row.used ?? 0),
          remaining: Number(row.remaining ?? 0),
          can_scan: Boolean(row.can_scan),
        }
      : { plan_id: null, quota: 0, used: 0, remaining: 0, can_scan: false };
    return Response.json(quota, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
