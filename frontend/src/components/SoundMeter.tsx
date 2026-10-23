import { motion } from "framer-motion";
import { ShieldCheck } from "lucide-react";
import { soundColor } from "../lib/format";
import type { SoundNow } from "../lib/types";

const MIN = 30;
const MAX = 110;
const BANDS = [
  { name: "Quiet", from: 30, to: 50 },
  { name: "Normal", from: 50, to: 70 },
  { name: "Loud", from: 70, to: 85 },
  { name: "Very Loud", from: 85, to: 110 },
];
const pct = (db: number) => ((Math.max(MIN, Math.min(MAX, db)) - MIN) / (MAX - MIN)) * 100;

/** Horizontal dB meter with category bands, rolling-average marker and the 60 s persistence timer. */
export default function SoundMeter({ sound, persist = 60, compact = false }: { sound: SoundNow; persist?: number; compact?: boolean }) {
  const db = sound.db ?? 0;
  const run = Math.min(sound.very_loud_run_seconds, persist);
  const cat = sound.category ?? "—";
  const color = soundColor[cat] ?? "rgb(var(--muted))";
  const segs = 40;

  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="num font-display text-4xl font-bold" style={{ color }}>
              {sound.db != null ? db.toFixed(0) : "--"}
            </span>
            <span className="text-sm text-muted">dB</span>
          </div>
          <div className="text-sm font-semibold" style={{ color }}>
            {sound.sensor_ok ? cat : "Sensor offline"}
          </div>
        </div>
        <div className="text-right text-xs text-muted">
          <div>
            5-min avg <span className="num font-semibold text-fg">{sound.rolling_avg?.toFixed(1) ?? "--"}</span> dB
          </div>
          <div>{sound.rolling_category ?? ""}</div>
        </div>
      </div>

      <div className="relative mt-4">
        <div className="flex h-9 gap-[3px]">
          {Array.from({ length: segs }).map((_, i) => {
            const segDb = MIN + ((i + 0.5) / segs) * (MAX - MIN);
            const band = BANDS.find((b) => segDb >= b.from && segDb < b.to) ?? BANDS[3];
            const on = sound.db != null && segDb <= db;
            const c = soundColor[band.name];
            return (
              <motion.div
                key={i}
                className="flex-1 rounded-[3px]"
                animate={{ opacity: on ? 1 : 0.13, scaleY: on ? 1 : 0.55 }}
                transition={{ duration: 0.25, delay: on ? i * 0.006 : 0 }}
                style={{ background: c, boxShadow: on ? `0 0 8px ${c}` : "none" }}
              />
            );
          })}
        </div>
        {sound.rolling_avg != null && (
          <motion.div
            className="absolute -bottom-1.5 -top-1.5 w-0.5 rounded bg-fg"
            animate={{ left: `${pct(sound.rolling_avg)}%` }}
            transition={{ type: "spring", stiffness: 120, damping: 20 }}
            title="Rolling average"
          />
        )}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-muted">
        {BANDS.map((b) => (
          <span key={b.name} style={{ width: `${((b.to - b.from) / (MAX - MIN)) * 100}%` }}>
            {b.name} <span className="num opacity-70">{b.from}</span>
          </span>
        ))}
      </div>

      {!compact && (
        <div className="mt-5 grid grid-cols-[auto,1fr] items-center gap-4 rounded-2xl border border-line/10 bg-line/[0.02] p-4">
          <PersistRing value={run} max={persist} active={sound.very_loud_run_seconds > 0} done={sound.sustained_very_loud} />
          <div className="text-sm">
            <div className="font-semibold">
              {sound.sustained_very_loud
                ? "Sustained very loud — alert raised"
                : sound.very_loud_run_seconds > 0
                  ? `Very loud for ${sound.very_loud_run_seconds.toFixed(0)}s — watching`
                  : sound.transient_suppressed
                    ? "Short spike ignored (persistence rule)"
                    : "Persistence rule armed"}
            </div>
            <div className="mt-0.5 text-xs text-muted">
              Alerts fire only if sound stays above 85 dB for {persist}s, so door slams and claps don't cause false alarms.
            </div>
          </div>
        </div>
      )}
      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted">
        <ShieldCheck size={13} className="text-safe" /> Only the dB level is measured. Audio is never recorded, stored or sent.
      </div>
    </div>
  );
}

function PersistRing({ value, max, active, done }: { value: number; max: number; active: boolean; done: boolean }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const color = done ? "rgb(var(--crit))" : active ? "rgb(var(--warn))" : "rgb(var(--safe))";
  return (
    <div className="relative h-14 w-14">
      <svg viewBox="0 0 56 56" className="-rotate-90">
        <circle cx="28" cy="28" r={r} fill="none" stroke="rgb(var(--line) / 0.08)" strokeWidth="5" />
        <motion.circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          animate={{ strokeDashoffset: c * (1 - value / max) }}
          transition={{ duration: 0.6 }}
        />
      </svg>
      <div className="num absolute inset-0 flex items-center justify-center text-xs font-bold" style={{ color }}>
        {Math.round(value)}s
      </div>
    </div>
  );
}
