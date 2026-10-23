import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { Skeleton } from "./components/ui";
import { AuthProvider, useAuth } from "./lib/auth";
import { LiveProvider } from "./lib/live";
import { ThemeProvider } from "./lib/theme";
import AuthPage from "./pages/Auth";
import Overview from "./pages/Overview";

const MapPage = lazy(() => import("./pages/MapPage"));
const Zones = lazy(() => import("./pages/Zones"));
const Sound = lazy(() => import("./pages/Sound"));
const ActivityPage = lazy(() => import("./pages/Activity"));
const Attendance = lazy(() => import("./pages/Attendance"));
const Trust = lazy(() => import("./pages/Trust"));
const Alerts = lazy(() => import("./pages/Alerts"));
const History = lazy(() => import("./pages/History"));
const Schedule = lazy(() => import("./pages/Schedule"));
const DeviceLab = lazy(() => import("./pages/DeviceLab"));
const SettingsPage = lazy(() => import("./pages/Settings"));

function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <img src="/icon.svg" alt="" className="h-14 w-14 animate-pulse" />
    </div>
  );
}

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace />;
  return <LiveProvider>{children}</LiveProvider>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  return user ? <Navigate to="/" replace /> : <>{children}</>;
}

const page = (el: ReactNode) => <Suspense fallback={<Skeleton className="h-[70vh]" />}>{el}</Suspense>;

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<PublicOnly><AuthPage mode="login" /></PublicOnly>} />
            <Route path="/register" element={<PublicOnly><AuthPage mode="register" /></PublicOnly>} />
            <Route element={<Protected><Layout /></Protected>}>
              <Route index element={<Overview />} />
              <Route path="map" element={page(<MapPage />)} />
              <Route path="zones" element={page(<Zones />)} />
              <Route path="sound" element={page(<Sound />)} />
              <Route path="activity" element={page(<ActivityPage />)} />
              <Route path="attendance" element={page(<Attendance />)} />
              <Route path="trust" element={page(<Trust />)} />
              <Route path="alerts" element={page(<Alerts />)} />
              <Route path="history" element={page(<History />)} />
              <Route path="schedule" element={page(<Schedule />)} />
              <Route path="device" element={page(<DeviceLab />)} />
              <Route path="settings" element={page(<SettingsPage />)} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
