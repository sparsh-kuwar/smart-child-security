import type { Band, Level } from "./types";

export function parseTs(ts: string | null | undefined): Date | null {
  return ts ? new Date(ts) : null;
}

export function timeAgo(ts: string | null | undefined, now = Date.now()): string {
  const d = parseTs(ts);
  if (!d) return "never";
  const s = Math.max(0, Math.round((now - d.getTime()) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function clock(ts: string | null | undefined, seconds = false): string {
  const d = parseTs(ts);
  if (!d) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) });
}

export function dayLabel(date: string): string {
  const d = new Date(date + "T12:00:00");
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

export function minutes(m: number): string {
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  return h ? `${h}h ${mm}m` : `${mm}m`;
}

export const bandColor: Record<Band, string> = {
  safe: "rgb(var(--safe))",
  watch: "rgb(var(--info))",
  concern: "rgb(var(--warn))",
  critical: "rgb(var(--crit))",
};

export function scoreColor(v: number): string {
  if (v >= 0.8) return "rgb(var(--safe))";
  if (v >= 0.6) return "rgb(var(--info))";
  if (v >= 0.45) return "rgb(var(--warn))";
  return "rgb(var(--crit))";
}

export const levelColor: Record<Level, string> = {
  critical: "rgb(var(--crit))",
  warning: "rgb(var(--warn))",
  info: "rgb(var(--info))",
};

export const soundColor: Record<string, string> = {
  Quiet: "rgb(var(--safe))",
  Normal: "rgb(var(--info))",
  Loud: "rgb(var(--warn))",
  "Very Loud": "rgb(var(--crit))",
};

export const componentMeta: Record<string, { label: string; short: string; color: string }> = {
  activity: { label: "Activity", short: "Sa", color: "#34f5c5" },
  schedule: { label: "Schedule", short: "Ss", color: "#60a5fa" },
  location: { label: "Location", short: "Sl", color: "#9787ff" },
  device: { label: "Device", short: "Sd", color: "#fbbf24" },
  sound: { label: "Sound", short: "Sn", color: "#f472b6" },
};

export const WEIGHTS: Record<string, number> = { activity: 0.25, schedule: 0.2, location: 0.25, device: 0.15, sound: 0.15 };
