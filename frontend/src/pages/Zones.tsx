import clsx from "clsx";
import { Home, Loader2, MapPinPlus, Plus, Route, School, Star, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import LiveMap from "../components/LiveMap";
import { Card, PageHeader, Segmented, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import { useLive } from "../lib/live";
import type { Zone } from "../lib/types";

const KIND_ICON = { home: Home, school: School, route: Route, other: Star };
type Draft = Omit<Zone, "id"> & { id?: number };

export default function Zones() {
  const { live, childId, reload } = useLive();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [routeStep, setRouteStep] = useState<0 | 1>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setError(null), [draft?.id]);
  if (!live) return <Skeleton className="h-[75vh]" />;
  const r = live.reading;

  const startNew = () => {
    const c = r?.lat != null ? { lat: r.lat, lon: r.lon! } : { lat: live.zones[0]?.lat ?? 18.52, lon: live.zones[0]?.lon ?? 73.85 };
    setDraft({ name: "New zone", kind: "other", lat: c.lat, lon: c.lon, lat2: null, lon2: null, radius_m: 150, active: true });
    setRouteStep(0);
  };

  const onMapClick = (lat: number, lon: number) => {
    if (!draft) return;
    if (draft.kind === "route") {
      if (routeStep === 0) {
        setDraft({ ...draft, lat, lon, lat2: null, lon2: null });
        setRouteStep(1);
      } else {
        setDraft({ ...draft, lat2: lat, lon2: lon });
        setRouteStep(0);
      }
    } else {
      setDraft({ ...draft, lat, lon });
    }
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const body = { ...draft, lat2: draft.kind === "route" ? draft.lat2 : null, lon2: draft.kind === "route" ? draft.lon2 : null };
      if (draft.kind === "route" && (body.lat2 == null || body.lon2 == null)) throw new Error("Click the start and end of the route on the map");
      if (draft.id) await api(`/api/children/${childId}/zones/${draft.id}`, { method: "PUT", body });
      else await api(`/api/children/${childId}/zones`, { body });
      setDraft(null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft?.id || !confirm(`Delete zone "${draft.name}"?`)) return;
    setBusy(true);
    try {
      await api(`/api/children/${childId}/zones/${draft.id}`, { method: "DELETE" });
      setDraft(null);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const shownZones = draft?.id ? live.zones.filter((z) => z.id !== draft.id) : live.zones;

  return (
    <>
      <PageHeader
        title="Safe zones"
        subtitle="Create, move and resize geofences from here. No firmware changes needed (report §8.2, future work 3)."
        action={
          <button className="btn-primary" onClick={startNew}>
            <Plus size={16} /> New zone
          </button>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[1fr,360px]">
        <Card className="relative h-[64vh] min-h-[420px] !p-0">
          <LiveMap
            zones={shownZones}
            pos={r?.lat != null && r.lon != null ? [r.lat, r.lon] : null}
            name={live.child.name}
            follow={false}
            onMapClick={onMapClick}
            draft={draft}
            selectedZone={draft?.id}
            onZoneClick={(z) => {
              setDraft({ ...z });
              setRouteStep(0);
            }}
            className="absolute inset-0 h-full w-full rounded-3xl"
          />
          {draft && (
            <div className="glass absolute left-1/2 top-3 z-[500] -translate-x-1/2 rounded-xl px-3 py-2 text-xs font-semibold">
              <MapPinPlus size={13} className="mr-1 inline" />
              {draft.kind === "route" ? (routeStep === 0 ? "Click the route start" : "Click the route end") : "Click the map to place the centre"}
            </div>
          )}
        </Card>

        <div className="space-y-5">
          {draft ? (
            <Card title={draft.id ? "Edit zone" : "New zone"}>
              <div className="space-y-4">
                <div>
                  <label className="label">Name</label>
                  <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </div>
                <div>
                  <label className="label">Type</label>
                  <Segmented
                    value={draft.kind}
                    onChange={(k) => {
                      setDraft({ ...draft, kind: k, radius_m: k === "route" ? 150 : draft.radius_m });
                      setRouteStep(0);
                    }}
                    options={[
                      { value: "home", label: "Home" },
                      { value: "school", label: "School" },
                      { value: "route", label: "Route" },
                      { value: "other", label: "Other" },
                    ]}
                  />
                </div>
                <div>
                  <label className="label">
                    {draft.kind === "route" ? "Corridor half-width" : "Radius"} · <span className="num text-fg">{draft.radius_m} m</span>
                  </label>
                  <input
                    type="range"
                    min={30}
                    max={1500}
                    step={10}
                    value={draft.radius_m}
                    onChange={(e) => setDraft({ ...draft, radius_m: Number(e.target.value) })}
                    className="w-full accent-[rgb(var(--safe))]"
                  />
                </div>
                <div className="num rounded-xl bg-line/[0.03] p-3 text-xs text-muted">
                  {draft.lat.toFixed(5)}, {draft.lon.toFixed(5)}
                  {draft.kind === "route" && draft.lat2 != null && ` → ${draft.lat2.toFixed(5)}, ${draft.lon2!.toFixed(5)}`}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} className="h-4 w-4 accent-[rgb(var(--safe))]" />
                  Zone active
                </label>
                {error && <div className="rounded-xl bg-crit/10 px-3 py-2 text-sm text-crit">{error}</div>}
                <div className="flex gap-2">
                  <button className="btn-primary flex-1" onClick={save} disabled={busy}>
                    {busy && <Loader2 size={15} className="animate-spin" />} Save
                  </button>
                  <button className="btn-ghost" onClick={() => setDraft(null)}>
                    Cancel
                  </button>
                  {draft.id && (
                    <button className="btn-ghost text-crit" onClick={remove} aria-label="Delete zone">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            </Card>
          ) : (
            <Card title="Zones" action={<span className="text-xs text-muted">Click a zone to edit it</span>}>
              <div className="space-y-2">
                {live.zones.map((z) => {
                  const Icon = KIND_ICON[z.kind] ?? Star;
                  return (
                    <button
                      key={z.id}
                      onClick={() => setDraft({ ...z })}
                      className={clsx("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-line/5", !z.active && "opacity-50")}
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-line/5">
                        <Icon size={16} />
                      </span>
                      <span className="flex-1">
                        <span className="block text-sm font-medium">{z.name}</span>
                        <span className="block text-[11px] text-muted">
                          {z.kind === "route" ? `Corridor ±${z.radius_m} m` : `${z.radius_m} m radius`}
                          {!z.active && " · inactive"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </Card>
          )}
          <Card title="How scoring works">
            <ul className="space-y-2 text-sm text-muted">
              <li>
                Inside any active zone: <b className="text-safe">Sl = 1.0</b>
              </li>
              <li>
                Outside every zone: <b className="text-warn">Sl = 0.3</b>. A warning is sent after {live.child.settings.outside_grace_seconds}s, and it becomes critical after 10 min.
              </li>
              <li>
                GPS lost for longer than {live.child.settings.gps_stale_seconds}s: <b className="text-info">Sl ≤ 0.6</b>
              </li>
              <li>A route corridor covers the school-bus path, so a normal commute doesn't raise an alert.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
