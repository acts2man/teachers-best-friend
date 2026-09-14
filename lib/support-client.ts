"use client";
// Data layer for the teacher-facing side of the support ticketing system.
// Every read and write here goes through the signed-in browser session
// (RLS-scoped to the caller's own tickets) or a SECURITY DEFINER RPC that
// re-checks eligibility server-side — never trust the client for the
// paying/beta gate, the DB is the source of truth.
import { createClient } from "@/lib/supabase/client";
import type { MessageAuthor, TicketStatus } from "@/lib/support-constants";

export type TicketRow = {
  id: string;
  ticket_ref: string | null;
  subject: string;
  category: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  status: TicketStatus;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

export type MessageRow = {
  id: string;
  ticket_id: string;
  author: MessageAuthor;
  body: string;
  created_at: string;
};

function friendlyError(error: { message?: string } | null | undefined) {
  const code = error?.message ?? "";
  if (code.includes("NOT_ELIGIBLE"))
    return "This account isn't on a plan that includes support tickets yet.";
  if (code.includes("TICKET_CLOSED"))
    return "This ticket is closed. Open a new one if you still need help.";
  if (code.includes("INVALID_SUBJECT"))
    return "Give the ticket a short subject (under 200 characters).";
  if (code.includes("INVALID_BODY")) return "Say a bit about what's going on.";
  if (code.includes("NOT_FOUND")) return "That ticket couldn't be found.";
  return "That didn't go through. Please try again.";
}

export async function canOpenSupportTicket(): Promise<boolean> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("can_open_support_ticket");
  if (error) return false;
  return Boolean(data);
}

export async function fetchMyTickets(): Promise<TicketRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("support_tickets")
    .select(
      "id, ticket_ref, subject, category, priority, status, created_at, updated_at, resolved_at",
    )
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(friendlyError(error));
  return (data ?? []) as TicketRow[];
}

export async function fetchTicket(ticketId: string): Promise<TicketRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("support_tickets")
    .select(
      "id, ticket_ref, subject, category, priority, status, created_at, updated_at, resolved_at",
    )
    .eq("id", ticketId)
    .maybeSingle();
  if (error || !data) throw new Error(friendlyError(error));
  return data as TicketRow;
}

export async function fetchTicketMessages(
  ticketId: string,
): Promise<MessageRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("support_messages")
    .select("id, ticket_id, author, body, created_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(friendlyError(error));
  return (data ?? []) as MessageRow[];
}

export async function openSupportTicket(input: {
  subject: string;
  body: string;
  category: string;
  priority: string;
}): Promise<{ id: string; ticket_ref: string }> {
  const supabase = createClient();
  const { data, error } = await supabase
    .rpc("open_support_ticket", {
      p_subject: input.subject,
      p_body: input.body,
      p_category: input.category || null,
      p_priority: input.priority,
    })
    .single();
  if (error || !data) throw new Error(friendlyError(error));
  return data as { id: string; ticket_ref: string };
}

export async function replySupportTicket(input: {
  ticketId: string;
  body: string;
}): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("reply_support_ticket", {
    p_ticket: input.ticketId,
    p_body: input.body,
  });
  if (error) throw new Error(friendlyError(error));
}

// Best-effort live updates for an open thread. Wrapped so a dropped socket
// never breaks the view — the caller's own "Refresh" action is the fallback.
export function subscribeToTicketMessages(
  ticketId: string,
  onInsert: () => void,
) {
  try {
    const supabase = createClient();
    const channel = supabase
      .channel(`support-ticket-${ticketId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "support_messages",
          filter: `ticket_id=eq.${ticketId}`,
        },
        () => onInsert(),
      )
      .subscribe();
    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // best-effort cleanup only
      }
    };
  } catch {
    return () => {};
  }
}
