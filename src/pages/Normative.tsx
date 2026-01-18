import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import Modal from "../components/Modal";
import {
  Operation,
  createOperation,
  getMyProfile,
  listOperations,
  updateOperation,
  upsertOperationsBulk,
} from "../lib/db";

type ImportRow = {
  code?: string | null;
  name: string;
  category?: string | null;
  norm_minutes: number;
};

function normHeaderKey(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function pick<T extends object>(obj: T, keys: string[]): string {
  for (const k of keys) {
    const val = (obj as any)[k];
    if (val != null && String(val).trim().length > 0) return String(val).trim();
  }
  return "";
}

function toInt(v: string): number {
  const n = Number(String(v).replace(/,/g, "."));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

export default function NormativePage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);

  const [ops, setOps] = useState<Operation[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // add/edit modal
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [normMinutes, setNormMinutes] = useState("0");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // import modal
  const [openImport, setOpenImport] = useState(false);
  const [importName, setImportName] = useState<string>("");
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const p = await getMyProfile();
        setOrgId(p.org_id);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Eroare la inițializare");
      }
    })();
  }, []);

  async function refresh() {
    setErr(null);
    setLoading(true);
    try {
      const list = await listOperations({ query: q, includeInactive });
      setOps(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Eroare la încărcare");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, includeInactive]);

  function openCreate() {
    setEditId(null);
    setCode("");
    setName("");
    setCategory("");
    setNormMinutes("0");
    setIsActive(true);
    setOpen(true);
  }

  function openEdit(op: Operation) {
    setEditId(op.id);
    setCode(op.code ?? "");
    setName(op.name);
    setCategory(op.category ?? "");
    setNormMinutes(String(op.norm_minutes ?? 0));
    setIsActive(Boolean(op.is_active));
    setOpen(true);
  }

  async function onSave() {
    if (!orgId) return;
    setErr(null);
    setSaving(true);

    try {
      if (!name.trim()) throw new Error("Denumire obligatorie.");
      const mins = Number(normMinutes);
      if (!Number.isFinite(mins) || mins < 0) throw new Error("Minute invalide.");

      if (editId) {
        await updateOperation(editId, {
          code: code.trim() || null,
          name: name.trim(),
          category: category.trim() || null,
          norm_minutes: Math.floor(mins),
          is_active: isActive,
        });
      } else {
        await createOperation({
          orgId,
          code: code.trim() || undefined,
          name: name.trim(),
          category: category.trim() || undefined,
          normMinutes: Math.floor(mins),
          isActive,
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

  const grouped = useMemo(() => {
    const map = new Map<string, Operation[]>();
    for (const op of ops) {
      const key = op.category?.trim() || "(Fără categorie)";
      const arr = map.get(key) ?? [];
      arr.push(op);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [ops]);

  function openImportModal() {
    setImportErr(null);
    setImportName("");
    setImportRows([]);
    setOpenImport(true);
  }

  async function onPickImportFile(file: File) {
    setImportErr(null);
    setImportName(file.name);

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const wsName = wb.SheetNames[0];
      if (!wsName) throw new Error("Fișierul nu are foi (sheets).");
      const ws = wb.Sheets[wsName];
      if (!ws) throw new Error("Nu pot citi foaia 1.");

      // Convert to objects using headers (first row)
      const raw: any[] = XLSX.utils.sheet_to_json(ws, {
        defval: "",
        raw: false,
      }) as any[];

      // Normalize keys for every row
      const normalized = raw.map((r) => {
        const obj: Record<string, any> = {};
        for (const [k, v] of Object.entries(r)) obj[normHeaderKey(k)] = v;
        return obj;
      });

      // Accept multiple header variants
      const rows: ImportRow[] = normalized
        .map((r) => {
          const code = pick(r, ["code", "cod", "cod_intern", "id", "cod_op"]);
          const name = pick(r, ["name", "denumire", "operatiune", "operațiune", "operatie", "operație"]);
          const cat = pick(r, ["category", "categorie", "categoria"]);
          const minsStr = pick(r, [
            "norm_minutes",
            "minute",
            "timp",
            "timp_minute",
            "durata",
            "durata_minute",
            "normat",
          ]);

          const mins = toInt(minsStr);

          return {
            code: code || null,
            name: name,
            category: cat || null,
            norm_minutes: mins,
          };
        })
        .filter((r) => r.name.trim().length > 0);

      if (rows.length === 0) throw new Error("Nu am găsit rânduri valide. Verifică header-ele.");
      if (rows.length > 5000) throw new Error("Fișier prea mare (max 5000 rânduri pentru import).");

      setImportRows(rows);
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : "Eroare la citire fișier");
      setImportRows([]);
    }
  }

  async function onRunImport() {
    if (!orgId) return;
    if (importRows.length === 0) return;

    setImportErr(null);
    setImporting(true);

    try {
      await upsertOperationsBulk({
        orgId,
        rows: importRows.map((r) => ({
          code: r.code,
          name: r.name,
          category: r.category,
          norm_minutes: r.norm_minutes,
          is_active: true,
        })),
      });

      setOpenImport(false);
      await refresh();
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : "Eroare la import");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="h1">Sistem Normativ</div>
          <div className="muted">Catalog operațiuni + timp normat (minute)</div>
        </div>

        <div className="row">
          <input
            className="input"
            style={{ width: 240 }}
            placeholder="Caută (denumire/cod/categorie)…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            <span className="muted">Include inactive</span>
          </label>

          <button className="btn" onClick={() => void refresh()}>
            Refresh
          </button>
          <button className="btn" onClick={openImportModal}>
            Import Excel/CSV
          </button>
          <button className="btn primary" onClick={openCreate}>
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
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontWeight: 950 }}>Operațiuni</div>
          <div className="muted">{loading ? "Se încarcă…" : `${ops.length} înregistrări`}</div>
        </div>

        {grouped.map(([cat, items]) => (
          <div key={cat} style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 950, margin: "8px 0" }}>{cat}</div>

            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 120 }}>Cod</th>
                  <th>Denumire</th>
                  <th style={{ width: 120 }}>Minute</th>
                  <th style={{ width: 120 }}>Activ</th>
                  <th style={{ width: 120 }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((op) => (
                  <tr key={op.id}>
                    <td>{op.code || "—"}</td>
                    <td style={{ fontWeight: 800 }}>{op.name}</td>
                    <td>{op.norm_minutes}</td>
                    <td>{op.is_active ? "Da" : "Nu"}</td>
                    <td>
                      <button className="btn" onClick={() => openEdit(op)}>
                        Editează
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {!loading && ops.length === 0 && <div className="muted">Nu există operațiuni (încă).</div>}
      </div>

      {/* Add/Edit */}
      <Modal
        open={open}
        title={editId ? "Editează operațiune" : "Adaugă operațiune"}
        onClose={() => setOpen(false)}
      >
        <div style={{ display: "grid", gap: 10 }}>
          <div className="grid2">
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>
                Cod intern (opțional)
              </div>
              <input className="input" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>

            <div>
              <div className="muted" style={{ marginBottom: 6 }}>
                Categorie (opțional)
              </div>
              <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
          </div>

          <div>
            <div className="muted" style={{ marginBottom: 6 }}>
              Denumire
            </div>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="grid2">
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>
                Timp normat (minute)
              </div>
              <input
                className="input"
                value={normMinutes}
                onChange={(e) => setNormMinutes(e.target.value)}
                inputMode="numeric"
              />
            </div>

            <div>
              <div className="muted" style={{ marginBottom: 6 }}>
                Activ
              </div>
              <select className="select" value={isActive ? "yes" : "no"} onChange={(e) => setIsActive(e.target.value === "yes")}>
                <option value="yes">Da</option>
                <option value="no">Nu</option>
              </select>
            </div>
          </div>

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setOpen(false)}>
              Închide
            </button>
            <button className="btn primary" onClick={() => void onSave()} disabled={saving}>
              {saving ? "Se salvează…" : "Salvează"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Import */}
      <Modal open={openImport} title="Import normativ (Excel / CSV)" onClose={() => setOpenImport(false)}>
        <div style={{ display: "grid", gap: 10 }}>
          <div className="muted">
            Recomandat: coloane cu header-e precum <b>code</b>, <b>name</b>, <b>category</b>, <b>norm_minutes</b>.
            Sunt acceptate și variante românești (cod/denumire/categorie/minute/timp).
          </div>

          <input
            className="input"
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPickImportFile(f);
            }}
          />

          {importName && <div className="muted">Fișier: <b>{importName}</b></div>}

          {importErr && (
            <div className="card card-pad" style={{ borderColor: "rgba(220,38,38,0.35)" }}>
              <div style={{ color: "crimson", fontWeight: 900 }}>{importErr}</div>
            </div>
          )}

          {importRows.length > 0 && (
            <div className="card card-pad">
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontWeight: 950 }}>Preview</div>
                <div className="muted">{importRows.length} rânduri detectate</div>
              </div>

              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 120 }}>Cod</th>
                    <th>Denumire</th>
                    <th style={{ width: 160 }}>Categorie</th>
                    <th style={{ width: 120 }}>Minute</th>
                  </tr>
                </thead>
                <tbody>
                  {importRows.slice(0, 10).map((r, idx) => (
                    <tr key={idx}>
                      <td>{r.code || "—"}</td>
                      <td style={{ fontWeight: 800 }}>{r.name}</td>
                      <td>{r.category || "—"}</td>
                      <td>{r.norm_minutes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {importRows.length > 10 && <div className="muted">(+ {importRows.length - 10} rânduri)</div>}
            </div>
          )}

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setOpenImport(false)}>
              Închide
            </button>
            <button
              className="btn primary"
              onClick={() => void onRunImport()}
              disabled={importing || importRows.length === 0}
            >
              {importing ? "Se importă…" : "Import"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
