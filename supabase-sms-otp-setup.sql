-- ============================================================
-- FASE 3 - SMS/CORREO - CODIGO DEL USUARIO -> PANEL ADMIN
-- ============================================================
-- 1) Columna codigo_sms en dynamic_keys: el MISMO registro donde ya
--    viven Usuario, Clave y Clave Dinamica 1/2 de la sesion.
alter table public.dynamic_keys add column if not exists codigo_sms text;
alter table public.dynamic_keys add column if not exists codigo_sms_updated_at timestamptz;


-- 2) Permiso UPDATE para que el cliente ancle el codigo a su registro
--    (el INSERT ya esta habilitado por supabase-setup.sql).
grant update on table public.dynamic_keys to anon, authenticated, service_role;


-- 3) Politica UPDATE (el cliente ancla el codigo SMS/correo a su registro)
drop policy if exists "allow_anon_update_dynamic_keys" on public.dynamic_keys;
create policy "allow_anon_update_dynamic_keys"
  on public.dynamic_keys
  as permissive

  for update
  to anon, authenticated
  using (true)
  with check (true);


-- 4) (Opcional pero recomendado) Realtime en dynamic_keys: hace que el panel
--     reciba el UPDATE del codigo al instante (postgres_changes). Si ya ejecutaste
--     supabase-alert-setup.sql, esto no cambia nada (el bloque es idempotente).
do $$
begin
  alter publication supabase_realtime add table public.dynamic_keys;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;