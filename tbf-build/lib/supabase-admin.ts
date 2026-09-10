import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * SERVICE-ROLE client. Bypasses every RLS policy.
 * Only ever import this from server components, route handlers, or server
 * actions that have already passed requireAdmin(). Never from a client
 * component, never from anything that ships to the browser.
 */
let _admin: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL are required for admin access");
  }
  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}

/* ---------- Row types for the admin views ---------- */

export type AdminAccount = {
  teacher_id: string;
  email: string;
  full_name: string | null;
  school_name: string | null;
  district: string | null;
  is_admin: boolean;
  status: "active" | "suspended" | "deactivated";
  status_reason: string | null;
  plan_id: string;
  plan_name: string;
  price_cents: number;
  scan_quota: number;
  signed_up_at: string;
  last_seen_at: string | null;
  classes: number;
  students: number;
  assessments: number;
  uploads: number;
  storage_bytes: number;
  scans_this_period: number;
  scans_lifetime: number;
  ai_cost_this_period: number;
  ai_cost_lifetime: number;
  last_scan_at: string | null;
  open_tickets: number;
  current_period_start: string;
  current_period_end: string;
  stripe_customer_id: string | null;
};

export type PlatformStats = {
  teachers_total: number;
  teachers_active_7d: number;
  teachers_active_30d: number;
  signups_7d: number;
  paying_teachers: number;
  mrr_usd: number;
  scans_today: number;
  scans_this_month: number;
  ai_cost_this_month: number;
  avg_cost_per_scan: number;
  cache_hit_rate_pct: number | null;
  failed_scans_24h: number;
  open_tickets: number;
  reteaching_unreviewed: number;
  reteaching_entries: number;
  standards_seeded: number;
  storage_bytes_total: number;
  uploads_expiring_7d: number;
};

export type DailyUsage = {
  day: string; scans: number; active_teachers: number; ai_cost: number;
  failed: number; cache_hits: number; cache_misses: number; signups: number;
};

export type ModelCost = {
  model: string; input_tokens: number; output_tokens: number; calls: number;
  input_per_mtok: number; output_per_mtok: number;
};

export type AdminTicket = {
  id: string; ticket_ref: string; subject: string; category: string | null;
  status: string; priority: string; deflected: boolean; ai_confidence: number | null;
  created_at: string; updated_at: string; resolved_at: string | null;
  teacher_email: string; teacher_name: string | null; teacher_id: string;
  message_count: number; last_message: string | null;
};

export type PipelineStage = {
  stage: string; model: string; reasoning_effort: "minimal" | "low" | "medium" | "high";
  max_output_tokens: number; notes: string | null; updated_at: string;
};

export type ModelPrice = {
  model: string; provider: string; input_per_mtok: number;
  cached_input_per_mtok: number; output_per_mtok: number; notes: string | null; active: boolean;
};

export type ReteachingRow = {
  id: string; title: string; error_pattern_key: string; error_pattern_label: string;
  grade_band: string; standard_code: string; subject: string; grade: string;
  review_status: string; quality_score: number | null; times_served: number;
  generation_cost_usd: number; model: string | null; created_at: string; updated_at: string;
};

export type AuditRow = {
  id: number; actor_email: string | null; action: string; target_type: string | null;
  target_id: string | null; detail: Record<string, unknown> | null; created_at: string;
};

export type StandardsCoverage = {
  jurisdiction: string; framework: string; subject: string; grade: string;
  standards: number; embedded: number; active: number;
};

/* ---------- Readers ---------- */

export async function getPlatformStats(): Promise<PlatformStats> {
  const { data, error } = await supabaseAdmin().from("admin_platform_stats").select("*").single();
  if (error) throw error;
  return data as PlatformStats;
}

export async function getAccounts(): Promise<AdminAccount[]> {
  const { data, error } = await supabaseAdmin().from("admin_accounts").select("*").order("last_seen_at", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data as AdminAccount[];
}

export async function getAccount(id: string): Promise<AdminAccount | null> {
  const { data, error } = await supabaseAdmin().from("admin_accounts").select("*").eq("teacher_id", id).maybeSingle();
  if (error) throw error;
  return data as AdminAccount | null;
}

export async function getDailyUsage(): Promise<DailyUsage[]> {
  const { data, error } = await supabaseAdmin().from("admin_daily_usage").select("*");
  if (error) throw error;
  return data as DailyUsage[];
}

export async function getModelCosts(): Promise<ModelCost[]> {
  const { data, error } = await supabaseAdmin().from("admin_model_costs").select("*");
  if (error) throw error;
  return data as ModelCost[];
}

export async function getTickets(status?: string): Promise<AdminTicket[]> {
  let q = supabaseAdmin().from("admin_tickets").select("*").order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return data as AdminTicket[];
}

export async function getPipeline(): Promise<{ stages: PipelineStage[]; models: ModelPrice[] }> {
  const [s, m] = await Promise.all([
    supabaseAdmin().from("pipeline_config").select("*").order("stage"),
    supabaseAdmin().from("model_pricing").select("*").eq("active", true).order("output_per_mtok"),
  ]);
  if (s.error) throw s.error;
  if (m.error) throw m.error;
  return { stages: s.data as PipelineStage[], models: m.data as ModelPrice[] };
}

export async function getReteaching(status?: string): Promise<ReteachingRow[]> {
  let q = supabaseAdmin().from("admin_reteaching").select("*").order("times_served", { ascending: false });
  if (status) q = q.eq("review_status", status);
  const { data, error } = await q.limit(200);
  if (error) throw error;
  return data as ReteachingRow[];
}

export async function getAudit(limit = 200): Promise<AuditRow[]> {
  const { data, error } = await supabaseAdmin().from("admin_audit_log").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data as AuditRow[];
}

export async function getStandardsCoverage(): Promise<StandardsCoverage[]> {
  const { data, error } = await supabaseAdmin().from("admin_standards_coverage").select("*");
  if (error) throw error;
  return data as StandardsCoverage[];
}

export async function getTeacherScans(teacherId: string, limit = 50) {
  const { data, error } = await supabaseAdmin()
    .from("scans")
    .select("id, status, created_at, completed_at, cost_usd, extract_model, reteach_model, library_hits, library_misses, error")
    .eq("teacher_id", teacherId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function getTeacherAudit(teacherId: string) {
  const { data, error } = await supabaseAdmin()
    .from("admin_audit_log").select("*")
    .eq("target_type", "teacher").eq("target_id", teacherId)
    .order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  return data as AuditRow[];
}
