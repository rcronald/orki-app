// Alias de los tipos del esquema para el resto de la app.
//
// Los tipos salen de database.types.ts, que se genera con `npm run db:types` a partir de las
// migraciones; este módulo solo les pone nombres cómodos y no se regenera. Si una migración
// añade una tabla o un enumerado, añade aquí su alias.
//
// Por tabla hay tres formas: la fila tal como se lee (Row), lo que se envía al insertar
// (Insert: las columnas con valor por defecto son opcionales) y lo que se envía al actualizar
// (Update: todo opcional).

import {
  Constants,
  type Database,
  type Enums,
  type Tables,
  type TablesInsert,
  type TablesUpdate,
} from './database.types.ts'

export type { Database, Json } from './database.types.ts'

// Tablas -------------------------------------------------------------------------------

export type Genus = Tables<'genera'>
export type GenusInsert = TablesInsert<'genera'>
export type GenusUpdate = TablesUpdate<'genera'>

export type GenusAbbreviation = Tables<'genus_abbreviations'>
export type GenusAbbreviationInsert = TablesInsert<'genus_abbreviations'>
export type GenusAbbreviationUpdate = TablesUpdate<'genus_abbreviations'>

export type Species = Tables<'species'>
export type SpeciesInsert = TablesInsert<'species'>
export type SpeciesUpdate = TablesUpdate<'species'>

export type SpeciesName = Tables<'species_names'>
export type SpeciesNameInsert = TablesInsert<'species_names'>
export type SpeciesNameUpdate = TablesUpdate<'species_names'>

export type Profile = Tables<'profiles'>
export type ProfileInsert = TablesInsert<'profiles'>
export type ProfileUpdate = TablesUpdate<'profiles'>

// La auditoría del catálogo solo se lee: nadie la escribe por la API.
export type CatalogAuditLogRow = Tables<'catalog_audit_log'>

// La memoria de las fusiones de especies solo se lee: la escribe merge_species().
export type SpeciesMergeKey = Tables<'species_merge_keys'>

export type Plant = Tables<'plants'>
export type PlantInsert = TablesInsert<'plants'>
export type PlantUpdate = TablesUpdate<'plants'>

// Fotos de una planta (de 0 a 6; la principal es la de position más baja). La API solo deja
// cambiar photo_path, thumbnail_path, in_bloom, taken_at, note y position: una foto no cambia
// de planta ni de dueño (PlantPhotoUpdate lo refleja, aunque los tipos generados no).
export type PlantPhoto = Tables<'plant_photos'>
export type PlantPhotoInsert = TablesInsert<'plant_photos'>
export type PlantPhotoUpdate = Pick<
  TablesUpdate<'plant_photos'>,
  | 'photo_path'
  | 'thumbnail_path'
  | 'in_bloom'
  | 'taken_at'
  | 'note'
  | 'position'
>

// Eventos de producto: solo se insertan, con la función record_product_events (no hay
// Update, y la API no deja leer la tabla). user_id y received_at los pone la base.
export type ProductEvent = Tables<'product_events'>
/** Cada elemento del arreglo `events` de `record_product_events`. */
export type ProductEventPayload = Omit<
  TablesInsert<'product_events'>,
  'user_id' | 'received_at'
>

// Funciones ----------------------------------------------------------------------------

/** Una entrada del historial de una especie (species_history). */
export type SpeciesHistoryRow =
  Database['public']['Functions']['species_history']['Returns'][number]

/** La vista previa de una fusión de especies (preview_species_merge). */
export type SpeciesMergePreviewRow =
  Database['public']['Functions']['preview_species_merge']['Returns'][number]

/** El resultado de una fusión de especies (merge_species). */
export type SpeciesMergeResultRow =
  Database['public']['Functions']['merge_species']['Returns'][number]

// Catálogo público (#231): las cuatro funciones que pueden llamar los visitantes sin sesión
// (anon) y los usuarios con sesión. Ver "Catálogo público" en supabase/README.md.

/** Un resultado de la búsqueda pública (search_public_species): como search_species, sin el estado. */
export type PublicSpeciesSearchRow =
  Database['public']['Functions']['search_public_species']['Returns'][number]

/** Un género con su número de especies públicas, en una página de list_public_genera. */
export type PublicGenusRow =
  Database['public']['Functions']['list_public_genera']['Returns'][number]

/** Una especie de un género, en una página de list_public_genus_species. */
export type PublicGenusSpeciesRow =
  Database['public']['Functions']['list_public_genus_species']['Returns'][number]

/** Un nombre común de la ficha pública: el idioma es opcional («es», «en», «pt-BR»). */
export type PublicCommonName = { name: string; language: string | null }

/**
 * La ficha de una especie (get_public_species). Los tipos generados no saben que source_ref
 * es nulo salvo en las fuentes externas (col, gbif) ni la forma de common_names (jsonb), así
 * que aquí se precisan.
 */
export type PublicSpeciesDetail = Omit<
  Database['public']['Functions']['get_public_species']['Returns'][number],
  'source_ref' | 'common_names'
> & {
  source_ref: string | null
  common_names: PublicCommonName[]
}

// Enumerados ---------------------------------------------------------------------------

export type SpeciesType = Enums<'species_type'>
export type SpeciesStatus = Enums<'species_status'>
export type SpeciesSource = Enums<'species_source'>
export type SpeciesNameType = Enums<'species_name_type'>
/** Por qué nombre coincidió una especie en la búsqueda: científico, sinónimo o común. */
export type SpeciesMatchType = Enums<'species_match_type'>
export type PlantType = Enums<'plant_type'>
export type PlantStatus = Enums<'plant_status'>
export type PlantValidation = Enums<'plant_validation'>
export type FlowerColor = Enums<'flower_color'>
/** Tipo de evento de producto: registro completado o búsqueda "¿Ya la tengo?". */
export type ProductEventType = Enums<'product_event_type'>
/** Resultado de una búsqueda "¿Ya la tengo?": la tengo, no la tengo o parecidas. */
export type ProductEventResult = Enums<'product_event_result'>

/**
 * Valores de cada enumerado en el orden en que los declara la base de datos, para recorrerlos
 * en la interfaz (selectores, filtros). Los textos en español los pone la interfaz.
 */
export const enumValues = Constants.public.Enums
