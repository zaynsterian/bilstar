import { supabase } from "./supabase";
import type { PostgrestError } from "@supabase/supabase-js";

export type UserRole = "admin" | "staff";

export type Profile = {
  org_id: string;
  role: UserRole;
  display_name: string | null;
};

export type OrgSettings = {
  labor_rate_per_hour: number; // RON / ora
  currency: string; // "RON"
};

export type Customer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
};

export type Vehicle = {
  id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  plate: string | null;
};

export type AppointmentStatus =
  | "new"
  | "confirmed"
  | "in_progress"
  | "done"
  | "cancelled"
  | "no_show";

export type AppointmentRow = {
  id: string;
  service_title: string;
  estimated_minutes: number | null;
  estimated_price: number | null;
  start_at: string;
  status: AppointmentStatus;
  notes: string | null;
  customer: Customer | null;
  vehicle: Vehicle | null;
};

export type Operation = {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  norm_minutes: number;
  is_active: boolean;
};

export type JobProgressStatus =
  | "not_started"
  | "diagnosis"
  | "repair"
  | "final_stage"
  | "finished";

export type JobRow = {
  id: string;
  appointment_id: string | null;
  progress: JobProgressStatus;
  discount_value: number;
  notes: string | null;
  created_at: string;
  customer: Customer;
  vehicle: Vehicle;
};

export type JobItemType = "labor" | "part" | "other";

export type JobItemRow = {
  id: string;
  item_type: JobItemType;
  title: string;
  qty: number;
  unit_price: number;
  operation_id: string | null;
  norm_minutes: number | null;
  created_at: string;
  operation?: Pick<Operation, "id" | "code" | "name" | "category" | "norm_minutes"> | null;
};

export type JobAttachmentRow = {
  id: string;
  job_id: string;
  org_id: string;
  storage_path: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

export type ReportJobRow = {
  id: string;
  created_at: string;
  discount_value: number;
  customer: Customer;
  vehicle: Vehicle;
  items: Array<{
    id: string;
    item_type: JobItemType;
    title: string;
    qty: unknown;
    unit_price: unknown;
    norm_minutes: number | null;
    operation_id: string | null;
  }>;
};

function throwIfError(error: PostgrestError | null) {
  if (error) throw new Error(error.message);
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

async function getMyUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error(error.message);
  const uid = data.user?.id;
  if (!uid) throw new Error("Not authenticated");
  return uid;
}

/**
 * IMPORTANT FIX:
 * Supabase embedded relations sometimes come back as:
 *  - object: { ... }
 *  - array:  [{ ... }]
 * Depending on how inference happens in TS / select aliases.
 * We normalize to "single object".
 */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function oneRequired<T>(value: T | T[] | null | undefined, label: string): T {
  const v = one<T>(value);
  if (!v) throw new Error(`Missing embedded relation: ${label}`);
  return v;
}

function toAppointmentRow(r: any): AppointmentRow {
  const customer = one<Customer>(r.customer);
  const vehicle = one<Vehicle>(r.vehicle);

  return {
    id: String(r.id),
    service_title: String(r.service_title ?? ""),
    estimated_minutes: r.estimated_minutes == null ? null : toNumber(r.estimated_minutes),
    estimated_price: r.estimated_price == null ? null : toNumber(r.estimated_price),
    start_at: String(r.start_at),
    status: r.status as AppointmentStatus,
    notes: (r.notes ?? null) as string | null,
    customer,
    vehicle,
  };
}

/** ================= PROFILE / SETTINGS ================= */

export async function getMyProfile(): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .select("org_id, role, display_name")
    .single();

  throwIfError(error);
  if (!data) throw new Error("Profile not found");
  return data as Profile;
}

export async function updateMyDisplayName(displayName: string): Promise<void> {
  const uid = await getMyUserId();

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: displayName.trim() || null })
    .eq("user_id", uid);

  throwIfError(error);
}

export async function getOrgSettings(): Promise<OrgSettings> {
  const { data, error } = await supabase
    .from("org_settings")
    .select("labor_rate_per_hour, currency")
    .maybeSingle();

  throwIfError(error);

  if (!data) {
    return { labor_rate_per_hour: 0, currency: "RON" };
  }

  return {
    labor_rate_per_hour: toNumber((data as any).labor_rate_per_hour),
    currency: ((data as any).currency as string) || "RON",
  };
}

export async function upsertOrgSettings(input: {
  orgId: string;
  laborRatePerHour: number;
  currency: string;
}): Promise<void> {
  const { error } = await supabase.from("org_settings").upsert(
    {
      org_id: input.orgId,
      labor_rate_per_hour: input.laborRatePerHour,
      currency: input.currency,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id" },
  );

  throwIfError(error);
}

/** ================= CUSTOMERS / VEHICLES ================= */

export async function listCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase
    .from("customers")
    .select("id, name, phone, email")
    .order("name", { ascending: true });

  throwIfError(error);
  return (data ?? []) as Customer[];
}

