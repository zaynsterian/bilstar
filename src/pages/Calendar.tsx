import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import luxonPlugin from "@fullcalendar/luxon3";
import type { DateSelectArg, DatesSetArg, EventClickArg, EventDropArg } from "@fullcalendar/core";

import Modal from "../components/Modal";
import {
  AppointmentRow,
  AppointmentStatus,
  Customer,
  Vehicle,
  createAppointment,
  createCustomer,
  createVehicle,
  deleteAppointment,
  getAppointmentById,
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

function moneyRON(n: number) {
  return new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON" }).format(n);
}

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

  const target = { y, m, d, hh, mm };

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

    // Inlined in JS below
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

  return new Date(Date.UTC(y, m - 1, d, hh, mm)).toISOString();
}

function vehicleLabel(v: Vehicle | null) {
  if (!v) return "Vehicul necunoscut";
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

function customerName(c: Customer | null) {
  return c?.name || "Client necunoscut";
}

export default function CalendarPage() {
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

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
  const [estimatedMinutes, setEstimatedMinutes] = useState<string>("");
  const [estimatedPrice, setEstimatedPrice] = useState<string>("");
  const [startAtLocal, setStartAtLocal] = useState("");
  const [status, setStatus] = useState<AppointmentStatus>("new");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Quick-create Customer / Vehicle inside appointment modals
  const [openAddCustomer, setOpenAddCustomer] = useState(false);
  const [addCustomerTarget, setAddCustomerTarget] = useState<"create" | "details">("create");
  const [cName, setCName] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  const [openAddVehicle, setOpenAddVehicle] = useState(false);
  const [addVehicleTarget, setAddVehicleTarget] = useState<"create" | "details">("create");
  const [vMake, setVMake] = useState("");
  const [vModel, setVModel] = useState("");
  const [vYear, setVYear] = useState("");
  const [vPlate, setVPlate] = useState("");
  const [creatingVehicle, setCreatingVehicle] = useState(false);

  // Details modal
  const [openDetails, setOpenDetails] = useState(false);
  const [selected, setSelected] = useState<AppointmentRow | null>(null);

  const [dServiceTitle, setDServiceTitle] = useState("");
  const [dEstimatedMinutes, setDEstimatedMinutes] = useState<string>("");
  const [dEstimatedPrice, setDEstimatedPrice] = useState<string>("");
  const [dStartAtLocal, setDStartAtLocal] = useState("");
  const [dStatus, setDStatus] = useState<AppointmentStatus>("new");
  const [dNotes, setDNotes] = useState("");

  const [dCustomerId, setDCustomerId] = useState<string>("");
  const [dVehicleId, setDVehicleId] = useState<string>("");
  const [dVehicles, setDVehicles] = useState<Vehicle[]>([]);

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
        if (vehicleId && !list.some((v) => v.id === vehicleId)) setVehicleId("");
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Eroare la încărcarea vehiculelor");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  useEffect(() => {
    if (!dCustomerId) {
      setDVehicles([]);
      setDVehicleId("");
      return;
    }

    (async () => {
      try {
        const list = await listVehiclesByCustomer(dCustomerId);
        setDVehicles(list);
        if (dVehicleId && !list.some((v) => v.id === dVehicleId)) setDVehicleId("");
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Eroare la încărcarea vehiculelor");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dCustomerId]);

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
      const startIso = start.toISOString();
      const minutesForDisplay = a.estimated_minutes ?? 60;
      const end = new Date(start.getTime() + Math.max(5, minutesForDisplay) * 60_000);
      const priceSuffix = a.estimated_price != null ? ` • ~${moneyRON(a.estimated_price)}` : "";

      return {
        id: a.id,
        title: `${customerName(a.customer)} — ${a.service_title}${priceSuffix}`,
        start: startIso,
        end: end.toISOString(),
        extendedProps: { appointment: a },
      };
    });
  }, [appointments]);

  function openCreateWithStart(date: Date) {
    setCustomerId("");
    setVehicleId("");
    setServiceTitle("");
    setEstimatedMinutes("");
    setEstimatedPrice("");
    setStartAtLocal(toDatetimeLocalValueInTz(date.toISOString()));
    setStatus("new");
    setNotes("");
    setOpenCreate(true);
  }

  function parseOptionalPositiveInt(v: string): number | null {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t);
    if (!Number.isFinite(n) || n <= 0) throw new Error("Durată invalidă.");
    return Math.round(n);
  }

  function parseOptionalNonNegativeMoney(v: string): number | null {
    const t = v.trim().replace(/,/g, ".");
    if (!t) return null;
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0) throw new Error("Preț invalid.");
    return n;
  }


  function openCustomerModal(target: "create" | "details") {
    setAddCustomerTarget(target);
    setCName("");
    setCPhone("");
    setCEmail("");
    setOpenAddCustomer(true);
  }

  function openVehicleModal(target: "create" | "details") {
    setAddVehicleTarget(target);
    setVMake("");
    setVModel("");
    setVYear("");
    setVPlate("");
    setOpenAddVehicle(true);
  }

  async function onAddCustomer() {
    if (!orgId) return;
    setErr(null);
    setCreatingCustomer(true);
    try {
      const name = cName.trim();
      if (!name) throw new Error("Numele clientului este obligatoriu.");

      const created = await createCustomer({
        orgId,
        name,
        phone: cPhone.trim() || undefined,
        email: cEmail.trim() || undefined,
      });

      setCustomers((prev) => {
        const next = [...prev, created];
        next.sort((a, b) => (a.name || "").localeCompare(b.name || "", "ro"));
        return next;
      });

      if (addCustomerTarget === "create") {
        setCustomerId(created.id);
        setVehicleId("");
      } else {
        setDCustomerId(created.id);
        setDVehicleId("");
      }

      setOpenAddCustomer(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Eroare la crearea clientului");
    } finally {
      setCreatingCustomer(false);
    }
  }

  async function onAddVehicle() {
    if (!orgId) return;
    setErr(null);
    setCreatingVehicle(true);

    try {
      const targetCustomerId = addVehicleTarget === "create" ? customerId : dCustomerId;
      if (!targetCustomerId) throw new Error("Selectează un client înainte să creezi un vehicul.");

      const make = vMake.trim();
      const model = vModel.trim();
      if (!make) throw new Error("Marca este obligatorie.");
      if (!model) throw new Error("Modelul este obligatoriu.");

      const yearTrim = vYear.trim();
      const year = yearTrim ? Number(yearTrim) : undefined;
      if (yearTrim && (!Number.isFinite(year) || year < 1900 || year > 2100)) throw new Error("An invalid.");

      const created = await createVehicle({
        orgId,
        customerId: targetCustomerId,
        make,
        model,
        year: yearTrim ? Math.round(year!) : undefined,
        plate: vPlate.trim() || undefined,
      });

      if (addVehicleTarget === "create") {
        setVehicles((prev) => [...prev, created]);
        setVehicleId(created.id);
      } else {
        setDVehicles((prev) => [...prev, created]);
        setDVehicleId(created.id);
      }

      setOpenAddVehicle(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Eroare la crearea vehiculului");
    } finally {
      setCreatingVehicle(false);
    }
  }

  async function onCreate() {
    if (!orgId) return;
    setErr(null);
    setSaving(true);

    try {
      const st = serviceTitle.trim();
      if (!st) throw new Error("Serviciu obligatoriu.");

      if (!startAtLocal) throw new Error("Data/ora este obligatorie.");

      const mins = parseOptionalPositiveInt(estimatedMinutes);
      const price = parseOptionalNonNegativeMoney(estimatedPrice);

      const startAtIso = tzLocalInputToUtcIso(startAtLocal);

      await createAppointment({
        orgId,
        customerId: customerId || null,
        vehicleId: customerId ? (vehicleId || null) : null,
        serviceTitle: st,
        estimatedMinutes: mins,
        estimatedPrice: price,
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

  function hydrateDetails(appt: AppointmentRow) {
    setSelected(appt);
    setDServiceTitle(appt.service_title);
    setDEstimatedMinutes(appt.estimated_minutes != null ? String(appt.estimated_minutes) : "");
    setDEstimatedPrice(appt.estimated_price != null ? String(appt.estimated_price) : "");
    setDStartAtLocal(toDatetimeLocalValueInTz(appt.start_at));
    setDStatus(appt.status);
    setDNotes(appt.notes ?? "");

    setDCustomerId(appt.customer?.id ?? "");
    setDVehicleId(appt.vehicle?.id ?? "");
    setDVehicles([]);
  }


  // Open appointment details from other pages (query param: ?appointment=<id>)
  useEffect(() => {
    const apptId = searchParams.get("appointment");
    if (!apptId) return;

    (async () => {
      try {
        const appt = await getAppointmentById(apptId);
        hydrateDetails(appt);
        setOpenDetails(true);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Eroare la deschiderea programării");
      } finally {
        setSearchParams({}, { replace: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function onEventClick(arg: EventClickArg) {
    const appt = (arg.event.extendedProps as any)?.appointment as AppointmentRow | undefined;
    if (!appt) return;
    hydrateDetails(appt);
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

      if (!dStartAtLocal) throw new Error("Data/ora este obligatorie.");

      const mins = parseOptionalPositiveInt(dEstimatedMinutes);
      const price = parseOptionalNonNegativeMoney(dEstimatedPrice);

      const startAtIso = tzLocalInputToUtcIso(dStartAtLocal);

      await updateAppointmentSchedule(selected.id, {
        service_title: st,
        estimated_minutes: mins,
        estimated_price: price,
        start_at: startAtIso,
        notes: dNotes.trim() || null,
        customer_id: dCustomerId || null,
        vehicle_id: dCustomerId ? (dVehicleId || null) : null,
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
          <div className="muted">Calendar zi/săptămână/lună + drag &amp; drop (timezone: {TIME_ZONE})</div>
        </div>

        <div className="row">
          <button className="btn" onClick={() => void refresh()} disabled={loading || !range}>
            {loading ? "Se încarcă…" : "Refresh"}
          </button>
          <button className="btn primary" onClick={() => openCreateWithStart(new Date())} disabled={!orgId}>
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
            plugins={[luxonPlugin, dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
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
                  hydrateDetails(a);
                  setOpenDetails(true);
                }}
              >
                <div style={{ fontWeight: 900 }}>{customerName(a.customer)}</div>
                <div className="muted">
                  {fmtDateTime(a.start_at)} • {vehicleLabel(a.vehicle)}
                </div>
                <div className="muted">
                  {a.service_title}
                  {a.estimated_price != null ? ` • ~${moneyRON(a.estimated_price)}` : ""}
                </div>
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
            Tip: Poți trage programările în calendar (drag &amp; drop) sau le poți redimensiona ca să schimbi durata.
          </div>
        </div>
      </div>

      {/* Create */}
      <Modal open={openCreate} title="Programare nouă" onClose={() => setOpenCreate(false)}>
        <div style={{ display: "grid", gap: 10 }}>
          <div className="grid2">
            <div>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div className="muted">Client (opțional)</div>
                <button className="btn" style={{ padding: "6px 10px", fontWeight: 750 }} onClick={() => openCustomerModal("create")}>
                  + Client
                </button>
              </div>
              <select className="select" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">— (necunoscut) —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div className="muted">Vehicul (opțional)</div>
                <button
                  className="btn"
                  style={{ padding: "6px 10px", fontWeight: 750 }}
                  onClick={() => openVehicleModal("create")}
                  disabled={!customerId}
                  title={!customerId ? "Selectează un client înainte" : "Creează vehicul"}
                >
                  + Vehicul
                </button>
              </div>
              <select
                className="select"
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
                disabled={!customerId}
              >
                <option value="">— (necunoscut) —</option>
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
              <div className="muted" style={{ marginBottom: 6 }}>Data / ora (RO)</div>
              <input type="datetime-local" className="input" value={startAtLocal} onChange={(e) => setStartAtLocal(e.target.value)} />
            </div>
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>Durată (min) (opțional)</div>
              <input className="input" value={estimatedMinutes} onChange={(e) => setEstimatedMinutes(e.target.value)} placeholder="Ex: 90" />
            </div>
          </div>

          <div>
            <div className="muted" style={{ marginBottom: 6 }}>Serviciu</div>
            <input className="input" value={serviceTitle} onChange={(e) => setServiceTitle(e.target.value)} placeholder="Ex: Schimb distribuție" />
          </div>

          <div className="grid2">
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>Preț estimat (RON) (opțional)</div>
              <input className="input" value={estimatedPrice} onChange={(e) => setEstimatedPrice(e.target.value)} placeholder="Ex: 600" />
            </div>
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
          </div>

          <div>
            <div className="muted" style={{ marginBottom: 6 }}>Note (opțional)</div>
            <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Detalii (piese aduse, simptome, etc.)" />
          </div>

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setOpenCreate(false)}>Anulează</button>
            <button className="btn primary" onClick={() => void onCreate()} disabled={saving}>
              {saving ? "Se salvează…" : "Salvează"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Details */}
      <Modal
        open={openDetails}
        title={selected ? `Programare • ${customerName(selected.customer)}` : "Programare"}
        onClose={() => setOpenDetails(false)}
      >
        {!selected ? (
          <div className="muted">Nicio programare selectată.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <div className="grid2">
              <div>
                <div className="muted" style={{ marginBottom: 6 }}>Data / ora (RO)</div>
                <input type="datetime-local" className="input" value={dStartAtLocal} onChange={(e) => setDStartAtLocal(e.target.value)} />
              </div>
              <div>
                <div className="muted" style={{ marginBottom: 6 }}>Durată (min) (opțional)</div>
                <input className="input" value={dEstimatedMinutes} onChange={(e) => setDEstimatedMinutes(e.target.value)} placeholder="Ex: 90" />
              </div>
            </div>

            <div className="grid2">
              <div>
                <div className="muted" style={{ marginBottom: 6 }}>Preț estimat (RON) (opțional)</div>
                <input className="input" value={dEstimatedPrice} onChange={(e) => setDEstimatedPrice(e.target.value)} placeholder="Ex: 600" />
              </div>
              <div>
                <div className="muted" style={{ marginBottom: 6 }}>Status</div>
                <select className="select" value={dStatus} onChange={(e) => setDStatus(e.target.value as AppointmentStatus)}>
                  {Object.keys(STATUS_LABEL).map((k) => (
                    <option key={k} value={k}>
                      {STATUS_LABEL[k as AppointmentStatus]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <div className="muted" style={{ marginBottom: 6 }}>Serviciu</div>
              <input className="input" value={dServiceTitle} onChange={(e) => setDServiceTitle(e.target.value)} />
            </div>

            <div className="grid2">
              <div>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div className="muted">Client (opțional)</div>
                  <button className="btn" style={{ padding: "6px 10px", fontWeight: 750 }} onClick={() => openCustomerModal("details")}>
                    + Client
                  </button>
                </div>
                <select className="select" value={dCustomerId} onChange={(e) => setDCustomerId(e.target.value)}>
                  <option value="">— (necunoscut) —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div className="muted">Vehicul (opțional)</div>
                  <button
                    className="btn"
                    style={{ padding: "6px 10px", fontWeight: 750 }}
                    onClick={() => openVehicleModal("details")}
                    disabled={!dCustomerId}
                    title={!dCustomerId ? "Selectează un client înainte" : "Creează vehicul"}
                  >
                    + Vehicul
                  </button>
                </div>
                <select className="select" value={dVehicleId} onChange={(e) => setDVehicleId(e.target.value)} disabled={!dCustomerId}>
                  <option value="">— (necunoscut) —</option>
                  {dVehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {vehicleLabel(v)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <div className="muted" style={{ marginBottom: 6 }}>Note</div>
              <textarea className="textarea" value={dNotes} onChange={(e) => setDNotes(e.target.value)} />
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

      {/* Quick add: Customer */}
      <Modal open={openAddCustomer} title="Client nou" onClose={() => setOpenAddCustomer(false)}>
        <div style={{ display: "grid", gap: 10 }}>
          <div>
            <div className="muted" style={{ marginBottom: 6 }}>Nume *</div>
            <input className="input" value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Ex: Popescu Ion" />
          </div>

          <div className="grid2">
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>Telefon (opțional)</div>
              <input className="input" value={cPhone} onChange={(e) => setCPhone(e.target.value)} placeholder="Ex: 07xxxxxxxx" />
            </div>
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>Email (opțional)</div>
              <input className="input" value={cEmail} onChange={(e) => setCEmail(e.target.value)} placeholder="Ex: nume@email.com" />
            </div>
          </div>

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setOpenAddCustomer(false)} disabled={creatingCustomer}>
              Renunță
            </button>
            <button className="btn primary" onClick={() => void onAddCustomer()} disabled={creatingCustomer}>
              {creatingCustomer ? "Se creează…" : "Creează"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Quick add: Vehicle */}
      <Modal open={openAddVehicle} title="Vehicul nou" onClose={() => setOpenAddVehicle(false)}>
        <div style={{ display: "grid", gap: 10 }}>
          <div className="muted">
            Vehiculul va fi creat pentru clientul selectat.
          </div>

          <div className="grid2">
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>Marca *</div>
              <input className="input" value={vMake} onChange={(e) => setVMake(e.target.value)} placeholder="Ex: BMW" />
            </div>
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>Model *</div>
              <input className="input" value={vModel} onChange={(e) => setVModel(e.target.value)} placeholder="Ex: 320d" />
            </div>
          </div>

          <div className="grid2">
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>An (opțional)</div>
              <input className="input" value={vYear} onChange={(e) => setVYear(e.target.value)} placeholder="Ex: 2016" />
            </div>
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>Număr (opțional)</div>
              <input className="input" value={vPlate} onChange={(e) => setVPlate(e.target.value)} placeholder="Ex: B-01-ABC" />
            </div>
          </div>

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setOpenAddVehicle(false)} disabled={creatingVehicle}>
              Renunță
            </button>
            <button className="btn primary" onClick={() => void onAddVehicle()} disabled={creatingVehicle}>
              {creatingVehicle ? "Se creează…" : "Creează"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
