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

// Fotos de referencia de las especies (#234): una por especie, con licencia abierta. Con sesión
// se leen de la tabla; nadie las escribe por la API (las escribe la carga) y el administrador
// solo las retira con retire_species_photo(). Ver «Fotos de referencia» en supabase/README.md.

/** Licencias aceptadas, con los códigos de iNaturalist (restricción species_photos_license_accepted). */
export const speciesPhotoLicenses = ['cc0', 'pd', 'cc-by', 'cc-by-sa'] as const
export type SpeciesPhotoLicense = (typeof speciesPhotoLicenses)[number]
/** Cómo eligió la carga la foto: la foto por defecto del taxón, otra del taxón o una de observación. */
export type SpeciesPhotoSelection =
  'taxon_default' | 'taxon_photo' | 'observation'
/** Por qué se retiró una foto (restricción species_photo_rejections_reason_valid). */
export type SpeciesPhotoRejectionReason =
  'misidentified' | 'inappropriate' | 'author_request' | 'other'

/**
 * Una fila de species_photos. Los tipos generados no saben que license y source_selection son
 * listas cerradas (son texto con una restricción), así que aquí se precisan.
 */
export type SpeciesPhoto = Omit<
  Tables<'species_photos'>,
  'license' | 'source_selection'
> & {
  license: SpeciesPhotoLicense
  source_selection: SpeciesPhotoSelection | null
}

// La memoria de las fotos retiradas solo se lee (solo la ven los administradores).
export type SpeciesPhotoRejection = Omit<
  Tables<'species_photo_rejections'>,
  'reason'
> & { reason: SpeciesPhotoRejectionReason }

// El identificador del ejemplar (#264): code ('CAT-012') es una columna generada a partir de
// code_prefix y code_number, que pone la base al insertar y no cambian. Los tipos generados
// dan code como nullable (lo hacen con toda columna generada), pero nunca es null. Ni Insert ni
// Update lo llevan: la API rechaza escribirlo. Ver «Identificador del ejemplar» en
// supabase/README.md.
type PlantCodeColumns = 'code' | 'code_prefix' | 'code_number'
export type Plant = Omit<Tables<'plants'>, 'code'> & { code: string }
export type PlantInsert = Omit<TablesInsert<'plants'>, PlantCodeColumns>
export type PlantUpdate = Omit<TablesUpdate<'plants'>, PlantCodeColumns>

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

// Bitácora de una planta (#264): se crea con add_plant_log_entry (con idempotency_key para
// reintentar sin duplicar) y se lee con list_plant_log_entries (de la más reciente a la más
// antigua, con filtro por tipo y cursor). No se edita; el dueño puede borrar. Ver «Bitácora»
// en supabase/README.md.
export type PlantLogEntry = Tables<'plant_log_entries'>
/** Parámetros de add_plant_log_entry: photo_path y thumbnail_path en <usuario>/<planta>/log/. */
export type AddPlantLogEntryArgs =
  Database['public']['Functions']['add_plant_log_entry']['Args']
/** Parámetros de list_plant_log_entries: el cursor es created_at e id del último leído, o ninguno. */
export type ListPlantLogEntriesArgs =
  Database['public']['Functions']['list_plant_log_entries']['Args']

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

/** El resultado de retirar la foto de referencia de una especie (retire_species_photo). */
export type RetireSpeciesPhotoResult =
  Database['public']['Functions']['retire_species_photo']['Returns'][number]

/** La vista previa de una fusión de especies (preview_species_merge). */
export type SpeciesMergePreviewRow =
  Database['public']['Functions']['preview_species_merge']['Returns'][number]

/** El resultado de una fusión de especies (merge_species). */
export type SpeciesMergeResultRow =
  Database['public']['Functions']['merge_species']['Returns'][number]

// Catálogo público (#231): las cuatro funciones que pueden llamar los visitantes sin sesión
// (anon) y los usuarios con sesión. Ver "Catálogo público" en supabase/README.md.

/**
 * La miniatura de referencia de una especie en la búsqueda y en las especies de un género
 * (columna reference_thumbnail, #234). Las rutas son del bucket público species-photos, sin el
 * nombre del bucket (supabase.storage.from('species-photos').getPublicUrl(thumbnail_path)).
 * Se muestra siempre como foto de referencia, con el autor y la licencia, enlazando a source_url.
 */
