"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireAppManager } from "@/lib/admin-gate";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { IMPERSONATION_COOKIE } from "@/lib/teacher-server";

/**
 * Starts a "view as" session and drops the app manager straight into the
 * teacher's own workspace (/app). Only app managers can call this — the
 * database function re-checks is_app_manager() itself. The session id in
 * the cookie is opaque and means nothing without the matching server-side
 * row, so it can't be forged into a different teacher.
 */
export async function startImpersonation(fd: FormData) {
  const admin = await requireAppManager();
  const teacherId = String(fd.get("teacher_id") ?? "").trim();
  if (!teacherId) throw new Error("Choose an account to view.");

  const { data, error } = await supabaseAdmin().rpc("start_impersonation", {
    p_actor: admin.id,
    p_teacher: teacherId,
  });
  if (error) throw new Error(error.message);

  const jar = await cookies();
  jar.set(IMPERSONATION_COOKIE, data as string, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 30 * 60, // matches the session's own 30-minute expiry
  });
  redirect("/app");
}
