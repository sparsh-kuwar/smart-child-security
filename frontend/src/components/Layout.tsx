import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AudioLines,
  Bell,
  CalendarDays,
  ChevronDown,
  Clock,
  Cpu,
  CreditCard,
  Gauge,
  Hexagon,
  LayoutDashboard,
  LogOut,
  Map,
  Menu,
  Moon,
  Settings,
  Sun,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useLive } from "../lib/live";
import { useTheme } from "../lib/theme";
import { CriticalOverlay, Toasts } from "./Overlays";

export const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/map", label: "Live map", icon: Map },
  { to: "/zones", label: "Safe zones", icon: Hexagon },
  { to: "/sound", label: "Ambient sound", icon: AudioLines },
  { to: "/activity", label: "Activity & device", icon: Activity },
  { to: "/attendance", label: "RFID attendance", icon: CreditCard },
  { to: "/trust", label: "Trust score", icon: Gauge },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/history", label: "History", icon: CalendarDays },
  { to: "/schedule", label: "Schedule", icon: Clock },
  { to: "/device", label: "Device lab", icon: Cpu },
  { to: "/settings", label: "Settings", icon: Settings },
];
const MOBILE = ["/", "/map", "/alerts", "/trust"];

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/icon.svg" alt="" className="h-9 w-9" />
      <div className="leading-tight">
        <div className="font-display text-[17px] font-bold tracking-tight">SafeTrack</div>
        <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted">Child security</div>
      </div>
    </div>
  );
}

