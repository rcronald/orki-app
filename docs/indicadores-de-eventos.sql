-- Indicadores de los dos objetivos de la Fase 1, a partir de public.product_events (#145, #24).
--
--   - Registro: porcentaje de registros completados en menos de 1 minuto.
--   - "¿Ya la tengo?": porcentaje de búsquedas respondidas en menos de 5 segundos.
--
-- Una fila por semana (de lunes a domingo, en hora de Lima, por cuándo ocurrió el evento en el
-- dispositivo) con el total, cuántos cumplen el objetivo y su porcentaje, y la mediana y el
-- percentil 90 de la duración en milisegundos. Solo salen las semanas con eventos. Cuentan
-- también los eventos generados sin conexión (columna aparte); su hora es la original.
--
-- Cómo se ejecutan: la API no deja leer los eventos a nadie, así que se consultan como dueño
-- de la tabla, en el editor SQL del proyecto de Supabase de cada ambiente (desarrollo o
-- producción) o con una conexión directa (psql). Este archivo crea dos vistas temporales, que
-- solo existen en la sesión y desaparecen al cerrarla, y después las consulta:
--
--   select * from indicador_registro;
--   select * from indicador_ya_la_tengo;
--
-- El editor SQL de Supabase muestra solo el resultado de la última sentencia; para ver los
-- dos, ejecuta el archivo y después cada select por separado, o cambia el orden.
--
-- Las pruebas (supabase/tests/eventos_de_producto.sql) cargan este mismo archivo sobre datos de
-- prueba y comprueban sus resultados: si cambias una consulta, ajusta allí lo esperado.

create or replace temporary view indicador_registro as
select
  date_trunc('week', e.occurred_at at time zone 'America/Lima')::date as semana,
  count(*) as registros,
  count(*) filter (where e.duration_ms < 60000) as en_menos_de_1_minuto,
  round(100.0 * count(*) filter (where e.duration_ms < 60000) / count(*), 1) as porcentaje,
  round(percentile_cont(0.5) within group (order by e.duration_ms)) as mediana_ms,
  round(percentile_cont(0.9) within group (order by e.duration_ms)) as p90_ms,
  count(*) filter (where e.generated_offline) as sin_conexion
from public.product_events e
where e.type = 'plant_registered'
group by 1
order by 1;

create or replace temporary view indicador_ya_la_tengo as
select
  date_trunc('week', e.occurred_at at time zone 'America/Lima')::date as semana,
  count(*) as busquedas,
  count(*) filter (where e.duration_ms < 5000) as en_menos_de_5_segundos,
  round(100.0 * count(*) filter (where e.duration_ms < 5000) / count(*), 1) as porcentaje,
  round(percentile_cont(0.5) within group (order by e.duration_ms)) as mediana_ms,
  round(percentile_cont(0.9) within group (order by e.duration_ms)) as p90_ms,
  count(*) filter (where e.generated_offline) as sin_conexion
from public.product_events e
where e.type = 'have_it_search'
group by 1
order by 1;

select * from indicador_registro;

select * from indicador_ya_la_tengo;
