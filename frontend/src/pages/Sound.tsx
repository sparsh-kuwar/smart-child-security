import { AudioLines, Ban, Cpu, Mic, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { Area, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import AlertItem from "../components/AlertItem";
import SoundMeter from "../components/SoundMeter";
import { Card, PageHeader, Segmented, Skeleton } from "../components/ui";
import { clock, soundColor } from "../lib/format";
import { useApi, useLive } from "../lib/live";
import type { Alert, SoundNow } from "../lib/types";

interface SoundResp {
  current: SoundNow;
  series: { ts: string; db: number | null; category: string | null; rolling: number | null }[];
  mix: Record<string, number>;
  events: Alert[];
  thresholds: { persist_seconds: number; window_seconds: number };
}

const SOUND_HEX: Record<string, string> = { Quiet: "#34f5c5", Normal: "#60a5fa", Loud: "#fbbf24", "Very Loud": "#fb4d6d" };

export function ChartTip({ active, payload, label, unit = "" }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass rounded-xl px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 text-muted">{typeof label === "string" && label.includes("T") ? clock(label, true) : label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.stroke }} />
          <span className="text-muted">{p.name}</span>
          <span className="num ml-auto font-semibold">
            {typeof p.value === "number" ? p.value.toFixed(1) : p.value}
            {unit}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function Sound() {
  const { live, childId } = useLive();
  const [mins, setMins] = useState(15);
  const { data } = useApi<SoundResp>(childId ? `/api/children/${childId}/sound?minutes=${mins}` : null, 2);

  if (!live || !data) return <Skeleton className="h-[75vh]" />;
  const total = Object.values(data.mix).reduce((a, b) => a + b, 0) || 1;
  const pie = ["Quiet", "Normal", "Loud", "Very Loud"].map((k) => ({ name: k, value: data.mix[k] ?? 0 }));

  return (
    <>
      <PageHeader
        title="Ambient sound"
        subtitle="Classified into Quiet (<50 dB), Normal (50–70), Loud (70–85) and Very Loud (>85), with a rolling-window persistence rule."
        action={<Segmented value={mins} onChange={setMins} options={[{ value: 15, label: "15 min" }, { value: 60, label: "1 h" }, { value: 360, label: "6 h" }]} />}
      />
      <div className="grid gap-5 lg:grid-cols-12">
        <Card className="lg:col-span-5" title="Right now" icon={<AudioLines size={16} />}>
          <SoundMeter sound={live.sound} persist={data.thresholds.persist_seconds} />
        </Card>

        <Card className="lg:col-span-7" title="Sound level over time">
          <div className="h-[300px]">
            <ResponsiveContainer>
              <ComposedChart data={data.series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="dbg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#f472b6" stopOpacity={0.45} />
                    <stop offset="1" stopColor="#f472b6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <ReferenceArea y1={85} y2={110} fill="#fb4d6d" fillOpacity={0.07} />
                <ReferenceArea y1={70} y2={85} fill="#fbbf24" fillOpacity={0.05} />
                <CartesianGrid stroke="rgb(var(--line) / 0.06)" vertical={false} />
                <XAxis dataKey="ts" tickFormatter={(t) => clock(t)} tick={{ fontSize: 10, fill: "rgb(var(--muted))" }} minTickGap={50} axisLine={false} tickLine={false} />
                <YAxis domain={[30, 105]} tick={{ fontSize: 10, fill: "rgb(var(--muted))" }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip unit=" dB" />} />
                <ReferenceLine y={85} stroke="#fb4d6d" strokeDasharray="4 4" label={{ value: "85 dB", fontSize: 10, fill: "#fb4d6d", position: "insideTopRight" }} />
                <Area type="monotone" dataKey="db" name="Level" stroke="#f472b6" strokeWidth={1.6} fill="url(#dbg)" isAnimationActive={false} />
                <Line type="monotone" dataKey="rolling" name="5-min avg" stroke="rgb(var(--fg))" strokeWidth={2} dot={false} strokeDasharray="5 3" isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="lg:col-span-4" title="Category mix">
          <div className="flex items-center gap-4">
            <div className="h-40 w-40 shrink-0">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={pie} dataKey="value" innerRadius={48} outerRadius={70} paddingAngle={3} stroke="none" isAnimationActive>
                    {pie.map((p) => (
                      <Cell key={p.name} fill={SOUND_HEX[p.name]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-2">
              {pie.map((p) => (
                <div key={p.name} className="flex items-center gap-2 text-sm">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: soundColor[p.name] }} />
                  <span className="flex-1">{p.name}</span>
                  <span className="num text-muted">{Math.round((100 * p.value) / total)}%</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card className="lg:col-span-4" title="Privacy pipeline" icon={<ShieldCheck size={16} />}>
          <ol className="space-y-3">
            {[
              { icon: Mic, t: "Electret mic + envelope detector", d: "An analogue signal goes to the Arduino's A0 pin." },
              { icon: Cpu, t: "On-device dB estimate", d: "Samples become one calibrated dB value." },
              { icon: Trash2, t: "Samples discarded immediately", d: "Raw audio never leaves RAM." },
              { icon: Ban, t: "No speech processing", d: "No speech-to-text, recognition or fingerprinting." },
            ].map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-safe/10 text-safe">
                  <s.icon size={15} />
                </span>
                <div>
                  <div className="text-sm font-medium">{s.t}</div>
                  <div className="text-xs text-muted">{s.d}</div>
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <Card className="lg:col-span-4" title="Sound events">
          <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
            {data.events.length ? data.events.map((a) => <AlertItem key={a.id} a={a} compact />) : <div className="py-8 text-center text-sm text-muted">No sound events logged.</div>}
          </div>
        </Card>
      </div>
    </>
  );
}
