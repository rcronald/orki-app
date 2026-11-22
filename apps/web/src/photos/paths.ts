// Rutas de las fotos de plantas en el bucket privado (#80, #82, #83).
//
// Convención obligatoria (supabase/migrations/20261121090000_bucket_de_fotos_de_plantas.sql
// y la sección "Fotos de plantas (Storage)" de supabase/README.md):
//
//   <id de usuario de Clerk>/<id de la planta en minúsculas>/photo-<versión>.<webp|jpg>
//   <id de usuario de Clerk>/<id de la planta en minúsculas>/thumb-<versión>.<webp|jpg>
//
// - El primer segmento es el dueño: las políticas de Storage solo miran ese.
// - <versión> es nueva en cada foto y la misma para la foto y su miniatura.
//   Con la versión en el nombre, una ruta nunca cambia de contenido: se puede
//   cachear para siempre (navegador, service worker, CDN de Storage).
// - plants.photo_path y plants.thumbnail_path guardan la ruta sin el nombre
//   del bucket.
//
// Módulo puro, sin dependencias ni API del navegador salvo crypto: lo importa
// también el script de limpieza (scripts/fotos-huerfanas.mjs) con Node, que
// ejecuta TypeScript quitando los tipos. Por eso solo usa sintaxis borrable.

/** Nombre del bucket de las fotos de plantas. */
export const PLANT_PHOTOS_BUCKET = 'plant-photos'

/**
 * Máximo de fotos por planta (#182, #219). La base lo garantiza con
 * plant_photos.position de 0 a 5 y única por planta; la app lo comprueba antes
 * de subir y el borrador del registro no guarda más.
 */
export const MAX_PLANT_PHOTOS = 6

/** Tipos que admite el bucket (allowed_mime_types). */
export type PlantPhotoType = 'image/webp' | 'image/jpeg'

export type PlantPhotoExtension = 'webp' | 'jpg'

export type PlantPhotoKind = 'photo' | 'thumb'

const EXTENSIONS: Record<PlantPhotoType, PlantPhotoExtension> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
}

const TYPES: Record<PlantPhotoExtension, PlantPhotoType> = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
}

/** Extensión del archivo según su tipo. */
export function extensionFor(type: PlantPhotoType): PlantPhotoExtension {
  return EXTENSIONS[type]
}

/** Tipo de contenido según la extensión de la ruta. */
export function typeForExtension(
  extension: PlantPhotoExtension,
): PlantPhotoType {
  return TYPES[extension]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
// Versión: letras minúsculas, cifras y guiones (un uuid o una marca en base 36).
const VERSION = /^[0-9a-z][0-9a-z-]{0,63}$/

/** ¿Es un id de usuario usable como primer segmento? (no vacío y sin "/") */
function isUserSegment(userId: string): boolean {
  return userId !== '' && !userId.includes('/') && userId.trim() === userId
}

/**
 * Versión nueva para una foto: un uuid aleatorio (crypto.randomUUID). La
 * misma para la foto y su miniatura.
 */
export function newPhotoVersion(): string {
  return crypto.randomUUID()
}

/** Carpeta de una planta, con la barra final: "<usuario>/<planta>/". */
export function plantFolder(userId: string, plantId: string): string {
  const plant = plantId.toLowerCase()
  if (!isUserSegment(userId)) {
    throw new Error('Id de usuario no válido para la ruta de la foto.')
  }
  if (!UUID.test(plant)) {
    throw new Error('Id de planta no válido para la ruta de la foto.')
  }
  return `${userId}/${plant}/`
}

export interface PlantPhotoPaths {
  /** Ruta de la foto dentro del bucket (plants.photo_path). */
  photoPath: string
  /** Ruta de la miniatura dentro del bucket (plants.thumbnail_path). */
  thumbnailPath: string
}

export interface PlantPhotoPathsInput {
  userId: string
  plantId: string
  version: string
  photoType: PlantPhotoType
  thumbnailType: PlantPhotoType
}

/** Rutas de la foto y la miniatura de una versión, con la convención exacta. */
export function plantPhotoPaths({
  userId,
  plantId,
  version,
  photoType,
  thumbnailType,
}: PlantPhotoPathsInput): PlantPhotoPaths {
  const folder = plantFolder(userId, plantId)
  if (!VERSION.test(version)) {
    throw new Error('Versión no válida para la ruta de la foto.')
  }
  return {
    photoPath: `${folder}photo-${version}.${extensionFor(photoType)}`,
    thumbnailPath: `${folder}thumb-${version}.${extensionFor(thumbnailType)}`,
  }
}

export interface ParsedPhotoPath {
  userId: string
  plantId: string
  kind: PlantPhotoKind
  version: string
  extension: PlantPhotoExtension
}

const FILE = /^(photo|thumb)-([0-9a-z][0-9a-z-]{0,63})\.(webp|jpg)$/

/** Descompone una ruta del bucket; null si no sigue la convención. */
export function parsePhotoPath(path: string): ParsedPhotoPath | null {
  const segments = path.split('/')
  if (segments.length !== 3) return null
  const [userId, plantId, file] = segments as [string, string, string]
  if (!isUserSegment(userId) || !UUID.test(plantId)) return null
  const match = FILE.exec(file)
  if (!match) return null
  return {
    userId,
    plantId,
    kind: match[1] as PlantPhotoKind,
    version: match[2],
    extension: match[3] as PlantPhotoExtension,
  }
}
