import { supabase } from "./supabase";
import type { PostgrestError } from "@supabase/supabase-js";

export type UserRole = "admin" | "staff";

export type Profile = {
  org_id: string;
  role: UserRole;
  display_name: string | null;
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
  estimated_minutes: number;
  start_at: string;
  status: AppointmentStatus;
  notes: string | null;
  customer: Customer;
  vehicle: Vehicle;
};

function throwIfError(error: PostgrestError | null) {
  if (error) throw new Error(error.message);
}

export async function getMyProfile(): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .select("org_id, role, display_name")
    .single();

  throwIfError(error);
  if (!data) throw new Error("Profile not found");

  return data as Profile;
}

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

export async function listAppointmentsBetween(startIso: string, endIso: string): Promise<AppointmentRow[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select(
      "id, service_title, estimated_minutes, start_at, status, notes, customer:customers(id, name, phone, email), vehicle:vehicles(id, make, model, year, plate)",
    )
    .gte("start_at", startIso)
    .lt("start_at", endIso)
    .order("start_at", { ascending: true });

  throwIfError(error);
  return (data ?? []) as AppointmentRow[];
}

export async function createAppointment(input: {
  orgId: string;
  customerId: string;
  vehicleId: string;
  serviceTitle: string;
  estimatedMinutes: number;
  startAtIso: string;
  status: AppointmentStatus;
  notes?: string;
}): Promise<void> {
  const { error } = await supabase.from("appointments").insert({
    org_id: input.orgId,
    customer_id: input.customerId,
    vehicle_id: input.vehicleId,
    service_title: input.serviceTitle,
    estimated_minutes: input.estimatedMinutes,
    start_at: input.startAtIso,
    status: input.status,
    notes: input.notes?.trim() || null,
  });

  throwIfError(error);
}

export async function updateAppointmentStatus(appointmentId: string, status: AppointmentStatus): Promise<void> {
  const { error } = await supabase
    .from("appointments")
    .update({ status })
    .eq("id", appointmentId);

  throwIfError(error);
}
