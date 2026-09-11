-- REPARACIÓN JAULA: error column "sh_normalizada" does not exist
-- Ejecutar en Supabase > SQL Editor después de haber ejecutado jaula-migration.sql.
-- Esta reparación conserva los registros existentes.

begin;

-- La columna oficial del proyecto es sh_normalizado.
-- Si una versión anterior creó sh_normalizada, se renombra automáticamente.
do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'jaula_accesorios'
       and column_name = 'sh_normalizada'
  ) and not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'jaula_accesorios'
       and column_name = 'sh_normalizado'
  ) then
    alter table public.jaula_accesorios rename column sh_normalizada to sh_normalizado;
  end if;
end $$;

-- Si la tabla existe pero quedó sin la columna normalizada, la crea y la rellena.
do $$
begin
  if to_regclass('public.jaula_accesorios') is not null
     and not exists (
       select 1
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'jaula_accesorios'
          and column_name = 'sh_normalizado'
     ) then
    alter table public.jaula_accesorios add column sh_normalizado text;
    update public.jaula_accesorios
       set sh_normalizado = upper(trim(sh_original));
    alter table public.jaula_accesorios alter column sh_normalizado set not null;
  end if;
end $$;

-- Garantiza que exista el índice único que usa ON CONFLICT.
drop index if exists public.jaula_accesorios_unique_part_idx;
create unique index if not exists jaula_accesorios_unique_part_idx
  on public.jaula_accesorios (
    planta,
    area,
    orden_normalizada,
    sh_normalizado,
    numero_parte_normalizada
  );

-- Reemplaza la RPC que podía conservar la referencia antigua sh_normalizada.
drop function if exists public.jaula_marcar_pedido(
  text,
  text,
  text,
  text,
  public.celda_produccion,
  text[]
);

create or replace function public.jaula_marcar_pedido(
  p_planta text,
  p_area text,
  p_orden text,
  p_sh text,
  p_celda public.celda_produccion,
  p_partes text[]
)
returns setof public.jaula_accesorios
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario_id uuid := auth.uid();
  v_orden text := public.normalizar_codigo(p_orden);
  v_sh text := public.normalizar_codigo(p_sh);
  v_part text;
begin
  if v_usuario_id is null or not public.tiene_rol(array['operador', 'supervisor', 'administrador']) then
    raise exception 'El usuario no tiene permiso para operar JAULA.';
  end if;

  if v_orden = '' or v_sh = '' or p_celda is null or coalesce(array_length(p_partes, 1), 0) = 0 then
    raise exception 'Orden, SH, celda y accesorios son obligatorios para marcar Ya pedido.';
  end if;

  foreach v_part in array p_partes loop
    if public.normalizar_codigo(v_part) = '' then
      continue;
    end if;

    insert into public.jaula_accesorios (
      planta,
      area,
      orden_original,
      sh_original,
      numero_parte_original,
      orden_normalizada,
      sh_normalizado,
      numero_parte_normalizada,
      estado,
      celda_recoleccion,
      pedido_por,
      pedido_at
    )
    values (
      p_planta,
      p_area,
      trim(p_orden),
      trim(p_sh),
      trim(v_part),
      v_orden,
      v_sh,
      public.normalizar_codigo(v_part),
      'pendiente',
      p_celda,
      v_usuario_id,
      now()
    )
    on conflict (planta, area, orden_normalizada, sh_normalizado, numero_parte_normalizada)
    do update set
      celda_recoleccion = coalesce(public.jaula_accesorios.celda_recoleccion, excluded.celda_recoleccion),
      pedido_por = coalesce(public.jaula_accesorios.pedido_por, excluded.pedido_por),
      pedido_at = coalesce(public.jaula_accesorios.pedido_at, excluded.pedido_at),
      updated_at = now();
  end loop;

  return query
  select j.*
    from public.jaula_accesorios j
   where j.planta = p_planta
     and j.area = p_area
     and j.orden_normalizada = v_orden
     and j.sh_normalizado = v_sh
   order by j.numero_parte_normalizada;
end;
$$;

grant execute on function public.jaula_marcar_pedido(
  text,
  text,
  text,
  text,
  public.celda_produccion,
  text[]
) to authenticated;

commit;
