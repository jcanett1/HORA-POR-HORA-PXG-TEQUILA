-- TRAZA: cambiar el match a SH + código/número de parte
-- La orden se conserva como trazabilidad, pero ya no participa en el match.
-- Ejecutar después de hourly-register-migration.sql.

begin;

-- Permite guardar un registro horario general con número de parte vacío.
-- Orden y SH siguen siendo obligatorios; el resultado será no_encontrado.
alter table public.registros_captura
  drop constraint if exists registros_captura_valores_check;

alter table public.registros_captura
  add constraint registros_captura_valores_check
  check (
    length(trim(orden_original)) > 0 and
    length(trim(sh_original)) > 0 and
    length(trim(orden_normalizada)) > 0 and
    length(trim(sh_normalizado)) > 0
  );

drop function if exists public.registrar_captura(text, text, text, text, text, uuid, text, text, numeric, numeric, numeric);

create or replace function public.registrar_captura(
  p_orden text,
  p_numero_parte text,
  p_sh text,
  p_planta text default 'Monterrey',
  p_area text default 'Produccion',
  p_turno_id uuid default null,
  p_observaciones text default null,
  p_idempotency_key text default null,
  p_cantidad numeric default 0,
  p_orden_x_hora numeric default 0,
  p_piezas_x_hora numeric default 0
)
returns setof public.registros_captura
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario_id uuid := auth.uid();
  v_celda public.celda_produccion;
  v_documento_id uuid;
  v_referencia_id uuid;
  v_match_count integer := 0;
  v_sh_count integer := 0;
  v_orden text := public.normalizar_codigo(p_orden);
  v_parte text := public.normalizar_codigo(p_numero_parte);
  v_sh text := public.normalizar_codigo(p_sh);
  v_resultado public.resultado_match;
  v_motivo public.motivo_discrepancia;
  v_existing_id uuid;
begin
  if v_usuario_id is null then
    raise exception 'Debes iniciar sesión para registrar una captura.';
  end if;

  if not public.tiene_rol(array['operador', 'supervisor', 'administrador']) then
    raise exception 'El usuario no tiene un rol operativo activo.';
  end if;

  select p.celda into v_celda
    from public.perfiles_usuarios p
   where p.id = v_usuario_id
     and p.activo = true;

  if v_celda is null then
    raise exception 'Tu usuario no tiene una celda asignada. Solicita al administrador asignar una celda.';
  end if;

  if v_orden = '' or v_sh = '' then
    raise exception 'Orden y SH son obligatorios.';
  end if;

  if p_cantidad < 0 or p_orden_x_hora < 0 or p_piezas_x_hora < 0 then
    raise exception 'Cantidad, Orden x hora y Piezas x hora no pueden ser negativos.';
  end if;

  if v_parte = '' and p_cantidad <> 0 then
    raise exception 'Un registro sin accesorio debe tener cantidad 0.';
  end if;

  if p_idempotency_key is not null then
    select r.id into v_existing_id
      from public.registros_captura r
     where r.idempotency_key = p_idempotency_key
     limit 1;
    if v_existing_id is not null then
      return query select r.* from public.registros_captura r where r.id = v_existing_id;
      return;
    end if;
  end if;

  select d.id into v_documento_id
    from public.documentos_maestros d
   where d.planta = p_planta
     and d.area = p_area
     and d.estatus_importacion = 'activo'
   order by d.fecha_activacion desc nulls last, d.fecha_carga desc
   limit 1;

  if v_parte = '' then
    v_resultado := 'no_encontrado';
    v_motivo := 'otro';
  elsif v_documento_id is null then
    v_resultado := 'no_encontrado';
    v_motivo := 'sin_documento_activo';
  else
    -- El match intencionalmente NO utiliza v_orden.
    select count(*) into v_match_count
      from public.datos_referencia dr
     where dr.documento_id = v_documento_id
       and dr.activo = true
       and dr.sh_normalizado = v_sh
       and dr.numero_parte_normalizada = v_parte;

    select count(*) into v_sh_count
      from public.datos_referencia dr
     where dr.documento_id = v_documento_id
       and dr.activo = true
       and dr.sh_normalizado = v_sh;

    if v_match_count = 1 then
      select dr.id into v_referencia_id
        from public.datos_referencia dr
       where dr.documento_id = v_documento_id
         and dr.activo = true
         and dr.sh_normalizado = v_sh
         and dr.numero_parte_normalizada = v_parte
       limit 1;
      v_resultado := 'coincide';
      v_motivo := null;
    elsif v_match_count > 1 then
      v_resultado := 'duplicado';
      v_motivo := 'referencia_ambigua';
    elsif v_sh_count > 0 then
      v_resultado := 'discrepancia';
      v_motivo := 'parte_diferente';
    else
      v_resultado := 'no_encontrado';
      v_motivo := 'combinacion_no_encontrada';
    end if;
  end if;

  -- Evita repetir el mismo SH + accesorio el mismo día, sin bloquear otros accesorios del SH.
  if exists (
    select 1 from public.registros_captura r
     where r.planta = p_planta
       and r.area = p_area
       and r.fecha_hora_captura >= date_trunc('day', now())
       and r.sh_normalizado = v_sh
       and r.numero_parte_normalizada = v_parte
       and v_parte <> ''
       and r.estatus_supervisor <> 'cancelado'
  ) then
    v_resultado := 'duplicado';
    v_motivo := 'registro_duplicado';
  end if;

  return query
  insert into public.registros_captura (
    usuario_id, celda, turno_id, planta, area,
    orden_original, numero_parte_original, sh_original,
    orden_normalizada, numero_parte_normalizada, sh_normalizado,
    documento_id_validacion, dato_referencia_id, resultado_match,
    motivo_discrepancia, estatus_supervisor, observaciones, idempotency_key,
    cantidad, orden_x_hora, piezas_x_hora
  )
  values (
    v_usuario_id, v_celda, p_turno_id, p_planta, p_area,
    p_orden, p_numero_parte, p_sh,
    v_orden, v_parte, v_sh,
    v_documento_id, v_referencia_id, v_resultado,
    v_motivo, 'pendiente', p_observaciones, p_idempotency_key,
    p_cantidad, p_orden_x_hora, p_piezas_x_hora
  )
  returning *;
end;
$$;

grant execute on function public.registrar_captura(text, text, text, text, text, uuid, text, text, numeric, numeric, numeric) to authenticated;

commit;
