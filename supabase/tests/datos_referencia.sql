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

-- prueba: solo esos cinco géneros son de acceso rápido y cada uno tiene una sola abreviatura
select pruebas.iguales(
  'géneros de acceso rápido',
  (select count(*) from public.genera where is_quick_access),
  5::bigint
);
select pruebas.iguales(
  'abreviaturas cargadas',
  (select count(*) from public.genus_abbreviations),
  5::bigint
);

-- prueba: las migraciones no cargan perfiles ni plantas
select pruebas.iguales('perfiles', (select count(*) from public.profiles), 0::bigint);
select pruebas.iguales('plantas', (select count(*) from public.plants), 0::bigint);
