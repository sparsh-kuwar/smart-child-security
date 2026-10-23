import clsx from "clsx";
import { Backpack, BookOpen, Check, Clock, Footprints, Moon, Pencil, Plus, Smartphone, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, PageHeader, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import { scoreColor } from "../lib/format";
import { useApi, useLive } from "../lib/live";
import type { ScheduleCheck } from "../lib/types";

interface Item {
  id?: number;
  time: string;
  title: string;
  kind: string;
  priority: "high" | "medium" | "low";
}
interface SchedResp {
  items: Item[];
  periods: Record<string, Item[]>;
  now: { period: string; current: Item | null; next: Item | null; minutes_until_next: number | null };
  adherence: { checks: ScheduleCheck[]; adherence: number };
  reminders: { icon: string; text: string }[];
  local_time: string;
}

const REM_ICON: Record<string, typeof Clock> = { screen: Smartphone, book: BookOpen, run: Footprints, moon: Moon, bag: Backpack, check: Check };
const PERIOD_LABEL: Record<string, string> = { morning: "Morning · 06–12", afternoon: "Afternoon · 12–17", evening: "Evening · 17–21", night: "Night · 21–06" };

export default function Schedule() {
  const { childId } = useLive();
  const { data, reload } = useApi<SchedResp>(childId ? `/api/children/${childId}/schedule` : null, 12);
  const [edit, setEdit] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setEdit(null), [childId]);
  if (!data) return <Skeleton className="h-[75vh]" />;

  const save = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      await api(`/api/children/${childId}/schedule`, { method: "PUT", body: edit.filter((i) => i.title.trim()) });
      setEdit(null);
      reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const nowMin = Number(data.local_time.slice(0, 2)) * 60 + Number(data.local_time.slice(3));

  return (
    <>
      <PageHeader
        title="Schedule"
        subtitle="The Schedule Optimizer splits the day into periods and builds reminders from the routine it observes."
        action={
          edit ? (
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={() => setEdit(null)}>
                <X size={15} /> Cancel
              </button>
              <button className="btn-primary" onClick={save} disabled={busy}>
                <Check size={15} /> Save routine
              </button>
            </div>
          ) : (
            <button className="btn-ghost" onClick={() => setEdit(data.items.map((i) => ({ ...i })))}>
              <Pencil size={15} /> Edit routine
            </button>
          )
        }
      />
      <div className="grid gap-5 lg:grid-cols-12">
        <Card className="lg:col-span-4" title="Right now" icon={<Clock size={16} />}>
          <div className="num font-display text-5xl font-bold">{data.local_time}</div>
          <div className="mt-1 text-sm capitalize text-muted">{data.now.period}</div>
          <div className="mt-5 space-y-3">
            <div className="rounded-2xl bg-line/[0.04] p-4">
              <div className="text-[11px] uppercase tracking-wider text-muted">Current</div>
              <div className="mt-1 font-semibold">{data.now.current?.title ?? "Free time"}</div>
            </div>
            {data.now.next && (
              <div className="rounded-2xl border border-safe/30 bg-safe/5 p-4">
                <div className="text-[11px] uppercase tracking-wider text-safe">Up next · in {data.now.minutes_until_next} min</div>
                <div className="mt-1 font-semibold">
                  {data.now.next.time} · {data.now.next.title}
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card className="lg:col-span-4" title="Smart reminders" icon={<Sparkles size={16} />}>
          <div className="space-y-2.5">
            {data.reminders.map((r, i) => {
              const Icon = REM_ICON[r.icon] ?? Sparkles;
              return (
                <div key={i} className="flex gap-3 rounded-xl bg-line/[0.03] p-3">
                  <Icon size={17} className="mt-0.5 shrink-0 text-violet" />
                  <span className="text-sm">{r.text}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="lg:col-span-4" title="Adherence checks" action={<span className="num font-semibold" style={{ color: scoreColor(data.adherence.adherence) }}>Ss {data.adherence.adherence.toFixed(2)}</span>}>
          <div className="space-y-2.5">
            {data.adherence.checks.map((c) => (
              <div key={c.name} className="rounded-xl bg-line/[0.03] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{c.name}</span>
                  <span className="num text-xs font-bold" style={{ color: scoreColor(c.score) }}>
                    {c.score.toFixed(1)}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  Planned {c.planned} · Observed {c.observed}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="lg:col-span-12" title="Daily routine">
          {edit ? (
            <div className="space-y-2">
              {edit
                .map((it, idx) => ({ it, idx }))
                .sort((a, b) => a.it.time.localeCompare(b.it.time))
                .map(({ it, idx }) => (
                  <div key={idx} className="grid grid-cols-[110px,1fr,120px,auto] items-center gap-2">
                    <input type="time" className="input" value={it.time} onChange={(e) => setEdit(edit.map((x, j) => (j === idx ? { ...x, time: e.target.value } : x)))} />
                    <input className="input" value={it.title} onChange={(e) => setEdit(edit.map((x, j) => (j === idx ? { ...x, title: e.target.value } : x)))} />
                    <select className="input" value={it.priority} onChange={(e) => setEdit(edit.map((x, j) => (j === idx ? { ...x, priority: e.target.value as Item["priority"] } : x)))}>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                    <button className="rounded-lg p-2 text-muted hover:bg-crit/10 hover:text-crit" onClick={() => setEdit(edit.filter((_, j) => j !== idx))} aria-label="Remove">
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              <button className="btn-ghost mt-2" onClick={() => setEdit([...edit, { time: "12:00", title: "New activity", kind: "routine", priority: "medium" }])}>
                <Plus size={15} /> Add item
              </button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {Object.entries(data.periods).map(([p, items]) => (
                <div key={p} className={clsx("rounded-2xl border p-4", p === data.now.period ? "border-safe/40 bg-safe/[0.04]" : "border-line/10")}>
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">{PERIOD_LABEL[p]}</div>
                  <ol className="space-y-2">
                    {items.map((it) => {
                      const m = Number(it.time.slice(0, 2)) * 60 + Number(it.time.slice(3));
                      const done = m <= nowMin;
                      return (
                        <li key={it.id ?? it.time + it.title} className={clsx("flex items-center gap-3 text-sm", done && "opacity-50")}>
                          <span className="num w-11 text-xs text-muted">{it.time}</span>
                          <span className={clsx("h-1.5 w-1.5 rounded-full", it.priority === "high" ? "bg-safe" : it.priority === "medium" ? "bg-info" : "bg-muted")} />
                          <span className={clsx(done && "line-through decoration-line/30")}>{it.title}</span>
                        </li>
                      );
                    })}
                    {!items.length && <li className="text-xs text-muted">Nothing planned</li>}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