export async function listVehiclesByCustomer(customerId: string): Promise<Vehicle[]> {
  const { data, error } = await supabase
    .from("vehicles")
    .select("id, make, model, year, plate")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  throwIfError(error);
  return (data ?? []) as Vehicle[];
}

export async function createCustomer(input: {
  orgId: string;
  name: string;
  phone?: string;
  email?: string;
}): Promise<Customer> {
  const { data, error } = await supabase
    .from("customers")
    .insert({
      org_id: input.orgId,
      name: input.name,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
    })
    .select("id, name, phone, email")
    .single();

  throwIfError(error);
  if (!data) throw new Error("Failed to create customer");
  return data as Customer;
}

export async function createVehicle(input: {
  orgId: string;
  customerId: string;
  make?: string;
  model?: string;
  year?: number;
  plate?: string;
}): Promise<Vehicle> {
  const { data, error } = await supabase
    .from("vehicles")
    .insert({
      org_id: input.orgId,
      customer_id: input.customerId,
      make: input.make?.trim() || null,
      model: input.model?.trim() || null,
      year: input.year ?? null,
      plate: input.plate?.trim() || null,
    })
    .select("id, make, model, year, plate")
    .single();

  throwIfError(error);
  if (!data) throw new Error("Failed to create vehicle");
  return data as Vehicle;
}

/** ================= APPOINTMENTS ================= */

export async function listAppointmentsBetween(
  startIso: string,
  endIso: string,
): Promise<AppointmentRow[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select(
      "id, service_title, estimated_minutes, estimated_price, start_at, status, notes, customer:customers(id, name, phone, email), vehicle:vehicles(id, make, model, year, plate)",
    )
    .gte("start_at", startIso)
    .lt("start_at", endIso)
    .order("start_at", { ascending: true });

  throwIfError(error);

  // Normalize embedded customer/vehicle regardless of object vs array
  const rows = (data ?? []) as any[];
  return rows.map(toAppointmentRow);
}

export async function listAppointmentsRecent(daysBack: number): Promise<AppointmentRow[]> {
  const start = new Date();
  start.setDate(start.getDate() - Math.max(1, daysBack));
  const startIso = start.toISOString();

  const { data, error } = await supabase
    .from("appointments")
    .select(
      "id, service_title, estimated_minutes, estimated_price, start_at, status, notes, customer:customers(id, name, phone, email), vehicle:vehicles(id, make, model, year, plate)",
    )
    .gte("start_at", startIso)
    .order("start_at", { ascending: false });

  throwIfError(error);

  const rows = (data ?? []) as any[];
  return rows.map(toAppointmentRow);
}

export async function createAppointment(input: {
  orgId: string;
  customerId?: string | null;
  vehicleId?: string | null;
  serviceTitle: string;
  estimatedMinutes?: number | null;
  estimatedPrice?: number | null;
  startAtIso: string;
  status: AppointmentStatus;
  notes?: string;
}): Promise<void> {
  const { error } = await supabase.from("appointments").insert({
    org_id: input.orgId,
    customer_id: input.customerId ?? null,
    vehicle_id: input.vehicleId ?? null,
    service_title: input.serviceTitle,
    estimated_minutes: input.estimatedMinutes ?? null,
    estimated_price: input.estimatedPrice ?? null,
    start_at: input.startAtIso,
    status: input.status,
    notes: input.notes?.trim() || null,
  });

  throwIfError(error);
}

export async function updateAppointmentStatus(
  appointmentId: string,
  status: AppointmentStatus,
): Promise<void> {
  const { error } = await supabase
    .from("appointments")
    .update({ status })
    .eq("id", appointmentId);

  throwIfError(error);
}

export async function updateAppointmentSchedule(
  appointmentId: string,
  patch: {
    start_at?: string;
    estimated_minutes?: number | null;
    estimated_price?: number | null;
    service_title?: string;
    notes?: string | null;
    customer_id?: string | null;
    vehicle_id?: string | null;
  },
): Promise<void> {
  const { error } = await supabase
    .from("appointments")
    .update(patch)
    .eq("id", appointmentId);

  throwIfError(error);
}

export async function deleteAppointment(appointmentId: string): Promise<void> {
  const { error } = await supabase.from("appointments").delete().eq("id", appointmentId);
  throwIfError(error);
}

/** ================= NORMATIVE (OPERATIONS) ================= */

