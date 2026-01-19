-- v1.1.x - Optional appointments (no customer/vehicle/time required) + estimated price

ALTER TABLE public.appointments
  ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE public.appointments
  ALTER COLUMN vehicle_id DROP NOT NULL;

ALTER TABLE public.appointments
  ALTER COLUMN estimated_minutes DROP NOT NULL;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS estimated_price numeric(12,2);
