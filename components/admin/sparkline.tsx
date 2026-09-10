/** A trend hairline for a KPI card. Server-rendered SVG, one series, no axes. */
export function Sparkline({ values, id, className }: { values: number[]; id: string; className?: string }) {
  const W = 96, H = 30, pad = 2;
  if (values.length < 2 || values.every((v) => v === 0)) return null;
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (values.length - 1)) * (W - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (H - pad * 2);
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(values.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;
  const last = values[values.length - 1];
  return (
    <svg className={className} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <defs>
        <linearGradient id={`sp-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--ad-green)" stopOpacity=".22" />
          <stop offset="1" stopColor="var(--ad-green)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sp-${id})`} />
      <path d={line} fill="none" stroke="var(--ad-green)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r="2.2" fill="var(--ad-green)" />
    </svg>
  );
}
