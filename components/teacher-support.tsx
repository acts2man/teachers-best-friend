"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Headset,
  LoaderCircle,
  Lock,
  Plus,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Action, EmptyState, Modal, Pick, Pill } from "./teacher-shared";
import { describeFailure } from "@/lib/connection";
import { useTeacher } from "./teacher-context";
import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  STATUS_LABEL,
  STATUS_TONE,
  categoryLabel,
  supportAuthorDisplay,
  type TicketStatus,
} from "@/lib/support-constants";
import {
  canOpenSupportTicket,
  fetchMyTickets,
  fetchTicket,
  fetchTicketMessages,
  openSupportTicket,
  replySupportTicket,
  subscribeToTicketMessages,
  type MessageRow,
  type TicketRow,
} from "@/lib/support-client";

function relTime(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 86400 * 14) return Math.floor(s / 86400) + "d ago";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function StatusPill({ status }: { status: TicketStatus }) {
  return <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>;
}

export function SupportView() {
  const { go } = useTeacher();
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [tickets, setTickets] = useState<TicketRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  async function loadList() {
    try {
      const [ok, rows] = await Promise.all([
        canOpenSupportTicket(),
        fetchMyTickets(),
      ]);
      setEligible(ok);
      setTickets(rows);
    } catch (e) {
      toast.error(
        describeFailure(e, "Couldn’t load your tickets."),
      );
      setTickets([]);
    }
  }

  useEffect(() => {
    // loadList() awaits before it sets state: a plain load-on-mount, not a
    // synchronous setState.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (openId) {
    return (
      <TicketDetail
        ticketId={openId}
        onBack={() => {
          setOpenId(null);
          loadList();
        }}
      />
    );
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Support</h1>
          <p>
            Reach the team behind A Teacher’s Best Friend, and see every
            reply in one place.
          </p>
        </div>
        <div className="heading-actions">
          {eligible && (
            <Action onClick={() => setNewOpen(true)}>
              New ticket
              <Plus size={16} />
            </Action>
          )}
        </div>
      </div>

      {eligible === false && (
        <div className="panel" style={{ padding: "1.25rem 1.4rem", display: "flex", gap: "1rem", alignItems: "flex-start" }}>
          <span className="soft-icon" aria-hidden="true">
            <Lock size={20} />
          </span>
          <div>
            <strong>Support tickets are part of a paid plan.</strong>
            <p className="muted" style={{ margin: ".35rem 0 0" }}>
              Upgrade your plan to message the team directly, or check{" "}
              <button
                type="button"
                className="text-link-inline"
                onClick={() => go("/guide")}
              >
                How to use
              </button>{" "}
              for answers to common questions in the meantime.
            </p>
          </div>
        </div>
      )}

      {tickets === null ? (
        <p className="muted">Loading your tickets…</p>
      ) : tickets.length === 0 ? (
        <EmptyState
          title="No tickets yet"
          description={
            eligible
              ? "When something isn’t working right, or you just have a question, open a ticket and we’ll get back to you here."
              : "Once support is part of your plan, any ticket you open will show up here."
          }
        >
          {eligible && (
            <Action onClick={() => setNewOpen(true)}>
              Open your first ticket
              <Plus size={16} />
            </Action>
          )}
        </EmptyState>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: ".6rem" }}>
          {tickets.map((t) => (
            <button
              key={t.id}
              type="button"
              className="panel ticket-row"
              onClick={() => setOpenId(t.id)}
            >
              <div className="ticket-row-main">
                <span className="mono muted">{t.ticket_ref}</span>
                <strong>{t.subject}</strong>
                <span className="muted" style={{ fontSize: ".85rem" }}>
                  {categoryLabel(t.category)} · Updated {relTime(t.updated_at)}
                </span>
              </div>
              <StatusPill status={t.status} />
            </button>
          ))}
        </div>
      )}

      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Open a ticket"
        description="Tell us what's going on. We reply here, usually within a school day."
      >
        <NewTicketForm
          onCreated={(t) => {
            setNewOpen(false);
            setOpenId(t.id);
          }}
        />
      </Modal>
    </>
  );
}

