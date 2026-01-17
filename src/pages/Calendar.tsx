import { useEffect, useMemo, useState } from "react";
import Modal from "../components/Modal";
import {
  AppointmentRow,
  AppointmentStatus,
  createAppointment,
  createCustomer,
  createVehicle,
  getMyProfile,
  listAppointmentsBetween,
  listCustomers,
  listVehiclesByCustomer,
  Customer,
  Vehicle,
  updateAppointmentStatus,
} from "../lib/db";

const TIME_ZONE = "Europe/Bucharest";

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  new: "Nou",
  confirmed: "Confirmat",
  in_progress: "În lucru",
  done: "Finalizat",
  cancelled: "Anulat",
  no_show: "No-show",
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function ymdInTimeZone(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const map = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function getTimeZoneOffsetMinutes(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = dtf.formatToParts(date);
  const map = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));

  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );

  return (asUtc - date.getTime()) / 60000;
}

function toUtcIsoFromDatetimeLocalInTz(timeZone: string, value: string): string {
  // value: "YYYY-MM-DDTHH:mm"
  const [d, t] = value.split("T");
  const [y, m, day] = d.split("-").map((x) => Number(x));
  const [hh, mm] = t.split(":").map((x) => Number(x));

  const assumedUtcMs = Date.UTC(y, m - 1, day, hh, mm, 0);
  const offsetMin = getTimeZoneOffsetMinutes(timeZone, new Date(assumedUtcMs));
  const realUtcMs = assumedUtcMs - offsetMin * 60_000;

  return new Date(realUtcMs).toISOString();
}

function nextYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function dayRangeUtc(ymd: string) {
  const startLocal = `${ymd}T00:00`;
  const endLocal = `${nextYmd(ymd)}T00:00`;
  return {
    startIso: toUtcIsoFromDatetimeLocalInTz(TIME_ZONE, startLocal),
    endIso: toUtcIsoFromDatetimeLocalInTz(TIME_ZONE, endLocal),
  };
}

