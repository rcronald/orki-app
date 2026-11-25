import { MAX_PLANT_PHOTOS } from '../photos/paths.ts'
import type { ProcessedPhoto } from '../photos/process.ts'
import {
  draftPhotoKey,
  forgetOtherUsers,
  isPendingUploadKey,
  PENDING_UPLOAD_MARK,
  toDraftPhotoItem,
  type DraftPhotoBackend,
} from './draft-photo.ts'

// Fotos por subir de una planta ya registrada (#284).
//
// El registro guarda primero la planta y después sube sus fotos. Si la
// persona sale a mitad (tras confirmarlo), recarga, cierra la pestaña o se
// queda sin conexión, las fotos que no llegaron a subirse se conservan en el
// dispositivo ligadas a esa planta, y su ficha las ofrece como «Fotos
// pendientes de subir» (PendingPlantPhotos.tsx), con subirlas o descartarlas.
//
// - Dónde: en el mismo almacén de IndexedDB que las fotos de los borradores
//   (draft-photo.ts), con la clave `<usuario>/subir:<planta>`. Así las borra
//   lo mismo que a las de los borradores: al leer con otra cuenta (las de
//   otros usuarios) y al eliminar la cuenta (clearDraftPhoto, todas las del
//   usuario). pruneDraftPhotos no las toca: no son de un borrador.
// - Qué: por cada foto, el nombre del archivo, la foto ya preparada (los dos
//   Blob, como el borrador), si es «en floración» y la versión de sus rutas
//   en el bucket (photoVersionFor). Con la versión, la foto sube a las mismas
//   rutas que en el intento anterior: si llegó a guardarse sin que la entrada
//   se actualizara (la recarga se llevó la respuesta), la fila ya la cita y
//   no se duplica, y si solo llegaron los archivos, Storage responde 409 y se
//   dan por subidos. Va también el nombre de la planta, para nombrarla en el
//   registro sin leer la colección.
// - Cuándo se escribe: al guardar la planta, antes de borrar su borrador (que
//   tenía las fotos); después, cada foto que se sube se quita de la entrada.
// - Cuándo se borra: al quedar todas subidas, al elegir «Continuar sin ellas»
//   en el registro, al descartarlas en la ficha, a los
//   PENDING_UPLOAD_MAX_AGE_MS de la última escritura, al entrar con otra
//   cuenta y al eliminar la cuenta.
// - IndexedDB puede no existir o fallar (navegación privada: Safari no guarda
//   Blob ahí): todo va en try/catch y, si falla, la subida sigue igual, solo
//   que las fotos no sobreviven a salir de la pantalla. El registro lo dice
//   al pedir confirmación para salir.

/**
 * Caducidad desde la última escritura: siete días. Más que el borrador (24
 * horas): la planta ya existe y las fotos no se pueden volver a hacer.
 */
export const PENDING_UPLOAD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const FORMAT = 'fotos-por-subir'
const VERSION = 1
/** Versión de las rutas de una foto (paths.ts). */
const PHOTO_VERSION = /^[0-9a-z][0-9a-z-]{0,63}$/

/** Una foto por subir. */
export interface PendingUploadPhoto {
  fileName: string
  photo: ProcessedPhoto
  /** Versión de sus rutas en el bucket, la de su primer intento. */
  version: string
  inBloom: boolean
}

/** Las fotos por subir de una planta. */
export interface PendingUpload {
  plantId: string
  /** El nombre con el que se muestra la planta (displayName). */
  plantName: string
  /** Si el nombre es el científico del catálogo (va en cursiva). */
  plantNameIsScientific: boolean
  /** Última escritura, en milisegundos desde la época. */
  savedAt: number
  /** De 1 a 6, en el orden de la galería. */
  photos: PendingUploadPhoto[]
}

