import type { ProcessedPhoto } from '../photos/process.ts'
import { PLANT_DRAFT_MAX_AGE_MS } from './draft.ts'

// Foto pendiente del borrador del registro (#87). Lo escrito va en
// localStorage (draft.ts); la foto ya preparada son dos Blob (foto y
// miniatura, unos 200-300 KB), que no caben ahí: van en IndexedDB, que guarda
// Blob tal cual.
//
// Para qué sirve: si iOS descarga la app instalada después de elegir la foto
// (por ejemplo, al salir a otra app a buscar el nombre), al volver se
// recuperan lo escrito y la foto. No cubre la recarga que ocurre mientras la
// cámara está abierta: entonces la foto aún no llegó a la página y hay que
// volver a tomarla; lo escrito sí se conserva.
//
// - Una entrada por usuario (clave: id de Clerk). Al leer se borran las de
//   otros usuarios y las caducadas: una foto no aparece con otra cuenta.
// - Va con el id de planta del borrador de texto: solo se recupera si
//   coincide con él. Sin borrador de texto, o con otro id, se borra.
// - Caduca como el borrador (24 horas desde que se eligió) y se borra al
//   guardar la planta, al descartar el borrador, al quitar la foto y al salir
//   con "Cancelar".
// - IndexedDB puede no existir o fallar (navegación privada, cuota llena,
//   datos del sitio bloqueados): todo va en try/catch y, si falla, el
//   formulario funciona igual, solo que la foto no sobrevive a una recarga.

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
 * (las funciones de abajo) lo trata como "sin foto".
 */
export interface DraftPhotoBackend {
  get(userId: string): Promise<unknown>
  put(userId: string, value: DraftPhoto): Promise<void>
  delete(userId: string): Promise<void>
  keys(): Promise<string[]>
}

const STORED_VERSION = 1

interface StoredDraftPhoto extends DraftPhoto {
  version: number
}

const PHOTO_TYPES: readonly string[] = ['image/webp', 'image/jpeg']

function isEncodedImage(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const image = value as Record<string, unknown>
  return (
    image.blob instanceof Blob &&
    typeof image.type === 'string' &&
    PHOTO_TYPES.includes(image.type)
  )
}

function toDraftPhoto(value: unknown): DraftPhoto | null {
  if (typeof value !== 'object' || value === null) return null
  const stored = value as Partial<StoredDraftPhoto>
  if (
    stored.version !== STORED_VERSION ||
    typeof stored.plantId !== 'string' ||
    stored.plantId === '' ||
    typeof stored.savedAt !== 'number' ||
    !Number.isFinite(stored.savedAt) ||
    typeof stored.fileName !== 'string' ||
    typeof stored.photo !== 'object' ||
    stored.photo === null ||
    !isEncodedImage(stored.photo.photo) ||
    !isEncodedImage(stored.photo.thumbnail)
  ) {
    return null
  }
  return {
    plantId: stored.plantId,
    savedAt: stored.savedAt,
    fileName: stored.fileName,
    photo: stored.photo,
  }
}

async function quietly(run: () => Promise<void>): Promise<void> {
  try {
    await run()
  } catch {
    // Sin almacenamiento no hay nada que hacer.
  }
}

/**
 * La foto pendiente del usuario si va con el borrador de `plantId` y no
 * caducó; null si no hay (lo que no vale se borra). Borra también las de
 * otros usuarios. Con `plantId` null (no hay borrador de texto), borra la del
 * usuario y devuelve null.
 */
export async function readDraftPhoto(
  backend: DraftPhotoBackend,
  userId: string,
  { plantId, now }: { plantId: string | null; now: Date },
): Promise<DraftPhoto | null> {
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
  const found = toDraftPhoto(raw)
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

/** Guarda la foto pendiente. Devuelve false si no se pudo. */
export async function writeDraftPhoto(
  backend: DraftPhotoBackend,
  userId: string,
  draft: DraftPhoto,
): Promise<boolean> {
  const stored: StoredDraftPhoto = { version: STORED_VERSION, ...draft }
  try {
    await backend.put(userId, stored)
    return true
  } catch {
    return false
  }
}

/** Borra la foto pendiente del usuario. */
export function clearDraftPhoto(
  backend: DraftPhotoBackend,
  userId: string,
): Promise<void> {
  return quietly(() => backend.delete(userId))
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

/** Almacén en memoria (pruebas y página de muestra). */
export function createMemoryDraftPhotoBackend(): DraftPhotoBackend & {
  readonly entries: Map<string, DraftPhoto>
} {
  const entries = new Map<string, DraftPhoto>()
  return {
    entries,
    get: (userId) => Promise.resolve(entries.get(userId)),
    put: (userId, value) => {
      entries.set(userId, value)
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
