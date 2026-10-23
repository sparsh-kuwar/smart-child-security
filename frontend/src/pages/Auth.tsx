import { motion } from "framer-motion";
import { ArrowRight, AudioLines, CreditCard, Gauge, Loader2, MapPin, ShieldCheck, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

const FEATURES = [
  { icon: MapPin, title: "Haversine geofencing", text: "Home, school and bus-route safe zones, with live position updates." },
  { icon: CreditCard, title: "RFID attendance", text: "Gate scans with debounce. Unknown cards are rejected." },
  { icon: AudioLines, title: "Privacy-first sound", text: "Measures dB level only. Audio is never recorded." },
  { icon: Gauge, title: "Weighted Trust Score", text: "Combines five signals into one score that ranks what needs attention." },
];

export default function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { login, register } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", child_name: "", phone: "" });
  const [busy, setBusy] = useState<"form" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("form");
    setError(null);
    try {
      if (mode === "login") await login(form.email, form.password);
      else await register({ ...form, child_name: form.child_name || "My child" });
      nav("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const demo = async () => {
    setBusy("demo");
    setError(null);
    try {
      await login("demo@safetrack.app", "demo1234");
      nav("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="grid-bg absolute inset-0" />
        <div className="absolute -left-40 -top-40 h-[620px] w-[620px] animate-drift rounded-full bg-safe/20 blur-[140px]" />
        <div className="absolute -right-40 top-20 h-[520px] w-[520px] animate-drift rounded-full bg-violet/25 blur-[140px] [animation-delay:-8s]" />
      </div>

      <div className="relative mx-auto grid min-h-screen max-w-7xl items-center gap-10 px-5 py-10 lg:grid-cols-[1.15fr,1fr] lg:px-10">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <div className="flex items-center gap-3">
            <img src="/icon.svg" alt="" className="h-11 w-11" />
            <span className="font-display text-xl font-bold">SafeTrack</span>
          </div>
          <h1 className="mt-8 font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            Know they're safe.
            <br />
            <span className="text-gradient">Without listening in.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base text-muted sm:text-lg">
            A smart child security system that brings together IoT sensing, machine learning and privacy-aware ambient sound into one live
            dashboard for parents and schools.
          </p>
          <div className="mt-8 grid max-w-2xl gap-3 sm:grid-cols-2">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.08 }}
                className="glass rounded-2xl p-4"
              >
                <f.icon size={18} className="text-safe" />
                <div className="mt-2 text-sm font-semibold">{f.title}</div>
                <div className="mt-0.5 text-xs text-muted">{f.text}</div>
              </motion.div>
            ))}
          </div>
          <p className="mt-6 hidden text-xs text-muted lg:block">
            JSPM's RSCOE · Department of Computer Engineering · B.Tech project 2026–27
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="glass mx-auto w-full max-w-md rounded-3xl p-6 sm:p-8"
        >
          <h2 className="font-display text-2xl font-bold">{mode === "login" ? "Welcome back" : "Create your account"}</h2>
          <p className="mt-1 text-sm text-muted">
            {mode === "login" ? "Sign in to see your child's live status." : "We'll set up a child profile and a device simulator for you."}
          </p>

          <button onClick={demo} disabled={!!busy} className="btn-primary mt-6 w-full py-3">
            {busy === "demo" ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
            Try the live demo
          </button>
          <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-widest text-muted">
            <span className="h-px flex-1 bg-line/10" /> or <span className="h-px flex-1 bg-line/10" />
          </div>

          <form onSubmit={submit} className="space-y-3.5">
            {mode === "register" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="name">Your name</label>
                  <input id="name" className="input" required value={form.name} onChange={set("name")} autoComplete="name" />
                </div>
                <div>
                  <label className="label" htmlFor="child">Child's name</label>
                  <input id="child" className="input" required value={form.child_name} onChange={set("child_name")} />
                </div>
              </div>
            )}
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" className="input" required value={form.email} onChange={set("email")} autoComplete="email" />
            </div>
            <div>
              <label className="label" htmlFor="pw">Password</label>
              <input
                id="pw"
                type="password"
                className="input"
                required
                minLength={6}
                value={form.password}
                onChange={set("password")}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </div>
            {mode === "register" && (
              <div>
                <label className="label" htmlFor="phone">Phone for SMS alerts (optional)</label>
                <input id="phone" className="input" value={form.phone} onChange={set("phone")} placeholder="+91…" autoComplete="tel" />
              </div>
            )}
            {error && <div className="rounded-xl bg-crit/10 px-3 py-2 text-sm text-crit">{error}</div>}
            <button type="submit" disabled={!!busy} className="btn-ghost w-full py-3">
              {busy === "form" ? <Loader2 className="animate-spin" size={16} /> : null}
              {mode === "login" ? "Sign in" : "Create account"} <ArrowRight size={15} />
            </button>
          </form>
          <p className="mt-5 text-center text-sm text-muted">
            {mode === "login" ? (
              <>
                New here? <Link to="/register" className="font-semibold text-safe hover:underline">Create an account</Link>
              </>
            ) : (
              <>
                Have an account? <Link to="/login" className="font-semibold text-safe hover:underline">Sign in</Link>
              </>
            )}
          </p>
          <div className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-muted">
            <ShieldCheck size={13} className="text-safe" /> Passwords are salted and hashed (PBKDF2-SHA256)
          </div>
        </motion.div>
      </div>
    </div>
  );
}
