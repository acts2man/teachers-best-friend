import Link from "next/link";
import { OctagonAlert, TriangleAlert, Info, ChevronRight, CircleCheck } from "lucide-react";

export type AttentionLevel = "bad" | "warn" | "ok";
export type AttentionItem = { level: AttentionLevel; text: string; href: string };

const META: Record<AttentionLevel, { tag: string; Icon: typeof Info }> = {
  bad: { tag: "Now", Icon: OctagonAlert },
  warn: { tag: "Soon", Icon: TriangleAlert },
  ok: { tag: "FYI", Icon: Info },
};

/** The "needs a human today" list: one card per item, severity on the left edge. */
export function AttentionList({ items, emptyText }: { items: AttentionItem[]; emptyText: string }) {
  if (items.length === 0) {
    return (
      <div className="ad-empty">
        <CircleCheck aria-hidden="true" />
        <span><strong>All clear.</strong> {emptyText}</span>
      </div>
    );
  }
  return (
    <ul className="att-list">
      {items.map((a, i) => {
        const { tag, Icon } = META[a.level];
        return (
          <li key={i} className="ad-rise" style={{ ["--i" as string]: i + 2 }}>
            <Link href={a.href} className={`att-card ${a.level}`}>
              <span className="att-icon" aria-hidden="true"><Icon /></span>
              <span className="att-body">
                <span className="att-tag">{tag}</span>
                <span className="att-text">{a.text}</span>
              </span>
              <ChevronRight className="att-chev" aria-hidden="true" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
