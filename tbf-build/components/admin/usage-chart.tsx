import type { DailyUsage } from "@/lib/supabase-admin";

/** Scans as bars (left axis), AI cost as a line (right axis). Server-rendered SVG, no library. */
export function UsageChart({ data }: { data: DailyUsage[] }) {
  const W = 640, H = 200, padL = 36, padR = 44, padT = 12, padB = 28;
  const iw = W - padL - padR, ih = H - padT - padB;
  const n = Math.max(data.length, 1);
  const maxScans = Math.max(1, ...data.map((d) => Number(d.scans)));
  const maxCost = Math.max(0.01, ...data.map((d) => Number(d.ai_cost)));
  const bw = Math.max(2, (iw / n) * 0.62);
  const x = (i: number) => padL + (i + 0.5) * (iw / n);
  const yS = (v: number) => padT + ih - (v / maxScans) * ih;
  const yC = (v: number) => padT + ih - (v / maxCost) * ih;

  const path = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${yC(Number(d.ai_cost)).toFixed(1)}`).join(" ");
  const ticks = [0, 0.5, 1].map((t) => ({ t, y: padT + ih - t * ih }));
  const totalScans = data.reduce((a, d) => a + Number(d.scans), 0);
  const totalCost = data.reduce((a, d) => a + Number(d.ai_cost), 0);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${totalScans} scans and $${totalCost.toFixed(2)} of AI cost over ${n} days`}>
        {ticks.map(({ t, y }) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="var(--rule-faint)" />
            <text x={padL - 6} y={y + 4} textAnchor="end" fontSize="10" fill="var(--ink-mute)">{Math.round(t * maxScans)}</text>
            <text x={W - padR + 6} y={y + 4} fontSize="10" fill="var(--ink-mute)">${(t * maxCost).toFixed(2)}</text>
          </g>
        ))}
        {data.map((d, i) => (
          <rect key={d.day} x={x(i) - bw / 2} y={yS(Number(d.scans))} width={bw} height={Math.max(0, padT + ih - yS(Number(d.scans)))}
                fill={Number(d.failed) > 0 ? "var(--correct-red)" : "var(--rule)"} opacity={Number(d.failed) > 0 ? 0.85 : 1}>
            <title>{`${d.day}: ${d.scans} scans, ${d.active_teachers} teachers, $${Number(d.ai_cost).toFixed(3)}${Number(d.failed) ? `, ${d.failed} failed` : ""}`}</title>
          </rect>
        ))}
        <path d={path} fill="none" stroke="var(--mark)" strokeWidth="2" strokeLinejoin="round" />
        {data.map((d, i) => (i % Math.ceil(n / 6) === 0 || i === n - 1) && (
          <text key={`l${d.day}`} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--ink-mute)">
            {new Date(d.day).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </text>
        ))}
      </svg>
      <div className="muted" style={{ fontSize: ".8rem", display: "flex", gap: "1.25rem", marginTop: ".25rem" }}>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--rule)", marginRight: 6 }} />Scans ({totalScans})</span>
        <span><span style={{ display: "inline-block", width: 10, height: 2, background: "var(--mark)", marginRight: 6, verticalAlign: "middle" }} />AI cost (${totalCost.toFixed(2)})</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--correct-red)", marginRight: 6 }} />Days with failures</span>
      </div>
    </div>
  );
}