function ChildSwitcher() {
  const { user } = useAuth();
  const { childId, setChildId, live } = useLive();
  const [open, setOpen] = useState(false);
  const current = user?.children.find((c) => c.id === childId);
  if (!user) return null;
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2.5 rounded-2xl py-1.5 pl-1.5 pr-3 hover:bg-line/5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-safe to-violet font-display font-bold text-ink">
          {current?.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="text-left leading-tight">
          <span className="block text-sm font-semibold">{current?.name ?? "…"}</span>
          <span className="block text-[11px] text-muted">
            {live?.reading?.zone ?? (live?.reading ? "Outside zones" : "Waiting for data")}
          </span>
        </span>
        <ChevronDown size={14} className="text-muted" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="glass absolute left-0 top-full z-[1100] mt-2 w-56 rounded-2xl p-1.5 shadow-2xl"
          >
            {user.children.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setChildId(c.id);
                  setOpen(false);
                }}
                className={clsx("flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-line/5", c.id === childId && "bg-line/5 font-semibold")}
              >
                {c.name}
              </button>
            ))}
            <NavLink to="/settings" onClick={() => setOpen(false)} className="mt-1 block rounded-xl px-3 py-2 text-xs text-muted hover:bg-line/5">
              + Add or edit children
            </NavLink>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Layout() {
  const { logout, user } = useAuth();
  const { live, connected } = useLive();
  const { theme, toggle } = useTheme();
  const [sheet, setSheet] = useState(false);
  const loc = useLocation();
  useEffect(() => setSheet(false), [loc.pathname]);

  const unacked = live?.unacked_alerts ?? 0;
  const sim = live?.child.simulator_enabled;

  return (
    <div className="relative min-h-screen">
      {/* aurora background */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="grid-bg absolute inset-0" />
        <div className="absolute -left-[10%] -top-[20%] h-[60vh] w-[60vw] animate-drift rounded-full bg-safe/[0.10] blur-[120px]" />
        <div className="absolute -right-[10%] top-[10%] h-[55vh] w-[50vw] animate-drift rounded-full bg-violet/[0.12] blur-[120px] [animation-delay:-6s]" />
        <div className="absolute bottom-[-20%] left-[30%] h-[50vh] w-[50vw] animate-drift rounded-full bg-info/[0.08] blur-[120px] [animation-delay:-12s]" />
      </div>

      {/* sidebar */}
      <aside className="fixed inset-y-0 left-0 z-[1000] hidden w-64 flex-col border-r border-line/5 p-4 lg:flex">
        <div className="px-2 py-2">
          <Logo />
        </div>
        <nav className="mt-6 flex-1 space-y-0.5 overflow-y-auto">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                clsx(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                  isActive ? "text-fg" : "text-muted hover:bg-line/[0.04] hover:text-fg",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl bg-line/[0.07]" transition={{ type: "spring", stiffness: 400, damping: 34 }} />
                  )}
                  {isActive && <motion.span layoutId="nav-bar" className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-safe shadow-[0_0_12px_rgb(var(--safe))]" />}
                  <Icon size={18} className="relative" />
                  <span className="relative">{label}</span>
                  {to === "/alerts" && unacked > 0 && (
                    <span className="relative ml-auto rounded-full bg-crit px-1.5 py-0.5 text-[10px] font-bold text-white">{unacked > 99 ? "99+" : unacked}</span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 rounded-2xl border border-line/10 p-3">
          <div className="truncate text-sm font-semibold">{user?.name}</div>
          <div className="truncate text-xs text-muted">{user?.email}</div>
          <button onClick={logout} className="mt-2 flex items-center gap-1.5 text-xs font-medium text-muted hover:text-crit">
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </aside>

      {/* top bar */}
      <header className="sticky top-0 z-[900] border-b border-line/5 bg-ink/70 backdrop-blur-xl lg:ml-64">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-3 px-4 sm:px-6">
          <div className="lg:hidden">
            <img src="/icon.svg" alt="SafeTrack" className="h-8 w-8" />
          </div>
          <ChildSwitcher />
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <span
              className={clsx(
                "hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline-flex",
                connected ? "bg-safe/10 text-safe" : "bg-warn/10 text-warn",
              )}
            >
              <span className={clsx("h-1.5 w-1.5 rounded-full", connected ? "animate-pulse bg-safe" : "bg-warn")} />
              {connected ? "Live" : "Reconnecting"}
            </span>
            {live && (
              <NavLink
                to="/device"
                className={clsx(
                  "hidden rounded-full px-2.5 py-1 text-[11px] font-semibold md:inline-flex",
                  sim ? "bg-violet/10 text-violet" : "bg-info/10 text-info",
                )}
              >
                {sim ? "Simulator" : "Hardware"}
              </NavLink>
            )}
            <button onClick={toggle} className="rounded-xl p-2.5 text-muted hover:bg-line/5 hover:text-fg" aria-label="Toggle theme">
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <NavLink to="/alerts" className="relative rounded-xl p-2.5 text-muted hover:bg-line/5 hover:text-fg" aria-label="Alerts">
              <Bell size={18} />
              {unacked > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-crit shadow-[0_0_8px_rgb(var(--crit))]" />}
            </NavLink>
          </div>
        </div>
      </header>

      <main className="relative pb-28 lg:ml-64 lg:pb-10">
        <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6">
          <AnimatePresence mode="wait">
            <motion.div key={loc.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* mobile bottom nav */}
      <nav className="glass fixed inset-x-3 bottom-3 z-[1000] flex items-center justify-around rounded-2xl px-2 py-1.5 shadow-2xl lg:hidden" style={{ paddingBottom: "max(6px, env(safe-area-inset-bottom))" }}>
        {NAV.filter((n) => MOBILE.includes(n.to)).map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => clsx("relative flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[10px] font-semibold", isActive ? "text-safe" : "text-muted")}>
            <Icon size={20} />
            {label.split(" ")[0]}
            {to === "/alerts" && unacked > 0 && <span className="absolute right-2 top-1 h-2 w-2 rounded-full bg-crit" />}
          </NavLink>
        ))}
        <button onClick={() => setSheet(true)} className="flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[10px] font-semibold text-muted">
          <Menu size={20} />
          More
        </button>
      </nav>

      <AnimatePresence>
        {sheet && (
          <motion.div className="fixed inset-0 z-[1100] lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink/70 backdrop-blur-sm" onClick={() => setSheet(false)} />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 32 }}
              className="glass absolute inset-x-0 bottom-0 rounded-t-3xl p-4 pb-8"
            >
              <div className="mb-3 flex items-center justify-between">
                <Logo />
                <button onClick={() => setSheet(false)} className="rounded-xl p-2 hover:bg-line/5" aria-label="Close">
                  <X size={18} />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {NAV.map(({ to, label, icon: Icon }) => (
                  <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => clsx("flex flex-col items-center gap-1.5 rounded-2xl border border-line/5 p-3 text-center text-[11px] font-medium", isActive ? "bg-safe/10 text-safe" : "bg-line/[0.02]")}>
                    <Icon size={20} />
                    {label}
                  </NavLink>
                ))}
              </div>
              <button onClick={logout} className="btn-ghost mt-3 w-full">
                <LogOut size={15} /> Sign out
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Toasts />
      <CriticalOverlay />
    </div>
  );
}
