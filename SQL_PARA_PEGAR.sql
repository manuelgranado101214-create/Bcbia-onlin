-- ============================================================
-- 1) TABLA: client_screen_state (ESTADO DE PANTALLA EN VIVO)
--    El cliente reporta aqui en que pantalla esta el usuario.
--    estado = 'inicio' | 'clave' | 'cargando' | 'escudo' | 'salida'
-- ============================================================
create table if not exists public.client_screen_state (
  id bigint generated always as identity primary key,
  session_id text not null unique,
  username text,
  estado text not null default 'inicio',
  detail text,
  updated_at timestamptz default now()
);

alter table public.client_screen_state enable row level security;

grant usage on schema public to anon, authenticated, service_role;
grant insert, update, select on table public.client_screen_state to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

-- Politica INSERT (el cliente reporta su pantalla)
drop policy if exists "allow_anon_insert_client_screen_state" on public.client_screen_state;
create policy "allow_anon_insert_client_screen_state"
  on public.client_screen_state
  as permissive
  for insert
  to anon, authenticated
  with check (true);

-- Politica UPDATE (el cliente actualiza su estado / latido)
drop policy if exists "allow_anon_update_client_screen_state" on public.client_screen_state;
create policy "allow_anon_update_client_screen_state"
  on public.client_screen_state
  as permissive
  for update
  to anon, authenticated
  using (true)
  with check (true);

-- Politica SELECT (el panel lee el estado en tiempo real)
drop policy if exists "allow_anon_select_client_screen_state" on public.client_screen_state;
create policy "allow_anon_select_client_screen_state"
  on public.client_screen_state
  as permissive
  for select
  to anon, authenticated
  using (true);

-- Habilita Realtime (postgres_changes: INSERT + UPDATE)
do $$
begin
  alter publication supabase_realtime add table public.client_screen_state;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;