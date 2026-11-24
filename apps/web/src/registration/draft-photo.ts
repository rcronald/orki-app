import { MAX_PLANT_PHOTOS } from '../photos/paths.ts'
import type { ProcessedPhoto } from '../photos/process.ts'
import { PLANT_DRAFT_MAX_AGE_MS } from './draft.ts'

// Fotos pendientes de los borradores del registro (#87; varias desde el #219;
// una entrada por borrador desde el #296). Lo escrito va en localStorage
// (draft.ts); cada foto ya preparada son dos Blob (foto y miniatura, unos
// 200-300 KB), que no caben ahí: van en IndexedDB, que guarda Blob tal cual.
//
// Para qué sirve: si iOS descarga la app instalada después de elegir las
// fotos (por ejemplo, al salir a otra app a buscar el nombre), al volver se
// recuperan lo escrito y las fotos, en su orden. No cubre la recarga que
// ocurre mientras la cámara está abierta: entonces la foto aún no llegó a la
// página y hay que volver a tomarla; lo escrito sí se conserva.
//
// - Una entrada por borrador, con hasta 6 fotos en orden (la primera será la
//   principal), con la clave draftPhotoKey(usuario, id de planta): así, dejar
//   un borrador para después (#296) no mueve sus fotos, y guardar las de un
//   borrador no reescribe las del otro. Hasta el #296 había una sola entrada
//   por usuario, con la clave del id de Clerk y el id de planta dentro: se
//   sigue leyendo como la del borrador de ese id, y se borra al escribir las
//   de ese borrador.
// - Al leer se borran las de otros usuarios: una foto no aparece con otra
//   cuenta. pruneDraftPhotos borra además las de borradores que ya no existen
//   (sin borrador de texto con su id) y las caducadas.
// - Caducan como el borrador (24 horas desde la última vez que se guardaron
//   las fotos) y se borran al guardar la planta, al descartar el borrador, al
//   quitar la última foto y al salir con "Cancelar".
// - IndexedDB puede no existir o fallar (navegación privada, cuota llena,
//   datos del sitio bloqueados): todo va en try/catch y, si falla, el
//   formulario funciona igual, solo que las fotos no sobreviven a una recarga.
//
// Formatos guardados:
// - Versión 2 (desde el #219): { version, plantId, savedAt, photos: [{ fileName, photo }] }.
// - Versión 1 (una sola foto): { version, plantId, savedAt, fileName, photo }. Se lee
//   como un borrador de una foto, con las mismas comprobaciones; la siguiente escritura
//   lo guarda ya en la versión 2. No cambia la base de IndexedDB: es el mismo almacén y
//   la misma forma de cada entrada, así que no hay migración de esquema (onupgradeneeded)
//   que pueda fallar en WebKit.
// Cualquier otra cosa (otra versión, una foto sin Blob, más de 6) se borra al leer.
//
// API: readDraftPhotos, writeDraftPhotos y clearDraftPhotos para las fotos de
// un borrador (el formulario con galería, #221); pruneDraftPhotos y
// readDraftPhotoCounts para todos los de un usuario (#296). readDraftPhoto,
// writeDraftPhoto y clearDraftPhoto, de una foto, siguen para quien ya los usa
// (la limpieza del dispositivo de «Tu cuenta» borra con clearDraftPhoto, que
// es el mismo borrado: sin id de planta, todas las del usuario).

/** Separa el usuario del id de planta en la clave; ninguno de los dos lo lleva. */
const KEY_SEPARATOR = '/'

/** Clave de las fotos del borrador `plantId` del usuario. */
export function draftPhotoKey(userId: string, plantId: string): string {
  return `${userId}${KEY_SEPARATOR}${plantId}`
}

/** El usuario de una clave: la de un borrador, o la de antes del #296 (el id solo). */
function ownerOf(key: string): string {
  const at = key.lastIndexOf(KEY_SEPARATOR)
  return at === -1 ? key : key.slice(0, at)
}

/** Una foto pendiente: el nombre del archivo elegido y la foto ya preparada. */
export interface DraftPhotoItem {
  fileName: string
  photo: ProcessedPhoto
}

/** Las fotos pendientes de un borrador, en orden. */
export interface DraftPhotos {
  /** Id de la planta del borrador con el que van las fotos. */
  plantId: string
  /** Cuándo se guardaron por última vez, en milisegundos desde la época. */
  savedAt: number
  /** De 1 a 6 fotos, en el orden de la galería. */
  photos: DraftPhotoItem[]
}

/** Una sola foto pendiente (formulario de una foto). */
export interface DraftPhoto {
  /** Id de la planta del borrador con el que va la foto. */
  plantId: string
  /** Cuándo se eligió, en milisegundos desde la época. */
  savedAt: number
  fileName: string
  photo: ProcessedPhoto
}