/** Clave de las fotos por subir de `plantId`. */
export function pendingUploadKey(userId: string, plantId: string): string {
  return draftPhotoKey(userId, `${PENDING_UPLOAD_MARK}${plantId.toLowerCase()}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toPhoto(value: unknown): PendingUploadPhoto | null {
  const item = toDraftPhotoItem(value)
  if (
    item === null ||
    !isRecord(value) ||
    typeof value.version !== 'string' ||
    !PHOTO_VERSION.test(value.version) ||
    typeof value.inBloom !== 'boolean'
  ) {
    return null
  }
  return { ...item, version: value.version, inBloom: value.inBloom }
}

/** Lo guardado si se entiende; null si no. */
function toPendingUpload(value: unknown): PendingUpload | null {
  if (
    !isRecord(value) ||
    value.format !== FORMAT ||
    value.version !== VERSION ||
    typeof value.plantId !== 'string' ||
    value.plantId === '' ||
    typeof value.plantName !== 'string' ||
    typeof value.plantNameIsScientific !== 'boolean' ||
    typeof value.savedAt !== 'number' ||
    !Number.isFinite(value.savedAt) ||
    !Array.isArray(value.photos)
  ) {
    return null
  }
  const items = value.photos as unknown[]
  if (items.length === 0 || items.length > MAX_PLANT_PHOTOS) return null
  const photos: PendingUploadPhoto[] = []
  for (const item of items) {
    const photo = toPhoto(item)
    if (photo === null) return null
    photos.push(photo)
  }
  return {
    plantId: value.plantId,
    plantName: value.plantName,
    plantNameIsScientific: value.plantNameIsScientific,
    savedAt: value.savedAt,
    photos,
  }
}

function isFresh(found: PendingUpload, now: Date): boolean {
  const age = now.getTime() - found.savedAt
  return age >= 0 && age <= PENDING_UPLOAD_MAX_AGE_MS
}

/** Lo de `key` si vale a la hora `now`; si no vale, lo borra y da null. */
async function readKey(
  backend: DraftPhotoBackend,
  key: string,
  now: Date,
): Promise<PendingUpload | null> {
  const raw: unknown = await backend.get(key)
  if (raw === undefined || raw === null) return null
  const found = toPendingUpload(raw)
  if (
    found === null ||
    !isFresh(found, now) ||
    key !== pendingUploadKeyOf(key, found)
  ) {
    await backend.delete(key)
    return null
  }
  return found
}

/** La clave donde deben estar las fotos de `found` (la del mismo usuario). */
function pendingUploadKeyOf(key: string, found: PendingUpload): string {
  const user = key.slice(0, key.lastIndexOf('/'))
  return pendingUploadKey(user, found.plantId)
}

/**
 * Las fotos por subir de la planta `plantId` del usuario; null si no hay o no
 * se pueden leer. Borra lo que no vale (caducado, otro formato) y lo de otros
 * usuarios.
 */
export async function readPendingUpload(
  backend: DraftPhotoBackend,
  userId: string,
  { plantId, now }: { plantId: string; now: Date },
): Promise<PendingUpload | null> {
  try {
    await forgetOtherUsers(backend, userId)
    return await readKey(backend, pendingUploadKey(userId, plantId), now)
  } catch {
    return null
  }
}

/**
 * Todas las fotos por subir del usuario, de la más reciente a la más antigua
 * (vacío si no hay o no se pueden leer). Borra lo que no vale y lo de otros
 * usuarios.
 */
export async function listPendingUploads(
  backend: DraftPhotoBackend,
  userId: string,
  { now }: { now: Date },
): Promise<PendingUpload[]> {
  const found: PendingUpload[] = []
  try {
    for (const key of await forgetOtherUsers(backend, userId)) {
      if (!isPendingUploadKey(key)) continue
      const upload = await readKey(backend, key, now)
      if (upload !== null) found.push(upload)
    }
  } catch {
    // Sin almacenamiento: ninguna.
  }
  return found.sort((a, b) => b.savedAt - a.savedAt)
}

/**
 * Guarda las fotos por subir de la planta, en lugar de las anteriores; sin
 * fotos, las borra. Devuelve false si no se pudo (o si son más de 6).
 */
export async function writePendingUpload(
  backend: DraftPhotoBackend,
  userId: string,
  upload: PendingUpload,
): Promise<boolean> {
  if (upload.photos.length > MAX_PLANT_PHOTOS) return false
  const key = pendingUploadKey(userId, upload.plantId)
  try {
    if (upload.photos.length === 0) {
      await backend.delete(key)
      return true
    }
    await backend.put(key, {
      format: FORMAT,
      version: VERSION,
      plantId: upload.plantId,
      plantName: upload.plantName,
      plantNameIsScientific: upload.plantNameIsScientific,
      savedAt: upload.savedAt,
      photos: upload.photos.map(({ fileName, photo, version, inBloom }) => ({
        fileName,
        photo,
        version,
        inBloom,
      })),
    })
    return true
  } catch {
    return false
  }
}

/** Borra las fotos por subir de la planta `plantId` del usuario. */
export async function clearPendingUpload(
  backend: DraftPhotoBackend,
  userId: string,
  plantId: string,
): Promise<void> {
  try {
    await backend.delete(pendingUploadKey(userId, plantId))
  } catch {
    // Sin almacenamiento no hay nada que borrar.
  }
}

/** Qué hacer con las fotos por subir, según las que ya tiene la planta. */
export interface PendingUploadPlan {
  /** Las que hay que subir (caben). */
  upload: PendingUploadPhoto[]
  /** Las que ya están en una fila (un intento anterior llegó a guardarlas). */
  stored: PendingUploadPhoto[]
  /** Las que no caben: la planta llegaría a más de seis. */
  leftOut: PendingUploadPhoto[]
}

/**
 * Reparte las fotos por subir de la planta según `storedPaths`, las rutas de
 * las fotos que ya tiene (photo_path de sus filas), y el máximo de seis: las
 * que ya están guardadas no se suben otra vez y, de las demás, solo las que
 * caben, en su orden. `pathOf` da la ruta de una foto en el bucket.
 */
export function planPendingUpload(
  photos: readonly PendingUploadPhoto[],
  storedPaths: readonly string[],
  pathOf: (photo: PendingUploadPhoto) => string,
): PendingUploadPlan {
  const stored = photos.filter((photo) => storedPaths.includes(pathOf(photo)))
  const rest = photos.filter((photo) => !stored.includes(photo))
  const room = Math.max(0, MAX_PLANT_PHOTOS - storedPaths.length)
  return {
    upload: rest.slice(0, room),
    stored,
    leftOut: rest.slice(room),
  }
}