export async function listOperations(input?: {
  query?: string;
  includeInactive?: boolean;
}): Promise<Operation[]> {
  const q = (input?.query ?? "").trim();
  const includeInactive = Boolean(input?.includeInactive);

  let req = supabase
    .from("operations")
    .select("id, code, name, category, norm_minutes, is_active")
    .order("created_at", { ascending: false });

  if (!includeInactive) req = req.eq("is_active", true);

  if (q) {
    const like = `%${q}%`;
    req = req.or(`name.ilike.${like},code.ilike.${like},category.ilike.${like}`);
  }

  const { data, error } = await req;
  throwIfError(error);

  return (data ?? []) as Operation[];
}

export async function listOperationsActive(): Promise<Operation[]> {
  const { data, error } = await supabase
    .from("operations")
    .select("id, code, name, category, norm_minutes, is_active")
    .eq("is_active", true)
    .order("name", { ascending: true });

  throwIfError(error);
  return (data ?? []) as Operation[];
}

export async function createOperation(input: {
  orgId: string;
  code?: string;
  name: string;
  category?: string;
  normMinutes: number;
  isActive?: boolean;
}): Promise<void> {
  const { error } = await supabase.from("operations").insert({
    org_id: input.orgId,
    code: input.code?.trim() || null,
    name: input.name.trim(),
    category: input.category?.trim() || null,
    norm_minutes: input.normMinutes,
    is_active: input.isActive ?? true,
  });

  throwIfError(error);
}

export async function updateOperation(
  opId: string,
  patch: Partial<{
    code: string | null;
    name: string;
    category: string | null;
    norm_minutes: number;
    is_active: boolean;
  }>,
): Promise<void> {
  const { error } = await supabase.from("operations").update(patch).eq("id", opId);
  throwIfError(error);
}

export async function upsertOperationsBulk(input: {
  orgId: string;
  rows: Array<{
    code?: string | null;
    name: string;
    category?: string | null;
    norm_minutes: number;
    is_active?: boolean;
  }>;
  chunkSize?: number;
}): Promise<{ upserted: number }>{
  const chunkSize = Math.max(50, Math.min(1000, input.chunkSize ?? 500));

  const cleaned = input.rows
    .map((r) => ({
      org_id: input.orgId,
      code: (r.code ?? null) ? String(r.code).trim() || null : null,
      name: String(r.name ?? "").trim(),
      category: (r.category ?? null) ? String(r.category).trim() || null : null,
      norm_minutes: Math.max(0, Math.floor(toNumber(r.norm_minutes))),
      is_active: r.is_active ?? true,
    }))
    .filter((r) => r.name.length > 0);

  let total = 0;

  for (let i = 0; i < cleaned.length; i += chunkSize) {
    const chunk = cleaned.slice(i, i + chunkSize);
    const { error } = await supabase
      .from("operations")
      .upsert(chunk, { onConflict: "org_id,code" });
    throwIfError(error);
    total += chunk.length;
  }

  return { upserted: total };
}

/** ================= JOBS (WORK PROGRESS) ================= */

export async function listJobsRecent(limit = 50): Promise<JobRow[]> {
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id, appointment_id, progress, discount_value, notes, created_at, customer:customers(id, name, phone, email), vehicle:vehicles(id, make, model, year, plate)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  throwIfError(error);

  const rows = (data ?? []) as any[];
  return rows.map((r) => {
    const customer = oneRequired<Customer>(r.customer, "customer");
    const vehicle = oneRequired<Vehicle>(r.vehicle, "vehicle");

    return {
      id: String(r.id),
      appointment_id: (r.appointment_id as string | null) ?? null,
      progress: r.progress as JobProgressStatus,
      discount_value: toNumber(r.discount_value),
      notes: (r.notes as string | null) ?? null,
      created_at: String(r.created_at),
      customer,
      vehicle,
    };
  });
}

export async function createJob(input: {
  orgId: string;
  appointmentId?: string | null;
  customerId: string;
  vehicleId: string;
  notes?: string;
}): Promise<string> {
  const { data, error } = await supabase
    .from("jobs")
    .insert({
      org_id: input.orgId,
      appointment_id: input.appointmentId ?? null,
      customer_id: input.customerId,
      vehicle_id: input.vehicleId,
      progress: "not_started",
      discount_value: 0,
      notes: input.notes?.trim() || null,
    })
    .select("id")
    .single();

  throwIfError(error);
  if (!data) throw new Error("Failed to create job");
  return (data as any).id as string;
}

export async function updateJobMeta(
  jobId: string,
  patch: Partial<{
    discount_value: number;
    notes: string | null;
  }>,
): Promise<void> {
  const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
  throwIfError(error);
}

