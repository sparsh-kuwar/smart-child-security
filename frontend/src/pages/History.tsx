import { TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";
import { Bar as RBar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, PageHeader, Pill, Segmented, Skeleton, Stat } from "../components/ui";
import { componentMeta, dayLabel, minutes, scoreColor, soundColor } from "../lib/format";
import { useApi, useLive } from "../lib/live";
import type { DaySummary } from "../lib/types";
import { ChartTip } from "./Sound";

interface HistoryResp {
  days: DaySummary[];
  aggregate: {
    days: number;
    avg_trust: number;
    avg_steps: number;
    avg_screen_minutes: number;
    avg_in_zone_pct: number;
    avg_db: number;
    total_alerts: number;
    total_critical: number;
    very_loud_events: number;
    best_day: { date: string; trust_score: number };
    worst_day: { date: string; trust_score: number };
    activity_mix: Record<string, number>;
    sound_mix: Record<string, number>;
    components: Record<string, number>;
  };
  trends: { metric: string; direction: "up" | "down"; delta: number; level: string; title: string; message: string }[];
  unusual: { title: string; message: string }[];
}

const ACT_COLOR: Record<string, string> = { Sleeping: "#9787ff", Idle: "#8c98b2", Sitting: "#60a5fa", Walking: "#34f5c5", Active: "#f472b6" };

export default function History() {
  const { childId } = useLive();
  const [days, setDays] = useState(14);
  const { data } = useApi<HistoryResp>(childId ? `/api/children/${childId}/history?days=${days}` : null);
  if (!data) return <Skeleton className="h-[75vh]" />;
  const a = data.aggregate;
  const anySim = data.days.some((d) => d.simulated);
  const mix = (m: Record<string, number>, colors: Record<string, string>) => (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full">
        {Object.entries(m).map(([k, v]) => (
          <div key={k} style={{ width: `${v * 100}%`, background: colors[k] ?? "#888" }} title={`${k} ${(v * 100).toFixed(0)}%`} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
        {Object.entries(m).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: colors[k] }} />
            {k} {(v * 100).toFixed(0)}%
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <PageHeader
        title="History"
        subtitle={
          <>
            The History Aggregator and Daily Trend Analyzer compare each day with the one before.
            {anySim && (
              <span className="ml-2 inline-block">
                <Pill color="rgb(var(--violet))">Earlier days are simulated back-fill</Pill>
              </span>
            )}
          </>
        }
        action={<Segmented value={days} onChange={setDays} options={[{ value: 7, label: "7 d" }, { value: 14, label: "14 d" }, { value: 30, label: "30 d" }]} />}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          { l: "Avg trust", v: `${a.avg_trust?.toFixed(0)}%`, c: scoreColor(a.avg_trust / 100) },
          { l: "Avg steps", v: a.avg_steps?.toLocaleString() },
          { l: "Avg screen", v: minutes(a.avg_screen_minutes ?? 0) },
          { l: "In safe zones", v: `${a.avg_in_zone_pct?.toFixed(0)}%` },
          { l: "Alerts", v: a.total_alerts, s: `${a.total_critical} critical` },
          { l: "Very-loud events", v: a.very_loud_events },
        ].map((s) => (
          <div key={s.l} className="glass rounded-2xl p-4">
            <Stat label={s.l} value={s.v} color={s.c} sub={s.s} />
          </div>
        ))}
      </div>

      {(data.trends.length > 0 || data.unusual.length > 0) && (
        <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[...data.trends, ...data.unusual.map((u) => ({ ...u, direction: "down" as const, level: "warning", metric: u.title, delta: 0 }))].map((t, i) => (
            <div key={i} className="glass flex gap-3 rounded-2xl p-4">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${t.direction === "up" ? "bg-safe/10 text-safe" : "bg-warn/10 text-warn"}`}>
                {t.direction === "up" ? <TrendingUp size={17} /> : <TrendingDown size={17} />}
              </span>
              <div>
                <div className="text-sm font-semibold">{t.title}</div>
                <div className="text-xs text-muted">{t.message}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-12">
        <Card className="lg:col-span-8" title="Daily trust score & alerts">
          <div className="h-[300px]">
            <ResponsiveContainer>
              <ComposedChart data={data.days} margin={{ top: 8, right: 0, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="rgb(var(--line) / 0.06)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d) => dayLabel(d).split(",")[0]} tick={{ fontSize: 10, fill: "rgb(var(--muted))" }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="t" domain={[0, 100]} tick={{ fontSize: 10, fill: "rgb(var(--muted))" }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="a" orientation="right" hide />
                <Tooltip content={<ChartTip />} cursor={{ fill: "rgb(var(--line) / 0.04)" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <RBar yAxisId="a" dataKey="alerts" name="Alerts" fill="#fbbf24" opacity={0.35} radius={[6, 6, 0, 0]} />
                <RBar yAxisId="a" dataKey="critical_alerts" name="Critical" fill="#fb4d6d" radius={[6, 6, 0, 0]} />
                <Line yAxisId="t" type="monotone" dataKey="trust_score" name="Trust %" stroke="#34f5c5" strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="lg:col-span-4" title="Average components">
          <div className="space-y-3">
            {Object.entries(a.components ?? {}).map(([k, v]) => {
              const key = k.replace("_score", "");
              return (
                <div key={k} className="flex items-center gap-3">
                  <span className="w-20 text-sm">{componentMeta[key]?.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-line/[0.07]">
                    <div className="h-full rounded-full" style={{ width: `${v * 100}%`, background: componentMeta[key]?.color }} />
                  </div>
                  <span className="num w-10 text-right text-sm">{v.toFixed(2)}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-safe/10 p-3">
              <div className="text-[11px] text-muted">Best day</div>
              <div className="font-semibold">{a.best_day && dayLabel(a.best_day.date)}</div>
              <div className="num text-safe">{a.best_day?.trust_score.toFixed(0)}%</div>
            </div>
            <div className="rounded-xl bg-crit/10 p-3">
              <div className="text-[11px] text-muted">Toughest day</div>
              <div className="font-semibold">{a.worst_day && dayLabel(a.worst_day.date)}</div>
              <div className="num text-crit">{a.worst_day?.trust_score.toFixed(0)}%</div>
            </div>
          </div>
        </Card>
        <Card className="lg:col-span-6" title="Activity mix">
          {mix(a.activity_mix ?? {}, ACT_COLOR)}
          <div className="mt-6 h-[180px]">
            <ResponsiveContainer>
              <BarChart data={data.days} margin={{ top: 0, right: 0, left: -18, bottom: 0 }}>
                <XAxis dataKey="date" tickFormatter={(d) => dayLabel(d).split(",")[0]} tick={{ fontSize: 10, fill: "rgb(var(--muted))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "rgb(var(--muted))" }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} cursor={{ fill: "rgb(var(--line) / 0.04)" }} />
                <RBar dataKey="steps" name="Steps" radius={[6, 6, 0, 0]}>
                  {data.days.map((d) => (
                    <Cell key={d.date} fill="#34f5c5" opacity={0.4 + 0.6 * Math.min(1, d.steps / 10000)} />
                  ))}
                </RBar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="lg:col-span-6" title="Sound environment">
          {mix(a.sound_mix ?? {}, soundColor)}
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="pb-2 font-medium">Day</th>
                  <th className="pb-2 font-medium">Arrival</th>
                  <th className="pb-2 text-right font-medium">Avg dB</th>
                  <th className="pb-2 text-right font-medium">Peak</th>
                  <th className="pb-2 text-right font-medium">Trust</th>
                </tr>
              </thead>
              <tbody>
                {[...data.days].reverse().slice(0, 7).map((d) => (
                  <tr key={d.date} className="border-t border-line/5">
                    <td className="py-2">{dayLabel(d.date)}</td>
                    <td className="num py-2">{d.arrival ?? "—"}</td>
                    <td className="num py-2 text-right">{d.avg_db.toFixed(0)}</td>
                    <td className="num py-2 text-right" style={{ color: d.max_db > 85 ? "rgb(var(--crit))" : undefined }}>{d.max_db.toFixed(0)}</td>
                    <td className="num py-2 text-right font-semibold" style={{ color: scoreColor(d.trust_score / 100) }}>
                      {d.trust_score.toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
