import { Bell, Check, CloudUpload, Loader2, Plus, SlidersHorizontal, Trash2, User, UserPlus } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Card, PageHeader, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLive } from "../lib/live";
import type { Settings as S } from "../lib/types";

const THRESHOLDS: { k: keyof S; label: string; unit: string; hint: string }[] = [
  { k: "screen_limit_minutes", label: "Daily screen limit", unit: "min", hint: "Report default 360" },
  { k: "night_limit_minutes", label: "Night-time limit", unit: "min", hint: "Use after 22:00 · default 60" },
  { k: "unlock_limit", label: "Unlock limit", unit: "/day", hint: "Default 80" },
  { k: "very_loud_db", label: "Very-loud threshold", unit: "dB", hint: "Default 85" },
  { k: "very_loud_persist_seconds", label: "Persistence rule", unit: "s", hint: "Must stay loud this long · default 60" },
  { k: "sound_window_seconds", label: "Rolling window", unit: "s", hint: "Default 300 (5 min)" },
  { k: "outside_grace_seconds", label: "Outside-zone grace", unit: "s", hint: "Before a warning is raised" },
  { k: "gps_stale_seconds", label: "GPS-loss alert after", unit: "s", hint: "Default 60" },
  { k: "rfid_debounce_seconds", label: "RFID debounce", unit: "s", hint: "Duplicate scans ignored" },
  { k: "offline_after_seconds", label: "Offline after", unit: "s", hint: "No data → device offline alert" },
  { k: "study_target_hours", label: "Study target", unit: "h/day", hint: "Feeds schedule adherence" },
];

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <div className="mt-1 text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

function SaveBtn({ busy, done, onClick }: { busy: boolean; done: boolean; onClick: () => void }) {
  return (
    <button className="btn-primary" onClick={onClick} disabled={busy}>
      {busy ? <Loader2 size={15} className="animate-spin" /> : done ? <Check size={15} /> : null}
      {done ? "Saved" : "Save"}
    </button>
  );
}

function useSaver() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setDone(true);
      setTimeout(() => setDone(false), 1800);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, done, error, run };
}

