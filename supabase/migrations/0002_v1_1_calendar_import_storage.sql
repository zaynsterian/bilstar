-- Bilstar v1.1: Calendar (drag/drop), Normativ import (upsert), Attachments storage

-- 1) Make normative imports idempotent when CODE is provided
create unique index if not exists uq_operations_org_code
  on public.operations(org_id, code)
  where code is not null;

-- 2) Speed up attachments
create index if not exists idx_job_attachments_job
  on public.job_attachments(job_id);

-- 3) Private storage bucket for job attachments
insert into storage.buckets (id, name, public)
values ('bilstar-job-attachments', 'bilstar-job-attachments', false)
on conflict (id) do nothing;

-- Allow authenticated users to read/write ONLY within their org prefix: <org_id>/...
-- NOTE: uses public.current_org_id() from 0001_init.sql

drop policy if exists "bilstar_job_attachments_rw" on storage.objects;
create policy "bilstar_job_attachments_rw"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'bilstar-job-attachments'
  and name like (public.current_org_id()::text || '/%')
)
with check (
  bucket_id = 'bilstar-job-attachments'
  and name like (public.current_org_id()::text || '/%')
);