/**
 * Almacén clave-valor de las fotos pendientes. La app usa IndexedDB; las
 * pruebas y la página de muestra, uno en memoria. Puede rechazar: quien lo usa
 * (las funciones de abajo) lo trata como "sin fotos". Guarda lo que recibe tal
 * cual; lo que lee se comprueba antes de usarlo.
 */
export interface DraftPhotoBackend {
  get(userId: string): Promise<unknown>
  put(userId: string, value: unknown): Promise<void>
  delete(userId: string): Promise<void>
  keys(): Promise<string[]>
}

const STORED_VERSION = 2
const SINGLE_PHOTO_VERSION = 1

interface StoredDraftPhotos {
  version: typeof STORED_VERSION
  plantId: string
  savedAt: number
  photos: DraftPhotoItem[]
}

const PHOTO_TYPES: readonly string[] = ['image/webp', 'image/jpeg']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isEncodedImage(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.blob instanceof Blob &&
    typeof value.type === 'string' &&
    PHOTO_TYPES.includes(value.type)
  )
}

function toItem(value: unknown): DraftPhotoItem | null {
  if (
    !isRecord(value) ||
    typeof value.fileName !== 'string' ||
    !isRecord(value.photo) ||
    !isEncodedImage(value.photo.photo) ||
    !isEncodedImage(value.photo.thumbnail)
  ) {
    return null
  }
  return {
    fileName: value.fileName,
    photo: value.photo as unknown as ProcessedPhoto,
  }
}

/** Lo guardado, en la versión 2 o en la 1; null si no se entiende. */
function toDraftPhotos(value: unknown): DraftPhotos | null {
  if (
    !isRecord(value) ||
    typeof value.plantId !== 'string' ||
    value.plantId === '' ||
    typeof value.savedAt !== 'number' ||
    !Number.isFinite(value.savedAt)
  ) {
    return null
  }
  let items: unknown[]
  if (value.version === STORED_VERSION && Array.isArray(value.photos)) {
    items = value.photos
  } else if (value.version === SINGLE_PHOTO_VERSION) {
    items = [value]
  } else {
    return null
  }
  if (items.length === 0 || items.length > MAX_PLANT_PHOTOS) return null
  const photos: DraftPhotoItem[] = []
  for (const item of items) {
    const photo = toItem(item)
    if (photo === null) return null
    photos.push(photo)
  }
  return { plantId: value.plantId, savedAt: value.savedAt, photos }
}

async function quietly(run: () => Promise<void>): Promise<void> {
  try {
    await run()
  } catch {
    // Sin almacenamiento no hay nada que hacer.
  }
}

/** Si las fotos guardadas siguen valiendo a la hora `now`. */
function isFresh(found: DraftPhotos, now: Date): boolean {
  const age = now.getTime() - found.savedAt
  return age >= 0 && age <= PLANT_DRAFT_MAX_AGE_MS
}

/** Borra las fotos de los demás usuarios; devuelve las claves de este. */
async function forgetOtherUsers(
  backend: DraftPhotoBackend,
  userId: string,
): Promise<string[]> {
  const own: string[] = []
  for (const key of await backend.keys()) {
    if (ownerOf(key) === userId) own.push(key)
    else await backend.delete(key)
  }
  return own
}

/** Borra la entrada de antes del #296 si es del borrador `plantId` o no se entiende. */
async function forgetLegacyOf(
  backend: DraftPhotoBackend,
  userId: string,
  plantId: string,
): Promise<void> {
  const legacy: unknown = await backend.get(userId)
  if (legacy === undefined || legacy === null) return
  const found = toDraftPhotos(legacy)
  if (found === null || found.plantId === plantId) {
    await backend.delete(userId)
  }
}

/**
 * Las fotos pendientes del borrador `plantId` del usuario si no caducaron;
 * null si no hay (lo que no vale se borra, también un formato desconocido).
 * Borra también las de otros usuarios. Con `plantId` null (no hay borrador de
 * texto), borra todas las del usuario y devuelve null.
 */
