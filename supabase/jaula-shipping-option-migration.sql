-- JAULA: opción de entrega directa a Shipping.
-- Ejecutar una sola vez en Supabase > SQL Editor después de jaula-migration.sql.
-- No modifica ni elimina registros existentes.

alter type public.celda_produccion
  add value if not exists 'JAULA ( DIRECTO A SHIPPING)';
