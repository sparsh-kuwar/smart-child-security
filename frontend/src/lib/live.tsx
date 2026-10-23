import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, getToken } from "./api";
import { useAuth } from "./auth";
import type { Alert, Live } from "./types";

interface LiveState {
  childId: number | null;
  setChildId: (id: number) => void;
  live: Live | null;
  error: string | null;
  connected: boolean;
  tick: number; // increments on every streamed reading — pages use it to refetch
  toasts: Alert[];
  dismissToast: (id: number) => void;
  critical: Alert | null;
  clearCritical: () => void;
  reload: () => Promise<void>;
}

const Ctx = createContext<LiveState>(null!);
const CHILD_KEY = "st-child";

function notifyBrowser(a: Alert, child: string) {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
      new Notification(`${a.level === "critical" ? "🚨" : "⚠️"} ${a.title}`, { body: `${child}: ${a.message}`, tag: String(a.id) });
    }
  } catch {
    /* notifications unsupported */
  }
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [childId, setChildIdState] = useState<number | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [tick, setTick] = useState(0);
  const [toasts, setToasts] = useState<Alert[]>([]);
  const [critical, setCritical] = useState<Alert | null>(null);
  const inflight = useRef(false);
  const lastFetch = useRef(0);
  const nameRef = useRef("");

  useEffect(() => {
    if (!user?.children.length) return;
    let stored: number | null = null;
    try {
      stored = Number(localStorage.getItem(CHILD_KEY)) || null;
    } catch {
      /* ignore */
    }
    const ids = user.children.map((c) => c.id);
    setChildIdState((cur) => (cur && ids.includes(cur) ? cur : stored && ids.includes(stored) ? stored : ids[0]));
  }, [user]);

  const setChildId = (id: number) => {
    setLive(null);
    setChildIdState(id);
    try {
      localStorage.setItem(CHILD_KEY, String(id));
    } catch {
      /* ignore */
    }
  };

  const reload = useCallback(async () => {
    if (!childId || inflight.current) return;
    inflight.current = true;
    lastFetch.current = Date.now();
    try {
      const l = await api<Live>(`/api/children/${childId}/live`);
      nameRef.current = l.child.name;
      setLive(l);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inflight.current = false;
    }
  }, [childId]);

  // Poll as a fallback; SSE drives most refreshes.
  useEffect(() => {
    if (!childId) return;
    reload();
    const t = setInterval(() => {
      if (Date.now() - lastFetch.current > 9000) reload();
    }, 3000);
    return () => clearInterval(t);
  }, [childId, reload]);

  useEffect(() => {
    if (!childId) return;
    const token = getToken();
    if (!token) return;
    const es = new EventSource(`/api/children/${childId}/stream?token=${encodeURIComponent(token)}`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("reading", () => {
      setTick((t) => t + 1);
      if (Date.now() - lastFetch.current > 1800) reload();
    });
    es.addEventListener("alert", (ev) => {
      const a = JSON.parse((ev as MessageEvent).data) as Alert;
      setToasts((ts) => [a, ...ts.filter((t) => t.id !== a.id)].slice(0, 4));
      if (a.level === "critical") setCritical(a);
      notifyBrowser(a, nameRef.current);
      reload();
    });
    es.addEventListener("attendance", () => reload());
    return () => {
      es.close();
      setConnected(false);
    };
  }, [childId, reload]);

  // auto-dismiss non-critical toasts
  useEffect(() => {
    if (!toasts.length) return;
    const t = setTimeout(() => setToasts((ts) => ts.filter((x) => x.level === "critical").slice(0, 2)), 7000);
    return () => clearTimeout(t);
  }, [toasts]);

  return (
    <Ctx.Provider
      value={{
        childId,
        setChildId,
        live,
        error,
        connected,
        tick,
        toasts,
        dismissToast: (id) => setToasts((ts) => ts.filter((t) => t.id !== id)),
        critical,
        clearCritical: () => setCritical(null),
        reload,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useLive = () => useContext(Ctx);

/** Fetch helper that re-runs when deps change and optionally every `everyTicks` streamed readings. */
export function useApi<T>(path: string | null, everyTicks = 0) {
  const { tick } = useLive();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const bucket = everyTicks ? Math.floor(tick / everyTicks) : 0;

  const load = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(true);
    setData(null);
  }, [path]);

  useEffect(() => {
    load();
  }, [load, bucket]);

  return { data, error, loading, reload: load, setData };
}
