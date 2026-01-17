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

    if (data.session) navigate("/calendar", { replace: true });
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="card card-pad" style={{ width: 440 }}>
        <div className="h1">Bilstar</div>
        <div className="muted" style={{ marginTop: 6 }}>Autentificare</div>

        <form onSubmit={onSubmit} style={{ display: "grid", gap: 10, marginTop: 14 }}>
          <input
            className="input"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <input
            className="input"
            placeholder="Parolă"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />

          <button type="submit" disabled={loading} className="btn primary">
            {loading ? "Se conectează…" : "Login"}
          </button>

          {err && <div style={{ color: "crimson", fontWeight: 800 }}>{err}</div>}
        </form>
      </div>
    </div>
  );
}
