-- Bilstar v1.4.0 - Job payments fields
-- Adds basic payment tracking to work orders (jobs):
--  - advance_paid: how much the client paid as advance
--  - is_paid: whether the job is fully paid

alter table if exists public.jobs
  add column if not exists advance_paid numeric(12,2) not null default 0;

alter table if exists public.jobs
  add column if not exists is_paid boolean not null default false;