export async function readDraftPhotos(
  backend: DraftPhotoBackend,
  userId: string,
  { plantId, now }: { plantId: string | null; now: Date },
): Promise<DraftPhotos | null> {
  if (plantId === null) {
    await clearDraftPhotos(backend, userId)
    return null
  }
  const key = draftPhotoKey(userId, plantId)
  let raw: unknown
  let legacy: unknown
  try {
    await forgetOtherUsers(backend, userId)
    raw = await backend.get(key)
    if (raw === undefined || raw === null) legacy = await backend.get(userId)
  } catch {
    return null
  }
  if (raw === undefined || raw === null) {
    // La entrada de antes del #296, si es de este borrador.
    if (legacy === undefined || legacy === null) return null
    const found = toDraftPhotos(legacy)
    if (found !== null && found.plantId !== plantId) return null
    if (found === null || !isFresh(found, now)) {
      await quietly(() => backend.delete(userId))
      return null
    }
    return found
  }
  const found = toDraftPhotos(raw)
  if (found === null || found.plantId !== plantId || !isFresh(found, now)) {
    await quietly(() => backend.delete(key))
    return null
  }
  return found
}

/**
 * Guarda las fotos pendientes del borrador en su orden, en lugar de las
 * anteriores. Sin fotos, las borra. Devuelve false si no se pudo, o si son
 * más de 6 (entonces no cambia nada).
 */
export async function writeDraftPhotos(
  backend: DraftPhotoBackend,
  userId: string,
  draft: DraftPhotos,
): Promise<boolean> {
  if (draft.photos.length > MAX_PLANT_PHOTOS) return false
  try {
    const key = draftPhotoKey(userId, draft.plantId)
    if (draft.photos.length === 0) {
      await backend.delete(key)
    } else {
      const stored: StoredDraftPhotos = {
        version: STORED_VERSION,
        plantId: draft.plantId,
        savedAt: draft.savedAt,
        photos: draft.photos.map(({ fileName, photo }) => ({
          fileName,
          photo,
        })),
      }
      await backend.put(key, stored)
    }
    await forgetLegacyOf(backend, userId, draft.plantId)
    return true
  } catch {
    return false
  }
}

/**
 * Borra las fotos pendientes del borrador `plantId` del usuario o, sin él,
 * todas las del usuario.
 */
export function clearDraftPhotos(
  backend: DraftPhotoBackend,
  userId: string,
  plantId?: string,
): Promise<void> {
  return quietly(async () => {
    if (plantId !== undefined) {
      await backend.delete(draftPhotoKey(userId, plantId))
      await forgetLegacyOf(backend, userId, plantId)
      return
    }
    for (const key of await backend.keys()) {
      if (ownerOf(key) === userId) await backend.delete(key)
    }
  })
}

/** Si `key` es donde deben estar las fotos de `found` (la suya o la de antes del #296). */
function isKeyOf(key: string, userId: string, found: DraftPhotos): boolean {
  return key === userId || key === draftPhotoKey(userId, found.plantId)
}

/**
 * Deja solo las fotos de los borradores `plantIds` del usuario que no
 * caducaron: borra las de otros usuarios, las de borradores que ya no existen,
 * las caducadas y las que no se entienden.
 */
export function pruneDraftPhotos(
  backend: DraftPhotoBackend,
  userId: string,
  { plantIds, now }: { plantIds: readonly string[]; now: Date },
): Promise<void> {
  return quietly(async () => {
    for (const key of await forgetOtherUsers(backend, userId)) {
      const found = toDraftPhotos(await backend.get(key))
      const valid =
        found !== null &&
        plantIds.includes(found.plantId) &&
        isKeyOf(key, userId, found) &&
        isFresh(found, now)
      if (!valid) await backend.delete(key)
    }
  })
}

/**
 * Cuántas fotos pendientes tiene cada borrador `plantIds` del usuario (0 si
 * ninguna o si no se pueden leer). No borra nada.
 */
export async function readDraftPhotoCounts(
  backend: DraftPhotoBackend,
  userId: string,
  { plantIds, now }: { plantIds: readonly string[]; now: Date },
): Promise<Map<string, number>> {
  const counts = new Map<string, number>(plantIds.map((id) => [id, 0]))
  try {
    for (const key of await backend.keys()) {
      if (ownerOf(key) !== userId) continue
      const found = toDraftPhotos(await backend.get(key))
      if (
        found === null ||
        !counts.has(found.plantId) ||
        !isKeyOf(key, userId, found) ||
        !isFresh(found, now)
      ) {
        continue
      }
      // La de un borrador gana a la de antes del #296.
      if (key !== userId || counts.get(found.plantId) === 0) {
        counts.set(found.plantId, found.photos.length)
      }
    }
  } catch {
    // Sin almacenamiento: ninguna.
  }
  return counts
}

// Una sola foto (formulario actual) -------------------------------------------

/**
 * La primera foto pendiente (la principal), con las mismas reglas que
 * readDraftPhotos. Lee los dos formatos.
 */
export async function readDraftPhoto(
  backend: DraftPhotoBackend,
  userId: string,
  options: { plantId: string | null; now: Date },
): Promise<DraftPhoto | null> {
  const found = await readDraftPhotos(backend, userId, options)
  if (found === null) return null
  const [first] = found.photos
  return {
    plantId: found.plantId,
    savedAt: found.savedAt,
    fileName: first.fileName,
    photo: first.photo,
  }
}