function fmtTime(iso: string) {
  return new Intl.DateTimeFormat("ro-RO", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function vehicleLabel(v: Vehicle) {
  const core = [v.make, v.model].filter(Boolean).join(" ");
  const plate = v.plate ? ` • ${v.plate}` : "";
  const year = v.year ? ` • ${v.year}` : "";
  const name = core || "Vehicul";
  return `${name}${year}${plate}`;
}

export default function CalendarPage() {
  const [orgId, setOrgId] = useState<string | null>(null);

  const [selectedYmd, setSelectedYmd] = useState<string>(() => ymdInTimeZone(new Date()));
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Modal state
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [customerMode, setCustomerMode] = useState<"existing" | "new">("existing");
  const [customerId, setCustomerId] = useState<string>("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleMode, setVehicleMode] = useState<"existing" | "new">("existing");
  const [vehicleId, setVehicleId] = useState<string>("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState<string>("");
  const [plate, setPlate] = useState("");

  const [serviceTitle, setServiceTitle] = useState("");
  const [startAtLocal, setStartAtLocal] = useState<string>(() => `${ymdInTimeZone(new Date())}T09:00`);
  const [estimatedMinutes, setEstimatedMinutes] = useState<string>("60");
  const [status, setStatus] = useState<AppointmentStatus>("new");
  const [notes, setNotes] = useState("");

  const range = useMemo(() => dayRangeUtc(selectedYmd), [selectedYmd]);

  const stats = useMemo(() => {
    const total = appointments.length;
    const by: Record<AppointmentStatus, number> = {
      new: 0,
      confirmed: 0,
      in_progress: 0,
      done: 0,
      cancelled: 0,
      no_show: 0,
    };
    for (const a of appointments) by[a.status] += 1;
    return { total, by };
  }, [appointments]);

  useEffect(() => {
    (async () => {
      try {
        const p = await getMyProfile();
        setOrgId(p.org_id);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Eroare la încărcarea profilului");
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const list = await listCustomers();
        setCustomers(list);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Eroare la încărcarea clienților");
      }
    })();
  }, []);

  async function refreshAppointments() {
    setErr(null);
    setLoading(true);
    try {
      const list = await listAppointmentsBetween(range.startIso, range.endIso);
      setAppointments(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Eroare la încărcarea programărilor");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!orgId) return;
    void refreshAppointments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, range.startIso, range.endIso]);

  useEffect(() => {
    if (customerMode !== "existing") {
      setVehicles([]);
      setVehicleId("");
      setVehicleMode("new");
      return;
    }
    if (!customerId) {
      setVehicles([]);
      setVehicleId("");
      return;
    }

    (async () => {
      try {
        const list = await listVehiclesByCustomer(customerId);
        setVehicles(list);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Eroare la încărcarea vehiculelor");
      }
    })();
  }, [customerId, customerMode]);

  function resetModalDefaults() {
    setCustomerMode("existing");
    setCustomerId("");
    setCustomerName("");
    setCustomerPhone("");
    setCustomerEmail("");

    setVehicles([]);
    setVehicleMode("existing");
    setVehicleId("");
    setMake("");
    setModel("");
    setYear("");
    setPlate("");

    setServiceTitle("");
    setStartAtLocal(`${selectedYmd}T09:00`);
    setEstimatedMinutes("60");
    setStatus("new");
    setNotes("");
  }

  function openNewAppointment() {
    resetModalDefaults();
    setOpen(true);
  }

  async function onCreateAppointment() {
    if (!orgId) {
      setErr("Org ID lipsă (profile).");
      return;
    }

    setErr(null);
    setSaving(true);

    try {
      let finalCustomerId = customerId;

      if (customerMode === "new") {
        if (!customerName.trim()) throw new Error("Nume client obligatoriu.");
        const c = await createCustomer({
          orgId,
          name: customerName.trim(),
          phone: customerPhone,
          email: customerEmail,
        });
        finalCustomerId = c.id;

        const updated = await listCustomers();
        setCustomers(updated);
      } else {
        if (!finalCustomerId) throw new Error("Selectează un client.");
      }

      let finalVehicleId = vehicleId;

      if (vehicleMode === "new") {
        const maybeYear = year.trim() ? Number(year.trim()) : undefined;
        if (year.trim() && Number.isNaN(maybeYear)) throw new Error("An vehicul invalid.");

        const v = await createVehicle({
          orgId,
          customerId: finalCustomerId,
          make,
          model,
          year: maybeYear,
          plate,
        });
        finalVehicleId = v.id;
      } else {
        if (!finalVehicleId) throw new Error("Selectează un vehicul.");
      }

      if (!serviceTitle.trim()) throw new Error("Serviciu obligatoriu.");
      const mins = Number(estimatedMinutes);
      if (!Number.isFinite(mins) || mins <= 0) throw new Error("Durată invalidă.");

      const startIso = toUtcIsoFromDatetimeLocalInTz(TIME_ZONE, startAtLocal);

      await createAppointment({
        orgId,
        customerId: finalCustomerId,
        vehicleId: finalVehicleId,
        serviceTitle: serviceTitle.trim(),
        estimatedMinutes: mins,
        startAtIso: startIso,
        status,
        notes,
      });

      setOpen(false);
      await refreshAppointments();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Eroare la salvare");
    } finally {
      setSaving(false);
    }
  }

  async function onChangeStatus(id: string, next: AppointmentStatus) {
    setErr(null);
    try {
      await updateAppointmentStatus(id, next);
      await refreshAppointments();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Eroare la update status");
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="h1">Programări</div>
          <div className="muted">Timezone: {TIME_ZONE}</div>
        </div>

        <div className="row">
          <input
            className="input"
            style={{ width: 180 }}
            type="date"
            value={selectedYmd}
            onChange={(e) => setSelectedYmd(e.target.value)}
          />
          <button className="btn primary" onClick={openNewAppointment}>
            + Programare
          </button>
        </div>
      </div>

      {err && (
        <div className="card card-pad" style={{ borderColor: "rgba(220,38,38,0.35)", marginBottom: 12 }}>
          <div style={{ color: "crimson", fontWeight: 900 }}>{err}</div>
        </div>
      )}

      <div className="grid2">
        <div className="card card-pad">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontWeight: 900 }}>Lista zilei ({selectedYmd})</div>
            <div className="muted">{loading ? "Se încarcă…" : `${appointments.length} programări`}</div>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>Ora</th>
                <th>Client</th>
                <th>Mașină</th>
                <th>Serviciu</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 900 }}>{fmtTime(a.start_at)}</td>
                  <td>
                    <div style={{ fontWeight: 850 }}>{a.customer.name}</div>
                    <div className="muted">{a.customer.phone || a.customer.email || ""}</div>
                  </td>
                  <td>{vehicleLabel(a.vehicle)}</td>
                  <td>
                    <div style={{ fontWeight: 850 }}>{a.service_title}</div>
                    <div className="muted">{a.estimated_minutes} min</div>
                  </td>
                  <td>
                    <div className="row">
                      <span className="badge">{STATUS_LABEL[a.status]}</span>
                      <select
                        className="select"
                        style={{ width: 160 }}
                        value={a.status}
                        onChange={(e) => onChangeStatus(a.id, e.target.value as AppointmentStatus)}
                      >
                        {Object.keys(STATUS_LABEL).map((k) => (
                          <option key={k} value={k}>
                            {STATUS_LABEL[k as AppointmentStatus]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                </tr>
              ))}

              {!loading && appointments.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Nicio programare pentru ziua selectată.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card card-pad">
          <div style={{ fontWeight: 950, marginBottom: 8 }}>Astăzi — sumar</div>
          <div className="muted" style={{ marginBottom: 12 }}>
            Total: <b>{stats.total}</b>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {(
              ["new", "confirmed", "in_progress", "done", "cancelled", "no_show"] as AppointmentStatus[]
            ).map((s) => (
              <div key={s} className="row" style={{ justifyContent: "space-between" }}>
                <span className="badge">{STATUS_LABEL[s]}</span>
                <span style={{ fontWeight: 950 }}>{stats.by[s]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Modal open={open} title="Programare nouă" onClose={() => setOpen(false)}>
        <div style={{ display: "grid", gap: 10 }}>
          <div className="grid2">
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>Client</div>

              <div className="row" style={{ marginBottom: 8 }}>
                <button
                  className={`btn ${customerMode === "existing" ? "primary" : ""}`}
                  type="button"
                  onClick={() => setCustomerMode("existing")}
                >
                  Existent
                </button>
                <button
                  className={`btn ${customerMode === "new" ? "primary" : ""}`}
                  type="button"
                  onClick={() => setCustomerMode("new")}
                >
                  Nou
                </button>
              </div>

              {customerMode === "existing" ? (
                <select
                  className="select"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                >
                  <option value="">Selectează client…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.phone ? `(${c.phone})` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  <input className="input" placeholder="Nume client *" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                  <input className="input" placeholder="Telefon" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
                  <input className="input" placeholder="Email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
                </div>
              )}
            </div>

            <div>
              <div className="muted" style={{ marginBottom: 6 }}>Vehicul</div>

              <div className="row" style={{ marginBottom: 8 }}>
                <button
                  className={`btn ${vehicleMode === "existing" ? "primary" : ""}`}
                  type="button"
                  onClick={() => setVehicleMode("existing")}
                  disabled={customerMode === "new"}
                >
                  Existent
                </button>
                <button
                  className={`btn ${vehicleMode === "new" ? "primary" : ""}`}
                  type="button"
                  onClick={() => setVehicleMode("new")}
                >
                  Nou
                </button>
              </div>

              {vehicleMode === "existing" && customerMode !== "new" ? (
                <select className="select" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                  <option value="">Selectează vehicul…</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {vehicleLabel(v)}
                    </option>
                  ))}
                </select>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  <div className="grid2">
                    <input className="input" placeholder="Marca" value={make} onChange={(e) => setMake(e.target.value)} />
                    <input className="input" placeholder="Model" value={model} onChange={(e) => setModel(e.target.value)} />
                  </div>
                  <div className="grid2">
                    <input className="input" placeholder="An" value={year} onChange={(e) => setYear(e.target.value)} />
                    <input className="input" placeholder="Număr (ex: B-123-ABC)" value={plate} onChange={(e) => setPlate(e.target.value)} />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid2">
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>Serviciu *</div>
              <input className="input" placeholder="Ex: Schimb ulei + filtre" value={serviceTitle} onChange={(e) => setServiceTitle(e.target.value)} />
            </div>

            <div className="grid2">
              <div>
                <div className="muted" style={{ marginBottom: 6 }}>Dată/Oră (România)</div>
                <input
                  className="input"
                  type="datetime-local"
                  value={startAtLocal}
                  onChange={(e) => setStartAtLocal(e.target.value)}
                />
              </div>

              <div>
                <div className="muted" style={{ marginBottom: 6 }}>Durată (min)</div>
                <input
                  className="input"
                  value={estimatedMinutes}
                  onChange={(e) => setEstimatedMinutes(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="grid2">
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>Status</div>
              <select className="select" value={status} onChange={(e) => setStatus(e.target.value as AppointmentStatus)}>
                {Object.keys(STATUS_LABEL).map((k) => (
                  <option key={k} value={k}>
                    {STATUS_LABEL[k as AppointmentStatus]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="muted" style={{ marginBottom: 6 }}>Notițe</div>
              <input className="input" placeholder="(opțional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn" type="button" onClick={() => setOpen(false)} disabled={saving}>
              Anulează
            </button>
            <button className="btn primary" type="button" onClick={onCreateAppointment} disabled={saving}>
              {saving ? "Se salvează…" : "Salvează"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
