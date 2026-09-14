-- TRAZA: un único turno operativo para PXG TEQUILA
-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Conserva los registros históricos y solo desactiva los turnos adicionales.

begin;

do $$
declare
  v_turno_id uuid;
begin
  -- Reutiliza PXG TEQUILA si ya existe; si no, reutiliza el antiguo Primer turno.
  select id
    into v_turno_id
    from public.turnos
   where nombre = 'PXG TEQUILA'
      or codigo = 'PXG'
      or nombre = 'Primer turno'
      or codigo = 'T1'
   order by case
     when nombre = 'PXG TEQUILA' then 1
     when codigo = 'PXG' then 2
     when nombre = 'Primer turno' then 3
     when codigo = 'T1' then 4
     else 5
   end
   limit 1;

  if v_turno_id is null then
    insert into public.turnos (nombre, codigo, hora_inicio, hora_fin, zona_horaria, activo)
    values ('PXG TEQUILA', 'PXG', '06:00', '14:00', 'America/Monterrey', true)
    returning id into v_turno_id;
  else
    update public.turnos
       set nombre = 'PXG TEQUILA',
           codigo = 'PXG',
           hora_inicio = '06:00',
           hora_fin = '14:00',
           zona_horaria = 'America/Monterrey',
           activo = true
     where id = v_turno_id;
  end if;

  update public.turnos
     set activo = false
   where id <> v_turno_id;
end $$;

commit;

-- Verificación esperada: solo una fila activa.
select id, nombre, codigo, hora_inicio, hora_fin, activo
  from public.turnos
 where activo = true
 order by hora_inicio;
