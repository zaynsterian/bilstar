import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Modal from "../components/Modal";
import {
  AppointmentRow,
  AppointmentStatus,
  Customer,
  JobProgressStatus,
  Vehicle,
  getMyProfile,
  listAppointmentsByCustomer,
  listCustomers,
  listJobsByCustomer,
  listVehiclesByCustomer,
  updateCustomer,
  updateVehicle,
} from "../lib/db";

const TIME_ZONE = "Europe/Bucharest";

const APPT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  new: "Nou",
  confirmed: "Confirmat",
  in_progress: "În lucru",
  done: "Finalizat",
  cancelled: "Anulat",
  no_show: "No-show",
};

const JOB_PROGRESS_LABEL: Record<JobProgressStatus, string> = {
  not_started: "Neînceput",
  diagnosis: "Diagnoză",
  repair: "Reparație",
  final_stage: "Finalizare",
  finished: "Finalizat",
};

function fmtDateTime(iso: string) {
  return new Intl.DateTimeFormat("ro-RO", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function vehicleLabel(v: Vehicle | null) {
  if (!v) return "Vehicul necunoscut";
  const core = [v.make, v.model].filter(Boolean).join(" ");
  const plate = v.plate ? ` • ${v.plate}` : "";
  const year = v.year ? ` • ${v.year}` : "";
  return `${core || "Vehicul"}${year}${plate}`;
}

function contactLabel(c: Customer) {
  const bits = [c.phone || "", c.email || ""].filter(Boolean);
  return bits.length ? bits.join(" • ") : "—";
}

export default function CustomersPage() {
  const nav = useNavigate();

  const [orgId, setOrgId] = useState<string | null>(null);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId],
  );

  const [query, setQuery] = useState("");

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [jobs, setJobs] = useState<Array<{ id: string; created_at: string; progress: JobProgressStatus; appointment_id: string | null; vehicle: Vehicle | null }>>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);

  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [editCustomerOpen, setEditCustomerOpen] = useState(false);
  const [editCustomerName, setEditCustomerName] = useState("");
  const [editCustomerPhone, setEditCustomerPhone] = useState("");
  const [editCustomerEmail, setEditCustomerEmail] = useState("");
  const [savingCustomer, setSavingCustomer] = useState(false);

  const [editVehicleOpen, setEditVehicleOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [editVehicleMake, setEditVehicleMake] = useState("");
  const [editVehicleModel, setEditVehicleModel] = useState("");
  const [editVehicleYear, setEditVehicleYear] = useState("");
  const [editVehiclePlate, setEditVehiclePlate] = useState("");
  const [savingVehicle, setSavingVehicle] = useState(false);

  const [modalErr, setModalErr] = useState<string | null>(null);

  function openEditCustomer() {
    if (!selectedCustomer) return;
    setModalErr(null);
    setEditCustomerName(selectedCustomer.name ?? "");
    setEditCustomerPhone(selectedCustomer.phone ?? "");
    setEditCustomerEmail(selectedCustomer.email ?? "");
    setEditCustomerOpen(true);
  }

  function openEditVehicle(v: Vehicle) {
    setModalErr(null);
    setEditingVehicle(v);
    setEditVehicleMake(v.make ?? "");
    setEditVehicleModel(v.model ?? "");
    setEditVehicleYear(v.year == null ? "" : String(v.year));
    setEditVehiclePlate(v.plate ?? "");
    setEditVehicleOpen(true);
  }

  function isValidEmail(email: string) {
    // Simple, safe validation
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  async function saveCustomerEdits() {
    if (!selectedCustomer) return;
    setModalErr(null);
    setSavingCustomer(true);
    try {
      const name = editCustomerName.trim();
      if (!name) throw new Error("Numele este obligatoriu.");

      const phoneTrim = editCustomerPhone.trim();
      const emailTrim = editCustomerEmail.trim();

      if (emailTrim && !isValidEmail(emailTrim)) throw new Error("Email invalid.");

      await updateCustomer(selectedCustomer.id, {
        name,
        phone: phoneTrim ? phoneTrim : null,
        email: emailTrim ? emailTrim : null,
      });

      await refreshCustomers();
      await refreshDetails(selectedCustomer.id);
      setEditCustomerOpen(false);
    } catch (e) {
      setModalErr(e instanceof Error ? e.message : "Eroare la salvarea clientului");
    } finally {
      setSavingCustomer(false);
    }
  }

  async function saveVehicleEdits() {
    if (!editingVehicle) return;
    setModalErr(null);
    setSavingVehicle(true);
    try {
      const make = editVehicleMake.trim();
      const model = editVehicleModel.trim();
      if (!make) throw new Error("Marca este obligatorie.");
      if (!model) throw new Error("Modelul este obligatoriu.");

      const yearTrim = editVehicleYear.trim();
      const yearNum = yearTrim ? Math.round(Number(yearTrim)) : NaN;
      if (yearTrim && (!Number.isFinite(yearNum) || yearNum < 1900 || yearNum > 2100)) {
        throw new Error("An invalid.");
      }

      const plateTrim = editVehiclePlate.trim();

      await updateVehicle(editingVehicle.id, {
        make,
        model,
        year: yearTrim ? yearNum : null,
        plate: plateTrim ? plateTrim : null,
      });

      if (selectedCustomer) {
        await refreshDetails(selectedCustomer.id);
      }

      setEditVehicleOpen(false);
      setEditingVehicle(null);
    } catch (e) {
      setModalErr(e instanceof Error ? e.message : "Eroare la salvarea vehiculului");
    } finally {
      setSavingVehicle(false);
    }
  }

  async function refreshCustomers() {
    setErr(null);
    setLoadingCustomers(true);
    try {
      const list = await listCustomers();
      setCustomers(list);

      // Keep selection if still exists
      if (selectedCustomerId && !list.some((c) => c.id === selectedCustomerId)) {
        setSelectedCustomerId(null);
      }
      if (!selectedCustomerId && list.length) setSelectedCustomerId(list[0].id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Eroare la încărcarea clienților");
    } finally {
      setLoadingCustomers(false);
    }
  }

  async function refreshDetails(customerId: string) {
    setErr(null);
    setLoadingDetails(true);
    try {
      const [v, j, a] = await Promise.all([
        listVehiclesByCustomer(customerId),
        listJobsByCustomer(customerId, 50),
        listAppointmentsByCustomer(customerId, 50),
      ]);

      setVehicles(v);
      setJobs(j);
      setAppointments(a);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Eroare la încărcarea detaliilor");
    } finally {
      setLoadingDetails(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const p = await getMyProfile();
        setOrgId(p.org_id);
        await refreshCustomers();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Eroare la inițializare");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedCustomerId) {
      setVehicles([]);
      setJobs([]);
      setAppointments([]);
      return;
    }
    void refreshDetails(selectedCustomerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomerId]);

  const filteredCustomers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
      const hay = `${c.name} ${(c.phone ?? "")} ${(c.email ?? "")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [customers, query]);

  return (
    <>
      <div>
      <div className="page-header">
        <div>
          <div className="h1">Clienți</div>
          <div className="muted">Listă + detalii (vehicule, lucrări, programări)</div>
        </div>

        <div className="row">
          <button className="btn" onClick={() => void refreshCustomers()}>
            Refresh
          </button>
        </div>
      </div>

      {err && (
        <div className="card card-pad" style={{ borderColor: "rgba(220,38,38,0.35)", marginBottom: 12 }}>
          <div style={{ color: "crimson", fontWeight: 900 }}>{err}</div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 10 }}>
        {/* Left: list */}
        <div className="card card-pad">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontWeight: 950 }}>Lista clienților</div>
            <div className="muted">{loadingCustomers ? "Se încarcă…" : `${customers.length} clienți`}</div>
          </div>

          <input
            className="input"
            placeholder="Caută după nume / telefon / email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ marginBottom: 10 }}
          />

          <div style={{ display: "grid", gap: 8, maxHeight: "calc(100vh - 220px)", overflow: "auto" }}>
            {filteredCustomers.map((c) => (
              <button
                key={c.id}
                className={`btn ${c.id === selectedCustomerId ? "primary" : ""}`}
                style={{ width: "100%", justifyContent: "space-between", display: "flex" }}
                onClick={() => setSelectedCustomerId(c.id)}
              >
                <span style={{ textAlign: "left" }}>
                  <div style={{ fontWeight: 900 }}>{c.name}</div>
                  <div className="muted">{contactLabel(c)}</div>
                </span>
                <span className="badge">Client</span>
              </button>
            ))}

            {!loadingCustomers && filteredCustomers.length === 0 && (
              <div className="muted">Niciun client găsit pentru căutarea curentă.</div>
            )}
          </div>
        </div>

        {/* Right: details */}
        <div className="card card-pad">
          {!selectedCustomer ? (
            <div className="muted">Selectează un client din stânga.</div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 950, fontSize: 16 }}>{selectedCustomer.name}</div>
                  <div className="muted">{contactLabel(selectedCustomer)}</div>
                </div>

                <div className="row">
                  <button className="btn" onClick={() => openEditCustomer()} disabled={!selectedCustomer}>Editează</button>
                  <span className="badge">{orgId ? "Org OK" : "—"}</span>
                </div>
              </div>

              {loadingDetails && <div className="muted">Se încarcă detaliile…</div>}

              {/* Vehicles */}
              <div>
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={{ fontWeight: 950 }}>Vehicule</div>
                  <div className="muted">{vehicles.length}</div>
                </div>

                <table className="table">
                  <thead>
                    <tr>
                      <th>Vehicul</th>
                      <th style={{ width: 120 }}>An</th>
                      <th style={{ width: 180 }}>Număr</th>
                      <th style={{ width: 140 }}>Acțiuni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vehicles.map((v) => (
                      <tr key={v.id}>
                        <td>{[v.make, v.model].filter(Boolean).join(" ") || "Vehicul"}</td>
                        <td>{v.year ?? "—"}</td>
                        <td>{v.plate ?? "—"}</td>
                        <td>
                          <button className="btn" onClick={() => openEditVehicle(v)}>Editează</button>
                        </td>
                      </tr>
                    ))}
                    {!loadingDetails && vehicles.length === 0 && (
                      <tr>
                        <td colSpan={4} className="muted">
                          Nu există vehicule pentru acest client.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Jobs */}
              <div>
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={{ fontWeight: 950 }}>Lucrări (istoric)</div>
                  <div className="muted">{jobs.length}</div>
                </div>

                <table className="table">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Vehicul</th>
                      <th>Status</th>
                      <th style={{ width: 160 }}>Acțiuni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((j) => (
                      <tr key={j.id}>
                        <td>{fmtDateTime(j.created_at)}</td>
                        <td>{vehicleLabel(j.vehicle)}</td>
                        <td>
                          <span className="badge">{JOB_PROGRESS_LABEL[j.progress]}</span>
                        </td>
                        <td>
                          <div className="row">
                            <button className="btn" onClick={() => nav(`/jobs?job=${encodeURIComponent(j.id)}`)}>
                              Deschide
                            </button>
                            {j.appointment_id && (
                              <button
                                className="btn"
                                onClick={() => nav(`/calendar?appointment=${encodeURIComponent(j.appointment_id!)}`)}
                              >
                                Programare
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!loadingDetails && jobs.length === 0 && (
                      <tr>
                        <td colSpan={4} className="muted">
                          Nu există lucrări pentru acest client.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Appointments */}
              <div>
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={{ fontWeight: 950 }}>Programări</div>
                  <div className="muted">{appointments.length}</div>
                </div>

                <table className="table">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Serviciu</th>
                      <th>Status</th>
                      <th style={{ width: 160 }}>Acțiuni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appointments.map((a) => (
                      <tr key={a.id}>
                        <td>{fmtDateTime(a.start_at)}</td>
                        <td>
                          <div style={{ fontWeight: 850 }}>{a.service_title}</div>
                          <div className="muted">{vehicleLabel(a.vehicle)}</div>
                        </td>
                        <td>
                          <span className="badge">{APPT_STATUS_LABEL[a.status]}</span>
                        </td>
                        <td>
                          <button
                            className="btn"
                            onClick={() => nav(`/calendar?appointment=${encodeURIComponent(a.id)}`)}
                          >
                            Deschide
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!loadingDetails && appointments.length === 0 && (
                      <tr>
                        <td colSpan={4} className="muted">
                          Nu există programări pentru acest client.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

      <Modal open={editCustomerOpen} title="Editează client" onClose={() => setEditCustomerOpen(false)}>
        {modalErr && (
          <div className="card card-pad" style={{ borderColor: "rgba(220,38,38,0.35)", marginBottom: 12 }}>
            <div style={{ color: "crimson", fontWeight: 900 }}>{modalErr}</div>
          </div>
        )}

        <div className="grid2">
          <div>
            <div className="muted" style={{ marginBottom: 4 }}>
              Nume *
            </div>
            <input className="input" value={editCustomerName} onChange={(e) => setEditCustomerName(e.target.value)} />
          </div>

          <div>
            <div className="muted" style={{ marginBottom: 4 }}>
              Telefon
            </div>
            <input className="input" value={editCustomerPhone} onChange={(e) => setEditCustomerPhone(e.target.value)} />
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <div className="muted" style={{ marginBottom: 4 }}>
              Email
            </div>
            <input className="input" value={editCustomerEmail} onChange={(e) => setEditCustomerEmail(e.target.value)} />
          </div>
        </div>

        <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button className="btn" onClick={() => setEditCustomerOpen(false)} disabled={savingCustomer}>
            Anulează
          </button>
          <button className="btn primary" onClick={() => void saveCustomerEdits()} disabled={savingCustomer}>
            {savingCustomer ? "Se salvează…" : "Salvează"}
          </button>
        </div>
      </Modal>

      <Modal open={editVehicleOpen} title="Editează vehicul" onClose={() => { setEditVehicleOpen(false); setEditingVehicle(null); }}>
        {modalErr && (
          <div className="card card-pad" style={{ borderColor: "rgba(220,38,38,0.35)", marginBottom: 12 }}>
            <div style={{ color: "crimson", fontWeight: 900 }}>{modalErr}</div>
          </div>
        )}

        <div className="grid2">
          <div>
            <div className="muted" style={{ marginBottom: 4 }}>
              Marca *
            </div>
            <input className="input" value={editVehicleMake} onChange={(e) => setEditVehicleMake(e.target.value)} />
          </div>

          <div>
            <div className="muted" style={{ marginBottom: 4 }}>
              Model *
            </div>
            <input className="input" value={editVehicleModel} onChange={(e) => setEditVehicleModel(e.target.value)} />
          </div>

          <div>
            <div className="muted" style={{ marginBottom: 4 }}>
              An
            </div>
            <input className="input" value={editVehicleYear} onChange={(e) => setEditVehicleYear(e.target.value)} />
          </div>

          <div>
            <div className="muted" style={{ marginBottom: 4 }}>
              Număr
            </div>
            <input className="input" value={editVehiclePlate} onChange={(e) => setEditVehiclePlate(e.target.value)} />
          </div>
        </div>

        <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button
            className="btn"
            onClick={() => {
              setEditVehicleOpen(false);
              setEditingVehicle(null);
            }}
            disabled={savingVehicle}
          >
            Anulează
          </button>
          <button className="btn primary" onClick={() => void saveVehicleEdits()} disabled={savingVehicle}>
            {savingVehicle ? "Se salvează…" : "Salvează"}
          </button>
        </div>
      </Modal>

    </>

  );
}
