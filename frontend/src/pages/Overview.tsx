import clsx from "clsx";
import { motion } from "framer-motion";
import {
  ArrowRight,
  AudioLines,
  Battery,
  Bell,
  BellRing,
  Bike,
  BookOpen,
  CreditCard,
  Footprints,
  Gamepad2,
  Moon,
  Navigation,
  Satellite,
  Sofa,
  Smartphone,
  Armchair,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, YAxis } from "recharts";
import AlertItem from "../components/AlertItem";
import LiveMap from "../components/LiveMap";
import SoundMeter from "../components/SoundMeter";
import TrustRing from "../components/TrustRing";
import { Bar, Card, Pill, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import { bandColor, clock, componentMeta, minutes, scoreColor, timeAgo } from "../lib/format";
import { useLive } from "../lib/live";
import type { Alert } from "../lib/types";

export const activityIcon: Record<string, typeof Sofa> = {
  Sleeping: Moon,
  Idle: Sofa,
  Sitting: Armchair,
  Walking: Footprints,
  Active: Bike,
};

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export default function Overview() {
  const { live, childId, reload } = useLive();
  const now = useNow();
  const [buzzing, setBuzzing] = useState(false);

  if (!live) {
    return (
      <div className="grid gap-5 lg:grid-cols-12">
        <Skeleton className="h-[360px] lg:col-span-8" />
        <Skeleton className="h-[360px] lg:col-span-4" />
        <Skeleton className="h-60 lg:col-span-5" />
        <Skeleton className="h-60 lg:col-span-3" />
        <Skeleton className="h-60 lg:col-span-4" />
      </div>
    );
  }

  const r = live.reading;
  const name = live.child.name;
  const inside = r?.inside ?? true;
  const where = r ? (r.zone ? `at ${r.zone}` : `${Math.round(live.zone?.distance_m ?? 0)} m outside ${live.zone?.nearest ?? "safe zones"}`) : "waiting for the device";
  const statusColor = !r ? "rgb(var(--muted))" : r.sos ? "rgb(var(--crit))" : !inside ? "rgb(var(--warn))" : "rgb(var(--safe))";
  const ActIcon = activityIcon[r?.activity ?? "Idle"] ?? Sofa;
  const ledColor = live.recent_alerts.some((a) => a.level === "critical" && !a.acknowledged && now - new Date(a.ts).getTime() < 120000)
    ? "rgb(var(--crit))"
    : !inside || r?.stale
      ? "rgb(var(--warn))"
      : "rgb(var(--safe))";

  const buzz = async () => {
    setBuzzing(true);
    try {
      await api(`/api/children/${childId}/commands`, { body: { type: "buzz" } });
    } finally {
      setTimeout(() => setBuzzing(false), 2500);
    }
  };
  const ack = async (a: Alert) => {
    await api(`/api/children/${childId}/alerts/${a.id}/ack`, { method: "POST" });
    reload();
  };

  const u = live.device.usage;
  const lim = live.child.settings;

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      {/* HERO */}
      <Card className="!p-0 lg:col-span-8" glow={statusColor}>
        <div className="grid h-full md:grid-cols-[1fr,1.1fr]">
          <div className="flex flex-col p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Pill color={statusColor} pulse>
                {r?.sos ? "SOS" : !r ? "No data yet" : inside ? "In a safe zone" : "Outside safe zones"}
              </Pill>
              {live.child.simulator_enabled && <Pill color="rgb(var(--violet))">Demo · {live.simulator.phase}</Pill>}
            </div>
            <h1 className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
              {name} is <span style={{ color: statusColor }}>{where}</span>
            </h1>
            <p className="mt-2 text-sm text-muted">
              Updated <span className="num">{timeAgo(r?.ts, now)}</span>
              {r?.stale && " · GPS signal lost, showing last known position"}
              {live.outside_since && !inside && ` · outside since ${clock(live.outside_since)}`}
            </p>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <MiniStat icon={<ActIcon size={16} />} label="Activity" value={r?.activity ?? "—"} />
              <MiniStat icon={<Footprints size={16} />} label="Steps / tick" value={r ? String(r.steps) : "—"} />
              <MiniStat
                icon={<Satellite size={16} />}
                label="GPS"
                value={r ? (r.fix ? "Fix OK" : "No fix") : "—"}
                color={r && !r.fix ? "rgb(var(--warn))" : undefined}
              />
              <MiniStat
                icon={<Battery size={16} />}
                label="Battery"
                value={live.child.battery != null ? `${Math.round(live.child.battery)}%` : "—"}
                color={live.child.battery != null && live.child.battery < 20 ? "rgb(var(--crit))" : undefined}
              />
            </div>

            <div className="mt-auto flex flex-wrap items-center gap-2 pt-6">
              <button onClick={buzz} disabled={buzzing} className="btn-ghost">
                <BellRing size={15} className={clsx(buzzing && "animate-bounce text-warn")} />
                {buzzing ? "Buzzer queued" : "Ring device"}
              </button>
              <Link to="/map" className="btn-ghost">
                <Navigation size={15} /> Track live
              </Link>
              <div className="ml-auto flex items-center gap-2 text-[11px] text-muted" title="Mirror of the LED on the device">
                Device LED
                <span className="h-3 w-3 rounded-full" style={{ background: ledColor, boxShadow: `0 0 10px ${ledColor}, 0 0 20px ${ledColor}` }} />
              </div>
            </div>
          </div>
          <div className="relative min-h-[260px] overflow-hidden md:rounded-r-3xl">
            <LiveMap
              zones={live.zones}
              pos={r?.lat != null && r.lon != null ? [r.lat, r.lon] : null}
              trail={live.trail.map((t) => [t.lat, t.lon] as [number, number])}
              name={name}
              color={statusColor.includes("crit") ? "#fb4d6d" : statusColor.includes("warn") ? "#fbbf24" : "#34f5c5"}
              interactive={false}
              className="absolute inset-0 h-full w-full"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[rgb(var(--surface)/0.35)] to-transparent md:from-[rgb(var(--surface)/0.5)]" />
          </div>
        </div>
      </Card>

      {/* TRUST */}
      <Card className="lg:col-span-4" title="Trust score" delay={0.05} action={<Link to="/trust" className="text-xs font-semibold text-muted hover:text-fg">Details →</Link>}>
        <TrustRing score={live.trust.trust} band={live.trust.band} label={live.trust.label} components={live.trust.components} size={230} />
        <div className="mt-4 grid grid-cols-5 gap-1.5">
          {(Object.keys(componentMeta) as (keyof typeof live.trust.components)[]).map((k) => (
            <div key={k} className="rounded-xl bg-line/[0.03] p-2 text-center">
              <div className="mx-auto mb-1 h-1.5 w-6 rounded-full" style={{ background: componentMeta[k].color }} />
              <div className="num text-sm font-semibold" style={{ color: scoreColor(live.trust.components[k]) }}>
                {live.trust.components[k].toFixed(2)}
              </div>
              <div className="text-[10px] text-muted">{componentMeta[k].label}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* SOUND */}
      <Card className="lg:col-span-5" title="Ambient sound" icon={<AudioLines size={16} />} delay={0.1} action={<Link to="/sound" className="text-xs font-semibold text-muted hover:text-fg">Open →</Link>}>
        <SoundMeter sound={live.sound} persist={lim.very_loud_persist_seconds} compact />
        <div className="mt-4 h-20">
          <ResponsiveContainer>
            <AreaChart data={live.sound_series} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#f472b6" stopOpacity={0.5} />
                  <stop offset="1" stopColor="#f472b6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis domain={[30, 100]} hide />
              <ReferenceLine y={85} stroke="rgb(var(--crit))" strokeDasharray="3 4" strokeOpacity={0.7} />
              <Area type="monotone" dataKey="db" stroke="#f472b6" strokeWidth={2} fill="url(#sg)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* ATTENDANCE */}
      <Card className="lg:col-span-3" title="Today's RFID log" icon={<CreditCard size={16} />} delay={0.15}>
        {live.attendance_today.length ? (
          <ol className="relative space-y-4 border-l border-line/10 pl-4">
            {live.attendance_today.slice(-5).map((a, i) => (
              <li key={i} className="relative">
                <span className={clsx("absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full", a.direction === "in" ? "bg-safe" : "bg-info")} />
                <div className="text-sm font-semibold">{a.direction === "in" ? "Entered" : "Left"} {a.zone ?? "reader"}</div>
                <div className="num text-xs text-muted">{clock(a.ts)}</div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="py-6 text-center text-sm text-muted">No scans yet today.<br />The card is scanned at the school gate.</div>
        )}
        <Link to="/attendance" className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-fg">
          Full log <ArrowRight size={12} />
        </Link>
      </Card>

      {/* SCHEDULE */}
      <Card className="lg:col-span-4" title="Routine adherence" delay={0.2} action={<span className="num text-sm font-semibold" style={{ color: scoreColor(live.schedule.adherence) }}>{Math.round(live.schedule.adherence * 100)}%</span>}>
        <div className="space-y-2.5">
          {live.schedule.checks.map((c) => (
            <div key={c.name} className="flex items-center justify-between gap-3 rounded-xl bg-line/[0.03] px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-medium">{c.name}</div>
                <div className="truncate text-xs text-muted">
                  Planned {c.planned} · Observed {c.observed}
                </div>
              </div>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: scoreColor(c.score), boxShadow: `0 0 8px ${scoreColor(c.score)}` }} />
            </div>
          ))}
        </div>
      </Card>

      {/* ALERTS */}
      <Card
        className="lg:col-span-7"
        title="Latest alerts"
        icon={<Bell size={16} />}
        delay={0.25}
        action={<Link to="/alerts" className="text-xs font-semibold text-muted hover:text-fg">All alerts ({live.unacked_alerts} new) →</Link>}
      >
        <div className="space-y-2">
          {live.recent_alerts.length ? live.recent_alerts.slice(0, 3).map((a) => <AlertItem key={a.id} a={a} onAck={ack} />) : <div className="py-6 text-center text-sm text-muted">All quiet.</div>}
        </div>
      </Card>

      {/* DEVICE */}
      <Card
        className="lg:col-span-5"
        title="Device usage today"
        icon={<Smartphone size={16} />}
        delay={0.3}
        action={<span className="num text-sm font-semibold" style={{ color: scoreColor(live.device.score) }}>Sd {live.device.score.toFixed(2)}</span>}
      >
        <div className="space-y-4">
          <UsageRow icon={<Smartphone size={14} />} label="Screen time" value={u.screen_minutes} limit={lim.screen_limit_minutes} />
          <UsageRow icon={<Moon size={14} />} label="Night use (after 22:00)" value={u.night_minutes} limit={lim.night_limit_minutes} />
          <div className="grid grid-cols-3 gap-2 pt-1">
            <MiniStat icon={<BookOpen size={14} />} label="Study" value={minutes(u.study_minutes)} />
            <MiniStat icon={<Gamepad2 size={14} />} label="Gaming" value={minutes(u.gaming_minutes)} color={u.gaming_minutes > u.study_minutes ? "rgb(var(--warn))" : undefined} />
            <MiniStat icon={<Smartphone size={14} />} label="Unlocks" value={String(u.unlocks)} color={u.unlocks > lim.unlock_limit ? "rgb(var(--warn))" : undefined} />
          </div>
          <div className="space-y-1.5">
            {live.device.violations.length ? (
              live.device.violations.map((v) => (
                <div key={v.key} className="flex items-center justify-between gap-2 rounded-xl bg-warn/10 px-3 py-2 text-xs text-warn">
                  <b>{v.title}</b>
                  <span className="opacity-80">{v.detail}</span>
                </div>
              ))
            ) : (
              <div className="rounded-xl bg-safe/10 px-3 py-2 text-xs text-safe">All usage within limits: no device penalties today</div>
            )}
          </div>
        </div>
      </Card>

      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }} className="text-center text-[11px] text-muted lg:col-span-12">
        The Trust Score ranks what needs attention first. It is not a measured probability of safety.{" "}
        <span style={{ color: bandColor[live.trust.band] }}>●</span>
      </motion.p>
    </div>
  );
}

function MiniStat({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color?: string }) {
  return (
    <div className="rounded-2xl border border-line/5 bg-line/[0.03] p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted">
        {icon}
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-semibold" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}

function UsageRow({ icon, label, value, limit }: { icon: React.ReactNode; label: string; value: number; limit: number }) {
  const over = value > limit;
  const c = over ? "rgb(var(--crit))" : value > limit * 0.8 ? "rgb(var(--warn))" : "rgb(var(--safe))";
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 text-muted">
          {icon}
          {label}
        </span>
        <span className="num font-semibold">
          <span style={{ color: c }}>{minutes(value)}</span>
          <span className="text-muted"> / {minutes(limit)}</span>
        </span>
      </div>
      <Bar value={value} max={limit} color={c} />
    </div>
  );
}
