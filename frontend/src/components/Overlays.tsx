import { AnimatePresence, motion } from "framer-motion";
import { MapPin, Siren, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { levelColor } from "../lib/format";
import { useLive } from "../lib/live";
import { categoryIcon } from "./AlertItem";

export function Toasts() {
  const { toasts, dismissToast } = useLive();
  return (
    <div className="pointer-events-none fixed right-3 top-[76px] z-[1200] flex w-[min(380px,calc(100vw-24px))] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = categoryIcon[t.category] ?? Siren;
          const c = levelColor[t.level];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 60, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, scale: 0.95 }}
              className="glass pointer-events-auto flex gap-3 rounded-2xl p-3 shadow-2xl"
              style={{ boxShadow: `0 10px 40px -12px ${c}` }}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ color: c, background: `color-mix(in srgb, ${c} 16%, transparent)` }}>
                <Icon size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{t.title}</div>
                <div className="line-clamp-2 text-xs text-muted">{t.message}</div>
              </div>
              <button onClick={() => dismissToast(t.id)} className="self-start rounded-lg p-1 text-muted hover:bg-line/10" aria-label="Dismiss">
                <X size={14} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/** Full-screen takeover for critical alerts (SOS, critical combo) — the parent can't miss it. */
export function CriticalOverlay() {
  const { critical, clearCritical, childId, live, reload } = useLive();
  const nav = useNavigate();
  const ack = async () => {
    if (critical && childId) {
      try {
        await api(`/api/children/${childId}/alerts/${critical.id}/ack`, { method: "POST" });
      } catch {
        /* still close */
      }
      reload();
    }
    clearCritical();
  };
  return (
    <AnimatePresence>
      {critical && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[1300] flex items-center justify-center p-4"
          role="alertdialog"
          aria-modal="true"
        >
          <motion.div
            className="absolute inset-0"
            style={{ background: "radial-gradient(circle at center, rgb(var(--crit) / 0.45), rgb(var(--ink) / 0.92) 70%)" }}
            animate={{ opacity: [0.75, 1, 0.75] }}
            transition={{ duration: 1.4, repeat: Infinity }}
          />
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            className="glass relative w-full max-w-md rounded-3xl p-6 text-center"
            style={{ boxShadow: `0 0 0 1px ${levelColor.critical}, 0 30px 120px -20px ${levelColor.critical}` }}
          >
            <motion.div
              className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-crit text-white"
              animate={{ scale: [1, 1.08, 1] }}
              transition={{ duration: 0.9, repeat: Infinity }}
              style={{ boxShadow: "0 0 0 12px rgb(var(--crit) / 0.2), 0 0 0 26px rgb(var(--crit) / 0.08)" }}
            >
              <Siren size={38} />
            </motion.div>
            <div className="mt-5 text-xs font-bold uppercase tracking-[0.25em] text-crit">Critical alert</div>
            <h2 className="mt-2 font-display text-2xl font-bold">{critical.title}</h2>
            <p className="mt-2 text-sm text-muted">{critical.message}</p>
            {live?.child && <p className="mt-2 text-xs text-muted">Device buzzer and red LED have been activated on {live.child.name}'s device.</p>}
            <div className="mt-6 grid grid-cols-2 gap-2">
              <button
                className="btn-ghost"
                onClick={() => {
                  clearCritical();
                  nav("/map");
                }}
              >
                <MapPin size={16} /> Locate
              </button>
              <button className="btn-danger" onClick={ack}>
                Acknowledge
              </button>
            </div>
            {critical.lat != null && (
              <a className="mt-3 block text-xs text-info hover:underline" href={`https://maps.google.com/?q=${critical.lat},${critical.lon}`} target="_blank" rel="noreferrer">
                Open position in Google Maps ↗
              </a>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
