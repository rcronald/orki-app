-- Lo importado del Catalogue of Life siempre trae su referencia (issue #74, parte de #8).
--
-- Igual que species_gbif_has_source_ref para 'gbif': una especie con source = 'col' tiene
-- que llevar su identificador de COL en source_ref, porque la importación la vuelve a
-- encontrar por (source, source_ref) para actualizarla sin duplicar (restricción única
-- species_source_ref_key). Sin la referencia, cada recarga crearía una especie nueva o
-- chocaría con el nombre.
--
-- Va en una migración aparte de la que añade el valor 'col' al enumerado: ese valor solo se
-- puede usar después de que se confirme la transacción que lo añade (ver
-- 20261120220000_fuente_col_en_especies.sql).
--
-- Al añadirla, Postgres comprueba las filas que ya hay. Ninguna puede usar 'col' todavía,
-- así que no falla. Mientras se comprueba, bloquea la escritura en species; con el catálogo
-- actual es un momento.

alter table public.species
  add constraint species_col_has_source_ref check (source <> 'col' or source_ref is not null);

comment on type public.species_source is
  'Fuente de la especie: col (Catalogue of Life, la importación del catálogo), gbif (GBIF Backbone, sin uso), curated (lista curada) o user_proposal (propuesta de un usuario).';
