import { MAX_PLANT_PHOTOS } from '../photos/paths.ts'
import type { ProcessedPhoto } from '../photos/process.ts'
import { PLANT_DRAFT_MAX_AGE_MS } from './draft.ts'

// Fotos pendientes del borrador del registro (#87; varias desde el #219). Lo
// escrito va en localStorage (draft.ts); cada foto ya preparada son dos Blob
// (foto y miniatura, unos 200-300 KB), que no caben ahí: van en IndexedDB, que
// guarda Blob tal cual.
//
// Para qué sirve: si iOS descarga la app instalada después de elegir las
// fotos (por ejemplo, al salir a otra app a buscar el nombre), al volver se
// recuperan lo escrito y las fotos, en su orden. No cubre la recarga que
// ocurre mientras la cámara está abierta: entonces la foto aún no llegó a la
// página y hay que volver a tomarla; lo escrito sí se conserva.
//
// - Una entrada por usuario (clave: id de Clerk) con hasta 6 fotos en orden
//   (la primera será la principal). Al leer se borran las de otros usuarios y
//   las caducadas: una foto no aparece con otra cuenta.
// - Va con el id de planta del borrador de texto: solo se recupera si
//   coincide con él. Sin borrador de texto, o con otro id, se borra.
// - Caduca como el borrador (24 horas desde la última vez que se guardaron
//   las fotos) y se borra al guardar la planta, al descartar el borrador, al
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
//   la misma clave, así que no hay migración de esquema (onupgradeneeded) que pueda
//   fallar en WebKit.
// Cualquier otra cosa (otra versión, una foto sin Blob, más de 6) se borra al leer.
//
// API: readDraftPhotos, writeDraftPhotos y clearDraftPhotos para varias fotos
// (el formulario con galería, #221). readDraftPhoto, writeDraftPhoto y
// clearDraftPhoto, de una foto, siguen para quien ya los usa (la limpieza del
// dispositivo de «Tu cuenta» borra con clearDraftPhoto, que es el mismo
// borrado).

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

/**
 * Las fotos pendientes del usuario si van con el borrador de `plantId` y no
 * caducaron; null si no hay (lo que no vale se borra, también un formato
 * desconocido). Borra también las de otros usuarios. Con `plantId` null (no
 * hay borrador de texto), borra las del usuario y devuelve null.
 */
export async function readDraftPhotos(
  backend: DraftPhotoBackend,
  userId: string,
  { plantId, now }: { plantId: string | null; now: Date },
): Promise<DraftPhotos | null> {
  let raw: unknown
  try {
    for (const key of await backend.keys()) {
      if (key !== userId) await backend.delete(key)
    }
    raw = await backend.get(userId)
  } catch {
    return null
  }
  if (raw === undefined || raw === null) return null
  const found = toDraftPhotos(raw)
  const age = found ? now.getTime() - found.savedAt : Number.NaN
  if (
    found === null ||
    plantId === null ||
    found.plantId !== plantId ||
    !(age >= 0 && age <= PLANT_DRAFT_MAX_AGE_MS)
  ) {
    await quietly(() => backend.delete(userId))
    return null
  }
  return found
}

/**
 * Guarda las fotos pendientes en su orden, en lugar de las anteriores. Sin
 * fotos, las borra. Devuelve false si no se pudo, o si son más de 6 (entonces
 * no cambia nada).
 */
export async function writeDraftPhotos(
  backend: DraftPhotoBackend,
  userId: string,
  draft: DraftPhotos,
): Promise<boolean> {
  if (draft.photos.length > MAX_PLANT_PHOTOS) return false
  try {
    if (draft.photos.length === 0) {
      await backend.delete(userId)
      return true
    }
    const stored: StoredDraftPhotos = {
      version: STORED_VERSION,
      plantId: draft.plantId,
      savedAt: draft.savedAt,
      photos: draft.photos.map(({ fileName, photo }) => ({ fileName, photo })),
    }
    await backend.put(userId, stored)
    return true
  } catch {
    return false
  }
}

/** Borra las fotos pendientes del usuario. */
export function clearDraftPhotos(
  backend: DraftPhotoBackend,
  userId: string,
): Promise<void> {
  return quietly(() => backend.delete(userId))
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

/** Borra la foto pendiente del usuario (todas, si hay varias). */
export const clearDraftPhoto = clearDraftPhotos

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
 * Almacén en IndexedDB: una base con un solo almacén de objetos, con el id de
 * usuario como clave. Cada operación abre la base, hace su transacción y la
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
