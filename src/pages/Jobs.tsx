import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import Modal from "../components/Modal";
import { supabase } from "../lib/supabase";
import {
  AppointmentRow,
  Customer,
  JobAttachmentRow,
  JobItemRow,
  JobItemType,
  JobProgressStatus,
  JobRow,
  Operation,
  Vehicle,
  createCustomer,
  createJob,
  createJobAttachmentRecord,
  createJobItem,
  createVehicle,
  deleteJobItem,
  deleteJobAttachmentRecord,
  getMyProfile,
  getOrgSettings,
  listAppointmentsRecent,
  listCustomers,
  listJobAttachments,
  listJobItems,
  listJobsRecent,
  listOperationsActive,
  listVehiclesByCustomer,
  updateJobMeta,
  updateJobProgress,
} from "../lib/db";

const TIME_ZONE = "Europe/Bucharest";
const ATT_BUCKET = "bilstar-job-attachments";

const PROGRESS_LABEL: Record<JobProgressStatus, string> = {
  not_started: "Neînceput",
  diagnosis: "În constatare",
  repair: "În reparație",
  final_stage: "Stagiul final",
  finished: "Finalizat",
};

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

function moneyRON(amount: number) {
  return new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON" }).format(amount);
}

function calcTotals(items: JobItemRow[], laborRatePerHour: number) {
  let labor = 0;
  let parts = 0;
  let other = 0;

  for (const it of items) {
    if (it.item_type === "labor") {
      const mins = (it.norm_minutes ?? 0) * (it.qty || 1);
      labor += (laborRatePerHour * mins) / 60;
    } else if (it.item_type === "part") {
      parts += (it.qty || 0) * (it.unit_price || 0);
    } else {
      other += (it.qty || 0) * (it.unit_price || 0);
    }
  }

  const subtotal = labor + parts + other;
  return { labor, parts, other, subtotal };
}

