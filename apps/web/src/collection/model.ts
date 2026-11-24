import type {
  FlowerColor,
  Genus,
  Plant,
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
 * code y notes (#264, #265): el identificador que pone la base al dar de alta
 * la planta («CAT-012», no cambia) y sus notas libres (hasta 2000 caracteres,
 * null si no tiene). Van al final para que el cambio se lea solo.
 */
export const COLLECTION_PLANT_SELECT =
  'id, entered_name, type, validation, status, acquired_on, origin, location, nickname, flower_color, photo_in_bloom, photo_path, thumbnail_path, photo_count, created_at, updated_at, species:species_id (id, scientific_name, type, status), genus:genus_id (id, name), code, notes'

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
  | 'photo_in_bloom'
  | 'photo_path'
  | 'thumbnail_path'
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
  species: Pick<Species, 'id' | 'scientific_name' | 'type' | 'status'> | null
  genus: Pick<Genus, 'id' | 'name'>
}

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
  photoInBloom: boolean
  /** Ruta de la foto en el almacenamiento privado (#10), no una dirección. */
  photoPath: string | null
  /** Ruta de la miniatura en el almacenamiento privado (#10), no una dirección. */
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
 * (copias y respuestas anteriores al #184) y la respuesta de un insert o
 * update que crea la principal en la misma sentencia (la base devuelve el
 * recuento de antes; ver la migración 20261124090000).
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

/** Pasa una fila de la consulta al modelo de la colección. */
export function toCollectionPlant(row: CollectionPlantRow): CollectionPlant {
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
    photoInBloom: row.photo_in_bloom,
    photoPath: row.photo_path,
    thumbnailPath: row.thumbnail_path,
    photoCount: photoCountOf(row.photo_count, row.photo_path),
    code: row.code,
    notes: row.notes,
  }
}
