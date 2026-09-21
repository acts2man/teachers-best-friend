"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireAdmin, requireAppManager } from "@/lib/admin-gate";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { deleteTeacherAccount } from "@/lib/account-deletion-server";

/* Every write goes through an audited database function that itself
   re-verifies is_admin(). The app-layer check is belt; the DB check is braces. */

async function ip() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-nf-client-connection-ip") ?? null;
}

function str(fd: FormData, k: string) { const v = fd.get(k); return typeof v === "string" ? v.trim() : ""; }

export async function setPlan(fd: FormData) {
  const admin = await requireAdmin();
  const { error } = await supabaseAdmin().rpc("admin_set_plan", {
    p_actor: admin.id, p_teacher: str(fd, "teacher_id"), p_plan: str(fd, "plan_id"), p_reason: str(fd, "reason") || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin"); revalidatePath(`/admin/accounts/${str(fd, "teacher_id")}`); revalidatePath("/admin/accounts");
}

export async function setStatus(fd: FormData) {
  const admin = await requireAdmin();
  const { error } = await supabaseAdmin().rpc("admin_set_status", {
    p_actor: admin.id, p_teacher: str(fd, "teacher_id"), p_status: str(fd, "status"), p_reason: str(fd, "reason") || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/accounts/${str(fd, "teacher_id")}`); revalidatePath("/admin/accounts");
}

export async function setAdminRole(fd: FormData) {
  const admin = await requireAdmin();
  const { error } = await supabaseAdmin().rpc("admin_set_admin", {
    p_actor: admin.id, p_teacher: str(fd, "teacher_id"), p_is_admin: str(fd, "is_admin") === "true",
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/accounts/${str(fd, "teacher_id")}`); revalidatePath("/admin/accounts");
}

export async function resetTeacher(fd: FormData) {
  const admin = await requireAdmin();
  if (str(fd, "confirm") !== "RESET") throw new Error("Type RESET to confirm");
  const { error } = await supabaseAdmin().rpc("admin_reset_teacher", {
    p_actor: admin.id, p_teacher: str(fd, "teacher_id"), p_keep_scans: str(fd, "keep_scans") !== "false",
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/accounts/${str(fd, "teacher_id")}`); revalidatePath("/admin/accounts"); revalidatePath("/admin");
}

/**
 * Delete an account on an LEA's request -- Data Processing Addendum, Section
 * 7, which promises deletion on the LEA's request as well as by the teacher.
 *
 * Exactly the same server function the teacher's own button calls, so there is
 * one deletion in this codebase rather than two that will drift. The only
 * difference is the actor recorded on the audit line: the admin's id here,
 * NULL when a teacher does it themselves. Neither writes an email.
 *
 * The confirmation is the account's own email address rather than a word like
 * RESET. An admin working down a list of requests should have to look at which
 * row they are on.
 */
export async function deleteAccount(fd: FormData) {
  const admin = await requireAdmin();
  const teacherId = str(fd, "teacher_id");
  const { data } = await supabaseAdmin().auth.admin.getUserById(teacherId);
  const email = data?.user?.email ?? "";
  if (!email || str(fd, "confirm").trim().toLowerCase() !== email.toLowerCase())
    throw new Error("Type the account's email address to confirm");
  await deleteTeacherAccount(teacherId, { actorId: admin.id });
  revalidatePath("/admin"); revalidatePath("/admin/accounts"); revalidatePath("/admin/audit");
  // The page this was submitted from describes an account that no longer exists.
  redirect("/admin/accounts");
}

export async function setPipelineStage(fd: FormData) {
  const admin = await requireAdmin();
  const { error } = await supabaseAdmin().rpc("admin_set_pipeline", {
    p_actor: admin.id, p_stage: str(fd, "stage"), p_model: str(fd, "model"),
    p_effort: str(fd, "reasoning_effort"), p_max_tokens: Number(str(fd, "max_output_tokens")),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/pipeline");
}

export async function replyTicket(fd: FormData) {
  const admin = await requireAdmin();
  const { error } = await supabaseAdmin().rpc("admin_reply_ticket", {
    p_actor: admin.id, p_ticket: str(fd, "ticket_id"), p_body: str(fd, "body"), p_status: str(fd, "status") || "resolved",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/tickets"); revalidatePath("/admin");
}

export async function setAppManagerRole(fd: FormData) {
  const admin = await requireAppManager();
  const { error } = await supabaseAdmin().rpc("admin_set_app_manager", {
    p_actor: admin.id, p_teacher: str(fd, "teacher_id"), p_value: str(fd, "is_app_manager") === "true",
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/accounts/${str(fd, "teacher_id")}`); revalidatePath("/admin/accounts");
}

export async function setTicketPriority(fd: FormData) {
  const admin = await requireAdmin();
  const { error } = await supabaseAdmin().rpc("admin_set_ticket_priority", {
    p_actor: admin.id, p_ticket: str(fd, "ticket_id"), p_priority: str(fd, "priority"),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/tickets"); revalidatePath("/admin");
}

export async function reviewReteaching(fd: FormData) {
  const admin = await requireAdmin();
  const q = str(fd, "quality");
  const { error } = await supabaseAdmin().rpc("admin_review_reteaching", {
    p_actor: admin.id, p_id: str(fd, "id"), p_status: str(fd, "status"), p_quality: q ? Number(q) : null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/library"); revalidatePath("/admin");
}

export async function addInternalNote(fd: FormData) {
  const admin = await requireAdmin();
  const db = supabaseAdmin();
  const teacher = str(fd, "teacher_id");
  const { error } = await db.from("profiles").update({ internal_notes: str(fd, "notes") }).eq("id", teacher);
  if (error) throw new Error(error.message);
  await db.rpc("admin_log", { p_actor: admin.id, p_action: "internal_note", p_target_type: "teacher", p_target_id: teacher, p_detail: null, p_ip: await ip() });
  revalidatePath(`/admin/accounts/${teacher}`);
}

export async function clearFailedScans(fd: FormData) {
  const admin = await requireAdmin();
  const teacher = str(fd, "teacher_id");
  const { error } = await supabaseAdmin().rpc("admin_clear_failed_scans", { p_actor: admin.id, p_teacher: teacher });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/accounts/${teacher}`); revalidatePath("/admin/accounts"); revalidatePath("/admin/usage"); revalidatePath("/admin");
}

/** Dismisses a platform alert once an operator has dealt with it. */
export async function acknowledgeAlert(fd: FormData) {
  await requireAdmin();
  const { error } = await supabaseAdmin().rpc("acknowledge_platform_alert", {
    p_id: str(fd, "alert_id"),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}
