-- TRAZA / JAULA: candado de Registro hora por hora
-- Ejecutar después de jaula-migration.sql y jaula-repair-sh-column.sql.
-- Impide registrar accesorios ligados a un SH si JAULA no los liberó.
-- No elimina registros existentes; solo protege nuevas capturas.

begin;

create or replace function public.bloquear_captura_sin_jaula()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requiere_jaula boolean;
  v_liberado boolean;
begin
  -- Solo se aplica cuando el material existe en el documento maestro activo.
  -- Los materiales que no son accesorios de ese documento conservan el flujo normal.
  select exists (
    select 1
      from public.datos_referencia dr
     where dr.documento_id = (
       select d.id
         from public.documentos_maestros d
        where d.planta = new.planta
          and d.area = new.area
          and d.estatus_importacion = 'activo'
        order by d.fecha_activacion desc nulls last, d.fecha_carga desc
        limit 1
     )
       and dr.activo = true
       and dr.orden_normalizada = new.orden_normalizada
       and dr.sh_normalizado = new.sh_normalizado
       and dr.numero_parte_normalizada = new.numero_parte_normalizada
  )
    into v_requiere_jaula;

  if coalesce(v_requiere_jaula, false) then
    select exists (
      select 1
        from public.jaula_accesorios j
       where j.planta = new.planta
         and j.area = new.area
         and j.orden_normalizada = new.orden_normalizada
         and j.sh_normalizado = new.sh_normalizado
         and j.numero_parte_normalizada = new.numero_parte_normalizada
         and j.estado in ('liberado', 'recogido')
    )
      into v_liberado;

    if not coalesce(v_liberado, false) then
      raise exception 'Registro bloqueado: el accesorio % del SH % todavía no ha sido liberado por JAULA. Solicítalo físicamente en JAULA antes de registrar la cantidad.', new.numero_parte_original, new.sh_original;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_bloquear_captura_sin_jaula on public.registros_captura;
create trigger trg_bloquear_captura_sin_jaula
before insert on public.registros_captura
for each row execute function public.bloquear_captura_sin_jaula();

grant execute on function public.bloquear_captura_sin_jaula() to authenticated;

commit;
