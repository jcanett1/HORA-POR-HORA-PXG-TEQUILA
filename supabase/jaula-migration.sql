-- TRAZA / JAULA: control de pedido, liberación y recolección de accesorios
-- Ejecutar una sola vez en Supabase > SQL Editor.
-- No elimina registros existentes.

begin;

create extension if not exists pgcrypto;

-- Catálogo de celdas utilizado por el personal que recoge accesorios.
do $$
begin
  create type public.celda_produccion as enum (
    'CELDA 16',
    'CELDA 15',
    'CELDA 11',
    'CELDA 10'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.jaula_estatus_accesorio as enum (
    'pendiente',
    'liberado',
    'recogido'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.jaula_accesorios (
  id uuid primary key default gen_random_uuid(),
  planta text not null default 'Monterrey',
  area text not null default 'Produccion',
  orden_original text not null,
  sh_original text not null,
  numero_parte_original text not null,
  orden_normalizada text not null,
  sh_normalizado text not null,
  numero_parte_normalizada text not null,
  estado public.jaula_estatus_accesorio not null default 'pendiente',
  celda_recoleccion public.celda_produccion,
  pedido_por uuid references public.perfiles_usuarios(id) on delete set null,
  pedido_at timestamptz,
  liberado_por uuid references public.perfiles_usuarios(id) on delete set null,
  liberado_at timestamptz,
  recogido_por uuid references public.perfiles_usuarios(id) on delete set null,
  recogido_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jaula_accesorios_valores_check check (
    length(trim(orden_original)) > 0 and
    length(trim(sh_original)) > 0 and
    length(trim(numero_parte_original)) > 0 and
    length(trim(orden_normalizada)) > 0 and
    length(trim(sh_normalizado)) > 0 and
    length(trim(numero_parte_normalizada)) > 0
  ),
  constraint jaula_accesorios_flujo_check check (
    (estado = 'pendiente' and liberado_at is null and recogido_at is null) or
    (estado = 'liberado' and pedido_at is not null and liberado_at is not null and recogido_at is null) or
    (estado = 'recogido' and pedido_at is not null and liberado_at is not null and recogido_at is not null)
  ),
  constraint jaula_accesorios_unique_part unique (
    planta,
    area,
    orden_normalizada,
    sh_normalizado,
    numero_parte_normalizada
  )
);

create index if not exists jaula_accesorios_group_idx
  on public.jaula_accesorios (planta, area, orden_normalizada, sh_normalizado);

create index if not exists jaula_accesorios_estado_idx
  on public.jaula_accesorios (estado, celda_recoleccion, updated_at desc);

drop trigger if exists trg_jaula_accesorios_updated_at on public.jaula_accesorios;
create trigger trg_jaula_accesorios_updated_at
before update on public.jaula_accesorios
for each row execute function public.actualizar_updated_at();

grant usage on type public.celda_produccion to authenticated;
grant usage on type public.jaula_estatus_accesorio to authenticated;
grant select on public.jaula_accesorios to authenticated;

alter table public.jaula_accesorios enable row level security;

drop policy if exists jaula_accesorios_select_operativo on public.jaula_accesorios;
create policy jaula_accesorios_select_operativo
on public.jaula_accesorios
for select
to authenticated
using (public.tiene_rol(array['operador', 'supervisor', 'administrador']));

-- Lee los estados de JAULA para la planta y el área del usuario autenticado.
create or replace function public.jaula_listar_estados(
  p_planta text default 'Monterrey',
  p_area text default 'Produccion'
)
returns setof public.jaula_accesorios
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.tiene_rol(array['operador', 'supervisor', 'administrador']) then
    raise exception 'El usuario no tiene permiso para consultar JAULA.';
  end if;

  return query
  select j.*
    from public.jaula_accesorios j
   where j.planta = p_planta
     and j.area = p_area
   order by j.orden_normalizada, j.sh_normalizado, j.numero_parte_normalizada;
end;
$$;

grant execute on function public.jaula_listar_estados(text, text) to authenticated;

-- Marca toda la orden + SH como pedida y registra la celda que recogerá los accesorios.
-- p_partes contiene los números de parte visibles en el detalle de la orden.
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
      planta, area, orden_original, sh_original, numero_parte_original,
      orden_normalizada, sh_normalizado, numero_parte_normalizada,
      estado, celda_recoleccion, pedido_por, pedido_at
    )
    values (
      p_planta, p_area, trim(p_orden), trim(p_sh), trim(v_part),
      v_orden, v_sh, public.normalizar_codigo(v_part),
      'pendiente', p_celda, v_usuario_id, now()
    )
    on conflict (planta, area, orden_normalizada, sh_normalizada, numero_parte_normalizada)
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

grant execute on function public.jaula_marcar_pedido(text, text, text, text, public.celda_produccion, text[]) to authenticated;

-- Avanza un accesorio: pendiente -> liberado -> recogido.
create or replace function public.jaula_actualizar_estado(
  p_id uuid,
  p_estado public.jaula_estatus_accesorio
)
returns public.jaula_accesorios
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario_id uuid := auth.uid();
  v_actual public.jaula_accesorios;
  v_actualizado public.jaula_accesorios;
begin
  if v_usuario_id is null or not public.tiene_rol(array['operador', 'supervisor', 'administrador']) then
    raise exception 'El usuario no tiene permiso para operar JAULA.';
  end if;

  select * into v_actual
    from public.jaula_accesorios
   where id = p_id
   for update;

  if v_actual.id is null then
    raise exception 'El accesorio de JAULA no existe.';
  end if;

  if v_actual.estado = 'pendiente' and p_estado <> 'liberado' then
    raise exception 'El accesorio debe liberarse antes de marcarse como recogido.';
  end if;
  if v_actual.estado = 'liberado' and p_estado <> 'recogido' then
    raise exception 'El accesorio liberado solo puede pasar a recogido.';
  end if;
  if v_actual.estado = 'recogido' then
    return v_actual;
  end if;

  update public.jaula_accesorios
     set estado = p_estado,
         liberado_por = case when p_estado = 'liberado' then v_usuario_id else liberado_por end,
         liberado_at = case when p_estado = 'liberado' then now() else liberado_at end,
         recogido_por = case when p_estado = 'recogido' then v_usuario_id else recogido_por end,
         recogido_at = case when p_estado = 'recogido' then now() else recogido_at end,
         updated_at = now()
   where id = p_id
   returning * into v_actualizado;

  return v_actualizado;
end;
$$;

grant execute on function public.jaula_actualizar_estado(uuid, public.jaula_estatus_accesorio) to authenticated;

commit;
