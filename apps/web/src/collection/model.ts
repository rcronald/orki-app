import type {
  FlowerColor,
  Genus,
  Plant,
  PlantPhoto,
  PlantStatus,
  PlantType,
  PlantValidation,
  Species,
  SpeciesStatus,
  SpeciesType,
} from '../lib/database.ts'

// Modelo de la colección en memoria (issue #93).
//
// Una planta de la colección es la fila de public.plants con su especie y su
// género embebidos, con los nombres en camelCase. Lo usan la lista y la
// cuadrícula (#94, #95), los filtros (#15), el detalle y la edición (#16), la
// exportación (#17), la caché local (#18) y "¿Ya la tengo?" (#19).
//
// Lo que no está porque el esquema no lo guarda: la fecha de la baja (el
// estado "lost" o "gifted" no lleva fecha; ver la decisión pendiente del #16)
// ni el motivo en texto. user_id tampoco se copia: la colección en memoria es
// siempre la del usuario activo (ver store.ts).

/**
 * Columnas que se piden a PostgREST: todas las de la planta que usa la app y,
 * embebidas por su clave foránea, la especie (nombre científico, tipo y estado)
 * y el género (nombre). El alias "species:species_id" deja el objeto embebido
 * con un nombre propio y fija la relación por la columna, sin ambigüedad.
 *
 * Las pantallas que escriban una planta (#11, #16) pueden pedir de vuelta las
 * mismas columnas (.select(COLLECTION_PLANT_SELECT)) y pasar la fila por
 * toCollectionPlant() para reflejarla en la colección sin volver a leerla.
 *
 * photo_count es un campo calculado (public.photo_count(plants), #184): el
 * número de filas de plant_photos de la planta, de 0 a 6.
 *
 * La foto principal (#186) llega embebida de plant_photos por su clave
 * foránea (plant_photos_plant_id_fkey): sus rutas, si es en floración y su
 * posición. No se leen plants.photo_path, thumbnail_path ni photo_in_bloom,
 * que la base mantiene solo como copia para las versiones anteriores de la
 * app y se retirarán. Cada consulta pasa por withMainPhotoOnly(), que pide
 * a PostgREST solo la de position más baja; toCollectionPlant() elige igual
 * la de posición más baja de lo que llegue, así que el resultado no depende
 * de ese límite (solo el tamaño de la respuesta). Hace falta: en la
 * respuesta de un update (PATCH), PostgREST 12.2 no aplica el orden ni el
 * límite de la tabla embebida y devuelve todas las fotos, sin orden (se
 * comprobó con PostgREST v12.2.12 y el esquema de las migraciones). En la
 * respuesta de un insert la lista llega vacía: la planta es nueva.
 *
 * code y notes (#264, #265): el identificador que pone la base al dar de alta
 * la planta («CAT-012», no cambia) y sus notas libres (hasta 2000 caracteres,
 * null si no tiene). Van al final para que el cambio se lea solo.
 */
export const COLLECTION_PLANT_SELECT =
  'id, entered_name, type, validation, status, acquired_on, origin, location, nickname, flower_color, plant_photos (photo_path, thumbnail_path, in_bloom, position), photo_count, created_at, updated_at, species:species_id (id, scientific_name, type, status), genus:genus_id (id, name), code, notes'

/** Tabla embebida con la foto principal (ver COLLECTION_PLANT_SELECT). */
export const MAIN_PHOTO_TABLE = 'plant_photos'

/** Lo que hace falta de una consulta para limitar la foto embebida. */
interface EmbeddedPhotoModifiers<Query> {
  order(
    column: string,
    options: { ascending?: boolean; referencedTable: string },
  ): Query
  limit(count: number, options: { referencedTable: string }): Query
}

/**
 * Pide de plant_photos solo la foto principal, la de position más baja:
 * `plant_photos.order=position.asc&plant_photos.limit=1`. Va en toda
 * consulta con COLLECTION_PLANT_SELECT, también en la respuesta de un insert
 * o un update, antes de .single() o .maybeSingle(). Solo reduce lo que viaja:
 * quien elige la principal es toCollectionPlant() (ver arriba).
 */
export function withMainPhotoOnly<Query extends EmbeddedPhotoModifiers<Query>>(
  query: Query,
): Query {
  return query
    .order('position', { ascending: true, referencedTable: MAIN_PHOTO_TABLE })
    .limit(1, { referencedTable: MAIN_PHOTO_TABLE })
}

/** Fila tal como la devuelve la consulta de COLLECTION_PLANT_SELECT. */
export type CollectionPlantRow = Pick<
  Plant,
  | 'id'
  | 'entered_name'
  | 'type'
  | 'validation'
  | 'status'
  | 'acquired_on'
  | 'origin'
  | 'location'
  | 'nickname'
  | 'flower_color'
  | 'created_at'
  | 'updated_at'
  | 'notes'
> & {
  /**
   * Identificador (#264). Nunca es null en la base, pero los tipos generados
   * dan nullable toda columna generada y postgrest-js lo infiere así.
   */
  code: string | null
  /**
   * Número de fotos (campo calculado). Opcional en el tipo: una fila sin él
   * (una respuesta simulada antigua, por ejemplo) se trata con photoCountOf().
   */
  photo_count?: number | null
  /**
   * La foto principal, embebida de plant_photos: una lista con una foto o
   * vacía si la planta no tiene. Opcional en el tipo por las respuestas
   * simuladas; sin ella, la planta no tiene foto.
   */
  plant_photos?: readonly CollectionPlantPhotoRow[] | null
  species: Pick<Species, 'id' | 'scientific_name' | 'type' | 'status'> | null
  genus: Pick<Genus, 'id' | 'name'>
}

