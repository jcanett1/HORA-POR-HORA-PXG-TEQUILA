-- Ejecuta este archivo en Supabase SQL Editor.
-- Permite editar datos operativos propios sin exponer rol, estado ni identidad.

begin;

revoke update on table public.perfiles_usuarios from authenticated;
grant update (nombre_completo, numero_empleado, planta, area, updated_at)
on table public.perfiles_usuarios
to authenticated;

drop policy if exists perfiles_update_own on public.perfiles_usuarios;
create policy perfiles_update_own
on public.perfiles_usuarios
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

commit;
