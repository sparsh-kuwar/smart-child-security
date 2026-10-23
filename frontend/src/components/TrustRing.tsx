import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect } from "react";
import { bandColor, componentMeta, WEIGHTS } from "../lib/format";
import type { Band, Components } from "../lib/types";

const ORDER = ["activity", "schedule", "location", "device", "sound"] as const;

function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
}

/**
 * The Trust Score formula drawn as a ring: each segment's length is the component's weight,
 * and how much of it is lit is the component's value. The centre is the weighted sum.
 */
export default function TrustRing({
  score,
  band,
  label,
  components,
  size = 260,
}: {
  score: number;
  band: Band;
  label: string;
  components: Components;
  size?: number;
}) {
  const mv = useMotionValue(0);
  const shown = useTransform(mv, (v) => v.toFixed(0));
  useEffect(() => {
    const c = animate(mv, score, { duration: 1.2, ease: [0.2, 0.8, 0.2, 1] });
    return c.stop;
  }, [score, mv]);

  const cx = size / 2;
  const r = size / 2 - 18;
  const gap = 0.06;
  let a = -Math.PI / 2;
  const color = bandColor[band];

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <div
        className="absolute inset-6 rounded-full opacity-60 blur-3xl transition-colors duration-700"
        style={{ background: `radial-gradient(circle, ${color}, transparent 70%)` }}
      />
      <svg viewBox={`0 0 ${size} ${size}`} className="relative" role="img" aria-label={`Trust score ${score.toFixed(0)} percent`}>
        <circle cx={cx} cy={cx} r={r - 26} fill="none" stroke="rgb(var(--line) / 0.06)" strokeWidth={1} strokeDasharray="2 6" />
        {ORDER.map((k, i) => {
          const span = WEIGHTS[k] * Math.PI * 2 - gap;
          const a0 = a + gap / 2;
          const a1 = a0 + span;
          a += WEIGHTS[k] * Math.PI * 2;
          const v = Math.max(0.001, components[k]);
          const meta = componentMeta[k];
          return (
            <g key={k}>
              <path d={arc(cx, cx, r, a0, a1)} stroke="rgb(var(--line) / 0.08)" strokeWidth={14} fill="none" strokeLinecap="round" />
              <motion.path
                d={arc(cx, cx, r, a0, a0 + span * v)}
                stroke={meta.color}
                strokeWidth={14}
                fill="none"
                strokeLinecap="round"
                style={{ filter: `drop-shadow(0 0 6px ${meta.color})` }}
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1, delay: 0.1 * i }}
              />
            </g>
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">Trust score</div>
        <div className="flex items-start">
          <motion.span className="num font-display text-6xl font-bold" style={{ color }}>
            {shown}
          </motion.span>
          <span className="mt-2 text-xl font-semibold text-muted">%</span>
        </div>
        <div className="mt-1 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
          {label}
        </div>
      </div>
    </div>
  );
}
