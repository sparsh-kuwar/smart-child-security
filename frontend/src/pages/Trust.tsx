import { Calculator, Gauge, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import TrustRing from "../components/TrustRing";
import { Bar, Card, PageHeader, Segmented, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import { clock, componentMeta, scoreColor, WEIGHTS } from "../lib/format";
import { useApi, useLive } from "../lib/live";
import type { Components, TrustNow } from "../lib/types";
import { ChartTip } from "./Sound";

interface TrustResp {
  current: TrustNow;
  history: ({ ts: string; score: number } & Components)[];
  formula: string;
}
const KEYS = ["activity", "schedule", "location", "device", "sound"] as const;
const PRESETS: { name: string; v: Components }[] = [
  { name: "Case study §5.3", v: { activity: 0.8, schedule: 0.7, location: 1, device: 0.6, sound: 1 } },
  { name: "Perfect day", v: { activity: 1, schedule: 1, location: 1, device: 1, sound: 1 } },
  { name: "Critical combo", v: { activity: 0.6, schedule: 0.7, location: 0.3, device: 0.8, sound: 0.2 } },
];

export default function Trust() {
  const { childId, live } = useLive();
  const [hours, setHours] = useState(6);
  const { data } = useApi<TrustResp>(childId ? `/api/children/${childId}/trust?hours=${hours}` : null, 6);
  const [whatIf, setWhatIf] = useState<Components>(PRESETS[0].v);
  const [result, setResult] = useState<TrustNow | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        setResult(await api<TrustNow>("/api/trust/calculate", { body: whatIf }));
      } catch {
        /* ignore */
      }
    }, 120);
    return () => clearTimeout(t);
  }, [whatIf]);

  if (!data || !live) return <Skeleton className="h-[75vh]" />;
  const cur = live.trust;

  return (
    <>
      <PageHeader
        title="Trust score"
        subtitle={
          <>
            <span className="num rounded-md bg-line/5 px-2 py-0.5 text-fg">T = 100 × (0.25·Sa + 0.20·Ss + 0.25·Sl + 0.15·Sd + 0.15·Sn)</span>
            <span className="ml-2">A ranking aid for what needs attention. It is not a probability of safety.</span>
          </>
        }
        action={<Segmented value={hours} onChange={setHours} options={[{ value: 6, label: "6 h" }, { value: 24, label: "24 h" }, { value: 168, label: "7 d" }]} />}
      />
      <div className="grid gap-5 lg:grid-cols-12">
        <Card className="lg:col-span-4" title="Now" icon={<Gauge size={16} />}>
          <TrustRing score={cur.trust} band={cur.band} label={cur.label} components={cur.components} />
          <div className="mt-5 space-y-3">
            {cur.explain.map((e) => (
              <div key={e.component}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: componentMeta[e.component].color }} />
                    {componentMeta[e.component].label}
                    <span className="text-xs text-muted">({componentMeta[e.component].short} × {e.weight})</span>
                  </span>
                  <span className="num">
                    <b style={{ color: scoreColor(e.value) }}>{e.value.toFixed(2)}</b>
                    <span className="text-xs text-muted"> → {e.points.toFixed(1)} pts</span>
                  </span>
                </div>
                <Bar value={e.value} color={componentMeta[e.component].color} />
                {e.lost > 3 && <div className="mt-1 text-[11px] text-warn">Costing {e.lost.toFixed(1)} points</div>}
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-5 lg:col-span-8">
          <Card title="Trust score over time">
            <div className="h-[230px]">
              <ResponsiveContainer>
                <AreaChart data={data.history} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#34f5c5" stopOpacity={0.5} />
                      <stop offset="1" stopColor="#9787ff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgb(var(--line) / 0.06)" vertical={false} />
                  <XAxis dataKey="ts" tickFormatter={(t) => (hours > 24 ? new Date(t).toLocaleDateString([], { weekday: "short" }) : clock(t))} tick={{ fontSize: 10, fill: "rgb(var(--muted))" }} minTickGap={40} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "rgb(var(--muted))" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTip unit="%" />} />
                  <ReferenceLine y={80} stroke="#34f5c5" strokeDasharray="3 5" strokeOpacity={0.5} />
                  <ReferenceLine y={45} stroke="#fb4d6d" strokeDasharray="3 5" strokeOpacity={0.5} />
                  <Area type="monotone" dataKey="score" name="Trust" stroke="#34f5c5" strokeWidth={2.2} fill="url(#tg)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="Component breakdown">
            <div className="h-[230px]">
              <ResponsiveContainer>
                <LineChart data={data.history} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="rgb(var(--line) / 0.06)" vertical={false} />
                  <XAxis dataKey="ts" tickFormatter={(t) => (hours > 24 ? new Date(t).toLocaleDateString([], { weekday: "short" }) : clock(t))} tick={{ fontSize: 10, fill: "rgb(var(--muted))" }} minTickGap={40} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: "rgb(var(--muted))" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {KEYS.map((k) => (
                    <Line key={k} type="stepAfter" dataKey={k} name={componentMeta[k].label} stroke={componentMeta[k].color} strokeWidth={1.8} dot={false} isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        <Card
          className="lg:col-span-12"
          title="What-if calculator"
          icon={<Calculator size={16} />}
          action={
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button key={p.name} className="rounded-lg bg-line/5 px-2.5 py-1 text-xs font-medium hover:bg-line/10" onClick={() => setWhatIf(p.v)}>
                  {p.name}
                </button>
              ))}
              <button className="rounded-lg p-1 text-muted hover:bg-line/10" onClick={() => setWhatIf(cur.components)} aria-label="Use live values" title="Use live values">
                <RotateCcw size={14} />
              </button>
            </div>
          }
        >
          <div className="grid items-center gap-6 md:grid-cols-[1fr,auto]">
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
              {KEYS.map((k) => (
                <div key={k}>
                  <label className="label flex justify-between">
                    <span>
                      {componentMeta[k].label} <span className="normal-case opacity-70">w={WEIGHTS[k]}</span>
                    </span>
                    <span className="num text-fg">{whatIf[k].toFixed(2)}</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={whatIf[k]}
                    onChange={(e) => setWhatIf({ ...whatIf, [k]: Number(e.target.value) })}
                    className="w-full"
                    style={{ accentColor: componentMeta[k].color }}
                  />
                </div>
              ))}
            </div>
            {result && (
              <div className="text-center">
                <div className="num font-display text-5xl font-bold" style={{ color: scoreColor(result.trust / 100) }}>
                  {result.trust.toFixed(1)}%
                </div>
                <div className="text-sm text-muted">{result.label}</div>
              </div>
            )}
          </div>
          <p className="mt-4 text-xs text-muted">
            Note: the report's §5.3 case study prints 84%. With the stated inputs (0.8, 0.7, 1.0, 0.6, 1.0) the formula actually gives <b>83%</b>, and this calculator shows the correct value.
          </p>
        </Card>
      </div>
    </>
  );
}
