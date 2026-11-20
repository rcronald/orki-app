-- Fuente "col" para las especies importadas del Catalogue of Life (issue #74, parte de #8).
--
-- La importación del catálogo toma las especies del Catalogue of Life eXtended Release
-- (COL XR), que es hoy la taxonomía principal de GBIF, y no del GBIF Backbone, congelado desde
-- 2023 (decisión del issue #72; la investigación está en scripts/catalog-import/FUENTE.md).
-- Lo importado se registra con source = 'col' y su identificador alfanumérico de COL en
-- source_ref (por ejemplo "4FR2J" para Phalaenopsis amabilis).
--
-- El valor 'gbif' se conserva: quitar un valor de un enumerado obliga a recrear el tipo y
-- nadie lo usa, pero no estorba.
--
-- Va sola en su propia migración porque un valor recién añadido a un enumerado no se puede
-- usar en la misma transacción en la que se añade ("unsafe use of new value"), y cada
-- migración se aplica en una transacción (la CLI de Supabase y scripts/db-desechable). La
-- restricción que exige source_ref a lo importado de COL, que sí usa el valor, va en la
-- migración siguiente, 20261120220100_col_exige_referencia.sql.
--
-- "if not exists" la hace repetible sin error.

alter type public.species_source add value if not exists 'col';
