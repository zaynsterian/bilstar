import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import type { DateSelectArg, DatesSetArg, EventClickArg, EventDropArg } from "@fullcalendar/core";

import Modal from "../components/Modal";
import {
  AppointmentRow,
  AppointmentStatus,
  Customer,
  Vehicle,
  createAppointment,
  deleteAppointment,
  getMyProfile,
  listAppointmentsBetween,
  listCustomers,
  listVehiclesByCustomer,
  updateAppointmentSchedule,
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

type EventResizeArg = {
  event: {
    id: string;
    start: Date | null;
    end: Date | null;
  };
  revert: () => void;
};


function ymdInTimeZone(d: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const da = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${da}`;
}

function toDatetimeLocalValueInTz(iso: string) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const da = parts.find((p) => p.type === "day")?.value ?? "01";
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";

  return `${y}-${m}-${da}T${hh}:${mm}`;
}

// Convert input "YYYY-MM-DDTHH:mm" assumed in Europe/Bucharest => UTC ISO
function tzLocalInputToUtcIso(localValue: string): string {
  const [datePart, timePart] = localValue.split("T");
  const [y, m, d] = datePart.split("-").map((x) => parseInt(x, 10));
  const [hh, mm] = timePart.split(":").map((x) => parseInt(x, 10));

  // This is the intended wall time (Bucharest). We find its UTC instant by
  // binary searching for a UTC time that formats to the same wall time in that timezone.
  const target = { y, m, d, hh, mm };

  // start from a rough guess: treat as local then adjust
  let lo = Date.UTC(y, m - 1, d, hh, mm) - 6 * 60 * 60 * 1000;
  let hi = Date.UTC(y, m - 1, d, hh, mm) + 6 * 60 * 60 * 1000;

  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  function partsFor(ms: number) {
    const parts = fmt.formatToParts(new Date(ms));
    return {
      y: parseInt(parts.find((p) => p.type === "year")?.value ?? "1970", 10),
      m: parseInt(parts.find((p) => p.type === "month")?.value ?? "01", 10),
      d: parseInt(parts.find((p) => p.type === "day")?.value ?? "01", 10),
      hh: parseInt(parts.find((p) => p.type === "hour")?.value ?? "00", 10),
      mm: parseInt(parts.find((p) => p.type === "minute")?.value ?? "00", 10),
    };
  }

  function cmp(a: ReturnType<typeof partsFor>) {
    const A = [a.y, a.m, a.d, a.hh, a.mm];
    const B = [target.y, target.m, target.d, target.hh, target.mm];
    for (let i = 0; i < A.length; i++) {
      if (A[i] < B[i]) return -1;
      if (A[i] > B[i]) return 1;
    }
    return 0;
  }

  for (let i = 0; i < 36; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const p = partsFor(mid);
    const c = cmp(p);
    if (c === 0) {
      return new Date(mid).toISOString();
    }
    if (c < 0) lo = mid + 30 * 1000;
    else hi = mid - 30 * 1000;
  }

  // fallback (should rarely happen)
  return new Date(Date.UTC(y, m - 1, d, hh, mm)).toISOString();
}

function vehicleLabel(v: Vehicle) {
  const core = [v.make, v.model].filter(Boolean).join(" ");
  const plate = v.plate ? ` • ${v.plate}` : "";
  const year = v.year ? ` • ${v.year}` : "";
  return `${core || "Vehicul"}${year}${plate}`;
}

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

export default function CalendarPage() {
  const nav = useNavigate();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [range, setRange] = useState<{ startIso: string; endIso: string } | null>(null);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Create modal
  const [openCreate, setOpenCreate] = useState(false);
  const [customerId, setCustomerId] = useState<string>("");
  const [vehicleId, setVehicleId] = useState<string>("");
  const [serviceTitle, setServiceTitle] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState("60");
  const [startAtLocal, setStartAtLocal] = useState("");
  const [status, setStatus] = useState<AppointmentStatus>("new");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Details modal
  const [openDetails, setOpenDetails] = useState(false);
  const [selected, setSelected] = useState<AppointmentRow | null>(null);

  const [dServiceTitle, setDServiceTitle] = useState("");
  const [dEstimatedMinutes, setDEstimatedMinutes] = useState("60");
  const [dStartAtLocal, setDStartAtLocal] = useState("");
  const [dStatus, setDStatus] = useState<AppointmentStatus>("new");
  const [dNotes, setDNotes] = useState("");
  const [savingDetails, setSavingDetails] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const p = await getMyProfile();
        setOrgId(p.org_id);

        const list = await listCustomers();
        setCustomers(list);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Eroare la inițializare");
      }
    })();
  }, []);

  useEffect(() => {
    if (!customerId) {
      setVehicles([]);
      setVehicleId("");
      return;
    }

    (async () => {
      try {
        const list = await listVehiclesByCustomer(customerId);
        setVehicles(list);
        if (list.length && !vehicleId) setVehicleId(list[0].id);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Eroare la încărcarea vehiculelor");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  async function refresh() {
    if (!range) return;
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
    if (!range) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, range?.startIso, range?.endIso]);

  const todayYmd = ymdInTimeZone(new Date(), TIME_ZONE);

  const todayList = useMemo(() => {
    return appointments.filter((a) => ymdInTimeZone(new Date(a.start_at), TIME_ZONE) === todayYmd);
  }, [appointments, todayYmd]);

  const events = useMemo(() => {
    return appointments.map((a) => {
      const start = new Date(a.start_at);
      const end = new Date(start.getTime() + Math.max(0, a.estimated_minutes) * 60_000);

      return {
        id: a.id,
        title: `${a.customer.name} — ${a.service_title}`,
        start: a.start_at,
        end: end.toISOString(),
        extendedProps: { appointment: a },
      };
    });
  }, [appointments]);

  function openCreateWithStart(date: Date) {
    setCustomerId(customers[0]?.id ?? "");
    setVehicleId("");
    setServiceTitle("");
    setEstimatedMinutes("60");
    setStartAtLocal(toDatetimeLocalValueInTz(date.toISOString()));
    setStatus("new");
    setNotes("");
    setOpenCreate(true);
  }

  async function onCreate() {
    if (!orgId) return;
    setErr(null);
    setSaving(true);

    try {
      if (!customerId) throw new Error("Selectează un client.");
      if (!vehicleId) throw new Error("Selectează un vehicul.");
      const st = serviceTitle.trim();
      if (!st) throw new Error("Serviciu obligatoriu.");

      const mins = Number(estimatedMinutes);
      if (!Number.isFinite(mins) || mins <= 0) throw new Error("Durată invalidă.");

      if (!startAtLocal) throw new Error("Data/ora este obligatorie.");

      const startAtIso = tzLocalInputToUtcIso(startAtLocal);

      await createAppointment({
        orgId,
        customerId,
        vehicleId,
        serviceTitle: st,
        estimatedMinutes: mins,
        startAtIso,
        status,
        notes,
      });

      setOpenCreate(false);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Eroare la salvare");
    } finally {
      setSaving(false);
    }
  }

  function onDatesSet(arg: DatesSetArg) {
    setRange({ startIso: arg.start.toISOString(), endIso: arg.end.toISOString() });
  }

  function onSelect(arg: DateSelectArg) {
    openCreateWithStart(arg.start);
  }

  function onEventClick(arg: EventClickArg) {
    const appt = (arg.event.extendedProps as any)?.appointment as AppointmentRow | undefined;
    if (!appt) return;

    setSelected(appt);
    setDServiceTitle(appt.service_title);
    setDEstimatedMinutes(String(appt.estimated_minutes ?? 60));
    setDStartAtLocal(toDatetimeLocalValueInTz(appt.start_at));
    setDStatus(appt.status);
    setDNotes(appt.notes ?? "");
    setOpenDetails(true);
  }

  async function onEventDrop(arg: EventDropArg) {
    try {
      const id = arg.event.id;
      const start = arg.event.start;
      if (!start) return;

      const end = arg.event.end;
      const minutes = end ? Math.max(5, Math.round((end.getTime() - start.getTime()) / 60_000)) : undefined;

      await updateAppointmentSchedule(id, {
        start_at: start.toISOString(),
        ...(minutes != null ? { estimated_minutes: minutes } : null),
      });

      await refresh();
    } catch (e) {
      arg.revert();
      setErr(e instanceof Error ? e.message : "Eroare la mutarea programării");
    }
  }

  async function onEventResize(arg: EventResizeArg) {
    try {
      const id = arg.event.id;
      const start = arg.event.start;
      const end = arg.event.end;
      if (!start || !end) return;

      const minutes = Math.max(5, Math.round((end.getTime() - start.getTime()) / 60_000));

      await updateAppointmentSchedule(id, {
        start_at: start.toISOString(),
        estimated_minutes: minutes,
      });

      await refresh();
    } catch (e) {
      arg.revert();
      setErr(e instanceof Error ? e.message : "Eroare la redimensionare");
    }
  }

  async function onSaveDetails() {
    if (!selected) return;
    setErr(null);
    setSavingDetails(true);

    try {
      const st = dServiceTitle.trim();
      if (!st) throw new Error("Serviciu obligatoriu.");

      const mins = Number(dEstimatedMinutes);
      if (!Number.isFinite(mins) || mins <= 0) throw new Error("Durată invalidă.");

      if (!dStartAtLocal) throw new Error("Data/ora este obligatorie.");

      const startAtIso = tzLocalInputToUtcIso(dStartAtLocal);

      await updateAppointmentSchedule(selected.id, {
        service_title: st,
        estimated_minutes: mins,
        start_at: startAtIso,
        notes: dNotes.trim() || null,
      });

      if (dStatus !== selected.status) {
        await updateAppointmentStatus(selected.id, dStatus);
      }

      setOpenDetails(false);
      setSelected(null);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Eroare la salvare");
    } finally {
      setSavingDetails(false);
    }
  }

  async function onDeleteSelected() {
    if (!selected) return;
    const ok = confirm("Ștergi programarea? Acțiunea este ireversibilă.");
    if (!ok) return;

    setErr(null);
    try {
      await deleteAppointment(selected.id);
      setOpenDetails(false);
      setSelected(null);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Eroare la ștergere");
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="h1">Programări</div>
          <div className="muted">
            Calendar zi/săptămână/lună + drag &amp; drop (timezone: {TIME_ZONE})
          </div>
        </div>

        <div className="row">
          <button className="btn" onClick={() => void refresh()} disabled={loading || !range}>
            {loading ? "Se încarcă…" : "Refresh"}
          </button>
          <button
            className="btn primary"
            onClick={() => openCreateWithStart(new Date())}
            disabled={!orgId || customers.length === 0}
          >
            + Programare
          </button>
        </div>
      </div>

      {err && (
        <div className="card card-pad" style={{ borderColor: "rgba(220,38,38,0.35)", marginBottom: 12 }}>
          <div style={{ color: "crimson", fontWeight: 900 }}>{err}</div>
        </div>
      )}

      <div className="calendar-wrap">
        <div className="card card-pad">
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
            initialView="timeGridWeek"
            selectable
            editable
            timeZone={TIME_ZONE}
            height="auto"
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
            }}
            events={events as any}
            datesSet={onDatesSet}
            select={onSelect}
            eventClick={onEventClick}
            eventDrop={onEventDrop}
            eventResize={onEventResize}
            eventResizableFromStart
            nowIndicator
            slotMinTime="07:00:00"
            slotMaxTime="21:00:00"
            locale="ro"
          />
        </div>

        <div className="card card-pad">
          <div style={{ fontWeight: 950, marginBottom: 10 }}>Astăzi ({todayYmd})</div>

          <div style={{ display: "grid", gap: 8 }}>
            {todayList.map((a) => (
              <button
                key={a.id}
                className="btn"
                style={{ width: "100%", textAlign: "left" }}
                onClick={() => {
                  setSelected(a);
                  setDServiceTitle(a.service_title);
                  setDEstimatedMinutes(String(a.estimated_minutes ?? 60));
                  setDStartAtLocal(toDatetimeLocalValueInTz(a.start_at));
                  setDStatus(a.status);
                  setDNotes(a.notes ?? "");
                  setOpenDetails(true);
                }}
              >
                <div style={{ fontWeight: 900 }}>{a.customer.name}</div>
                <div className="muted">
                  {fmtDateTime(a.start_at)} • {vehicleLabel(a.vehicle)}
                </div>
                <div className="muted">{a.service_title}</div>
                <div style={{ marginTop: 6 }}>
                  <span className="badge">{STATUS_LABEL[a.status]}</span>
                </div>
              </button>
            ))}

            {!loading && todayList.length === 0 && (
              <div className="muted">Nicio programare azi (în range-ul încărcat).</div>
            )}
          </div>

          <div style={{ marginTop: 12 }} className="muted">
            Tip: Poți trage programările în calendar (drag &amp; drop) sau le poți
            redimensiona ca să schimbi durata.
          </div>
        </div>
      </div>

      {/* Create */}
      <Modal open={openCreate} title="Programare nouă" onClose={() => setOpenCreate(false)}>
        <div style={{ display: "grid", gap: 10 }}>
          <div className="grid2">
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>
                Client
              </div>
              <select
                className="select"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">— alege —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="muted" style={{ marginBottom: 6 }}>
                Vehicul
              </div>
              <select
                className="select"
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
                disabled={!customerId}
              >
                <option value="">— alege —</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {vehicleLabel(v)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid2">
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>
                Data / ora (RO)
              </div>
              <input
                type="datetime-local"
                className="input"
                value={startAtLocal}
                onChange={(e) => setStartAtLocal(e.target.value)}
              />
            </div>
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>
                Durată (min)
              </div>
              <input
                className="input"
                value={estimatedMinutes}
                onChange={(e) => setEstimatedMinutes(e.target.value)}
              />
            </div>
          </div>

          <div>
            <div className="muted" style={{ marginBottom: 6 }}>
              Serviciu
            </div>
            <input
              className="input"
              value={serviceTitle}
              onChange={(e) => setServiceTitle(e.target.value)}
              placeholder="Ex: Schimb ulei + filtre"
            />
          </div>

          <div className="grid2">
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>
                Status
              </div>
              <select
                className="select"
                value={status}
                onChange={(e) => setStatus(e.target.value as AppointmentStatus)}
              >
                {Object.keys(STATUS_LABEL).map((k) => (
                  <option key={k} value={k}>
                    {STATUS_LABEL[k as AppointmentStatus]}
                  </option>
                ))}
              </select>
            </div>
            <div />
          </div>

          <div>
            <div className="muted" style={{ marginBottom: 6 }}>
              Note (opțional)
            </div>
            <textarea
              className="textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Detalii (piese aduse, simptome, etc.)"
            />
          </div>

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setOpenCreate(false)}>
              Anulează
            </button>
            <button className="btn primary" onClick={() => void onCreate()} disabled={saving}>
              {saving ? "Se salvează…" : "Salvează"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Details */}
      <Modal
        open={openDetails}
        title={selected ? `Programare • ${selected.customer.name}` : "Programare"}
        onClose={() => setOpenDetails(false)}
      >
        {!selected ? (
          <div className="muted">Nicio programare selectată.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <div className="grid2">
              <div>
                <div className="muted" style={{ marginBottom: 6 }}>
                  Data / ora (RO)
                </div>
                <input
                  type="datetime-local"
                  className="input"
                  value={dStartAtLocal}
                  onChange={(e) => setDStartAtLocal(e.target.value)}
                />
              </div>
              <div>
                <div className="muted" style={{ marginBottom: 6 }}>
                  Durată (min)
                </div>
                <input
                  className="input"
                  value={dEstimatedMinutes}
                  onChange={(e) => setDEstimatedMinutes(e.target.value)}
                />
              </div>
            </div>

            <div>
              <div className="muted" style={{ marginBottom: 6 }}>
                Serviciu
              </div>
              <input
                className="input"
                value={dServiceTitle}
                onChange={(e) => setDServiceTitle(e.target.value)}
              />
            </div>

            <div className="grid2">
              <div>
                <div className="muted" style={{ marginBottom: 6 }}>
                  Status
                </div>
                <select
                  className="select"
                  value={dStatus}
                  onChange={(e) => setDStatus(e.target.value as AppointmentStatus)}
                >
                  {Object.keys(STATUS_LABEL).map((k) => (
                    <option key={k} value={k}>
                      {STATUS_LABEL[k as AppointmentStatus]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="muted" style={{ marginBottom: 6 }}>
                  Client / vehicul
                </div>
                <div style={{ fontWeight: 900 }}>{selected.customer.name}</div>
                <div className="muted">{vehicleLabel(selected.vehicle)}</div>
              </div>
            </div>

            <div>
              <div className="muted" style={{ marginBottom: 6 }}>
                Note
              </div>
              <textarea
                className="textarea"
                value={dNotes}
                onChange={(e) => setDNotes(e.target.value)}
              />
            </div>

            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="row">
                <button className="btn" onClick={() => nav(`/jobs?fromAppointment=${selected.id}`)}>
                  Creează lucrare
                </button>
                <button className="btn" onClick={() => void onDeleteSelected()}>
                  Șterge
                </button>
              </div>

              <div className="row">
                <button className="btn" onClick={() => setOpenDetails(false)}>
                  Închide
                </button>
                <button className="btn primary" onClick={() => void onSaveDetails()} disabled={savingDetails}>
                  {savingDetails ? "Se salvează…" : "Salvează"}
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