export async function updateJobProgress(jobId: string, next: JobProgressStatus): Promise<void> {
  const { data: cur, error: curErr } = await supabase
    .from("jobs")
    .select("org_id, progress")
    .eq("id", jobId)
    .single();

  throwIfError(curErr);
  if (!cur) throw new Error("Job not found");

  const fromStatus = (cur as any).progress as JobProgressStatus;
  const orgId = (cur as any).org_id as string;

  const { error: upErr } = await supabase.from("jobs").update({ progress: next }).eq("id", jobId);
  throwIfError(upErr);

  // history insert (best-effort)
  const uid = await getMyUserId().catch(() => null);

  const { error: histErr } = await supabase.from("job_status_history").insert({
    org_id: orgId,
    job_id: jobId,
    from_status: fromStatus,
    to_status: next,
    changed_by: uid,
  });

  throwIfError(histErr);
}

export async function listJobItems(jobId: string): Promise<JobItemRow[]> {
  const { data, error } = await supabase
    .from("job_items")
    .select(
      "id, item_type, title, qty, unit_price, operation_id, norm_minutes, created_at, operation:operations(id, code, name, category, norm_minutes)",
    )
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });

  throwIfError(error);

  const rows = (data ?? []) as any[];
  return rows.map((r) => ({
    id: String(r.id),
    item_type: r.item_type as JobItemType,
    title: String(r.title),
    qty: toNumber(r.qty),
    unit_price: toNumber(r.unit_price),
    operation_id: (r.operation_id as string | null) ?? null,
    norm_minutes: (r.norm_minutes as number | null) ?? null,
    created_at: String(r.created_at),
    operation: one<Pick<Operation, "id" | "code" | "name" | "category" | "norm_minutes">>((r.operation as any) ?? null),
  }));
}

export async function createJobItem(input: {
  orgId: string;
  jobId: string;
  itemType: JobItemType;
  title: string;
  qty: number;
  unitPrice: number;
  operationId?: string | null;
  normMinutes?: number | null;
}): Promise<void> {
  const { error } = await supabase.from("job_items").insert({
    org_id: input.orgId,
    job_id: input.jobId,
    item_type: input.itemType,
    title: input.title.trim(),
    qty: input.qty,
    unit_price: input.unitPrice,
    operation_id: input.operationId ?? null,
    norm_minutes: input.normMinutes ?? null,
  });

  throwIfError(error);
}

export async function deleteJobItem(itemId: string): Promise<void> {
  const { error } = await supabase.from("job_items").delete().eq("id", itemId);
  throwIfError(error);
}

/** ================= JOB ATTACHMENTS ================= */

export async function listJobAttachments(jobId: string): Promise<JobAttachmentRow[]> {
  const { data, error } = await supabase
    .from("job_attachments")
    .select("id, job_id, org_id, storage_path, note, created_by, created_at")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });

  throwIfError(error);
  return (data ?? []) as JobAttachmentRow[];
}

export async function createJobAttachmentRecord(input: {
  orgId: string;
  jobId: string;
  storagePath: string;
  note?: string;
}): Promise<void> {
  const { error } = await supabase.from("job_attachments").insert({
    org_id: input.orgId,
    job_id: input.jobId,
    storage_path: input.storagePath,
    note: input.note?.trim() || null,
  });

  throwIfError(error);
}

export async function deleteJobAttachmentRecord(attachmentId: string): Promise<JobAttachmentRow> {
  // Return the row so UI can also delete from storage.
  const { data, error } = await supabase
    .from("job_attachments")
    .delete()
    .eq("id", attachmentId)
    .select("id, job_id, org_id, storage_path, note, created_by, created_at")
    .single();

  throwIfError(error);
  if (!data) throw new Error("Attachment not found");
  return data as JobAttachmentRow;
}

/** ================= REPORTS ================= */

export async function listFinishedJobsWithItemsBetween(
  startIso: string,
  endIso: string,
): Promise<ReportJobRow[]> {
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id, created_at, discount_value, customer:customers(id, name, phone, email), vehicle:vehicles(id, make, model, year, plate), items:job_items(id, item_type, title, qty, unit_price, norm_minutes, operation_id)",
    )
    .eq("progress", "finished")
    .gte("created_at", startIso)
    .lt("created_at", endIso)
    .order("created_at", { ascending: true });

  throwIfError(error);

  const rows = (data ?? []) as any[];
  return rows.map((r) => {
    const customer = oneRequired<Customer>(r.customer, "customer");
    const vehicle = oneRequired<Vehicle>(r.vehicle, "vehicle");

    return {
      id: String(r.id),
      created_at: String(r.created_at),
      discount_value: toNumber(r.discount_value),
      customer,
      vehicle,
      items: (r.items ?? []) as ReportJobRow["items"],
    };
  });
}