export default function JobsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [laborRate, setLaborRate] = useState<number>(0);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const selectedJob = useMemo(
    () => jobs.find((j) => j.id === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );

  const [items, setItems] = useState<JobItemRow[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);

  // Attachments
  const [attachments, setAttachments] = useState<JobAttachmentRow[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [signedUrlByPath, setSignedUrlByPath] = useState<Record<string, string>>({});

  const [err, setErr] = useState<string | null>(null);

  // Create Job modal
  const [openCreate, setOpenCreate] = useState(false);
  const [createMode, setCreateMode] = useState<"appointment" | "manual">("appointment");
  const [recentAppointments, setRecentAppointments] = useState<AppointmentRow[]>([]);
  const [appointmentId, setAppointmentId] = useState<string>("");

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
  const [year, setYear] = useState("");
  const [plate, setPlate] = useState("");

  const [jobNotes, setJobNotes] = useState("");

  const [creating, setCreating] = useState(false);

  // Add item modal
  const [openItem, setOpenItem] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
  const [itemType, setItemType] = useState<JobItemType>("labor");

  const [opId, setOpId] = useState<string>("");
  const [itemTitle, setItemTitle] = useState("");
  const [itemQty, setItemQty] = useState("1");
  const [itemUnitPrice, setItemUnitPrice] = useState("0");
  const [itemNormMinutes, setItemNormMinutes] = useState("0");

  const [discountValue, setDiscountValue] = useState("0");
  const [notesValue, setNotesValue] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const p = await getMyProfile();
        setOrgId(p.org_id);

        const s = await getOrgSettings();
        setLaborRate(s.labor_rate_per_hour);

        const [cust, ops] = await Promise.all([listCustomers(), listOperationsActive()]);
        setCustomers(cust);
        setOperations(ops);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Eroare la inițializare");
      }
    })();
  }, []);

  async function refreshJobs() {
    setErr(null);
    setLoadingJobs(true);
    try {
      const list = await listJobsRecent(80);
      setJobs(list);
      if (!selectedJobId && list.length) setSelectedJobId(list[0].id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Eroare la încărcarea lucrărilor");
    } finally {
      setLoadingJobs(false);
    }
  }

  useEffect(() => {
    if (!orgId) return;
    void refreshJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function loadItems(jobId: string) {
    setErr(null);
    setLoadingItems(true);
    try {
      const list = await listJobItems(jobId);
      setItems(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Eroare la încărcarea liniilor");
    } finally {
      setLoadingItems(false);
    }
  }

  async function loadAttachments(jobId: string) {
    setErr(null);
    setLoadingAttachments(true);
    try {
      const list = await listJobAttachments(jobId);
      setAttachments(list);

      // Best-effort: pre-generate signed URLs for thumbnails
      const missing = list
        .map((a) => a.storage_path)
        .filter((p) => !signedUrlByPath[p]);

      if (missing.length) {
        const pairs = await Promise.all(
          missing.slice(0, 18).map(async (path) => {
            const { data, error } = await supabase.storage
              .from(ATT_BUCKET)
              .createSignedUrl(path, 60 * 60);
            if (error || !data?.signedUrl) return [path, ""] as const;
            return [path, data.signedUrl] as const;
          }),
        );

        setSignedUrlByPath((prev) => {
          const next = { ...prev };
          for (const [p, url] of pairs) {
            if (url) next[p] = url;
          }
          return next;
        });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Eroare la încărcarea atașamentelor");
    } finally {
      setLoadingAttachments(false);
    }
  }

  useEffect(() => {
    if (!selectedJobId) return;
    void loadItems(selectedJobId);
    void loadAttachments(selectedJobId);
  }, [selectedJobId]);

  useEffect(() => {
    if (!selectedJob) return;
    setDiscountValue(String(selectedJob.discount_value ?? 0));
    setNotesValue(selectedJob.notes ?? "");
  }, [selectedJob]);

  // vehicles for create job
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

  function resetCreateModal() {
    setCreateMode("appointment");
    setRecentAppointments([]);
    setAppointmentId("");

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

    setJobNotes("");
  }

  async function openCreateModal(prefillAppointmentId?: string) {
    resetCreateModal();
    setOpenCreate(true);

    try {
      const appts = await listAppointmentsRecent(14);
      setRecentAppointments(appts);
      if (prefillAppointmentId) {
        setCreateMode("appointment");
        setAppointmentId(prefillAppointmentId);
      }
    } catch {
      // ignore
    }
  }

  // Open create-job modal from calendar (query param: ?fromAppointment=<id>)
  useEffect(() => {
    const apptId = searchParams.get("fromAppointment");
    if (!apptId) return;
    void openCreateModal(apptId);
    // clear param
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (createMode !== "appointment") return;
    if (!appointmentId) return;

    const appt = recentAppointments.find((a) => a.id === appointmentId);
    if (!appt) return;

    setCustomerMode("existing");
    setCustomerId(appt.customer.id);
    setVehicleMode("existing");
    setVehicleId(appt.vehicle.id);
  }, [appointmentId, createMode, recentAppointments]);

  async function onCreateJob() {
    if (!orgId) return;

    setErr(null);
    setCreating(true);

    try {
      let finalCustomerId = customerId;

      if (createMode === "appointment") {
        if (!appointmentId) throw new Error("Selectează o programare.");
        // customerId/vehicleId vin din programare
        if (!finalCustomerId) throw new Error("Client lipsă.");
      } else {
        // manual: poate fi client nou
        if (customerMode === "new") {
          if (!customerName.trim()) throw new Error("Nume client obligatoriu.");
          const c = await createCustomer({
            orgId,
            name: customerName.trim(),
            phone: customerPhone,
            email: customerEmail,
          });
          finalCustomerId = c.id;
          setCustomers(await listCustomers());
        } else {
          if (!finalCustomerId) throw new Error("Selectează un client.");
        }
      }

      let finalVehicleId = vehicleId;

      if (createMode === "appointment") {
        if (!finalVehicleId) throw new Error("Vehicul lipsă.");
      } else {
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
      }

      const newJobId = await createJob({
        orgId,
        appointmentId: createMode === "appointment" ? appointmentId : null,
        customerId: finalCustomerId,
        vehicleId: finalVehicleId,
        notes: jobNotes,
      });

      setOpenCreate(false);
      await refreshJobs();
      setSelectedJobId(newJobId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Eroare la creare lucrare");
    } finally {
      setCreating(false);
    }
  }

  async function onChangeProgress(next: JobProgressStatus) {
    if (!selectedJob) return;
    setErr(null);
    try {
      await updateJobProgress(selectedJob.id, next);
      await refreshJobs();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Eroare la schimbare status");
    }
  }

  async function onSaveMeta() {
    if (!selectedJob) return;

    setErr(null);
    try {
      const d = Number(discountValue);
      if (!Number.isFinite(d) || d < 0) throw new Error("Discount invalid.");
      await updateJobMeta(selectedJob.id, { discount_value: d, notes: notesValue.trim() || null });
      await refreshJobs();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Eroare la salvare");
    }
  }

  function resetItemModal() {
    setItemType("labor");
    setOpId("");
    setItemTitle("");
    setItemQty("1");
    setItemUnitPrice("0");
    setItemNormMinutes("0");
  }

  function openAddItem() {
    resetItemModal();
    setOpenItem(true);
  }

  useEffect(() => {
    if (itemType !== "labor") return;
    if (!opId) return;

    const op = operations.find((o) => o.id === opId);
    if (!op) return;

    setItemTitle(op.name);
    setItemNormMinutes(String(op.norm_minutes ?? 0));
    setItemQty("1");
    setItemUnitPrice("0");
  }, [opId, itemType, operations]);

  async function onSaveItem() {
    if (!orgId) return;
    if (!selectedJob) return;

    setErr(null);
    setSavingItem(true);

    try {
      const q = Number(itemQty);
      if (!Number.isFinite(q) || q <= 0) throw new Error("Cantitate invalidă.");

      if (itemType === "labor") {
        if (!opId) throw new Error("Selectează o operațiune.");
        const mins = Number(itemNormMinutes);
        if (!Number.isFinite(mins) || mins < 0) throw new Error("Minute invalide.");

        await createJobItem({
          orgId,
          jobId: selectedJob.id,
          itemType: "labor",
          title: itemTitle.trim() || "Manoperă",
          qty: q,
          unitPrice: 0,
          operationId: opId,
          normMinutes: mins,
        });
      } else {
        const price = Number(itemUnitPrice);
        if (!Number.isFinite(price) || price < 0) throw new Error("Preț invalid.");
        if (!itemTitle.trim()) throw new Error("Denumirea este obligatorie.");

        await createJobItem({
          orgId,
          jobId: selectedJob.id,
          itemType,
          title: itemTitle.trim(),
          qty: q,
          unitPrice: price,
          operationId: null,
          normMinutes: null,
        });
      }

      setOpenItem(false);
      await loadItems(selectedJob.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Eroare la adăugare linie");
    } finally {
      setSavingItem(false);
    }
  }

  async function onDeleteItem(itemId: string) {
    if (!selectedJob) return;
    setErr(null);
    try {
      await deleteJobItem(itemId);
      await loadItems(selectedJob.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Eroare la ștergere linie");
    }
  }

  const totals = useMemo(() => calcTotals(items, laborRate), [items, laborRate]);
  const discountNum = selectedJob ? (selectedJob.discount_value ?? 0) : 0;
  const grand = Math.max(0, totals.subtotal - discountNum);

  async function onExportPdf() {
    if (!selectedJob) return;

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const marginX = 40;
    let y = 40;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Bilstar Service - Deviz", marginX, y);
    y += 18;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(`Client: ${selectedJob.customer.name}`, marginX, y);
    y += 14;
    doc.text(`Vehicul: ${vehicleLabel(selectedJob.vehicle)}`, marginX, y);
    y += 14;
    doc.text(`Stadiu: ${PROGRESS_LABEL[selectedJob.progress]}`, marginX, y);
    y += 14;
    doc.text(`Data: ${fmtDateTime(selectedJob.created_at)}`, marginX, y);
    y += 12;

    const body = items.map((it, idx) => {
      const subtotal =
        it.item_type === "labor"
          ? (laborRate * ((it.norm_minutes ?? 0) * (it.qty || 1))) / 60
          : (it.qty || 0) * (it.unit_price || 0);

      return [
        String(idx + 1),
        it.item_type === "labor" ? "Manoperă" : it.item_type === "parts" ? "Piese" : "Altele",
        it.title,
        String(it.qty ?? 0),
        it.item_type === "labor" ? `${it.norm_minutes ?? 0} min/op` : moneyRON(it.unit_price ?? 0),
        moneyRON(subtotal),
      ];
    });

    (autoTable as any)(doc, {
      startY: y + 10,
      head: [["#", "Tip", "Denumire", "Qty", "Preț", "Subtotal"]],
      body,
      styles: { font: "helvetica", fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [15, 23, 42] },
      margin: { left: marginX, right: marginX },
    });

    const lastY = (doc as any).lastAutoTable?.finalY ?? (y + 10);
    let y2 = lastY + 18;
    const discount = selectedJob.discount_value ?? 0;
    const grandTotal = Math.max(0, totals.subtotal - discount);

    doc.setFont("helvetica", "bold");
    doc.text(`Manoperă: ${moneyRON(totals.labor)}`, marginX, y2);
    y2 += 14;
    doc.text(`Piese: ${moneyRON(totals.parts)}`, marginX, y2);
    y2 += 14;
    doc.text(`Altele: ${moneyRON(totals.other)}`, marginX, y2);
    y2 += 14;
    doc.text(`Subtotal: ${moneyRON(totals.subtotal)}`, marginX, y2);
    y2 += 14;
    doc.text(`Discount: -${moneyRON(discount)}`, marginX, y2);
    y2 += 18;
    doc.setFontSize(13);
    doc.text(`TOTAL: ${moneyRON(grandTotal)}`, marginX, y2);

    if ((selectedJob.notes ?? "").trim()) {
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      y2 += 22;
      doc.text("Note:", marginX, y2);
      y2 += 12;
      const noteLines = doc.splitTextToSize(String(selectedJob.notes), 515);
      doc.text(noteLines, marginX, y2);
    }

    const safeName = selectedJob.customer.name
      .replace(/[^a-zA-Z0-9_\- ]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 40);

    doc.save(`bilstar_deviz_${safeName || "client"}_${selectedJob.id.slice(0, 6)}.pdf`);
  }

  async function onUploadAttachments(fileList: FileList | null) {
    if (!orgId || !selectedJob) return;
    const files = Array.from(fileList ?? []);
    if (!files.length) return;

    setErr(null);
    setUploadingAttachments(true);

    try {
      for (const file of files) {
        const extRaw = (file.name.split(".").pop() || "bin").toLowerCase();
        const ext = /^[a-z0-9]{1,5}$/.test(extRaw) ? extRaw : "bin";
        const path = `${orgId}/${selectedJob.id}/${crypto.randomUUID()}.${ext}`;

        const { error: upErr } = await supabase.storage.from(ATT_BUCKET).upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || undefined,
        });

        if (upErr) throw upErr;
        await createJobAttachmentRecord({ orgId, jobId: selectedJob.id, storagePath: path });
      }

      await loadAttachments(selectedJob.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Eroare la upload atașamente");
    } finally {
      setUploadingAttachments(false);
    }
  }

  async function onDeleteAttachment(attachmentId: string) {
    if (!selectedJob) return;
    setErr(null);
    try {
      const row = await deleteJobAttachmentRecord(attachmentId);
      // best-effort: remove file
      await supabase.storage.from(ATT_BUCKET).remove([row.storage_path]);
      await loadAttachments(selectedJob.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Eroare la ștergere atașament");
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="h1">Lucrări</div>
          <div className="muted">Work progress + deviz (manoperă/piese/discount)</div>
        </div>

        <div className="row">
          <button className="btn" onClick={() => void refreshJobs()}>
            Refresh
          </button>
          <button className="btn primary" onClick={() => void openCreateModal()}>
            + Lucrare
          </button>
        </div>
      </div>

      {err && (
        <div className="card card-pad" style={{ borderColor: "rgba(220,38,38,0.35)", marginBottom: 12 }}>
          <div style={{ color: "crimson", fontWeight: 900 }}>{err}</div>
        </div>
      )}

      <div className="grid2">
        {/* Left: jobs list */}
        <div className="card card-pad">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontWeight: 950 }}>Lista lucrărilor</div>
            <div className="muted">{loadingJobs ? "Se încarcă…" : `${jobs.length} lucrări`}</div>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {jobs.map((j) => (
              <button
                key={j.id}
                className={`btn ${j.id === selectedJobId ? "primary" : ""}`}
                style={{ width: "100%", justifyContent: "space-between", display: "flex" }}
                onClick={() => setSelectedJobId(j.id)}
              >
                <span style={{ textAlign: "left" }}>
                  <div style={{ fontWeight: 900 }}>{j.customer.name}</div>
                  <div className="muted">
                    {vehicleLabel(j.vehicle)} • {fmtDateTime(j.created_at)}
                  </div>
                </span>
                <span className="badge">{PROGRESS_LABEL[j.progress]}</span>
              </button>
            ))}

            {!loadingJobs && jobs.length === 0 && (
              <div className="muted">Nu există lucrări. Creează una din “+ Lucrare”.</div>
            )}
          </div>
        </div>

        {/* Right: job details */}
        <div className="card card-pad">
          {!selectedJob ? (
            <div className="muted">Selectează o lucrare din stânga.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 950, fontSize: 16 }}>{selectedJob.customer.name}</div>
                  <div className="muted">{vehicleLabel(selectedJob.vehicle)}</div>
                </div>

                <div className="row">
                  <select
                    className="select"
                    style={{ width: 190 }}
                    value={selectedJob.progress}
                    onChange={(e) => void onChangeProgress(e.target.value as JobProgressStatus)}
                  >
                    {(Object.keys(PROGRESS_LABEL) as JobProgressStatus[]).map((k) => (
                      <option key={k} value={k}>
                        {PROGRESS_LABEL[k]}
                      </option>
                    ))}
                  </select>

                  <button className="btn primary" onClick={openAddItem}>
                    + Linie
                  </button>
                </div>
              </div>

              <div className="grid2">
                <div>
                  <div className="muted" style={{ marginBottom: 6 }}>Discount (RON)</div>
                  <input className="input" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} />
                </div>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button className="btn" onClick={() => void onSaveMeta()}>
                    Salvează (discount + note)
                  </button>
                </div>
              </div>

              <div>
                <div className="muted" style={{ marginBottom: 6 }}>Note</div>
                <textarea
                  className="textarea"
                  value={notesValue}
                  onChange={(e) => setNotesValue(e.target.value)}
                />
              </div>

              <div className="card card-pad" style={{ boxShadow: "none" }}>
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                  <div className="row" style={{ gap: 10 }}>
                    <div style={{ fontWeight: 950 }}>Deviz</div>
                    <button
                      className="btn"
                      onClick={() => void onExportPdf()}
                      disabled={!selectedJob || loadingItems}
                      title="Exportă devizul ca PDF"
                    >
                      Export PDF
                    </button>
                  </div>
                  <div className="muted">{loadingItems ? "Se încarcă…" : `${items.length} linii`}</div>
                </div>

                <table className="table">
                  <thead>
                    <tr>
                      <th>Tip</th>
                      <th>Denumire</th>
                      <th>Qty</th>
                      <th>Preț / unitate</th>
                      <th>Subtotal</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => {
                      const subtotal =
                        it.item_type === "labor"
                          ? (laborRate * ((it.norm_minutes ?? 0) * (it.qty || 1))) / 60
                          : (it.qty || 0) * (it.unit_price || 0);

                      return (
                        <tr key={it.id}>
                          <td><span className="badge">{it.item_type}</span></td>
                          <td style={{ fontWeight: 850 }}>
                            {it.title}
                            {it.item_type === "labor" && (
                              <div className="muted">{it.norm_minutes ?? 0} min/op</div>
                            )}
                          </td>
                          <td>{it.qty}</td>
                          <td>{it.item_type === "labor" ? "—" : moneyRON(it.unit_price)}</td>
                          <td style={{ fontWeight: 950 }}>{moneyRON(subtotal)}</td>
                          <td>
                            <button className="btn" onClick={() => void onDeleteItem(it.id)}>
                              Șterge
                            </button>
                          </td>
                        </tr>
                      );
                    })}

                    {!loadingItems && items.length === 0 && (
                      <tr>
                        <td colSpan={6} className="muted">
                          Nicio linie. Apasă “+ Linie” și adaugă manoperă/piese.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

                <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="muted">Manoperă</span>
                    <b>{moneyRON(totals.labor)}</b>
                  </div>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="muted">Piese</span>
                    <b>{moneyRON(totals.parts)}</b>
                  </div>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="muted">Altele</span>
                    <b>{moneyRON(totals.other)}</b>
                  </div>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="muted">Subtotal</span>
                    <b>{moneyRON(totals.subtotal)}</b>
                  </div>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="muted">Discount</span>
                    <b>-{moneyRON(discountNum)}</b>
                  </div>
                  <div className="row" style={{ justifyContent: "space-between", fontSize: 16 }}>
                    <span style={{ fontWeight: 950 }}>TOTAL</span>
                    <span style={{ fontWeight: 950 }}>{moneyRON(grand)}</span>
                  </div>
                </div>
              </div>

              <div className="card card-pad" style={{ boxShadow: "none" }}>
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontWeight: 950 }}>Atașamente</div>
                  <div className="row" style={{ gap: 8 }}>
                    <label className={`btn ${uploadingAttachments ? "primary" : ""}`} style={{ cursor: uploadingAttachments ? "not-allowed" : "pointer" }}>
                      {uploadingAttachments ? "Se urcă…" : "+ Poze"}
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        style={{ display: "none" }}
                        disabled={uploadingAttachments}
                        onChange={(e) => void onUploadAttachments(e.target.files)}
                      />
                    </label>
                    <div className="muted">{loadingAttachments ? "Se încarcă…" : `${attachments.length} fișiere`}</div>
                  </div>
                </div>

                {attachments.length === 0 ? (
                  <div className="muted">Încarcă poze înainte/după, note, etc.</div>
                ) : (
                  <div className="attachments-grid">
                    {attachments.map((a) => {
                      const url = signedUrlByPath[a.storage_path];
                      return (
                        <div key={a.id} className="attachment-card">
                          {url ? (
                            <a href={url} target="_blank" rel="noreferrer">
                              <img src={url} alt="attachment" />
                            </a>
                          ) : (
                            <div className="muted" style={{ padding: 8 }}>Previzualizare indisponibilă</div>
                          )}

                          <div className="row" style={{ justifyContent: "space-between" }}>
                            <span className="muted" style={{ fontSize: 12 }}>{fmtDateTime(a.created_at)}</span>
                            <button className="btn" onClick={() => void onDeleteAttachment(a.id)}>
                              Șterge
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      </div>

      {/* Create Job modal */}
      <Modal open={openCreate} title="Lucrare nouă" onClose={() => setOpenCreate(false)}>
        <div style={{ display: "grid", gap: 10 }}>
          <div className="row">
            <button
              className={`btn ${createMode === "appointment" ? "primary" : ""}`}
              type="button"
              onClick={() => setCreateMode("appointment")}
            >
              Din programare
            </button>
            <button
              className={`btn ${createMode === "manual" ? "primary" : ""}`}
              type="button"
              onClick={() => setCreateMode("manual")}
            >
              Manual
            </button>
          </div>

          {createMode === "appointment" ? (
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>Alege programare (ultimele 14 zile)</div>
              <select className="select" value={appointmentId} onChange={(e) => setAppointmentId(e.target.value)}>
                <option value="">Selectează…</option>
                {recentAppointments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {fmtDateTime(a.start_at)} — {a.customer.name} — {a.service_title}
                  </option>
                ))}
              </select>
              <div className="muted" style={{ marginTop: 6 }}>
                Clientul și vehiculul se preiau automat din programare.
              </div>
            </div>
          ) : (
            <div className="grid2">
              <div>
                <div className="muted" style={{ marginBottom: 6 }}>Client</div>
                <div className="row" style={{ marginBottom: 8 }}>
                  <button className={`btn ${customerMode === "existing" ? "primary" : ""}`} type="button" onClick={() => setCustomerMode("existing")}>
                    Existent
                  </button>
                  <button className={`btn ${customerMode === "new" ? "primary" : ""}`} type="button" onClick={() => setCustomerMode("new")}>
                    Nou
                  </button>
                </div>

                {customerMode === "existing" ? (
                  <select className="select" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
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
                    <input className="input" placeholder="Marca" value={make} onChange={(e) => setMake(e.target.value)} />
                    <input className="input" placeholder="Model" value={model} onChange={(e) => setModel(e.target.value)} />
                    <input className="input" placeholder="An" value={year} onChange={(e) => setYear(e.target.value)} />
                    <input className="input" placeholder="Număr" value={plate} onChange={(e) => setPlate(e.target.value)} />
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <div className="muted" style={{ marginBottom: 6 }}>Note (opțional)</div>
            <textarea className="textarea" value={jobNotes} onChange={(e) => setJobNotes(e.target.value)} />
          </div>

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn primary" disabled={creating} onClick={() => void onCreateJob()}>
              {creating ? "Creez…" : "Creează lucrare"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Add Item modal */}
      <Modal open={openItem} title="Adaugă linie" onClose={() => setOpenItem(false)}>
        <div style={{ display: "grid", gap: 10 }}>
          <div className="grid2">
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>Tip</div>
              <select className="select" value={itemType} onChange={(e) => setItemType(e.target.value as JobItemType)}>
                <option value="labor">Manoperă</option>
                <option value="part">Piesă</option>
                <option value="other">Altceva</option>
              </select>
            </div>

            <div>
              <div className="muted" style={{ marginBottom: 6 }}>Cantitate</div>
              <input className="input" value={itemQty} onChange={(e) => setItemQty(e.target.value)} />
            </div>
          </div>

          {itemType === "labor" ? (
            <>
              <div>
                <div className="muted" style={{ marginBottom: 6 }}>Operațiune (din normativ)</div>
                <select className="select" value={opId} onChange={(e) => setOpId(e.target.value)}>
                  <option value="">Selectează…</option>
                  {operations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {(o.code ? `${o.code} — ` : "") + o.name} ({o.norm_minutes} min)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid2">
                <div>
                  <div className="muted" style={{ marginBottom: 6 }}>Denumire</div>
                  <input className="input" value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} />
                </div>
                <div>
                  <div className="muted" style={{ marginBottom: 6 }}>Minute (per operațiune)</div>
                  <input className="input" value={itemNormMinutes} onChange={(e) => setItemNormMinutes(e.target.value)} />
                </div>
              </div>

              <div className="muted">
                Costul manoperei se calculează automat după tarif: <b>{moneyRON(laborRate)}</b> / oră.
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="muted" style={{ marginBottom: 6 }}>Denumire</div>
                <input className="input" value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} />
              </div>

              <div>
                <div className="muted" style={{ marginBottom: 6 }}>Preț / unitate (RON)</div>
                <input className="input" value={itemUnitPrice} onChange={(e) => setItemUnitPrice(e.target.value)} />
              </div>
            </>
          )}

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn primary" disabled={savingItem} onClick={() => void onSaveItem()}>
              {savingItem ? "Salvez…" : "Adaugă"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
