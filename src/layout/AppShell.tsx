import { NavLink, Outlet } from "react-router-dom";
import { supabase } from "../lib/supabase";

const linkStyle = ({ isActive }: { isActive: boolean }) => ({
  padding: "10px 12px",
  borderRadius: 10,
  textDecoration: "none",
  color: "inherit",
  background: isActive ? "rgba(0,0,0,0.08)" : "transparent",
  fontWeight: isActive ? 700 : 500,
});

export default function AppShell() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", height: "100vh" }}>
      <aside style={{ borderRight: "1px solid rgba(0,0,0,0.12)", padding: 14 }}>
        <div style={{ fontWeight: 800, marginBottom: 14, fontSize: 18 }}>
          Bilstar Service
        </div>

        <nav style={{ display: "grid", gap: 6 }}>
          <NavLink to="/calendar" style={linkStyle}>Programări</NavLink>
          <NavLink to="/normative" style={linkStyle}>Normativ</NavLink>
          <NavLink to="/jobs" style={linkStyle}>Lucrări</NavLink>
          <NavLink to="/reports" style={linkStyle}>Rapoarte</NavLink>
          <NavLink to="/settings" style={linkStyle}>Setări</NavLink>
        </nav>

        <div style={{ marginTop: 18 }}>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 10 }}
          >
            Logout
          </button>
        </div>
      </aside>

      <main style={{ padding: 16, overflow: "auto" }}>
        <Outlet />
      </main>
    </div>
  );
}
