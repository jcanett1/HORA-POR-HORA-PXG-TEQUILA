-- ================================================================
-- SISTEMA DE MATCH Y TRAZABILIDAD DE MATERIALES
-- Supabase / PostgreSQL
--
-- Instalación:
-- 1. Ejecuta este script desde Supabase > SQL Editor.
-- 2. Crea usuarios desde Authentication > Users.
-- 3. El trigger crea automáticamente su perfil como operador.
-- 4. Promueve supervisores/administradores desde SQL Editor.
--
-- Importante:
-- - Este script usa auth.users únicamente como identidad de Supabase Auth.
-- - Los datos de aplicación viven en public.*.
-- - La captura operativa debe realizarse mediante registrar_captura().
-- - La revisión del supervisor debe realizarse mediante confirmar_revision().
-- ================================================================

begin;

create extension if not exists pgcrypto;

-- ================================================================
-- 1. TIPOS ENUMERADOS
-- ================================================================

do $$
begin
  create type public.rol_usuario as enum ('operador', 'supervisor', 'administrador');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.estatus_documento as enum (
    'cargado',
    'procesando',
    'validado',
    'activo',
    'archivado',
    'error'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.resultado_match as enum (
    'coincide',
    'discrepancia',
    'no_encontrado',
    'duplicado'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.motivo_discrepancia as enum (
    'orden_diferente',
    'parte_diferente',
    'sh_diferente',
    'combinacion_no_encontrada',
    'registro_duplicado',
    'sin_documento_activo',
    'referencia_ambigua',
    'otro'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.estatus_supervisor as enum (
    'pendiente',
    'confirmado',
    'rechazado',
    'cancelado'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.accion_revision as enum (
    'confirmar',
    'rechazar',
    'cancelar',
    'aprobar_excepcion'
  );
exception when duplicate_object then null;
end $$;

-- ================================================================
-- 2. TABLAS PRINCIPALES
-- ================================================================

-- Perfil de aplicación relacionado 1:1 con auth.users.
create table if not exists public.perfiles_usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre_completo text not null default '',
  numero_empleado text,
  rol public.rol_usuario not null default 'operador',
  planta text not null default 'Monterrey',
  area text not null default 'Produccion',
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint perfiles_usuarios_nombre_check check (length(trim(nombre_completo)) > 0)
);

-- Catálogo de turnos. Permite turnos que cruzan la medianoche.
create table if not exists public.turnos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  codigo text,
  hora_inicio time not null,
  hora_fin time not null,
  zona_horaria text not null default 'America/Monterrey',
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  constraint turnos_horas_check check (hora_inicio <> hora_fin),
  constraint turnos_nombre_unique unique (nombre)
);

-- Cada carga de CSV/XLSX es una versión inmutable de referencia.
create table if not exists public.documentos_maestros (
  id uuid primary key default gen_random_uuid(),
  nombre_archivo text not null,
  tipo_archivo text not null default 'xlsx',
  hash_archivo text,
  usuario_carga_id uuid references public.perfiles_usuarios(id) on delete set null,
  fecha_carga timestamptz not null default now(),
  planta text not null default 'Monterrey',
  area text not null default 'Produccion',
  estatus_importacion public.estatus_documento not null default 'cargado',
  total_filas integer not null default 0,
  filas_validas integer not null default 0,
  filas_con_error integer not null default 0,
  ruta_storage text,
  fecha_activacion timestamptz,
  activado_por uuid references public.perfiles_usuarios(id) on delete set null,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documentos_maestros_nombre_check check (length(trim(nombre_archivo)) > 0),
  constraint documentos_maestros_filas_check check (
    total_filas >= 0 and filas_validas >= 0 and filas_con_error >= 0
  ),
  constraint documentos_maestros_hash_unique unique (planta, area, hash_archivo)
);

-- Filas extraídas y normalizadas del documento maestro.
create table if not exists public.datos_referencia (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.documentos_maestros(id) on delete restrict,
  numero_fila_origen integer,
  orden_original text not null,
  numero_parte_original text not null,
  sh_original text not null,
  orden_normalizada text not null,
  numero_parte_normalizada text not null,
  sh_normalizado text not null,
  cantidad_esperada numeric(14,3),
  cantidad_procesada numeric(14,3) not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  constraint datos_referencia_valores_check check (
    length(trim(orden_original)) > 0 and
    length(trim(numero_parte_original)) > 0 and
    length(trim(sh_original)) > 0 and
    length(trim(orden_normalizada)) > 0 and
    length(trim(numero_parte_normalizada)) > 0 and
    length(trim(sh_normalizado)) > 0
  ),
  constraint datos_referencia_cantidades_check check (
    (cantidad_esperada is null or cantidad_esperada >= 0) and
    cantidad_procesada >= 0
  )
);

-- Captura central de la operación.
create table if not exists public.registros_captura (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.perfiles_usuarios(id) on delete restrict,
  fecha_hora_captura timestamptz not null default now(),
  turno_id uuid references public.turnos(id) on delete set null,
  planta text not null default 'Monterrey',
  area text not null default 'Produccion',
  orden_original text not null,
  numero_parte_original text not null,
  sh_original text not null,
  orden_normalizada text not null,
  numero_parte_normalizada text not null,
  sh_normalizado text not null,
  documento_id_validacion uuid references public.documentos_maestros(id) on delete restrict,
  dato_referencia_id uuid references public.datos_referencia(id) on delete restrict,
  resultado_match public.resultado_match not null,
  motivo_discrepancia public.motivo_discrepancia,
  estatus_supervisor public.estatus_supervisor not null default 'pendiente',
  fecha_revision timestamptz,
  revisado_por uuid references public.perfiles_usuarios(id) on delete set null,
  observaciones text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  constraint registros_captura_valores_check check (
    length(trim(orden_original)) > 0 and
    length(trim(numero_parte_original)) > 0 and
    length(trim(sh_original)) > 0 and
    length(trim(orden_normalizada)) > 0 and
    length(trim(numero_parte_normalizada)) > 0 and
    length(trim(sh_normalizado)) > 0
  ),
  constraint registros_captura_motivo_check check (
    (resultado_match = 'coincide' and motivo_discrepancia is null) or
    (resultado_match <> 'coincide' and motivo_discrepancia is not null)
  ),
  constraint registros_captura_revision_check check (
    (estatus_supervisor = 'pendiente' and fecha_revision is null and revisado_por is null) or
    (estatus_supervisor <> 'pendiente' and fecha_revision is not null and revisado_por is not null)
  )
);

-- Bitácora append-only de revisiones del supervisor.
create table if not exists public.acciones_revision (
  id uuid primary key default gen_random_uuid(),
  registro_captura_id uuid not null references public.registros_captura(id) on delete restrict,
  usuario_id uuid references public.perfiles_usuarios(id) on delete set null,
  accion public.accion_revision not null,
  estatus_anterior public.estatus_supervisor not null,
  estatus_nuevo public.estatus_supervisor not null,
  motivo text,
  fecha_hora timestamptz not null default now()
);

-- ================================================================
-- 3. ÍNDICES
-- ================================================================

create unique index if not exists documentos_maestros_un_activo_idx
  on public.documentos_maestros (planta, area)
  where estatus_importacion = 'activo';

create index if not exists datos_referencia_match_idx
  on public.datos_referencia (
    documento_id,
    orden_normalizada,
    numero_parte_normalizada,
    sh_normalizado
  );

create index if not exists datos_referencia_orden_idx
  on public.datos_referencia (documento_id, orden_normalizada);

create index if not exists registros_captura_fecha_idx
  on public.registros_captura (fecha_hora_captura desc);

create index if not exists registros_captura_match_idx
  on public.registros_captura (resultado_match, estatus_supervisor);

create index if not exists registros_captura_usuario_idx
  on public.registros_captura (usuario_id, fecha_hora_captura desc);

create index if not exists registros_captura_orden_idx
  on public.registros_captura (planta, area, orden_normalizada);

create index if not exists acciones_revision_registro_idx
  on public.acciones_revision (registro_captura_id, fecha_hora desc);

create unique index if not exists registros_captura_idempotency_idx
  on public.registros_captura (idempotency_key)
  where idempotency_key is not null;

-- ================================================================
-- 4. FUNCIONES AUXILIARES Y TRIGGERS
-- ================================================================

-- Actualiza updated_at en tablas mutables.
create or replace function public.actualizar_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Devuelve true si el usuario autenticado tiene uno de los roles recibidos.
-- SECURITY DEFINER evita depender de la política de lectura del perfil dentro de RLS.
create or replace function public.tiene_rol(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.perfiles_usuarios p
    where p.id = auth.uid()
      and p.activo = true
      and p.rol::text = any(p_roles)
  );
$$;

-- Normalización inicial. Si las reglas reales son distintas, modifícala aquí.
create or replace function public.normalizar_codigo(p_valor text)
returns text
language sql
immutable
as $$
  select upper(trim(coalesce(p_valor, '')));
$$;

-- Cuando una versión pasa a activa, archiva la anterior de la misma planta y área.
create or replace function public.archivar_documentos_anteriores()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estatus_importacion = 'activo' then
    update public.documentos_maestros
       set estatus_importacion = 'archivado',
           updated_at = now()
     where planta = new.planta
       and area = new.area
       and estatus_importacion = 'activo'
       and id <> new.id;

    new.fecha_activacion = coalesce(new.fecha_activacion, now());
    new.activado_por = coalesce(new.activado_por, auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists trg_perfiles_updated_at on public.perfiles_usuarios;
create trigger trg_perfiles_updated_at
before update on public.perfiles_usuarios
for each row execute function public.actualizar_updated_at();

drop trigger if exists trg_documentos_updated_at on public.documentos_maestros;
create trigger trg_documentos_updated_at
before update on public.documentos_maestros
for each row execute function public.actualizar_updated_at();

drop trigger if exists trg_documentos_archivar_anteriores on public.documentos_maestros;
create trigger trg_documentos_archivar_anteriores
before insert or update of estatus_importacion, planta, area
on public.documentos_maestros
for each row execute function public.archivar_documentos_anteriores();

-- Crea un perfil de aplicación al registrar un usuario en Supabase Auth.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfiles_usuarios (
    id,
    nombre_completo,
    numero_empleado,
    rol
  )
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'nombre_completo', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      new.id::text
    ),
    nullif(new.raw_user_meta_data ->> 'numero_empleado', ''),
    'operador'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ================================================================
-- 5. FUNCIONES OPERATIVAS (RPC)
-- ================================================================

-- Registra una captura y calcula el match dentro de la base de datos.
-- La hora y el usuario siempre provienen del servidor y de auth.uid().
create or replace function public.registrar_captura(
  p_orden text,
  p_numero_parte text,
  p_sh text,
  p_planta text default 'Monterrey',
  p_area text default 'Produccion',
  p_turno_id uuid default null,
  p_observaciones text default null,
  p_idempotency_key text default null
)
returns setof public.registros_captura
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario_id uuid := auth.uid();
  v_documento_id uuid;
  v_referencia_id uuid;
  v_match_count integer := 0;
  v_orden_count integer := 0;
  v_orden text := public.normalizar_codigo(p_orden);
  v_parte text := public.normalizar_codigo(p_numero_parte);
  v_sh text := public.normalizar_codigo(p_sh);
  v_resultado public.resultado_match;
  v_motivo public.motivo_discrepancia;
  v_existing_id uuid;
  v_registro public.registros_captura;
begin
  if v_usuario_id is null then
    raise exception 'Debes iniciar sesión para registrar una captura.';
  end if;

  if not public.tiene_rol(array['operador', 'supervisor', 'administrador']) then
    raise exception 'El usuario no tiene un rol operativo activo.';
  end if;

  if v_orden = '' or v_parte = '' or v_sh = '' then
    raise exception 'Orden, número de parte y SH son obligatorios.';
  end if;

  if p_idempotency_key is not null then
    select r.id
      into v_existing_id
      from public.registros_captura r
     where r.idempotency_key = p_idempotency_key
     limit 1;

    if v_existing_id is not null then
      return query
      select r.*
        from public.registros_captura r
       where r.id = v_existing_id;
      return;
    end if;
  end if;

  -- La versión activa es la única fuente válida de comparación.
  select d.id
    into v_documento_id
    from public.documentos_maestros d
   where d.planta = p_planta
     and d.area = p_area
     and d.estatus_importacion = 'activo'
   order by d.fecha_activacion desc nulls last, d.fecha_carga desc
   limit 1;

  if v_documento_id is null then
    v_resultado := 'no_encontrado';
    v_motivo := 'sin_documento_activo';
  else
    select count(*)
      into v_match_count
      from public.datos_referencia dr
     where dr.documento_id = v_documento_id
       and dr.activo = true
       and dr.orden_normalizada = v_orden
       and dr.numero_parte_normalizada = v_parte
       and dr.sh_normalizado = v_sh;

    select count(*)
      into v_orden_count
      from public.datos_referencia dr
     where dr.documento_id = v_documento_id
       and dr.activo = true
       and dr.orden_normalizada = v_orden;

    if v_match_count = 1 then
      select dr.id
        into v_referencia_id
        from public.datos_referencia dr
       where dr.documento_id = v_documento_id
         and dr.activo = true
         and dr.orden_normalizada = v_orden
       and dr.numero_parte_normalizada = v_parte
       and dr.sh_normalizado = v_sh
       limit 1;

      v_resultado := 'coincide';
      v_motivo := null;
    elsif v_match_count > 1 then
      v_resultado := 'duplicado';
      v_motivo := 'referencia_ambigua';
    elsif v_orden_count > 0 then
      v_resultado := 'discrepancia';
      v_motivo := case
        when not exists (
          select 1 from public.datos_referencia dr
           where dr.documento_id = v_documento_id
             and dr.activo = true
             and dr.orden_normalizada = v_orden
             and dr.numero_parte_normalizada = v_parte
        ) then 'parte_diferente'
        when not exists (
          select 1 from public.datos_referencia dr
           where dr.documento_id = v_documento_id
             and dr.activo = true
             and dr.orden_normalizada = v_orden
             and dr.sh_normalizado = v_sh
        ) then 'sh_diferente'
        else 'combinacion_no_encontrada'
      end;
    else
      v_resultado := 'no_encontrado';
      v_motivo := 'combinacion_no_encontrada';
    end if;
  end if;

  -- Regla inicial de duplicados: misma combinación en el mismo día.
  -- Si el proceso maneja varias piezas iguales, reemplaza esta regla por cantidad/lote/secuencia.
  if exists (
    select 1
      from public.registros_captura r
     where r.planta = p_planta
       and r.area = p_area
       and r.fecha_hora_captura >= date_trunc('day', now())
       and r.orden_normalizada = v_orden
       and r.numero_parte_normalizada = v_parte
       and r.sh_normalizado = v_sh
       and r.estatus_supervisor <> 'cancelado'
  ) then
    v_resultado := 'duplicado';
    v_motivo := 'registro_duplicado';
  end if;

  return query
  insert into public.registros_captura (
    usuario_id,
    turno_id,
    planta,
    area,
    orden_original,
    numero_parte_original,
    sh_original,
    orden_normalizada,
    numero_parte_normalizada,
    sh_normalizado,
    documento_id_validacion,
    dato_referencia_id,
    resultado_match,
    motivo_discrepancia,
    estatus_supervisor,
    observaciones,
    idempotency_key
  )
  values (
    v_usuario_id,
    p_turno_id,
    p_planta,
    p_area,
    p_orden,
    p_numero_parte,
    p_sh,
    v_orden,
    v_parte,
    v_sh,
    v_documento_id,
    v_referencia_id,
    v_resultado,
    v_motivo,
    'pendiente',
    p_observaciones,
    p_idempotency_key
  )
  returning *;
end;
$$;

-- Activa una versión previamente validada e impide mantener dos activas.
create or replace function public.activar_documento(p_documento_id uuid)
returns public.documentos_maestros
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario_id uuid := auth.uid();
  v_documento public.documentos_maestros;
begin
  if v_usuario_id is null or not public.tiene_rol(array['supervisor', 'administrador']) then
    raise exception 'Solo un supervisor o administrador puede activar documentos.';
  end if;

  select *
    into v_documento
    from public.documentos_maestros
   where id = p_documento_id
   for update;

  if v_documento.id is null then
    raise exception 'El documento no existe.';
  end if;

  if v_documento.filas_validas <= 0 or v_documento.filas_con_error > 0 then
    raise exception 'El documento debe tener filas válidas y cero errores antes de activarse.';
  end if;

  update public.documentos_maestros
     set estatus_importacion = 'activo',
         fecha_activacion = now(),
         activado_por = v_usuario_id,
         updated_at = now()
   where id = p_documento_id
   returning * into v_documento;

  return v_documento;
end;
$$;

-- Confirma o rechaza una captura y guarda la acción en la bitácora.
create or replace function public.confirmar_revision(
  p_registro_id uuid,
  p_nuevo_estatus public.estatus_supervisor,
  p_motivo text default null,
  p_observaciones text default null
)
returns public.registros_captura
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario_id uuid := auth.uid();
  v_registro public.registros_captura;
  v_estatus_anterior public.estatus_supervisor;
  v_accion public.accion_revision;
begin
  if v_usuario_id is null or not public.tiene_rol(array['supervisor', 'administrador']) then
    raise exception 'Solo un supervisor o administrador puede revisar capturas.';
  end if;

  if p_nuevo_estatus not in ('confirmado', 'rechazado', 'cancelado') then
    raise exception 'El nuevo estatus debe ser confirmado, rechazado o cancelado.';
  end if;

  if p_nuevo_estatus in ('rechazado', 'cancelado')
     and length(trim(coalesce(p_motivo, ''))) = 0 then
    raise exception 'El motivo es obligatorio para rechazar o cancelar.';
  end if;

  select *
    into v_registro
    from public.registros_captura
   where id = p_registro_id
   for update;

  if v_registro.id is null then
    raise exception 'El registro no existe.';
  end if;

  v_estatus_anterior := v_registro.estatus_supervisor;

  if p_nuevo_estatus = 'confirmado'
     and v_registro.resultado_match <> 'coincide'
     and length(trim(coalesce(p_motivo, ''))) = 0 then
    raise exception 'Una discrepancia requiere motivo para aprobarse como excepción.';
  end if;

  v_accion := case p_nuevo_estatus
    when 'confirmado' then 'confirmar'::public.accion_revision
    when 'rechazado' then 'rechazar'::public.accion_revision
    else 'cancelar'::public.accion_revision
  end;

  update public.registros_captura
     set estatus_supervisor = p_nuevo_estatus,
         fecha_revision = now(),
         revisado_por = v_usuario_id,
         observaciones = coalesce(nullif(trim(p_observaciones), ''), observaciones)
   where id = p_registro_id
   returning * into v_registro;

  insert into public.acciones_revision (
    registro_captura_id,
    usuario_id,
    accion,
    estatus_anterior,
    estatus_nuevo,
    motivo
  )
  values (
    p_registro_id,
    v_usuario_id,
    v_accion,
    v_estatus_anterior,
    p_nuevo_estatus,
    nullif(trim(p_motivo), '')
  );

  return v_registro;
end;
$$;

-- ================================================================
-- 6. SEGURIDAD Y RLS
-- ================================================================

alter table public.perfiles_usuarios enable row level security;
alter table public.turnos enable row level security;
alter table public.documentos_maestros enable row level security;
alter table public.datos_referencia enable row level security;
alter table public.registros_captura enable row level security;
alter table public.acciones_revision enable row level security;

-- Quitamos privilegios amplios y otorgamos solo lo necesario.
revoke all on table public.perfiles_usuarios from anon, authenticated;
revoke all on table public.turnos from anon, authenticated;
revoke all on table public.documentos_maestros from anon, authenticated;
revoke all on table public.datos_referencia from anon, authenticated;
revoke all on table public.registros_captura from anon, authenticated;
revoke all on table public.acciones_revision from anon, authenticated;

-- Perfiles: lectura del propio perfil; supervisores y administradores pueden consultar perfiles.
grant select on table public.perfiles_usuarios to authenticated;

-- Turnos: lectura para cualquier usuario autenticado.
grant select on table public.turnos to authenticated;

-- Documentos: lectura e importación controlada por supervisor/administrador.
grant select, insert, update on table public.documentos_maestros to authenticated;

-- Referencias: lectura para la operación; carga/corrección controlada.
grant select, insert, update, delete on table public.datos_referencia to authenticated;

-- Capturas: lectura únicamente; la inserción se hace por registrar_captura().
grant select on table public.registros_captura to authenticated;

-- Acciones: lectura únicamente; la escritura se hace por confirmar_revision().
grant select on table public.acciones_revision to authenticated;

-- Uso de los tipos enum expuestos por las tablas y las funciones RPC.
grant usage on type public.rol_usuario to authenticated;
grant usage on type public.estatus_documento to authenticated;
grant usage on type public.resultado_match to authenticated;
grant usage on type public.motivo_discrepancia to authenticated;
grant usage on type public.estatus_supervisor to authenticated;
grant usage on type public.accion_revision to authenticated;

-- La API de la aplicación puede invocar estas funciones.
grant execute on function public.registrar_captura(text, text, text, text, text, uuid, text, text) to authenticated;
grant execute on function public.activar_documento(uuid) to authenticated;
grant execute on function public.confirmar_revision(uuid, public.estatus_supervisor, text, text) to authenticated;

-- RLS: eliminar políticas con esos nombres si el script se vuelve a ejecutar.
drop policy if exists perfiles_select on public.perfiles_usuarios;
drop policy if exists turnos_select on public.turnos;
drop policy if exists documentos_select on public.documentos_maestros;
drop policy if exists documentos_insert on public.documentos_maestros;
drop policy if exists documentos_update on public.documentos_maestros;
drop policy if exists referencias_select on public.datos_referencia;
drop policy if exists referencias_insert on public.datos_referencia;
drop policy if exists referencias_update on public.datos_referencia;
drop policy if exists referencias_delete on public.datos_referencia;
drop policy if exists capturas_select on public.registros_captura;
drop policy if exists acciones_select on public.acciones_revision;

create policy perfiles_select
on public.perfiles_usuarios
for select to authenticated
using (
  id = auth.uid()
  or public.tiene_rol(array['supervisor', 'administrador'])
);

create policy turnos_select
on public.turnos
for select to authenticated
using (true);

create policy documentos_select
on public.documentos_maestros
for select to authenticated
using (true);

create policy documentos_insert
on public.documentos_maestros
for insert to authenticated
with check (
  public.tiene_rol(array['supervisor', 'administrador'])
  and usuario_carga_id = auth.uid()
  and estatus_importacion <> 'activo'
);

create policy documentos_update
on public.documentos_maestros
for update to authenticated
using (
  public.tiene_rol(array['supervisor', 'administrador'])
)
with check (
  public.tiene_rol(array['supervisor', 'administrador'])
  and estatus_importacion <> 'activo'
);

create policy referencias_select
on public.datos_referencia
for select to authenticated
using (true);

create policy referencias_insert
on public.datos_referencia
for insert to authenticated
with check (
  public.tiene_rol(array['supervisor', 'administrador'])
  and exists (
    select 1
      from public.documentos_maestros d
     where d.id = documento_id
       and d.estatus_importacion <> 'activo'
       and (
         d.usuario_carga_id = auth.uid()
         or public.tiene_rol(array['administrador'])
       )
  )
);

create policy referencias_update
on public.datos_referencia
for update to authenticated
using (
  public.tiene_rol(array['supervisor', 'administrador'])
  and exists (
    select 1
      from public.documentos_maestros d
     where d.id = documento_id
       and d.estatus_importacion <> 'activo'
  )
)
with check (
  public.tiene_rol(array['supervisor', 'administrador'])
  and exists (
    select 1
      from public.documentos_maestros d
     where d.id = documento_id
       and d.estatus_importacion <> 'activo'
  )
);

create policy referencias_delete
on public.datos_referencia
for delete to authenticated
using (
  public.tiene_rol(array['supervisor', 'administrador'])
  and exists (
    select 1
      from public.documentos_maestros d
     where d.id = documento_id
       and d.estatus_importacion <> 'activo'
  )
);

create policy capturas_select
on public.registros_captura
for select to authenticated
using (
  usuario_id = auth.uid()
  or public.tiene_rol(array['supervisor', 'administrador'])
);

create policy acciones_select
on public.acciones_revision
for select to authenticated
using (
  usuario_id = auth.uid()
  or public.tiene_rol(array['supervisor', 'administrador'])
);

-- ================================================================
-- 7. DATOS INICIALES OPCIONALES
-- ================================================================

insert into public.turnos (nombre, codigo, hora_inicio, hora_fin)
values
  ('PXG TEQUILA', 'PXG', '06:00', '14:00')
on conflict (nombre) do nothing;

commit;

-- ================================================================
-- 8. EJEMPLOS DE USO
-- ================================================================
-- Promover un usuario existente desde SQL Editor:
-- update public.perfiles_usuarios
--    set rol = 'supervisor'
--  where id = 'UUID_DEL_USUARIO';

-- Registrar una captura desde la aplicación con Supabase JS:
-- const { data, error } = await supabase.rpc('registrar_captura', {
--   p_orden: 'OP-240981',
--   p_numero_parte: 'PN-RA-4102',
--   p_sh: 'SH-MTY-01',
--   p_turno_id: 'UUID_DEL_TURNO',
--   p_idempotency_key: crypto.randomUUID()
-- });

-- Confirmar una salida desde la aplicación:
-- const { data, error } = await supabase.rpc('confirmar_revision', {
--   p_registro_id: 'UUID_DEL_REGISTRO',
--   p_nuevo_estatus: 'confirmado',
--   p_motivo: null,
--   p_observaciones: 'Material enviado a producción.'
-- });

-- ================================================================
-- 9. CONSULTAS DE VERIFICACIÓN
-- ================================================================
-- select * from public.perfiles_usuarios;
-- select * from public.turnos order by hora_inicio;
-- select * from public.documentos_maestros order by fecha_carga desc;
-- select * from public.registros_captura order by fecha_hora_captura desc;
-- select * from public.acciones_revision order by fecha_hora desc;
