import type { ReactNode } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Sparkline } from "./sparkline";

export type KpiTone = "good" | "bad" | "warn";

/**
 * A metric card. `tier="primary"` renders larger for the numbers that decide
 * the business. A zero or "—" value is styled as intentional: muted, with an
 * `empty` caption so it never reads as broken.
 */
export function Kpi({
  v, l, d, tone, tier = "secondary", icon, empty, spark, sparkId, style,
}: {
  v: string | number;
  l: string;
  d?: string;
  tone?: KpiTone;
  tier?: "primary" | "secondary";
  icon?: ReactNode;
  empty?: string;
  spark?: number[];
  sparkId?: string;
  style?: React.CSSProperties;
}) {
  const isEmpty = v === "—" || v === 0 || v === "0" || v === "$0" || v === "$0.00" || v === "0 B";
  const hasSpark = Boolean(spark && sparkId && spark.length > 1 && spark.some((n) => n > 0));
  const DeltaIcon = tone === "good" ? TrendingUp : tone === "bad" ? TrendingDown : Minus;
  return (
    <div className={`kpi-card ad-rise${tier === "primary" ? " kpi-primary" : ""}${hasSpark ? " kpi-has-spark" : ""}`} style={style}>
      <div className="kpi-head">
        <p className="kpi-l">{l}</p>
        {icon && <span className="kpi-icon" aria-hidden="true">{icon}</span>}
      </div>
      <div className={`kpi-v${isEmpty ? " is-empty" : ""}`}>{v}</div>
      <div className="kpi-foot">
        {isEmpty && empty ? (
          <p className="kpi-empty-note">{empty}</p>
        ) : d ? (
          tone ? (
            <span className={`kpi-delta ${tone}`}><DeltaIcon aria-hidden="true" />{d}</span>
          ) : (
            <p className="kpi-d">{d}</p>
          )
        ) : null}
      </div>
      {hasSpark && <Sparkline className="kpi-spark" values={spark!} id={sparkId!} />}
    </div>
  );
}
