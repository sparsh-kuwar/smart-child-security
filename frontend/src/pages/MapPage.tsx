import clsx from "clsx";
import { Crosshair, ExternalLink, MapPin, Navigation, Satellite } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import LiveMap from "../components/LiveMap";
import { Card, PageHeader, Pill, Segmented, Skeleton } from "../components/ui";
import { clock, timeAgo } from "../lib/format";
import { useApi, useLive } from "../lib/live";
import type { Alert, Reading } from "../lib/types";

export default function MapPage() {
  const { live, childId } = useLive();
  const [mins, setMins] = useState(15);
  const [follow, setFollow] = useState(true);
  const { data: readings } = useApi<Reading[]>(childId ? `/api/children/${childId}/readings?minutes=${mins}` : null, 3);
  const { data: locAlerts } = useApi<Alert[]>(childId ? `/api/children/${childId}/alerts?category=location&limit=20` : null, 12);

  const trail = useMemo(() => (readings ?? []).filter((r) => r.lat != null).map((r) => [r.lat!, r.lon!] as [number, number]), [readings]);
  if (!live) return <Skeleton className="h-[75vh]" />;
  const r = live.reading;
  const pos: [number, number] | null = r?.lat != null && r.lon != null ? [r.lat, r.lon] : null;
  const color = r?.sos ? "#fb4d6d" : r && !r.inside ? "#fbbf24" : "#34f5c5";
  const outsidePct = readings?.length ? Math.round((100 * readings.filter((x) => !x.inside).length) / readings.length) : 0;

  return (
    <>
      <PageHeader
        title="Live tracking"
        subtitle="GPS from the Neo-6M module, checked against every safe zone with the Haversine formula."
        action={<Segmented value={mins} onChange={setMins} options={[{ value: 15, label: "15 min" }, { value: 60, label: "1 h" }, { value: 360, label: "6 h" }]} />}
      />
      <div className="grid gap-5 lg:grid-cols-[1fr,340px]">
        <Card className="relative h-[62vh] min-h-[420px] !p-0">
          <LiveMap
            zones={live.zones}
            pos={pos}
            trail={trail}
            name={live.child.name}
            color={color}
            follow={follow}
            alertsPins={(locAlerts ?? []).filter((a) => a.lat != null).map((a) => ({ lat: a.lat!, lon: a.lon!, level: a.level, title: a.title }))}
            className="absolute inset-0 h-full w-full rounded-3xl"
          />
          <button
            onClick={() => setFollow((f) => !f)}
            className={clsx("glass absolute right-3 top-3 z-[500] flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold", follow ? "text-safe" : "text-muted")}
          >
            <Crosshair size={14} /> {follow ? "Following" : "Follow"}
          </button>
        </Card>

        <div className="space-y-5">
          <Card title="Position" icon={<Navigation size={16} />}>
            {r ? (
              <div className="space-y-3 text-sm">
                <Row k="Status">
                  <Pill color={color} pulse>
                    {r.inside ? `Inside ${r.zone}` : "Outside safe zones"}
                  </Pill>
                </Row>
                {!r.inside && live.zone?.distance_m != null && (
                  <Row k="Distance">
                    <span className="num">{Math.round(live.zone.distance_m)} m from {live.zone.nearest}</span>
                  </Row>
                )}
                <Row k="Coordinates">
                  <span className="num text-xs">{pos ? `${pos[0].toFixed(5)}, ${pos[1].toFixed(5)}` : "—"}</span>
                </Row>
                <Row k="GPS">
                  <span className={clsx("flex items-center gap-1", r.fix ? "text-safe" : "text-warn")}>
                    <Satellite size={13} /> {r.fix ? "3D fix" : "No fix, holding last position"}
                  </span>
                </Row>
                <Row k="Updated">
                  <span className="num">{timeAgo(r.ts)}</span>
                </Row>
                <Row k={`Outside (${mins} min)`}>
                  <span className="num">{outsidePct}%</span>
                </Row>
                {pos && (
                  <a href={`https://maps.google.com/?q=${pos[0]},${pos[1]}`} target="_blank" rel="noreferrer" className="btn-ghost mt-2 w-full">
                    <ExternalLink size={14} /> Open in Google Maps
                  </a>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted">Waiting for the first GPS reading…</div>
            )}
          </Card>

          <Card title="Safe zones" icon={<MapPin size={16} />} action={<Link to="/zones" className="text-xs font-semibold text-muted hover:text-fg">Edit →</Link>}>
            <div className="space-y-2">
              {live.zones.map((z) => (
                <div key={z.id} className={clsx("flex items-center justify-between rounded-xl px-3 py-2", r?.zone === z.name ? "bg-safe/10" : "bg-line/[0.03]")}>
                  <div>
                    <div className="text-sm font-medium">{z.name}</div>
                    <div className="text-[11px] capitalize text-muted">
                      {z.kind} · {z.kind === "route" ? `±${z.radius_m} m corridor` : `${z.radius_m} m radius`}
                    </div>
                  </div>
                  {r?.zone === z.name && <span className="text-[11px] font-bold text-safe">HERE</span>}
                </div>
              ))}
            </div>
          </Card>

          {!!locAlerts?.length && (
            <Card title="Recent location events">
              <ul className="space-y-2 text-sm">
                {locAlerts.slice(0, 5).map((a) => (
                  <li key={a.id} className="flex justify-between gap-2">
                    <span className="truncate">{a.title}</span>
                    <span className="num shrink-0 text-xs text-muted">{clock(a.ts)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{k}</span>
      {children}
    </div>
  );
}