/** Guarda una sola foto pendiente. Devuelve false si no se pudo. */
export function writeDraftPhoto(
  backend: DraftPhotoBackend,
  userId: string,
  { plantId, savedAt, fileName, photo }: DraftPhoto,
): Promise<boolean> {
  return writeDraftPhotos(backend, userId, {
    plantId,
    savedAt,
    photos: [{ fileName, photo }],
  })
}

/** Borra las fotos pendientes del usuario (todas, de todos sus borradores). */
export function clearDraftPhoto(
  backend: DraftPhotoBackend,
  userId: string,
): Promise<void> {
  return clearDraftPhotos(backend, userId)
}

// IndexedDB --------------------------------------------------------------------

export const DRAFT_PHOTO_DB = 'orki-registro'
export const DRAFT_PHOTO_STORE = 'foto-pendiente'

function promised<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB'))
  })
}

/**
 * Almacén en IndexedDB: una base con un solo almacén de objetos, con
 * draftPhotoKey (o, antes del #296, el id de usuario) como clave. Cada operación abre la base, hace su transacción y la
 * cierra; van en fila, una detrás de otra, para que "guardar" y "quitar"
 * seguidos se apliquen en ese orden.
 */
export function createIndexedDbDraftPhotoBackend(
  factory: () => IDBFactory | undefined = () => globalThis.indexedDB,
): DraftPhotoBackend {
  let queue: Promise<unknown> = Promise.resolve()

  function open(): Promise<IDBDatabase> {
    const idb = factory()
    if (!idb) return Promise.reject(new Error('Sin IndexedDB'))
    return new Promise((resolve, reject) => {
      const request = idb.open(DRAFT_PHOTO_DB, 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore(DRAFT_PHOTO_STORE)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('IndexedDB'))
      request.onblocked = () => reject(new Error('IndexedDB bloqueada'))
    })
  }

  function run<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const next = queue.then(async () => {
      const db = await open()
      try {
        const transaction = db.transaction(DRAFT_PHOTO_STORE, mode)
        const done = new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve()
          transaction.onerror = () =>
            reject(transaction.error ?? new Error('IndexedDB'))
          transaction.onabort = () =>
            reject(transaction.error ?? new Error('IndexedDB'))
        })
        // Si falla la petición, el error llega por ella (abajo) y `done` ya
        // no se espera; la transacción se aborta después y su rechazo no debe
        // quedar sin atender (llegaría a Sentry como "Error: IndexedDB"). Pasa
        // en Safari en navegación privada, que no guarda Blobs en IndexedDB.
        done.catch(() => undefined)
        const result = await promised(
          operation(transaction.objectStore(DRAFT_PHOTO_STORE)),
        )
        await done
        return result
      } finally {
        db.close()
      }
    })
    // Un fallo no corta la fila.
    queue = next.catch(() => undefined)
    return next
  }

  return {
    get: (userId) => run('readonly', (store) => store.get(userId)),
    put: async (userId, value) => {
      await run('readwrite', (store) => store.put(value, userId))
    },
    delete: async (userId) => {
      await run('readwrite', (store) => store.delete(userId))
    },
    keys: async () => {
      const keys = await run('readonly', (store) => store.getAllKeys())
      return keys.filter((key): key is string => typeof key === 'string')
    },
  }
}

/** Lo guardado en el almacén en memoria, para las comprobaciones de las pruebas. */
export interface MemoryDraftPhotoEntry {
  readonly version?: unknown
  readonly plantId?: unknown
  readonly savedAt?: unknown
  readonly photos?: unknown
}

/** Almacén en memoria (pruebas y página de muestra). */
export function createMemoryDraftPhotoBackend(): DraftPhotoBackend & {
  readonly entries: Map<string, MemoryDraftPhotoEntry>
} {
  const entries = new Map<string, MemoryDraftPhotoEntry>()
  return {
    entries,
    get: (userId) => Promise.resolve(entries.get(userId)),
    put: (userId, value) => {
      entries.set(userId, value as MemoryDraftPhotoEntry)
      return Promise.resolve()
    },
    delete: (userId) => {
      entries.delete(userId)
      return Promise.resolve()
    },
    keys: () => Promise.resolve([...entries.keys()]),
  }
}

let shared: DraftPhotoBackend | undefined

/** Almacén de la app (IndexedDB), creado al pedirlo. */
export function appDraftPhotoBackend(): DraftPhotoBackend {
  shared ??= createIndexedDbDraftPhotoBackend()
  return shared
}