/** Una foto embebida de plant_photos (ver COLLECTION_PLANT_SELECT). */
export type CollectionPlantPhotoRow = Pick<
  PlantPhoto,
  'photo_path' | 'thumbnail_path' | 'in_bloom' | 'position'
>

/** Especie del catálogo enlazada a la planta. */
export interface CollectionSpecies {
  id: string
  scientificName: string
  type: SpeciesType
  status: SpeciesStatus
}

/** Género de la planta (el de su especie si la tiene; si no, el que eligió el usuario). */
export interface CollectionGenus {
  id: string
  name: string
}

/** Una planta de la colección, lista para mostrar, filtrar y exportar. */
export interface CollectionPlant {
  id: string
  /** Nombre que se muestra: el de la especie enlazada o, si no hay, el ingresado. */
  displayName: string
  /**
   * Si displayName es un nombre científico del catálogo (para la cursiva). Un
   * nombre ingresado sin especie no se da por científico: está "por validar".
   */
  displayNameIsScientific: boolean
  /** Nombre tal como lo ingresó el usuario; se conserva aunque se enlace. */
  enteredName: string
  species: CollectionSpecies | null
  genus: CollectionGenus
  type: PlantType
  validation: PlantValidation
  status: PlantStatus
  /** Fecha de adquisición, "AAAA-MM-DD" (fecha local del usuario, sin hora). */
  acquiredOn: string
  /** Fecha de alta del registro (ISO 8601 con zona). */
  createdAt: string
  /** Última modificación del registro (ISO 8601 con zona). */
  updatedAt: string
  origin: string | null
  location: string | null
  nickname: string | null
  flowerColor: FlowerColor | null
  /**
   * Si la foto principal es en floración (plant_photos.in_bloom de la
   * principal); false sin foto.
   */
  photoInBloom: boolean
  /**
   * Ruta de la foto principal en el almacenamiento privado (#10), no una
   * dirección; null sin foto. Sale de plant_photos (#186).
   */
  photoPath: string | null
  /** Ruta de la miniatura de la principal, como photoPath. */
  thumbnailPath: string | null
  /**
   * Número de fotos de la planta (#184), de 0 a 6; la principal es la de
   * photoPath. Para un indicador discreto en la tarjeta cuando hay más de una
   * (aún sin pintar). Viene de la lectura de la planta; tras añadir o quitar
   * fotos, la galería relee la planta (gallery.ts). Una copia sin conexión
   * guardada antes del #184 no lo trae: fromStoredCopy() lo deduce con
   * photoCountOf() (1 si hay principal, 0 si no) hasta la siguiente lectura.
   */
  photoCount: number
  /**
   * Identificador del ejemplar (#264): «CAT-012», tres letras del género con
   * el que se dio de alta y un correlativo. Lo pone la base y no cambia. null
   * solo en una copia sin conexión guardada antes del #265, hasta la
   * siguiente lectura (fromStoredCopy).
   */
  code: string | null
  /** Notas libres de la persona (#264), hasta 2000 caracteres; null si no hay. */
  notes: string | null
}

/**
 * Número de fotos de una planta a partir de lo leído: photo_count si llegó y,
 * como mínimo, 1 si tiene principal. El mínimo cubre las filas sin el dato
 * (copias y respuestas anteriores al #184). La app ya no crea la principal
 * desde plants (#186), pero una respuesta que la creara en la misma sentencia
 * traería el recuento de antes (ver la migración 20261124090000).
 */
export function photoCountOf(
  photoCount: unknown,
  photoPath: string | null,
): number {
  const main = photoPath === null ? 0 : 1
  return typeof photoCount === 'number' && Number.isInteger(photoCount)
    ? Math.max(photoCount, main)
    : main
}

/** La foto principal de lo embebido: la de position más baja, o null. */
export function mainPhotoOf(
  photos: readonly CollectionPlantPhotoRow[] | null | undefined,
): CollectionPlantPhotoRow | null {
  let main: CollectionPlantPhotoRow | null = null
  for (const photo of photos ?? []) {
    if (main === null || photo.position < main.position) main = photo
  }
  return main
}

/** Pasa una fila de la consulta al modelo de la colección. */
export function toCollectionPlant(row: CollectionPlantRow): CollectionPlant {
  const main = mainPhotoOf(row.plant_photos)
  const species: CollectionSpecies | null = row.species
    ? {
        id: row.species.id,
        scientificName: row.species.scientific_name,
        type: row.species.type,
        status: row.species.status,
      }
    : null
  return {
    id: row.id,
    displayName: species?.scientificName ?? row.entered_name,
    displayNameIsScientific: species !== null,
    enteredName: row.entered_name,
    species,
    genus: { id: row.genus.id, name: row.genus.name },
    type: row.type,
    validation: row.validation,
    status: row.status,
    acquiredOn: row.acquired_on,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    origin: row.origin,
    location: row.location,
    nickname: row.nickname,
    flowerColor: row.flower_color,
    photoInBloom: main?.in_bloom ?? false,
    photoPath: main?.photo_path ?? null,
    thumbnailPath: main?.thumbnail_path ?? null,
    photoCount: photoCountOf(row.photo_count, main?.photo_path ?? null),
    code: row.code,
    notes: row.notes,
  }
}
