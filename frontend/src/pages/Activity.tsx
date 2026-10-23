import { Activity as ActivityIcon, AlertTriangle, CheckCircle2, Smartphone } from "lucide-react";
import { useMemo } from "react";
import { Bar as RBar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { Bar, Card, PageHeader, Skeleton, Stat } from "../components/ui";
import { clock, dayLabel, minutes, scoreColor } from "../lib/format";
import { useApi, useLive } from "../lib/live";
import type { Reading, Usage, Violation } from "../lib/types";
import { activityIcon } from "./Overview";
import { ChartTip } from "./Sound";

const ACTS = ["Sleeping", "Idle", "Sitting", "Walking", "Active"];
const ACT_COLOR: Record<string, string> = { Sleeping: "#9787ff", Idle: "#8c98b2", Sitting: "#60a5fa", Walking: "#34f5c5", Active: "#f472b6" };

interface DeviceResp {
  usage: Usage;
  score: number;
  violations: Violation[];
  limits: { screen: number; night: number; unlocks: number };
  activity_counts: Record<string, number>;
  history: { date: string; screen_minutes: number; device_score: number }[];
}

export default function ActivityPage() {
  const { childId, live } = useLive();
  const { data: readings } = useApi<Reading[]>(childId ? `/api/children/${childId}/readings?minutes=60` : null, 3);
  const { data: dev } = useApi<DeviceResp>(childId ? `/api/children/${childId}/device` : null, 6);

  const timeline = useMemo(
    () => (readings ?? []).map((r) => ({ ts: new Date(r.ts).getTime(), y: ACTS.indexOf(r.activity), activity: r.activity, steps: r.steps, movement: r.movement })),
    [readings],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (readings ?? []).forEach((r) => (c[r.activity] = (c[r.activity] ?? 0) + 1));
    return c;
  }, [readings]);

  if (!live || !dev) return <Skeleton className="h-[75vh]" />;
  const r = live.reading;
  const Icon = activityIcon[r?.activity ?? "Idle"] ?? ActivityIcon;
  const n = readings?.length || 1;
  const u = dev.usage;
  const usageBars = [
    { name: "Study", value: u.study_minutes, color: "#34f5c5" },
    { name: "Gaming", value: u.gaming_minutes, color: "#f472b6" },
    { name: "Other", value: u.other_minutes, color: "#60a5fa" },
    { name: "Night", value: u.night_minutes, color: "#9787ff" },
  ];

  return (
    <>
      <PageHeader title="Activity & device" subtitle="The activity classifier uses steps, movement intensity, screen state and time of day. Device behaviour is scored against usage limits." />
      <div className="grid gap-5 lg:grid-cols-12">
        <Card className="lg:col-span-4" title="Current activity">
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl" style={{ background: `${ACT_COLOR[r?.activity ?? "Idle"]}22`, color: ACT_COLOR[r?.activity ?? "Idle"] }}>
              <Icon size={38} />
            </div>
            <div>
              <div className="font-display text-3xl font-bold">{r?.activity ?? "—"}</div>
              <div className="text-sm text-muted">Activity score Sa {live.trust.components.activity.toFixed(2)}</div>
            </div>
          </div>
          <div className="mt-6 grid grid-cols-3 gap-3">
            <Stat label="Steps" value={r?.steps ?? "—"} sub="per reading" />
            <Stat label="Movement" value={r ? r.movement.toFixed(2) : "—"} sub="0–1 intensity" />
            <Stat label="Screen" value={r?.screen_on ? "On" : "Off"} />
          </div>
          <div className="mt-6 space-y-2.5">
            {ACTS.map((a) => (
              <div key={a}>
                <div className="mb-1 flex justify-between text-xs">
                  <span>{a}</span>
                  <span className="num text-muted">{Math.round(((counts[a] ?? 0) / n) * 100)}%</span>
                </div>
                <Bar value={counts[a] ?? 0} max={n} color={ACT_COLOR[a]} />
              </div>
            ))}
          </div>
        </Card>

        <Card className="lg:col-span-8" title="Activity timeline · last hour">
          <div className="h-[340px]">
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid stroke="rgb(var(--line) / 0.06)" />
                <XAxis dataKey="ts" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(t) => clock(new Date(t).toISOString())} tick={{ fontSize: 10, fill: "rgb(var(--muted))" }} axisLine={false} tickLine={false} />
                <YAxis dataKey="y" type="number" domain={[-0.5, 4.5]} ticks={[0, 1, 2, 3, 4]} tickFormatter={(v) => ACTS[v]} tick={{ fontSize: 11, fill: "rgb(var(--muted))" }} width={70} axisLine={false} tickLine={false} />
                <ZAxis range={[40, 40]} />
                <Tooltip
                  cursor={{ stroke: "rgb(var(--line) / 0.2)" }}
                  content={({ active, payload }) =>
                    active && payload?.length ? (
                      <div className="glass rounded-xl px-3 py-2 text-xs">
                        <div className="font-semibold">{payload[0].payload.activity}</div>
                        <div className="text-muted">
                          {clock(new Date(payload[0].payload.ts).toISOString(), true)} · {payload[0].payload.steps} steps · mv {payload[0].payload.movement.toFixed(2)}
                        </div>
                      </div>
                    ) : null
                  }
                />
                <Scatter data={timeline} isAnimationActive={false}>
                  {timeline.map((p, i) => (
                    <Cell key={i} fill={ACT_COLOR[p.activity]} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="lg:col-span-5" title="Device behaviour today" icon={<Smartphone size={16} />} action={<span className="num font-semibold" style={{ color: scoreColor(dev.score) }}>Sd {dev.score.toFixed(2)}</span>}>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Screen" value={minutes(u.screen_minutes)} sub={`limit ${minutes(dev.limits.screen)}`} color={u.screen_minutes > dev.limits.screen ? "rgb(var(--crit))" : undefined} />
            <Stat label="Night" value={minutes(u.night_minutes)} sub={`limit ${dev.limits.night}m`} color={u.night_minutes > dev.limits.night ? "rgb(var(--crit))" : undefined} />
            <Stat label="Unlocks" value={u.unlocks} sub={`limit ${dev.limits.unlocks}`} color={u.unlocks > dev.limits.unlocks ? "rgb(var(--crit))" : undefined} />
          </div>
          <div className="mt-5 h-36">
            <ResponsiveContainer>
              <BarChart data={usageBars} layout="vertical" margin={{ left: 0, right: 10 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={56} tick={{ fontSize: 11, fill: "rgb(var(--muted))" }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip unit=" min" />} cursor={{ fill: "rgb(var(--line) / 0.04)" }} />
                <RBar dataKey="value" name="Minutes" radius={[0, 8, 8, 0]} barSize={14}>
                  {usageBars.map((b) => (
                    <Cell key={b.name} fill={b.color} />
                  ))}
                </RBar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 space-y-2">
            {dev.violations.length ? (
              dev.violations.map((v) => (
                <div key={v.key} className="flex items-center gap-2 rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn">
                  <AlertTriangle size={15} /> <b>{v.title}</b> <span className="text-xs opacity-80">{v.detail}</span>
                </div>
              ))
            ) : (
              <div className="flex items-center gap-2 rounded-xl bg-safe/10 px-3 py-2 text-sm text-safe">
                <CheckCircle2 size={15} /> All usage within limits
              </div>
            )}
          </div>
        </Card>

        <Card className="lg:col-span-7" title="Screen time · last 14 days">
          <div className="h-[300px]">
            <ResponsiveContainer>
              <BarChart data={dev.history} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="rgb(var(--line) / 0.06)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d) => dayLabel(d).split(",")[0]} tick={{ fontSize: 10, fill: "rgb(var(--muted))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "rgb(var(--muted))" }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip unit=" min" />} cursor={{ fill: "rgb(var(--line) / 0.04)" }} />
                <ReferenceLine y={dev.limits.screen} stroke="#fb4d6d" strokeDasharray="4 4" label={{ value: "limit", fontSize: 10, fill: "#fb4d6d", position: "insideTopRight" }} />
                <RBar dataKey="screen_minutes" name="Screen" radius={[8, 8, 0, 0]}>
                  {dev.history.map((d) => (
                    <Cell key={d.date} fill={d.screen_minutes > dev.limits.screen ? "#fb4d6d" : "#60a5fa"} />
                  ))}
                </RBar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </>
  );
}
