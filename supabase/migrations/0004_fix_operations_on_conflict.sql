-- Fix for Normativ Import (ON CONFLICT needs a non-partial UNIQUE index)
-- Previous index was partial: WHERE code IS NOT NULL, which does NOT match ON CONFLICT (org_id, code)

drop index if exists public.uq_operations_org_code;

create unique index if not exists uq_operations_org_code
  on public.operations(org_id, code);
