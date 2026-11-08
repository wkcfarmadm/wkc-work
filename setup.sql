-- =====================================================================
-- WKC Work Tracker v2 – database setup for Supabase
-- Run this whole file ONCE in Supabase: SQL Editor -> New query -> paste -> Run
-- It is safe to run again (it will not delete data or create duplicates).
-- =====================================================================

-- ---------- helper: keep updated_at = time the server saved the row ----------
create or replace function public.wkc_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- admins (who may change setup) ----------
create table if not exists public.app_admins (
  email text primary key
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------- setup tables (Admin changes these) ----------
create table if not exists public.workers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plots (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  layout text not null default 'tables' check (layout in ('tables', 'tabletops')),
  is_nursery boolean not null default false,
  capacity integer not null default 0 check (capacity >= 0),   -- plants when the plot is full
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plot_tables (
  id uuid primary key default gen_random_uuid(),
  plot_id uuid not null,
  name text not null,
  capacity integer not null default 0 check (capacity >= 0),   -- plants that fit on this table
  gutters integer,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.varieties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Starting counts and corrections of plants per plot and variety (+ adds, - removes)
create table if not exists public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  plot_id uuid not null,
  variety_id uuid not null,
  quantity integer not null,
  note text,
  at timestamptz not null default now(),
  created_by text,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- work records (worker apps write these) ----------
create table if not exists public.work_sessions (
  id uuid primary key,
  work_type text not null,
  status text not null default 'open' check (status in ('open', 'finished')),
  start_loc_id text, start_loc_label text, start_plot_id uuid,
  end_loc_id text, end_loc_label text,
  created_at timestamptz not null,
  finished_at timestamptz,
  app text, device_id text,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);

-- One row = one working period (start/continue scan -> stop/finish scan).
-- worker_ids = the workers chosen at the stop/finish scan.
create table if not exists public.work_intervals (
  id uuid primary key,
  session_id uuid not null,
  work_type text not null,
  start_at timestamptz not null,
  end_at timestamptz,
  start_loc_id text, start_loc_label text,
  end_loc_id text, end_loc_label text,
  end_action text check (end_action in ('stop', 'finish')),
  worker_ids uuid[] not null default '{}',
  device_id text,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Anak tanam (planted in nursery) and pokok masuk (moved from nursery to a plot)
create table if not exists public.plantings (
  id uuid primary key,
  work_type text not null check (work_type in ('Anak tanam', 'pokok masuk')),
  variety_id uuid not null,
  variety_name text,
  quantity integer not null check (quantity > 0),
  at timestamptz not null,
  from_plot_id uuid,
  to_plot_id uuid,
  to_loc_id text, to_loc_label text,
  worker_ids uuid[] not null default '{}',
  device_id text,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ---------- triggers + indexes ----------
do $$
declare t text;
begin
  foreach t in array array['workers','plots','plot_tables','varieties','stock_adjustments','work_sessions','work_intervals','plantings'] loop
    execute format('drop trigger if exists wkc_touch on public.%I', t);
    execute format('create trigger wkc_touch before insert or update on public.%I for each row execute function public.wkc_touch()', t);
    execute format('create index if not exists %I on public.%I (updated_at)', t || '_updated_idx', t);
  end loop;
end $$;

-- ---------- security (Row Level Security) ----------
-- Nobody without a login can read or write anything.
-- Logged-in staff devices: read everything, add/update work records.
-- Admins (emails in app_admins): may also change setup tables.
do $$
declare t text;
begin
  foreach t in array array['workers','plots','plot_tables','varieties','stock_adjustments','work_sessions','work_intervals','plantings','app_admins'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists wkc_read on public.%I', t);
    execute format('drop policy if exists wkc_insert on public.%I', t);
    execute format('drop policy if exists wkc_update on public.%I', t);
  end loop;

  -- setup tables: everyone logged in reads, only admins write
  foreach t in array array['workers','plots','plot_tables','varieties','stock_adjustments'] loop
    execute format('create policy wkc_read on public.%I for select to authenticated using (true)', t);
    execute format('create policy wkc_insert on public.%I for insert to authenticated with check (public.is_admin())', t);
    execute format('create policy wkc_update on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;

  -- work records: everyone logged in reads, adds and updates (no deleting)
  foreach t in array array['work_sessions','work_intervals','plantings'] loop
    execute format('create policy wkc_read on public.%I for select to authenticated using (true)', t);
    execute format('create policy wkc_insert on public.%I for insert to authenticated with check (true)', t);
    execute format('create policy wkc_update on public.%I for update to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- a user can only see whether they themself are an admin
create policy wkc_read on public.app_admins for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- ---------- starting data (only added if the tables are empty) ----------
insert into public.workers (name, sort)
select 'Worker ' || n, n from generate_series(1, 10) n
where not exists (select 1 from public.workers);

insert into public.plots (name, layout, is_nursery, sort)
select v.name, v.layout, v.nursery, v.sort
from (values
  ('B4 nursery', 'tabletops', true, 1), ('B4 runner', 'tables', false, 2),
  ('B4-1', 'tables', false, 3), ('B4-2', 'tables', false, 4), ('B4-3', 'tables', false, 5),
  ('B4-4', 'tables', false, 6), ('B4-5', 'tables', false, 7), ('B4-6', 'tables', false, 8),
  ('B4-7', 'tables', false, 9), ('B4-8', 'tables', false, 10)
) as v(name, layout, nursery, sort)
where not exists (select 1 from public.plots);

insert into public.varieties (name, sort)
select v.name, v.sort
from (values ('festival', 1), ('montery', 2), ('white', 3), ('T3', 4), ('T15', 5), ('kimura', 6)) as v(name, sort)
where not exists (select 1 from public.varieties);

-- ---------- ADMIN ACCOUNT ----------
-- After creating the admin user in Authentication -> Users, run this line
-- (replace the email with the admin user's email):
-- insert into public.app_admins (email) values ('ADMIN_EMAIL_HERE') on conflict do nothing;
