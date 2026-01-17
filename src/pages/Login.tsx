import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function LoginPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setLoading(false);

    if (error) {
      setErr(error.message);
      return;
    }

    // Login OK -> mergem direct în app
    if (data.session) {
      navigate("/calendar", { replace: true });
    } else {
      // fallback (rar)
      navigate("/calendar", { replace: true });
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ width: 420, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 16, padding: 18 }}>
        <div style={{ fontWeight: 900, fontSize: 22 }}>Bilstar v0.0</div>
        <div style={{ opacity: 0.75, marginTop: 6 }}>Autentificare</div>

        <form onSubmit={onSubmit} style={{ display: "grid", gap: 10, marginTop: 14 }}>
          <input
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            style={{ padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.2)" }}
          />
          <input
            placeholder="Parolă"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            style={{ padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.2)" }}
          />

          <button
            type="submit"
            disabled={loading}
            style={{ padding: 10, borderRadius: 10, fontWeight: 700 }}
          >
            {loading ? "Se conectează..." : "Login"}
          </button>

          {err && <div style={{ color: "crimson", fontWeight: 600 }}>{err}</div>}
        </form>
      </div>
    </div>
  );
}
