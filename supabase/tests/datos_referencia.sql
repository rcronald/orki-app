-- Datos de referencia que cargan las migraciones (también en producción).

-- prueba: los cinco géneros de acceso rápido existen con su abreviatura de la RHS
select pruebas.iguales(
  'géneros de acceso rápido y sus abreviaturas',
  (select string_agg(g.name || '=' || a.abbreviation, ', ' order by g.name)
     from public.genera g
     join public.genus_abbreviations a on a.genus_id = g.id
     where g.is_quick_access),
  'Cattleya=C., Dendrobium=Den., Oncidium=Onc., Phalaenopsis=Phal., Vanda=V.'
);

-- prueba: solo esos cinco géneros son de acceso rápido y cada género tiene una sola abreviatura
-- Los cinco de la migración del catálogo y los 38 de la migración de abreviaturas (#69); la
-- lista completa se comprueba en busqueda_generos_y_abreviaturas.sql.
select pruebas.iguales(
  'géneros de acceso rápido',
  (select count(*) from public.genera where is_quick_access),
  5::bigint
);
select pruebas.iguales('géneros cargados', (select count(*) from public.genera), 43::bigint);
select pruebas.iguales(
  'abreviaturas cargadas',
  (select count(*) from public.genus_abbreviations),
  43::bigint
);
select pruebas.iguales(
  'géneros sin una única abreviatura',
  (select count(*) from public.genera g
     where (select count(*) from public.genus_abbreviations a where a.genus_id = g.id) <> 1),
  0::bigint
);

-- prueba: las migraciones no cargan perfiles ni plantas
select pruebas.iguales('perfiles', (select count(*) from public.profiles), 0::bigint);
select pruebas.iguales('plantas', (select count(*) from public.plants), 0::bigint);
