import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import LoginPage from "./pages/Login";
import CalendarPage from "./pages/Calendar";
import NormativePage from "./pages/Normative";
import JobsPage from "./pages/Jobs";
import ReportsPage from "./pages/Reports";
import SettingsPage from "./pages/Settings";
import AppShell from "./layout/AppShell";
import { useSession } from "./auth/useSession";

function ProtectedApp() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/normative" element={<NormativePage />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/calendar" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  const { session, ready } = useSession();

  if (!ready) return <div className="card card-pad">Loading…</div>;

  return (
    <HashRouter>
      <Routes>
        <Route
          path="/login"
          element={session ? <Navigate to="/calendar" replace /> : <LoginPage />}
        />
        <Route
          path="/*"
          element={session ? <ProtectedApp /> : <Navigate to="/login" replace />}
        />
      </Routes>
    </HashRouter>
  );
}
