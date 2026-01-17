import { useEffect, useState } from "react";
import { getMyProfile, getOrgSettings, upsertOrgSettings, updateMyDisplayName } from "../lib/db";

export default function SettingsPage() {
  const [orgId, setOrgId] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [laborRate, setLaborRate] = useState("0");
  const [currency, setCurrency] = useState("RON");

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useStates;

  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const p = await getMyProfile();
        setOrgId(p.org_id);
        setDisplayName(p.display_name ?? "");

        const s = await getOrgSettings();
        setLaborRate(String(s.labor_rate_per_hour ?? 0));
        setCurrency(s.currency ?? "RON");
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Eroare la încărcare setări");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function onSave() {
    if (!orgId) return;
    setErr(null);
    setOk(null);
    setSaving(true);

    try {
      const rate = Number(laborRate);
      if (!Number.isFinite(rate) || rate < 0) throw new Error("Tarif invalid.");

      await upsertOrgSettings({ orgId, laborRatePerHour: rate, currency });
      await updateMyDisplayName(displayName);

      setOk("Setările au fost salvate.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Eroare la salvare");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="h1">Setări</div>
          <div className="muted">Tarif manoperă + profil</div>
        </div>

        <div className="row">
          <button className="btn primary" disabled={saving} onClick={() => void onSave()}>
            {saving ? "Salvez…" : "Salvează"}
          </button>
        </div>
      </div>

      {loading && <div className="muted">Se încarcă…</div>}

      {err && (
        <div className="card card-pad" style={{ borderColor: "rgba(220,38,38,0.35)", marginBottom: 12 }}>
          <div style={{ color: "crimson", fontWeight: 900 }}>{err}</div>
        </div>
      )}

      {ok && (
        <div className="card card-pad" style={{ borderColor: "rgba(34,197,94,0.35)", marginBottom: 12 }}>
          <div style={{ color: "rgba(22,101,52,1)", fontWeight: 900 }}>{ok}</div>
        </div>
      )}

      <div className="grid2">
        <div className="card card-pad">
          <div style={{ fontWeight: 950, marginBottom: 10 }}>Profil</div>

          <div className="muted" style={{ marginBottom: 6 }}>Nume afișat</div>
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />

          <div className="muted" style={{ marginTop: 10 }}>
            Org ID: <b>{orgId ?? "—"}</b>
          </div>
        </div>

        <div className="card card-pad">
          <div style={{ fontWeight: 950, marginBottom: 10 }}>Manoperă</div>

          <div className="muted" style={{ marginBottom: 6 }}>Tarif (RON / oră)</div>
          <input className="input" value={laborRate} onChange={(e) => setLaborRate(e.target.value)} />

          <div className="muted" style={{ marginTop: 10, marginBottom: 6 }}>Monedă</div>
          <select className="select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="RON">RON</option>
          </select>
        </div>
      </div>
    </div>
  );
}

// fix: TS noUnused
function useState<T>(initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  return (window as any).__dummy_use_state__(initial);
}
