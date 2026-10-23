import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef } from "react";
import { Circle, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import type { Zone } from "../lib/types";

const ZONE_COLORS: Record<string, string> = { home: "#34f5c5", school: "#60a5fa", route: "#9787ff", other: "#fbbf24" };

function childIcon(color: string, initial: string) {
  return L.divIcon({
    className: "",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div class="child-marker" style="width:34px;height:34px">
      <div class="pulse" style="background:${color}"></div>
      <div class="dot" style="background:${color};display:flex;align-items:center;justify-content:center;font:700 13px 'Space Grotesk',sans-serif;color:#070b14">${initial}</div>
    </div>`,
  });
}

/** Builds a corridor polygon (segment buffered by radius) for route zones. */
function corridor(z: Zone): [number, number][] {
  const kx = Math.cos((z.lat * Math.PI) / 180) * 111320;
  const ky = 111320;
  const dx = (z.lon2! - z.lon) * kx;
  const dy = (z.lat2! - z.lat) * ky;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const pts: [number, number][] = [];
  const cap = (cxLat: number, cxLon: number, startAngle: number) => {
    for (let i = 0; i <= 12; i++) {
      const a = startAngle + (Math.PI * i) / 12;
      const ox = Math.cos(a) * z.radius_m;
      const oy = Math.sin(a) * z.radius_m;
      pts.push([cxLat + oy / ky, cxLon + ox / kx]);
    }
  };
  const base = Math.atan2(uy, ux);
  cap(z.lat2!, z.lon2!, base - Math.PI / 2);
  cap(z.lat, z.lon, base + Math.PI / 2);
  return pts;
}

function Follow({ pos, follow }: { pos: [number, number] | null; follow: boolean }) {
  const map = useMap();
  const first = useRef(true);
  useEffect(() => {
    if (!pos) return;
    if (first.current) {
      map.setView(pos, 15, { animate: false });
      first.current = false;
    } else if (follow) {
      map.panTo(pos, { animate: true, duration: 0.8 });
    }
  }, [pos?.[0], pos?.[1], follow]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function Clicks({ onClick }: { onClick?: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onClick?.(e.latlng.lat, e.latlng.lng) });
  return null;
}

function Resize() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

export default function LiveMap({
  zones,
  pos,
  trail = [],
  name = "?",
  color = "#34f5c5",
  follow = true,
  onMapClick,
  draft,
  selectedZone,
  onZoneClick,
  alertsPins = [],
  className = "h-full w-full",
  interactive = true,
}: {
  zones: Zone[];
  pos: [number, number] | null;
  trail?: [number, number][];
  name?: string;
  color?: string;
  follow?: boolean;
  onMapClick?: (lat: number, lon: number) => void;
  draft?: Partial<Zone> | null;
  selectedZone?: number | null;
  onZoneClick?: (z: Zone) => void;
  alertsPins?: { lat: number; lon: number; level: string; title: string }[];
  className?: string;
  interactive?: boolean;
}) {
  const icon = useMemo(() => childIcon(color, name.slice(0, 1).toUpperCase()), [color, name]);
  const center: [number, number] = pos ?? (zones[0] ? [zones[0].lat, zones[0].lon] : [18.5204, 73.8567]);

  return (
    <MapContainer
      center={center}
      zoom={15}
      className={className}
      zoomControl={interactive}
      scrollWheelZoom={interactive}
      dragging={interactive}
      attributionControl
    >
      {/* OpenStreetMap tiles; dark mode recolours them with a CSS filter (see index.css) */}
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      <Resize />
      <Follow pos={pos} follow={follow} />
      <Clicks onClick={onMapClick} />
      {zones
        .filter((z) => z.active)
        .map((z) => {
          const c = ZONE_COLORS[z.kind] ?? ZONE_COLORS.other;
          const sel = selectedZone === z.id;
          const style = { color: c, weight: sel ? 3 : 1.5, fillOpacity: sel ? 0.22 : 0.1, dashArray: z.kind === "route" ? "6 6" : undefined };
          const handlers = onZoneClick ? { click: () => onZoneClick(z) } : undefined;
          return z.kind === "route" && z.lat2 != null && z.lon2 != null ? (
            <Polygon key={z.id} positions={corridor(z)} pathOptions={style} eventHandlers={handlers}>
              <Tooltip sticky>{z.name}</Tooltip>
            </Polygon>
          ) : (
            <Circle key={z.id} center={[z.lat, z.lon]} radius={z.radius_m} pathOptions={style} eventHandlers={handlers}>
              <Tooltip direction="top" permanent={interactive} className="!bg-transparent !border-0 !shadow-none !text-[11px] !font-semibold" opacity={0.9}>
                <span style={{ color: c }}>{z.name}</span>
              </Tooltip>
            </Circle>
          );
        })}
      {draft?.lat != null && draft.lon != null && (
        draft.kind === "route" && draft.lat2 != null && draft.lon2 != null ? (
          <Polygon positions={corridor(draft as Zone)} pathOptions={{ color: "#fff", dashArray: "4 4", weight: 2, fillOpacity: 0.1 }} />
        ) : (
          <Circle center={[draft.lat, draft.lon]} radius={draft.radius_m ?? 200} pathOptions={{ color: "#fff", dashArray: "4 4", weight: 2, fillOpacity: 0.1 }} />
        )
      )}
      {trail.length > 1 && <Polyline positions={trail} pathOptions={{ color, weight: 3, opacity: 0.55, dashArray: "2 8", lineCap: "round" }} />}
      {alertsPins.map((p, i) => (
        <Circle
          key={i}
          center={[p.lat, p.lon]}
          radius={25}
          pathOptions={{ color: p.level === "critical" ? "#fb4d6d" : "#fbbf24", fillOpacity: 0.6, weight: 1 }}
        >
          <Tooltip>{p.title}</Tooltip>
        </Circle>
      ))}
      {pos && <Marker position={pos} icon={icon} zIndexOffset={1000} />}
    </MapContainer>
  );
}
