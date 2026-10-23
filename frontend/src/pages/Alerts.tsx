import { BellOff, CheckCheck } from "lucide-react";
import { useState } from "react";
import AlertItem from "../components/AlertItem";
import { Card, PageHeader, Segmented, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import { dayLabel } from "../lib/format";
import { useApi, useLive } from "../lib/live";
import type { Alert } from "../lib/types";

const CATS = ["all", "sos", "location", "sound", "gps", "attendance", "device", "trust", "system"];

export default function Alerts() {
  const { childId, reload: reloadLive } = useLive();
  const [level, setLevel] = useState<"" | "critical" | "warning" | "info">("");
  const [cat, setCat] = useState("all");
  const [unacked, setUnacked] = useState(false);
  const qs = new URLSearchParams({ limit: "200", ...(level && { level }), ...(cat !== "all" && { category: cat }), ...(unacked && { unacked: "true" }) });
  const { data, setData } = useApi<Alert[]>(childId ? `/api/children/${childId}/alerts?${qs}` : null, 2);
  const [permission, setPermission] = useState(typeof Notification !== "undefined" ? Notification.permission : "denied");

  const ack = async (a: Alert) => {
    await api(`/api/children/${childId}/alerts/${a.id}/ack`, { method: "POST" });
    setData((d) => d?.map((x) => (x.id === a.id ? { ...x, acknowledged: true } : x)) ?? null);
    reloadLive();
  };
  const ackAll = async () => {
    await api(`/api/children/${childId}/alerts/ack-all`, { method: "POST" });
    setData((d) => d?.map((x) => ({ ...x, acknowledged: true })) ?? null);
    reloadLive();
  };

  const groups: [string, Alert[]][] = [];
  (data ?? []).forEach((a) => {
    const k = new Date(a.ts).toLocaleDateString("en-CA");
    const g = groups.find((x) => x[0] === k);
    if (g) g[1].push(a);
    else groups.push([k, [a]]);
  });

  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle="The Alert Analyzer marks each event as Critical, Warning or Info. Critical alerts also sound the device buzzer and send an SMS if one is set up."
        action={
          <div className="flex flex-wrap gap-2">
            {permission === "default" && (
              <button className="btn-ghost" onClick={async () => setPermission(await Notification.requestPermission())}>
                Enable browser notifications
              </button>
            )}
            <button className="btn-ghost" onClick={ackAll}>
              <CheckCheck size={15} /> Mark all read
            </button>
          </div>
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented
          value={level}
          onChange={setLevel}
          options={[
            { value: "", label: "All" },
            { value: "critical", label: "Critical" },
            { value: "warning", label: "Warning" },
            { value: "info", label: "Info" },
          ]}
        />
        <select className="input !w-auto !py-2" value={cat} onChange={(e) => setCat(e.target.value)}>
          {CATS.map((c) => (
            <option key={c} value={c}>
              {c === "all" ? "All categories" : c}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={unacked} onChange={(e) => setUnacked(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--safe))]" />
          Unread only
        </label>
      </div>
      {!data ? (
        <Skeleton className="h-[60vh]" />
      ) : groups.length ? (
        <div className="space-y-6">
          {groups.map(([day, list]) => (
            <Card key={day} title={dayLabel(day)} action={<span className="text-xs text-muted">{list.length} alerts</span>}>
              <div className="grid gap-2 xl:grid-cols-2">
                {list.map((a) => (
                  <AlertItem key={a.id} a={a} onAck={ack} />
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <div className="flex flex-col items-center gap-2 py-12 text-muted">
            <BellOff size={28} />
            No alerts match these filters.
          </div>
        </Card>
      )}
    </>
  );
}
