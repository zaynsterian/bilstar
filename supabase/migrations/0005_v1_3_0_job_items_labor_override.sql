-- v1.3.0 — Deviz: total manoperă manual (override) pe linie

alter table public.job_items
  add column if not exists labor_total_override numeric;

-- Opțional (recomandat): blochează valori negative
-- alter table public.job_items
--   add constraint job_items_labor_total_override_nonneg
--   check (labor_total_override is null or labor_total_override >= 0);
