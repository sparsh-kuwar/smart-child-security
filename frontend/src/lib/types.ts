export type Level = "critical" | "warning" | "info";
export type Band = "safe" | "watch" | "concern" | "critical";

export interface Settings {
  screen_limit_minutes: number;
  night_limit_minutes: number;
  unlock_limit: number;
  rfid_debounce_seconds: number;
  sound_window_seconds: number;
  very_loud_db: number;
  very_loud_persist_seconds: number;
  outside_grace_seconds: number;
  gps_stale_seconds: number;
  offline_after_seconds: number;
  school_start: string;
  study_target_hours: number;
  notify_sms_phone: string;
  notify_webhook_url: string;
  thingspeak_write_key: string;
  thingspeak_channel_id: string;
}

export interface Child {
  id: number;
  name: string;
  age: number;
  grade: string;
  school: string;
  student_code: string;
  device_key: string;
  simulator_enabled: boolean;
  data_source: "simulator" | "device";
  online: boolean;
  last_seen: string | null;
  last_boot: string | null;
  battery: number | null;
  firmware: string;
  settings: Settings;
}

export interface Zone {
  id: number;
  name: string;
  kind: "home" | "school" | "route" | "other";
  lat: number;
  lon: number;
  lat2: number | null;
  lon2: number | null;
  radius_m: number;
  active: boolean;
}

export interface Reading {
  ts: string;
  lat: number | null;
  lon: number | null;
  fix: boolean;
  stale: boolean;
  activity: string;
  steps: number;
  movement: number;
  screen_on: boolean;
  sound_db: number | null;
  sound_category: string | null;
  sound_rolling: number | null;
  zone: string | null;
  inside: boolean;
  distance_m: number | null;
  location_score: number;
  sos: boolean;
  source: string;
}

export interface Alert {
  id: number;
  ts: string;
  level: Level;
  category: string;
  title: string;
  message: string;
  lat: number | null;
  lon: number | null;
  acknowledged: boolean;
  data: Record<string, unknown>;
}

export interface Components {
  activity: number;
  schedule: number;
  location: number;
  device: number;
  sound: number;
}

export interface Explain {
  component: keyof Components;
  value: number;
  weight: number;
  points: number;
  lost: number;
}

export interface TrustNow {
  trust: number;
  band: Band;
  label: string;
  components: Components;
  explain: Explain[];
}

export interface SoundNow {
  db: number | null;
  category: string | null;
  rolling_avg: number | null;
  rolling_category: string | null;
  very_loud_run_seconds: number;
  sustained_very_loud: boolean;
  transient_suppressed: boolean;
  sensor_ok: boolean;
}

export interface Usage {
  screen_minutes: number;
  night_minutes: number;
  gaming_minutes: number;
  study_minutes: number;
  unlocks: number;
  other_minutes: number;
}

export interface Violation {
  key: string;
  title: string;
  detail: string;
}

export interface ScheduleCheck {
  name: string;
  planned: string;
  observed: string;
  ok: boolean;
  score: number;
}

export interface SimStatus {
  enabled: boolean;
  active: string | null;
  remaining: number;
  overuse: boolean;
  phase: string;
  cycle_seconds: number;
  cycle_position: number;
}

export interface Live {
  child: Child;
  reading: Reading | null;
  zone: { inside: boolean; zone: string | null; nearest: string | null; distance_m: number | null; unknown: boolean } | null;
  outside_since: string | null;
  sound: SoundNow;
  trust: TrustNow;
  device: { usage: Usage; score: number; violations: Violation[] };
  schedule: { checks: ScheduleCheck[]; adherence: number };
  trail: { ts: string; lat: number; lon: number }[];
  sound_series: { ts: string; db: number | null; rolling: number | null }[];
  attendance_today: { ts: string; direction: string; zone: string | null }[];
  zones: Zone[];
  unacked_alerts: number;
  recent_alerts: Alert[];
  simulator: SimStatus;
  server_time: string;
}

export interface User {
  id: number;
  name: string;
  email: string;
  phone: string;
  children: { id: number; name: string }[];
}

export interface DaySummary {
  date: string;
  simulated: boolean;
  activity_score: number;
  schedule_score: number;
  location_score: number;
  device_score: number;
  sound_score: number;
  trust_score: number;
  steps: number;
  avg_db: number;
  max_db: number;
  loud_events: number;
  very_loud_events: number;
  alerts: number;
  critical_alerts: number;
  in_zone_pct: number;
  screen_minutes: number;
  arrival: string | null;
  activity_mix: Record<string, number>;
  sound_mix: Record<string, number>;
}
