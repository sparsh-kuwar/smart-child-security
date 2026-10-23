import clsx from "clsx";
import { motion } from "framer-motion";
import type { ReactNode } from "react";

export function Card({
  children,
  className,
  title,
  icon,
  action,
  glow,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  glow?: string;
  delay?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.2, 0.8, 0.2, 1] }}
      className={clsx("glass relative overflow-hidden rounded-3xl p-5", className)}
      style={glow ? { boxShadow: `0 0 0 1px ${glow}22, 0 20px 60px -30px ${glow}` } : undefined}
    >
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 font-display text-[15px] font-semibold tracking-tight">
            {icon && <span className="text-muted">{icon}</span>}
            {title}
          </h3>
          {action}
        </header>
      )}
      {children}
    </motion.section>
  );
}

export function Pill({ children, color, className, pulse }: { children: ReactNode; color?: string; className?: string; pulse?: boolean }) {
  return (
    <span
      className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", className)}
      style={{ color: color ?? "rgb(var(--muted))", background: `color-mix(in srgb, ${color ?? "rgb(var(--muted))"} 14%, transparent)` }}
    >
      {pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70" style={{ background: color }} />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: color }} />
        </span>
      )}
      {children}
    </span>
  );
}

export function Stat({ label, value, unit, sub, color }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; color?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="num truncate text-2xl font-semibold" style={color ? { color } : undefined}>
          {value}
        </span>
        {unit && <span className="text-xs text-muted">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Bar({ value, max = 1, color, className }: { value: number; max?: number; color: string; className?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={clsx("h-2 overflow-hidden rounded-full bg-line/[0.07]", className)}>
      <motion.div
        className="h-full rounded-full"
        style={{ background: color, boxShadow: `0 0 12px ${color}` }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }}
      />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} />;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      {icon && <div className="text-muted/60">{icon}</div>}
      <div className="font-medium">{title}</div>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-xl border border-line/10 bg-line/[0.03] p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={clsx(
            "relative rounded-lg px-3 py-1.5 text-xs font-semibold transition",
            value === o.value ? "text-fg" : "text-muted hover:text-fg",
          )}
        >
          {value === o.value && (
            <motion.span layoutId={`seg-${options.map((x) => x.value).join()}`} className="absolute inset-0 rounded-lg bg-line/10" />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function SimBadge({ simulated }: { simulated: boolean }) {
  return simulated ? (
    <Pill color="rgb(var(--violet))">Simulated data</Pill>
  ) : (
    <Pill color="rgb(var(--safe))" pulse>
      Live hardware
    </Pill>
  );
}
