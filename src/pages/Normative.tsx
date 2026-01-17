import { useEffect, useMemo, useState } from "react";
import Modal from "../components/Modal";
import {
  Operation,
  createOperation,
  getMyProfile,
  getOrgSettings,
  listOperations,
  updateOperation,
} from "../lib/db";

function moneyRON(amount: number) {
  return new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON" }).format(amount);
}

export default function NormativePage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [laborRate, setLaborRate] = useState<number>(0);

  const [q, setQ] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);

  const [rows, setRows] = useState<Operation[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // modal
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Operation | null>(null);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [minutes, setMinutes] = useState("0");
  const [active, setActive] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const p = await getMyProfile();
        setOrgId(p.org_id);

        const s = await getOrgSettings();
        setLaborRate(s.labor_rate_per_hour);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Eroare la încărcare");
      }
    })();
  }, []);

  async function refresh() {
    setErr(null);
    setLoading(true);
    try {
      const list = await listOperations({ query: q, includeInactive });
      setRows(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Eroare la încărcarea operațiunilor");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!orgId) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, includeInactive]);

  const filtered = useMemo(() => rows, [rows]);

  function openNew() {
    setEditing(null);
    setCode("");
    setName("");
    setCategory("");
    setMinutes("0");
    setActive(true);
    setOpen(true);
  }

  function openEdit(op: Operation) {
    setEditing(op);
    setCode(op.code ?? "");
    setName(op.name ?? "");
    setCategory(op.category ?? "");
    setMinutes(String(op.norm_minutes ?? 0));
    setActive(Boolean(op.is_active));
    setOpen(true);
  }

  async function save() {
    if (!orgId) return;
    setErr(null);
    setSaving(true);

    try {
      const nm = name.trim();
      if (!nm) throw new Error("Denumirea este obligatorie.");
      const m = Number(minutes);
      if (!Number.isFinite(m) || m < 0) throw new Error("Timp normat invalid.");

      if (!editing) {
        await createOperation({
          orgId,
          code: code.trim() || undefined,
          name: nm,
          category: category.trim() || undefined,
          normMinutes: m,
          isActive: active,
        });
      } else {
        await updateOperation(editing.id, {
          code: code.trim() || null,
          name: nm,
          category: category.trim() || null,
          norm_minutes: m,
          is_active: active,
        });
      }

      setOpen(false);
      await refresh();
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
          <div className="h1">Sistem Normativ</div>
          <div className="muted">
            Tarif manoperă: <b>{moneyRON(laborRate)}</b> / oră (setezi din Setări)
          </div>
        </div>

        <div className="row">
          <input
            className="input"
            style={{ width: 240 }}
            placeholder="Caută (nume / cod / categorie)…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn" onClick={() => void refresh()}>
            Caută
          </button>

          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            <span className="muted">Arată inactive</span>
          </label>

          <button className="btn primary" onClick={openNew}>
            + Operațiune
          </button>
        </div>
      </div>

      {err && (
        <div className="card card-pad" style={{ borderColor: "rgba(220,38,38,0.35)", marginBottom: 12 }}>
          <div style={{ color: "crimson", fontWeight: 900 }}>{err}</div>
        </div>
      )}

      <div className="card card-pad">
        <div className="muted" style={{ marginBottom: 10 }}>
          {loading ? "Se încarcă…" : `${filtered.length} operațiuni`}
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>Cod</th>
              <th>Denumire</th>
              <th>Categorie</th>
              <th>Timp (min)</th>
              <th>Cost estimat</th>
              <th>Activ</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((op) => {
              const cost = (laborRate * (op.norm_minutes ?? 0)) / 60;
              return (
                <tr key={op.id}>
                  <td>{op.code || <span className="muted">—</span>}</td>
                  <td style={{ fontWeight: 900 }}>{op.name}</td>
                  <td>{op.category || <span className="muted">—</span>}</td>
                  <td>{op.norm_minutes}</td>
                  <td>{moneyRON(cost)}</td>
                  <td>
                    <span className="badge">{op.is_active ? "Da" : "Nu"}</span>
                  </td>
                  <td>
                    <button className="btn" onClick={() => openEdit(op)}>
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}

            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  Nicio operațiune. Adaugă prima operațiune din “+ Operațiune”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={open} title={editing ? "Editează operațiune" : "Operațiune nouă"} onClose={() => setOpen(false)}>
        <div style={{ display: "grid", gap: 10 }}>
          <div className="grid2">
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>Cod (opțional)</div>
              <input className="input" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>Categorie (opțional)</div>
              <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
          </div>

          <div>
            <div className="muted" style={{ marginBottom: 6 }}>Denumire *</div>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="grid2">
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>Timp normat (minute)</div>
              <input className="input" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <label className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                <span style={{ fontWeight: 800 }}>Activ</span>
              </label>

              <button className="btn primary" disabled={saving} onClick={() => void save()}>
                {saving ? "Salvez…" : "Salvează"}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
