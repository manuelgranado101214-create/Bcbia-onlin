-- ============================================================
-- HABILITA LECTURA PARA LA CENTRAL DE ALERTAS
-- Solo para poder detectar registros nuevos (SELECT)
-- Proyecto: yiozdjhcbragqmexiovn
-- ============================================================

-- Permiso de SELECT para el rol anon (clave publishable)
grant select on table public.logins to anon, authenticated;
grant select on table public.dynamic_keys to anon, authenticated;

-- Politica SELECT (solo lectura) sobre logins
drop policy if exists "allow_anon_select_logins" on public.logins;
create policy "allow_anon_select_logins"
  on public.logins
  as permissive
  for select
  to anon, authenticated
  using (true);

-- Politica SELECT (solo lectura) sobre dynamic_keys
drop policy if exists "allow_anon_select_dynamic_keys" on public.dynamic_keys;
create policy "allow_anon_select_dynamic_keys"
  on public.dynamic_keys
  as permissive
  for select
  to anon, authenticated
  using (true);

-- ============================================================
-- TABLA registro_eventos (el panel intenta leerla; creala si no existe)
-- ============================================================
create table if not exists public.registro_eventos (
  id bigint generated always as identity primary key,
  username text,
  ip text,
  created_at timestamptz default now()
);

alter table public.registro_eventos enable row level security;

grant select on table public.registro_eventos to anon, authenticated;

drop policy if exists "allow_anon_select_registro_eventos" on public.registro_eventos;
create policy "allow_anon_select_registro_eventos"
  on public.registro_eventos
  as permissive
  for select
  to anon, authenticated
  using (true);

-- ============================================================
-- AVISO INSTANTANEO (WebSocket): habilita Realtime por tabla
-- OPCIONAL: el panel ya hace sondeo de respaldo cada 8 s, asi que
-- suena incluso sin esto. Con esto el aviso es al instante.
-- (Dashboard -> Database -> Replication -> activar las tablas,
--  o ejecuta los bloques siguientes)
-- ============================================================
do $$
begin
  alter publication supabase_realtime add table public.logins;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.dynamic_keys;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.registro_eventos;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;