export default function SettingsPage() {
  const { live, childId, reload, setChildId } = useLive();
  const { user, refresh } = useAuth();
  const [profile, setProfile] = useState({ name: "", age: 10, grade: "", school: "" });
  const [settings, setSettings] = useState<S | null>(null);
  const [account, setAccount] = useState({ name: "", phone: "" });
  const [newChild, setNewChild] = useState("");
  const [tsResult, setTsResult] = useState<string | null>(null);
  const s1 = useSaver();
  const s2 = useSaver();
  const s3 = useSaver();
  const s4 = useSaver();

  useEffect(() => {
    if (!live) return;
    setProfile({ name: live.child.name, age: live.child.age, grade: live.child.grade, school: live.child.school });
    setSettings(live.child.settings);
  }, [live?.child.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (user) setAccount({ name: user.name, phone: user.phone });
  }, [user]);

  if (!live || !settings || !user) return <Skeleton className="h-[75vh]" />;
  const patch = (body: object) => api(`/api/children/${childId}`, { method: "PATCH", body }).then(reload);

  return (
    <>
      <PageHeader title="Settings" subtitle={`Configure ${live.child.name}'s profile, safety thresholds, notifications and cloud publishing.`} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Child profile" icon={<User size={16} />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input className="input" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
            </Field>
            <Field label="Age">
              <input type="number" min={1} max={19} className="input" value={profile.age} onChange={(e) => setProfile({ ...profile, age: Number(e.target.value) })} />
            </Field>
            <Field label="Grade">
              <input className="input" value={profile.grade} onChange={(e) => setProfile({ ...profile, grade: e.target.value })} />
            </Field>
            <Field label="School">
              <input className="input" value={profile.school} onChange={(e) => setProfile({ ...profile, school: e.target.value })} />
            </Field>
            <Field label="School starts" hint="Used by the arrival check">
              <input type="time" className="input" value={settings.school_start} onChange={(e) => setSettings({ ...settings, school_start: e.target.value })} />
            </Field>
            <Field label="Student code" hint="Internal ID, never stored on the RFID card">
              <input className="input opacity-60" value={live.child.student_code} readOnly />
            </Field>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <SaveBtn busy={s1.busy} done={s1.done} onClick={() => s1.run(async () => { await patch({ ...profile, settings: { school_start: settings.school_start } }); await refresh(); })} />
            {s1.error && <span className="text-sm text-crit">{s1.error}</span>}
          </div>
        </Card>

        <Card title="Notifications" icon={<Bell size={16} />}>
          <div className="space-y-4">
            <Field label="SMS number for critical alerts" hint="Sent through Twilio when the server has TWILIO_* configured. Falls back to your account phone.">
              <input className="input" placeholder="+91 98xxxxxxx" value={settings.notify_sms_phone} onChange={(e) => setSettings({ ...settings, notify_sms_phone: e.target.value })} />
            </Field>
            <Field label="Webhook URL" hint="Every alert is POSTed here as JSON. Works with Slack, Discord, Telegram bots, IFTTT and similar.">
              <input className="input" placeholder="https://…" value={settings.notify_webhook_url} onChange={(e) => setSettings({ ...settings, notify_webhook_url: e.target.value })} />
            </Field>
            <button
              className="btn-ghost"
              onClick={async () => {
                if (typeof Notification === "undefined") return alert("This browser does not support notifications");
                const p = await Notification.requestPermission();
                if (p === "granted") new Notification("SafeTrack notifications on", { body: "You'll be notified about alerts while this tab is open." });
              }}
            >
              <Bell size={15} /> Enable browser notifications
            </button>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <SaveBtn busy={s2.busy} done={s2.done} onClick={() => s2.run(() => patch({ settings: { notify_sms_phone: settings.notify_sms_phone, notify_webhook_url: settings.notify_webhook_url } }))} />
            {s2.error && <span className="text-sm text-crit">{s2.error}</span>}
          </div>
        </Card>

        <Card className="lg:col-span-2" title="Safety thresholds" icon={<SlidersHorizontal size={16} />}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {THRESHOLDS.map((t) => (
              <Field key={t.k} label={`${t.label} (${t.unit})`} hint={t.hint}>
                <input
                  type="number"
                  step={t.k === "study_target_hours" ? 0.5 : 1}
                  min={0}
                  className="input num"
                  value={settings[t.k] as number}
                  onChange={(e) => setSettings({ ...settings, [t.k]: Number(e.target.value) })}
                />
              </Field>
            ))}
          </div>
          <div className="mt-5 flex items-center gap-3">
            <SaveBtn busy={s3.busy} done={s3.done} onClick={() => s3.run(() => patch({ settings: Object.fromEntries(THRESHOLDS.map((t) => [t.k, settings[t.k]])) }))} />
            {s3.error && <span className="text-sm text-crit">{s3.error}</span>}
          </div>
        </Card>

        <Card title="ThingSpeak cloud" icon={<CloudUpload size={16} />}>
          <p className="mb-4 text-sm text-muted">
            Publishes location (field 1 and 2), sound dB (3), sound category (4), Trust Score (5) and alert level (6) to your ThingSpeak channel, at most once every 15 s.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Write API key">
              <input className="input num" value={settings.thingspeak_write_key} onChange={(e) => setSettings({ ...settings, thingspeak_write_key: e.target.value.trim() })} />
            </Field>
            <Field label="Channel ID" hint="Used to link to your public dashboard">
              <input className="input num" value={settings.thingspeak_channel_id} onChange={(e) => setSettings({ ...settings, thingspeak_channel_id: e.target.value.trim() })} />
            </Field>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <SaveBtn
              busy={s4.busy}
              done={s4.done}
              onClick={() => s4.run(() => patch({ settings: { thingspeak_write_key: settings.thingspeak_write_key, thingspeak_channel_id: settings.thingspeak_channel_id } }))}
            />
            <button
              className="btn-ghost"
              onClick={async () => {
                setTsResult("Sending…");
                try {
                  const r = await api<{ ok: boolean }>(`/api/children/${childId}/thingspeak/test`, { method: "POST" });
                  setTsResult(r.ok ? "✓ ThingSpeak accepted the update" : "ThingSpeak rejected it. Check the key, or wait 15 s and try again.");
                } catch (e) {
                  setTsResult((e as Error).message);
                }
              }}
            >
              Send test update
            </button>
            {settings.thingspeak_channel_id && (
              <a className="text-sm text-info hover:underline" href={`https://thingspeak.com/channels/${settings.thingspeak_channel_id}`} target="_blank" rel="noreferrer">
                Open channel ↗
              </a>
            )}
          </div>
          {tsResult && <div className="mt-2 text-sm text-muted">{tsResult}</div>}
        </Card>

        <Card title="Account & children" icon={<UserPlus size={16} />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your name">
              <input className="input" value={account.name} onChange={(e) => setAccount({ ...account, name: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input className="input" value={account.phone} onChange={(e) => setAccount({ ...account, phone: e.target.value })} />
            </Field>
          </div>
          <button className="btn-ghost mt-3" onClick={async () => { await api("/api/auth/me", { method: "PATCH", body: account }); refresh(); }}>
            Update account
          </button>
          <div className="mt-6 space-y-2 border-t border-line/10 pt-5">
            {user.children.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-xl bg-line/[0.03] px-3 py-2">
                <button className="text-sm font-medium hover:underline" onClick={() => setChildId(c.id)}>
                  {c.name} {c.id === childId && <span className="text-xs text-safe">(selected)</span>}
                </button>
                {user.children.length > 1 && (
                  <button
                    className="rounded-lg p-1.5 text-muted hover:bg-crit/10 hover:text-crit"
                    aria-label={`Delete ${c.name}`}
                    onClick={async () => {
                      if (!confirm(`Delete ${c.name} and all their data?`)) return;
                      await api(`/api/children/${c.id}`, { method: "DELETE" });
                      await refresh();
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <input className="input" placeholder="Add another child…" value={newChild} onChange={(e) => setNewChild(e.target.value)} />
              <button
                className="btn-ghost"
                disabled={!newChild.trim()}
                onClick={async () => {
                  const c = await api<{ id: number }>("/api/children", { body: { name: newChild.trim() } });
                  setNewChild("");
                  await refresh();
                  setChildId(c.id);
                }}
              >
                <Plus size={15} /> Add
              </button>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
