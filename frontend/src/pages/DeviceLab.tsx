import clsx from "clsx";
import { motion } from "framer-motion";
import {
  AudioLines,
  Ban,
  Copy,
  CopyCheck,
  Cpu,
  CreditCard,
  Footprints,
  KeyRound,
  Power,
  RefreshCw,
  Satellite,
  Siren,
  Smartphone,
  Sparkles,
  Volume2,
  WifiOff,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { Card, PageHeader, Pill, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import { timeAgo } from "../lib/format";
import { useApi, useLive } from "../lib/live";

interface Scenario {
  name: string;
  label: string;
  seconds: number;
  desc: string;
}
interface SimResp {
  enabled: boolean;
  active: string | null;
  remaining: number;
  overuse: boolean;
  phase: string;
  cycle_seconds: number;
  cycle_position: number;
  scenarios: Scenario[];
}

const ICONS: Record<string, typeof Zap> = {
  wander: Footprints,
  very_loud: Volume2,
  critical: Zap,
  transient: AudioLines,
  gps_loss: Satellite,
  unregistered_tag: Ban,
  duplicate_scan: CreditCard,
  sos: Siren,
  network_loss: WifiOff,
  restart: Power,
  overuse: Smartphone,
  reset: RefreshCw,
};
const TONE: Record<string, string> = { critical: "crit", sos: "crit", very_loud: "warn", wander: "warn", gps_loss: "info", network_loss: "info", restart: "info" };

const PHASES = [
  { at: 0, to: 50, label: "Home" },
  { at: 50, to: 110, label: "Bus" },
  { at: 110, to: 180, label: "Class" },
  { at: 180, to: 215, label: "Recess" },
  { at: 215, to: 260, label: "Class" },
  { at: 260, to: 320, label: "Bus" },
  { at: 320, to: 360, label: "Home" },
];

export default function DeviceLab() {
  const { childId, live, reload } = useLive();
  const { data, reload: reloadSim, setData } = useApi<SimResp>(childId ? `/api/children/${childId}/simulator` : null, 1);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (!data || !live) return <Skeleton className="h-[75vh]" />;
  const origin = window.location.origin;
  const key = live.child.device_key;

  const run = async (name: string) => {
    setBusy(name);
    try {
      const s = await api(`/api/children/${childId}/simulator/scenario`, { body: { name } });
      setData({ ...data, ...s, enabled: true });
      reload();
    } finally {
      setBusy(null);
    }
  };
  const toggle = async () => {
    await api(`/api/children/${childId}/simulator`, { body: { enabled: !data.enabled } });
    reloadSim();
    reload();
  };
  const copy = (text: string, id: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };
  const rotate = async () => {
    if (!confirm("Generate a new device key? The old key stops working immediately.")) return;
    await api(`/api/children/${childId}/rotate-key`, { method: "POST" });
    reload();
  };

  const curl = `curl -X POST ${origin}/api/device/ingest \\
  -H "X-Device-Key: ${key}" -H "Content-Type: application/json" \\
  -d '{"lat":18.5204,"lon":73.8567,"gps_fix":true,"steps":12,"movement":0.2,"sound_db":54,"battery":88}'`;

  return (
    <>
      <PageHeader
        title="Device lab"
        subtitle="Run the end-to-end scenarios from report §6.3–6.4 on the virtual device, or connect the real Arduino + ESP8266 below."
        action={
          <button onClick={toggle} className={data.enabled ? "btn-ghost" : "btn-primary"}>
            <Cpu size={15} /> {data.enabled ? "Stop simulator" : "Start simulator"}
          </button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-12">
        <Card className="lg:col-span-12" title="Simulated school day" icon={<Sparkles size={16} />} action={data.enabled ? <Pill color="rgb(var(--violet))" pulse>{data.phase}</Pill> : <Pill>Stopped</Pill>}>
          <div className="relative">
            <div className="flex h-10 overflow-hidden rounded-xl">
              {PHASES.map((p, i) => (
                <div
                  key={i}
                  className={clsx("flex items-center justify-center border-r border-ink/40 text-[11px] font-semibold", p.label === "Home" ? "bg-safe/15 text-safe" : p.label === "Bus" ? "bg-violet/15 text-violet" : p.label === "Recess" ? "bg-warn/15 text-warn" : "bg-info/15 text-info")}
                  style={{ width: `${((p.to - p.at) / 360) * 100}%` }}
                >
                  <span className="hidden sm:inline">{p.label}</span>
                </div>
              ))}
            </div>
            {data.enabled && (
              <motion.div
                className="absolute -bottom-1 -top-1 w-1 rounded-full bg-fg shadow-[0_0_12px_rgb(var(--fg))]"
                animate={{ left: `${(data.cycle_position / data.cycle_seconds) * 100}%` }}
                transition={{ duration: 1, ease: "linear" }}
              />
            )}
          </div>
          <p className="mt-3 text-xs text-muted">
            The virtual device plays a 6-minute school day on a loop: home, then the bus (inside the route corridor), an RFID entry at the gate, class and recess with louder sound, an RFID exit, and home again. Readings arrive every 5 s and go through the same pipeline as real hardware.
          </p>
        </Card>

        <Card className="lg:col-span-8" title="Inject a scenario" action={data.active ? <Pill color="rgb(var(--warn))" pulse>{data.active} · {data.remaining}s</Pill> : data.overuse ? <Pill color="rgb(var(--warn))">Overuse on</Pill> : null}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.scenarios.map((s) => {
              const Icon = ICONS[s.name] ?? Zap;
              const tone = TONE[s.name] ?? "safe";
              const active = data.active === s.name || (s.name === "overuse" && data.overuse);
              return (
                <button
                  key={s.name}
                  onClick={() => run(s.name)}
                  disabled={!!busy}
                  className={clsx(
                    "group relative overflow-hidden rounded-2xl border p-4 text-left transition hover:-translate-y-0.5",
                    active ? "border-warn/60 bg-warn/[0.06]" : "border-line/10 bg-line/[0.02] hover:border-line/20",
                  )}
                >
                  {active && data.active === s.name && s.seconds > 0 && (
                    <motion.div className="absolute inset-x-0 bottom-0 h-0.5 bg-warn" initial={{ width: "100%" }} animate={{ width: `${(data.remaining / s.seconds) * 100}%` }} transition={{ duration: 1, ease: "linear" }} />
                  )}
                  <div className="flex items-center gap-2.5">
                    <span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-${tone}/10 text-${tone}`}>
                      <Icon size={17} />
                    </span>
                    <span className="font-semibold">{s.label}</span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted">{s.desc}</p>
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="lg:col-span-4" title="Device status" icon={<Cpu size={16} />}>
          <dl className="space-y-3 text-sm">
            {[
              ["Data source", live.child.simulator_enabled ? "Simulator" : "Hardware"],
              ["Connection", live.child.online ? "Online" : "Offline"],
              ["Last seen", timeAgo(live.child.last_seen)],
              ["Last boot", live.child.last_boot ? timeAgo(live.child.last_boot) : "—"],
              ["Battery", live.child.battery != null ? `${Math.round(live.child.battery)}%` : "—"],
              ["Firmware", live.child.firmware || "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <dt className="text-muted">{k}</dt>
                <dd className={clsx("font-medium", v === "Online" && "text-safe", v === "Offline" && "text-crit")}>{v}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card className="lg:col-span-12" title="Connect real hardware" icon={<KeyRound size={16} />}>
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-4">
              <div>
                <label className="label">Device key</label>
                <div className="flex gap-2">
                  <code className="num flex-1 truncate rounded-xl bg-line/5 px-3 py-2.5 text-xs">{key}</code>
                  <button className="btn-ghost !px-3" onClick={() => copy(key, "key")} aria-label="Copy key">
                    {copied === "key" ? <CopyCheck size={15} className="text-safe" /> : <Copy size={15} />}
                  </button>
                  <button className="btn-ghost !px-3" onClick={rotate} aria-label="Rotate key" title="Rotate key">
                    <RefreshCw size={15} />
                  </button>
                </div>
              </div>
              <div>
                <label className="label">Ingest endpoint</label>
                <code className="num block rounded-xl bg-line/5 px-3 py-2.5 text-xs">POST {origin}/api/device/ingest</code>
              </div>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted">
                <li>
                  Flash <code className="text-fg">hardware/arduino_uno/arduino_uno.ino</code> to the Uno (RC522 on SPI, Neo-6M on D4/D3, sound sensor on A0, buzzer on D6, LEDs on D7/D8/A1).
                </li>
                <li>
                  Put your Wi-Fi details, this server URL and the device key in <code className="text-fg">hardware/esp8266_bridge/config.h</code>, then flash the ESP8266.
                </li>
                <li>When the first reading arrives the simulator switches off automatically, and this page shows "Hardware".</li>
                <li>Critical alerts come back in the response as <code className="text-fg">{"{actuate:{buzzer,led}}"}</code>, which drives the buzzer and LEDs.</li>
              </ol>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="label !mb-0">Test from a terminal</label>
                <button className="text-xs text-muted hover:text-fg" onClick={() => copy(curl, "curl")}>
                  {copied === "curl" ? "Copied!" : "Copy"}
                </button>
              </div>
              <pre className="num overflow-x-auto rounded-2xl bg-[#05070d] p-4 text-[11px] leading-relaxed text-[#cfe9e1]">{curl}</pre>
              <p className="mt-2 text-xs text-muted">
                Batch upload after an outage: <code>{'{"readings":[{...,"age_s":40},{...,"age_s":35}]}'}</code>. API docs:{" "}
                <a className="text-info hover:underline" href="/api/docs" target="_blank" rel="noreferrer">
                  /api/docs
                </a>
              </p>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
