import clsx from "clsx";
import { CreditCard, LogIn, LogOut, Plus, ShieldX, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Card, PageHeader, Pill, Skeleton, Stat } from "../components/ui";
import { api } from "../lib/api";
import { clock, dayLabel } from "../lib/format";
import { useApi, useLive } from "../lib/live";

interface Scan {
  id: number;
  ts: string;
  uid: string;
  status: "accepted" | "rejected" | "duplicate";
  direction: "in" | "out" | null;
  zone: string | null;
}
interface Tag {
  id: number;
  uid: string;
  label: string;
  active: boolean;
}

const STATUS_COLOR = { accepted: "rgb(var(--safe))", rejected: "rgb(var(--crit))", duplicate: "rgb(var(--muted))" };

export default function Attendance() {
  const { childId, live } = useLive();
  const { data: scans } = useApi<Scan[]>(childId ? `/api/children/${childId}/attendance?days=14` : null, 4);
  const { data: tags, reload: reloadTags } = useApi<Tag[]>(childId ? `/api/children/${childId}/tags` : null);
  const [uid, setUid] = useState("");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const stats = useMemo(() => {
    const s = scans ?? [];
    const firstIn: Record<string, Date> = {};
    s.filter((x) => x.status === "accepted" && x.direction === "in").forEach((x) => {
      const d = new Date(x.ts);
      const k = d.toDateString();
      if (!firstIn[k] || d < firstIn[k]) firstIn[k] = d;
    });
    const start = (live?.child.settings.school_start ?? "08:30").split(":").map(Number);
    const days = Object.values(firstIn);
    const onTime = days.filter((d) => d.getHours() * 60 + d.getMinutes() <= start[0] * 60 + start[1] + 5).length;
    const avgMin = days.length ? days.reduce((a, d) => a + d.getHours() * 60 + d.getMinutes(), 0) / days.length : 0;
    return {
      days: days.length,
      onTimePct: days.length ? Math.round((100 * onTime) / days.length) : 0,
      avg: days.length ? `${String(Math.floor(avgMin / 60)).padStart(2, "0")}:${String(Math.round(avgMin % 60)).padStart(2, "0")}` : "—",
      rejected: s.filter((x) => x.status === "rejected").length,
      dupes: s.filter((x) => x.status === "duplicate").length,
    };
  }, [scans, live?.child.settings.school_start]);

  const grouped = useMemo(() => {
    const g: Record<string, Scan[]> = {};
    (scans ?? []).forEach((s) => {
      const k = new Date(s.ts).toLocaleDateString("en-CA"); // local YYYY-MM-DD
      (g[k] ??= []).push(s);
    });
    return Object.entries(g);
  }, [scans]);

  const addTag = async () => {
    setErr(null);
    try {
      await api(`/api/children/${childId}/tags`, { body: { uid: uid.trim() || null, label: label.trim() || "ID card" } });
      setUid("");
      setLabel("");
      reloadTags();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (!scans || !live) return <Skeleton className="h-[75vh]" />;

  return (
    <>
      <PageHeader title="RFID attendance" subtitle={`RC522 reader at the school gate. Unregistered cards are rejected, and repeat scans within ${live.child.settings.rfid_debounce_seconds}s are ignored.`} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { l: "School days", v: stats.days },
          { l: "On time", v: `${stats.onTimePct}%`, c: stats.onTimePct >= 80 ? "rgb(var(--safe))" : "rgb(var(--warn))" },
          { l: "Avg. arrival", v: stats.avg },
          { l: "Rejected cards", v: stats.rejected, c: stats.rejected ? "rgb(var(--crit))" : undefined },
          { l: "Duplicates ignored", v: stats.dupes },
        ].map((s) => (
          <div key={s.l} className="glass rounded-2xl p-4">
            <Stat label={s.l} value={s.v} color={s.c} />
          </div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr,380px]">
        <Card title="Scan log · 14 days" icon={<CreditCard size={16} />}>
          <div className="max-h-[62vh] space-y-5 overflow-y-auto pr-1">
            {grouped.map(([day, rows]) => (
              <div key={day}>
                <div className="sticky top-0 z-10 mb-2 bg-[rgb(var(--surface)/0.01)] text-xs font-semibold uppercase tracking-wider text-muted backdrop-blur">{dayLabel(day)}</div>
                <div className="space-y-1.5">
                  {rows.map((s) => (
                    <div key={s.id} className={clsx("flex items-center gap-3 rounded-xl px-3 py-2", s.status === "duplicate" ? "opacity-50" : "bg-line/[0.03]")}>
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ color: STATUS_COLOR[s.status], background: `color-mix(in srgb, ${STATUS_COLOR[s.status]} 14%, transparent)` }}>
                        {s.status === "rejected" ? <ShieldX size={15} /> : s.direction === "out" ? <LogOut size={15} /> : <LogIn size={15} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">
                          {s.status === "rejected" ? "Unknown card rejected" : s.status === "duplicate" ? "Duplicate scan (debounced)" : s.direction === "in" ? "Entry" : "Exit"}
                          {s.zone && <span className="text-muted"> · {s.zone}</span>}
                        </div>
                        <div className="num text-[11px] text-muted">{s.uid}</div>
                      </div>
                      <span className="num text-sm">{clock(s.ts)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {!grouped.length && <div className="py-10 text-center text-sm text-muted">No scans recorded yet.</div>}
          </div>
        </Card>

        <div className="space-y-5">
          <Card title="Registered cards">
            <div className="space-y-2">
              {(tags ?? []).map((t) => (
                <div key={t.id} className="flex items-center gap-3 rounded-xl bg-line/[0.03] px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{t.label}</div>
                    <div className="num text-xs text-muted">{t.uid}</div>
                  </div>
                  <button
                    onClick={async () => {
                      await api(`/api/children/${childId}/tags/${t.id}`, { method: "PATCH", body: { active: !t.active } });
                      reloadTags();
                    }}
                  >
                    <Pill color={t.active ? "rgb(var(--safe))" : "rgb(var(--muted))"}>{t.active ? "Active" : "Disabled"}</Pill>
                  </button>
                  <button
                    className="rounded-lg p-1.5 text-muted hover:bg-crit/10 hover:text-crit"
                    aria-label="Remove card"
                    onClick={async () => {
                      if (!confirm(`Remove card ${t.uid}?`)) return;
                      await api(`/api/children/${childId}/tags/${t.id}`, { method: "DELETE" });
                      reloadTags();
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2 border-t border-line/10 pt-4">
              <input className="input" placeholder="Card UID, e.g. A3:7F:21:9C (blank = generate)" value={uid} onChange={(e) => setUid(e.target.value)} />
              <input className="input" placeholder="Label (e.g. Spare card)" value={label} onChange={(e) => setLabel(e.target.value)} />
              {err && <div className="text-sm text-crit">{err}</div>}
              <button className="btn-ghost w-full" onClick={addTag}>
                <Plus size={15} /> Register card
              </button>
            </div>
          </Card>
          <Card title="Privacy">
            <p className="text-sm text-muted">
              The card only holds a UID. The student's name and details stay on the server and are never written to the tag. Each scan records the UID, time and the reader's location.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