function NewTicketForm({
  onCreated,
}: {
  onCreated: (t: { id: string; ticket_ref: string }) => void;
}) {
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState(TICKET_CATEGORIES[0].value as string);
  const [priority, setPriority] = useState("normal");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!subject.trim() || !body.trim()) return;
    setBusy(true);
    try {
      const ticket = await openSupportTicket({ subject, category, priority, body });
      toast.success(`${ticket.ticket_ref} is open. We’ll reply here.`);
      onCreated(ticket);
    } catch (e) {
      toast.error(describeFailure(e, "Couldn’t open that ticket."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="form-stack"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label>
        Subject
        <input
          required
          maxLength={200}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="e.g. A scan came back with the wrong standard"
        />
      </label>
      <div className="form-grid">
        <label>
          Category
          <Pick
            label="Category"
            value={category}
            onChange={setCategory}
            options={TICKET_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
          />
        </label>
        <label>
          Priority
          <Pick
            label="Priority"
            value={priority}
            onChange={setPriority}
            options={TICKET_PRIORITIES.map((p) => ({ value: p.value, label: p.label }))}
          />
        </label>
      </div>
      <label>
        What’s going on?
        <textarea
          required
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="The more detail you give us, the faster we can help — which assignment, which student, what you expected to see."
        />
      </label>
      <Action type="submit" disabled={busy || !subject.trim() || !body.trim()}>
        {busy && <LoaderCircle className="spin" size={16} />}
        Send to the team
      </Action>
    </form>
  );
}

function TicketDetail({
  ticketId,
  onBack,
}: {
  ticketId: string;
  onBack: () => void;
}) {
  const [ticket, setTicket] = useState<TicketRow | null>(null);
  const [messages, setMessages] = useState<MessageRow[] | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const [t, m] = await Promise.all([
        fetchTicket(ticketId),
        fetchTicketMessages(ticketId),
      ]);
      setTicket(t);
      setMessages(m);
    } catch (e) {
      toast.error(describeFailure(e, "Couldn’t load that ticket."));
    }
  }

  useEffect(() => {
    // load() awaits before it sets state: a plain load-on-mount, not a
    // synchronous setState.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const unsubscribe = subscribeToTicketMessages(ticketId, load);
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages?.length]);

  async function sendReply() {
    if (!reply.trim()) return;
    setSending(true);
    try {
      await replySupportTicket({ ticketId, body: reply });
      setReply("");
      await load();
    } catch (e) {
      toast.error(describeFailure(e, "That reply didn’t send."));
    } finally {
      setSending(false);
    }
  }

  const closed = ticket?.status === "closed";

  return (
    <>
      <button type="button" className="text-link" onClick={onBack} style={{ marginBottom: ".9rem" }}>
        <ArrowLeft size={16} />
        All tickets
      </button>

      {!ticket ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="page-heading">
            <div>
              <span className="mono muted">{ticket.ticket_ref}</span>
              <h1 style={{ marginTop: ".2rem" }}>{ticket.subject}</h1>
              <p>{categoryLabel(ticket.category)}</p>
            </div>
            <div className="heading-actions">
              <StatusPill status={ticket.status} />
            </div>
          </div>

          <div className="panel ticket-thread">
            {(messages ?? []).map((m) => (
              <div
                key={m.id}
                className={
                  "ticket-bubble " +
                  (m.author === "teacher"
                    ? "ticket-bubble-you"
                    : m.author === "ai"
                      ? "ticket-bubble-ai"
                      : "ticket-bubble-staff")
                }
              >
                <div className="ticket-bubble-meta">
                  {m.author === "ai" && <Sparkles size={12} />}
                  {m.author === "staff" && <Headset size={12} />}
                  <span>{supportAuthorDisplay(m.author)}</span>
                  <span>·</span>
                  <span>{relTime(m.created_at)}</span>
                </div>
                <p>{m.body}</p>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          {closed ? (
            <p className="muted" style={{ marginTop: ".9rem" }}>
              This ticket is closed. Open a new one from the Support page if
              you still need help.
            </p>
          ) : (
            <form
              className="form-stack"
              style={{ marginTop: ".9rem" }}
              onSubmit={(e) => {
                e.preventDefault();
                sendReply();
              }}
            >
              <label>
                Reply
                <textarea
                  rows={3}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Add more detail or answer a question from the team"
                />
              </label>
              <Action type="submit" disabled={sending || !reply.trim()}>
                {sending && <LoaderCircle className="spin" size={16} />}
                Send reply
              </Action>
            </form>
          )}
        </>
      )}
    </>
  );
}
