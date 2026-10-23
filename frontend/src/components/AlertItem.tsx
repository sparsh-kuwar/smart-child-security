import clsx from "clsx";
import {
  BatteryWarning,
  Bell,
  Check,
  CreditCard,
  MapPin,
  MonitorSmartphone,
  Satellite,
  Siren,
  TrendingDown,
  Volume2,
  Wifi,
} from "lucide-react";
import { clock, levelColor, timeAgo } from "../lib/format";
import type { Alert } from "../lib/types";

export const categoryIcon: Record<string, typeof Bell> = {
  sos: Siren,
  location: MapPin,
  sound: Volume2,
  gps: Satellite,
  attendance: CreditCard,
  device: MonitorSmartphone,
  trust: TrendingDown,
  system: Wifi,
  battery: BatteryWarning,
};

export default function AlertItem({ a, onAck, compact }: { a: Alert; onAck?: (a: Alert) => void; compact?: boolean }) {
  const Icon = categoryIcon[a.category] ?? Bell;
  const c = levelColor[a.level];
  return (
    <div
      className={clsx(
        "group relative flex gap-3 rounded-2xl border p-3 transition",
        a.acknowledged ? "border-line/5 opacity-60" : "border-line/10 bg-line/[0.02]",
      )}
    >
      {!a.acknowledged && a.level !== "info" && (
        <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full" style={{ background: c, boxShadow: `0 0 10px ${c}` }} />
      )}
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
        style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}
      >
        <Icon size={17} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-semibold leading-snug">{a.title}</div>
          <span className="shrink-0 text-[11px] text-muted" title={new Date(a.ts).toLocaleString()}>
            {compact ? timeAgo(a.ts) : clock(a.ts)}
          </span>
        </div>
        {!compact && <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{a.message}</p>}
        {!compact && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: c, background: `color-mix(in srgb, ${c} 12%, transparent)` }}>
              {a.level}
            </span>
            <span className="text-[11px] text-muted">{a.category}</span>
            {a.lat != null && a.lon != null && (
              <a
                className="text-[11px] font-medium text-info hover:underline"
                href={`https://maps.google.com/?q=${a.lat},${a.lon}`}
                target="_blank"
                rel="noreferrer"
              >
                Open in Maps ↗
              </a>
            )}
            {onAck && !a.acknowledged && (
              <button onClick={() => onAck(a)} className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-muted hover:bg-line/10 hover:text-fg">
                <Check size={12} /> Acknowledge
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
