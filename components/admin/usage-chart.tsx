"use client";

import { useId, useState } from "react";
import { ScanLine } from "lucide-react";
import type { DailyUsage } from "@/lib/supabase-admin";

/**
 * Daily scans and AI cost as two aligned small multiples on one time axis:
 * scans as bars (failure days in red), cost as a line with an area fill.
 * Two measures of different scale never share a y-axis. Inline SVG, no
 * library; hover shows a crosshair and a tooltip for the day under the cursor.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/* Deterministic on server and client: no timezone or locale involved. */
function dayLabel(day: string) {
  const [, m, d] = day.slice(0, 10).split("-").map(Number);
  return m && d ? `${MONTHS[m - 1]} ${d}` : day;
}
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return n * p;
}
function money(v: number) {
  return v >= 100 ? `$${Math.round(v)}` : v >= 1 ? `$${v.toFixed(1)}` : `$${v.toFixed(2)}`;
}
function roundedBar(x: number, y: number, w: number, base: number) {
  const h = base - y;
  const r = Math.min(3, w / 2, h);
  if (h <= 0.5) return `M${x},${base - 0.5} h${w} v0.5 h${-w} Z`;
  return `M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${base} Z`;
}

export function UsageChart({ data }: { data: DailyUsage[] }) {
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);

  const W = 640, padL = 40, padR = 12, padT = 30, gap = 40;
  const H1 = 132, H2 = 96, padB = 24;
  const H = padT + H1 + gap + H2 + padB;
  const iw = W - padL - padR;
  const n = Math.max(data.length, 1);
  const slot = iw / n;
  const bw = Math.max(2, Math.min(14, slot - 2));
  const x = (i: number) => padL + (i + 0.5) * slot;

  const scans = data.map((d) => Number(d.scans));
  const costs = data.map((d) => Number(d.ai_cost));
  const totalScans = scans.reduce((a, b) => a + b, 0);
  const totalCost = costs.reduce((a, b) => a + b, 0);
  const failDays = data.filter((d) => Number(d.failed) > 0).length;
  const empty = data.length === 0 || (totalScans === 0 && totalCost === 0);

  const maxScans = niceMax(Math.max(...scans, 0));
  const maxCost = niceMax(Math.max(...costs, 0));
  const base1 = padT + H1, top2 = padT + H1 + gap, base2 = top2 + H2;
  const yS = (v: number) => base1 - (v / maxScans) * H1;
  const yC = (v: number) => base2 - (v / maxCost) * H2;
  const line = costs.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${yC(v).toFixed(1)}`).join(" ");
  const area = data.length ? `${line} L${x(n - 1).toFixed(1)},${base2} L${x(0).toFixed(1)},${base2} Z` : "";
  const labelEvery = Math.max(1, Math.ceil(n / 6));

  const tipLeft = hover === null ? 0 : ((hover + 0.5) / n) * 100;
  const flip = tipLeft > 62;
  const h = hover === null ? null : data[hover];

  return (
    <div className="uc" onMouseLeave={() => setHover(null)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={empty ? "No scans recorded yet" : `${totalScans} scans and $${totalCost.toFixed(2)} of AI cost over ${n} days`}
      >
        <defs>
          <linearGradient id={`uc-area-${uid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--ad-ink)" stopOpacity=".14" />
            <stop offset="1" stopColor="var(--ad-ink)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* panel titles */}
        {!empty && (
          <>
            <text className="uc-title" x={padL} y={padT - 12}>Scans per day</text>
            <text className="uc-title" x={padL} y={top2 - 12}>AI cost per day</text>
          </>
        )}

        {/* grids */}
        {[0, 0.5, 1].map((t) => (
          <g key={`g1${t}`}>
            <line className="uc-grid" x1={padL} x2={W - padR} y1={base1 - t * H1} y2={base1 - t * H1} />
            {!empty && <text className="uc-axis" x={padL - 6} y={base1 - t * H1 + 3.5} textAnchor="end">{Math.round(t * maxScans)}</text>}
          </g>
        ))}
        {[0, 0.5, 1].map((t) => (
          <g key={`g2${t}`}>
            <line className="uc-grid" x1={padL} x2={W - padR} y1={base2 - t * H2} y2={base2 - t * H2} />
            {!empty && <text className="uc-axis" x={padL - 6} y={base2 - t * H2 + 3.5} textAnchor="end">{money(t * maxCost)}</text>}
          </g>
        ))}

        {!empty && (
          <>
            {data.map((d, i) => (
              <path
                key={d.day}
                className={`uc-bar${Number(d.failed) > 0 ? " is-failed" : ""}${hover !== null && hover !== i ? " is-dim" : ""}`}
                style={{ animationDelay: `${Math.min(i * 12, 500)}ms` }}
                d={roundedBar(x(i) - bw / 2, yS(scans[i]), bw, base1)}
              />
            ))}
            <path className="uc-area" fill={`url(#uc-area-${uid})`} d={area} />
            <path className="uc-line" d={line} />
            {hover !== null && (
              <>
                <line className="uc-cross" x1={x(hover)} x2={x(hover)} y1={padT - 4} y2={base2} />
                <circle className="uc-dot" cx={x(hover)} cy={yC(costs[hover])} r="3.5" />
              </>
            )}
            {data.map((d, i) => (i % labelEvery === 0 || i === n - 1) && (
              <text key={`l${d.day}`} className="uc-axis" x={x(i)} y={H - 7} textAnchor="middle">{dayLabel(d.day)}</text>
            ))}
            {/* hit targets: the whole column, larger than the mark */}
            {data.map((d, i) => (
              <rect
                key={`h${d.day}`}
                className="uc-hit"
                x={padL + i * slot}
                y={padT - 4}
                width={slot}
                height={base2 - padT + 4}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={`${dayLabel(d.day)}: ${d.scans} scans, $${Number(d.ai_cost).toFixed(3)} AI cost`}
              />
            ))}
          </>
        )}
      </svg>

      {empty && (
        <div className="uc-empty" role="status">
          <div>
            <ScanLine aria-hidden="true" />
            <br />
            No scans yet — activity will appear here once teachers start scanning.
          </div>
        </div>
      )}

      {h && hover !== null && (
        <div className="uc-tip" style={flip ? { right: `${100 - tipLeft}%`, marginRight: 10 } : { left: `${tipLeft}%`, marginLeft: 10 }}>
          <strong>{dayLabel(h.day)}</strong>
          <div className="uc-tip-row"><span>Scans</span><span>{h.scans}</span></div>
          <div className="uc-tip-row"><span>Active teachers</span><span>{h.active_teachers}</span></div>
          <div className="uc-tip-row"><span>AI cost</span><span>${Number(h.ai_cost).toFixed(3)}</span></div>
          {Number(h.failed) > 0 && <div className="uc-tip-row is-failed"><span>Failed</span><span>{h.failed}</span></div>}
          {(Number(h.cache_hits) > 0 || Number(h.cache_misses) > 0) && (
            <div className="uc-tip-row"><span>Cache hit / miss</span><span>{h.cache_hits} / {h.cache_misses}</span></div>
          )}
        </div>
      )}

      <div className="uc-legend">
        <span className="l-scans"><i />Scans <b>{totalScans.toLocaleString("en-US")}</b></span>
        <span className="l-cost"><i />AI cost <b>${totalCost.toFixed(2)}</b></span>
        <span className="l-fail"><i />Days with failures <b>{failDays}</b></span>
      </div>
    </div>
  );
}
