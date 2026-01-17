import { NavLink, Outlet } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function AppShell() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">Bilstar Service</div>

        <nav className="nav">
          <NavLink to="/calendar" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
            Programări
          </NavLink>
          <NavLink to="/normative" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
            Normativ
          </NavLink>
          <NavLink to="/jobs" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
            Lucrări
          </NavLink>
          <NavLink to="/reports" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
            Rapoarte
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
            Setări
          </NavLink>
        </nav>

        <div style={{ marginTop: 14 }}>
          <button className="btn full" onClick={() => supabase.auth.signOut()}>
            Logout
          </button>
        </div>
      </aside>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
