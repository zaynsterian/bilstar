-- v1.3.2 — NET (venit net intern) — job_net_items

create table if not exists public.job_net_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,

  item_type public.job_item_type not null,
  title text not null,
  title_key text not null default '',

  qty numeric(12,2) not null default 1,
  sale_unit_price numeric(12,2) not null default 0,
  purchase_unit_cost numeric(12,2),
  norm_minutes int,

  -- net_total reprezintă valoarea NET pentru linie:
  --  - manoperă/alte: valoare directă
  --  - piese: profit (vânzare - achiziție) * qty (0 dacă lipsește costul)
  net_total numeric(12,2) not null default 0,

  -- pentru import idempotent din deviz
  source_job_item_id uuid,

  created_at timestamptz not null default now()
);

create index if not exists idx_job_net_items_job on public.job_net_items(job_id);
create index if not exists idx_job_net_items_org_title_key on public.job_net_items(org_id, title_key);

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'job_net_items_org_job_source_uniq'
  ) then
    alter table public.job_net_items
      add constraint job_net_items_org_job_source_uniq unique (org_id, job_id, source_job_item_id);
  end if;
end $$;

alter table public.job_net_items enable row level security;

drop policy if exists "job_net_items_rw" on public.job_net_items;
create policy "job_net_items_rw"
on public.job_net_items for all
to authenticated
using (org_id = public.current_org_id())
with check (org_id = public.current_org_id());
