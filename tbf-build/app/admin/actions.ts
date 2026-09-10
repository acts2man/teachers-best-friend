"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/admin-gate";
import { supabaseAdmin } from "@/lib/supabase-admin";

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