export type ReferenceThumbnail = {
  thumbnail_path: string
  thumbnail_width: number
  thumbnail_height: number
  author_name: string
  license: SpeciesPhotoLicense
  source: SpeciesPhotoSource
  /** Página de la foto en la fuente (https://www.inaturalist.org/photos/<id>). */
  source_url: string
  /** Si la imagen está adaptada (reducida y convertida): la atribución lo dice. */
  is_modified: boolean
}

/** La foto de referencia de la ficha (columna reference_photo de get_public_species, #234). */
export type ReferencePhoto = ReferenceThumbnail & {
  medium_path: string
  medium_width: number
  medium_height: number
  /** El texto de atribución que da la fuente («(c) Ana Pérez, some rights reserved (CC BY)»). */
  attribution: string
  /** Si la foto salió de una observación de iNaturalist, su id (https://www.inaturalist.org/observations/<id>). */
  source_observation_id: string | null
  /** Cuándo la obtuvo la carga (ISO 8601). */
  obtained_at: string
}

// Las columnas de la foto (#234) se añadieron al final de tres funciones. Aquí son opcionales,
// para que el código y los datos de prueba escritos antes sigan compilando sin cambios: la base
// siempre las devuelve, nulas si la especie no tiene foto.

/** Un resultado de la búsqueda pública (search_public_species): como search_species, sin el estado. */
export type PublicSpeciesSearchRow = Omit<
  Database['public']['Functions']['search_public_species']['Returns'][number],
  'reference_thumbnail'
> & { reference_thumbnail?: ReferenceThumbnail | null }

/** Un género con su número de especies públicas, en una página de list_public_genera. */
export type PublicGenusRow =
  Database['public']['Functions']['list_public_genera']['Returns'][number]

/** Una especie de un género, en una página de list_public_genus_species. */
export type PublicGenusSpeciesRow = Omit<
  Database['public']['Functions']['list_public_genus_species']['Returns'][number],
  'reference_thumbnail'
> & { reference_thumbnail?: ReferenceThumbnail | null }

/** Un nombre común de la ficha pública: el idioma es opcional («es», «en», «pt-BR»). */
export type PublicCommonName = { name: string; language: string | null }

/**
 * La ficha de una especie (get_public_species). Los tipos generados no saben que source_ref
 * es nulo salvo en las fuentes externas (col, gbif) ni la forma de common_names (jsonb), así
 * que aquí se precisan.
 */
export type PublicSpeciesDetail = Omit<
  Database['public']['Functions']['get_public_species']['Returns'][number],
  'source_ref' | 'common_names' | 'reference_photo'
> & {
  source_ref: string | null
  common_names: PublicCommonName[]
  reference_photo?: ReferencePhoto | null
}

// Enumerados ---------------------------------------------------------------------------

export type SpeciesType = Enums<'species_type'>
export type SpeciesStatus = Enums<'species_status'>
export type SpeciesSource = Enums<'species_source'>
export type SpeciesNameType = Enums<'species_name_type'>
/** Fuente de una foto de referencia (hoy solo iNaturalist). */
export type SpeciesPhotoSource = Enums<'species_photo_source'>
/** Por qué nombre coincidió una especie en la búsqueda: científico, sinónimo o común. */
export type SpeciesMatchType = Enums<'species_match_type'>
export type PlantType = Enums<'plant_type'>
export type PlantStatus = Enums<'plant_status'>
export type PlantValidation = Enums<'plant_validation'>
export type FlowerColor = Enums<'flower_color'>
/** Tipo de registro de bitácora: riego, nutrición, mantenimiento o sanidad preventivos. */
export type PlantLogEntryType = Enums<'plant_log_entry_type'>
/** Tipo de evento de producto: registro completado o búsqueda "¿Ya la tengo?". */
export type ProductEventType = Enums<'product_event_type'>
/** Resultado de una búsqueda "¿Ya la tengo?": la tengo, no la tengo o parecidas. */
export type ProductEventResult = Enums<'product_event_result'>

/**
 * Valores de cada enumerado en el orden en que los declara la base de datos, para recorrerlos
 * en la interfaz (selectores, filtros). Los textos en español los pone la interfaz.
 */
export const enumValues = Constants.public.Enums
