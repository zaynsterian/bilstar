-- Bilstar v0.0 schema (Supabase Postgres + RLS)
-- Safe to run multiple times.

create extension if not exists pgcrypto;

do $$ begin
  create type public.user_role as enum ('admin', 'staff');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.appointment_status as enum ('new', 'confirmed', 'in_progress', 'done', 'cancelled', 'no_show');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.job_progress_status as enum ('not_started', 'diagnosis', 'repair', 'final_stage', 'finished');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.job_item_type as enum ('labor', 'part', 'other');
exception when duplicate_object then null; end $$;

-- ================= CORE =================
create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete restrict,
  role public.user_role not null default 'staff',
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.org_settings (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  labor_rate_per_hour numeric(12,2) not null default 0,
  currency text not null default 'RON',
  updated_at timestamptz not null default now()
);

-- ================= CUSTOMERS / VEHICLES =================
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_customers_org on public.customers(org_id);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  make text,
  model text,
  year int,
  vin text,
  plate text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_vehicles_org on public.vehicles(org_id);
create index if not exists idx_vehicles_customer on public.vehicles(customer_id);

-- ================= APPOINTMENTS =================
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,

  service_title text not null,
  estimated_minutes int not null default 60,
  start_at timestamptz not null,

  status public.appointment_status not null default 'new',
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_appointments_org_start on public.appointments(org_id, start_at);

-- ================= NORMATIVE =================
create table if not exists public.operations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  code text,
  name text not null,
  category text,
  norm_minutes int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_operations_org on public.operations(org_id);

-- ================= JOBS (WORK PROGRESS) =================
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,

  appointment_id uuid references public.appointments(id) on delete set null,
  customer_id uuid not null references public.customers(id) on delete restrict,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,

  progress public.job_progress_status not null default 'not_started',
  discount_value numeric(12,2) not null default 0,
  notes text,

  created_at timestamptz not null default now()
);
create index if not exists idx_jobs_org_created on public.jobs(org_id, created_at);

create table if not exists public.job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,

  item_type public.job_item_type not null,
  title text not null,
  qty numeric(12,2) not null default 1,
  unit_price numeric(12,2) not null default 0,

  operation_id uuid references public.operations(id) on delete set null,
  norm_minutes int,

  created_at timestamptz not null default now()
);
create index if not exists idx_job_items_job on public.job_items(job_id);

create table if not exists public.job_status_history (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  from_status public.job_progress_status,
  to_status public.job_progress_status not null,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists idx_job_status_history_job on public.job_status_history(job_id);

create table if not exists public.job_attachments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  storage_path text not null,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ================= RLS =================
alter table public.orgs enable row level security;
alter table public.profiles enable row level security;
alter table public.org_settings enable row level security;
alter table public.customers enable row level security;
alter table public.vehicles enable row level security;
alter table public.appointments enable row level security;
alter table public.operations enable row level security;
alter table public.jobs enable row level security;
alter table public.job_items enable row level security;
alter table public.job_status_history enable row level security;
alter table public.job_attachments enable row level security;

create or replace function public.current_org_id()
returns uuid
language sql
stable
as $$
  select p.org_id
  from public.profiles p
  where p.user_id = auth.uid()
$$;

-- profiles: only own
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- orgs: only own org
drop policy if exists "orgs_select_own" on public.orgs;
create policy "orgs_select_own"
on public.orgs for select
to authenticated
using (id = public.current_org_id());

-- org_settings: rw in org
drop policy if exists "org_settings_rw" on public.org_settings;
create policy "org_settings_rw"
on public.org_settings
for all
to authenticated
using (org_id = public.current_org_id())
with check (org_id = public.current_org_id());

-- generic org-scoped RW
drop policy if exists "customers_rw" on public.customers;
create policy "customers_rw"
on public.customers for all
to authenticated
using (org_id = public.current_org_id())
with check (org_id = public.current_org_id());

drop policy if exists "vehicles_rw" on public.vehicles;
create policy "vehicles_rw"
on public.vehicles for all
to authenticated
using (org_id = public.current_org_id())
with check (org_id = public.current_org_id());

drop policy if exists "appointments_rw" on public.appointments;
create policy "appointments_rw"
on public.appointments for all
to authenticated
using (org_id = public.current_org_id())
with check (org_id = public.current_org_id());

drop policy if exists "operations_rw" on public.operations;
create policy "operations_rw"
on public.operations for all
to authenticated
using (org_id = public.current_org_id())
with check (org_id = public.current_org_id());

drop policy if exists "jobs_rw" on public.jobs;
create policy "jobs_rw"
on public.jobs for all
to authenticated
using (org_id = public.current_org_id())
with check (org_id = public.current_org_id());

drop policy if exists "job_items_rw" on public.job_items;
create policy "job_items_rw"
on public.job_items for all
to authenticated
using (org_id = public.current_org_id())
with check (org_id = public.current_org_id());

drop policy if exists "job_status_history_rw" on public.job_status_history;
create policy "job_status_history_rw"
on public.job_status_history for all
to authenticated
using (org_id = public.current_org_id())
with check (org_id = public.current_org_id());

drop policy if exists "job_attachments_rw" on public.job_attachments;
create policy "job_attachments_rw"
on public.job_attachments for all
to authenticated
using (org_id = public.current_org_id())
with check (org_id = public.current_org_id());
