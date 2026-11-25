import type { ExtrasCoverage } from './extras-state.ts'
import { photoCountOf, type CollectionPlant } from './model.ts'
import type { OwnershipExtras, SpeciesExtraName } from './ownership.ts'

// Copia local de la colección en el dispositivo (#18, #118), en IndexedDB.
//
// - Una copia por usuario (clave: el id de Clerk). La app solo lee la copia
//   del usuario activo, y al cerrar sesión o entrar otra cuenta borra las
//   demás (deleteLocalCopies).
// - Lleva las plantas tal como están en memoria (CollectionPlant) y lo que
//   "¿Ya la tengo?" necesita además: los sinónimos y nombres comunes de sus
//   especies y las abreviaturas de sus géneros (OwnershipExtras), en pares
//   [clave, valores] porque IndexedDB no guarda Map tal cual en todos los
//   navegadores con el mismo resultado.
// - Formato con versión (LOCAL_COPY_FORMAT). Una copia de otro formato (de
//   una versión anterior o posterior de la app) no se migra: se borra y se
//   trata como si no hubiera copia, porque la red la vuelve a llenar entera
//   en la próxima lectura. Lo mismo con una copia dañada.
// - Campos añadidos sin cambiar el formato: photoCount (#184). Una copia
//   guardada antes no lo trae; al leerla se deduce de la principal
//   (photoCountOf: 1 si hay foto, 0 si no) en lugar de descartarla, así quien
//   abre la app sin conexión tras actualizar sigue viendo su colección.
//   Lo mismo con code y notes (#265): una copia anterior no los trae y quedan
//   en null (sin identificador ni notas) hasta la siguiente lectura. Y con la
//   cobertura de los extras (#274, extras-state.ts): de qué especies y
//   géneros se leyeron. Una copia anterior no la trae y queda desconocida
//   (null): sus extras no se dan por completos hasta la siguiente lectura.
// - La foto principal (#186): desde que se lee de plant_photos y no de las
//   columnas de foto de plants, la planta en memoria sigue teniendo los
//   mismos campos (photoPath, thumbnailPath y photoInBloom, los de la
//   principal), así que el formato no cambia y una copia guardada por una
//   versión anterior se lee igual: lo que guardó era también la principal.
// - Todo con try/catch: sin IndexedDB (algunos modos privados) o con un
//   fallo (sin espacio), no se guarda nada y la app funciona como sin caché.

/** Versión del formato de la copia. Cambiarla descarta las copias guardadas. */
export const LOCAL_COPY_FORMAT = 1

/** Base de datos de IndexedDB de la copia. */
export const LOCAL_COPY_DB = 'orki-coleccion'
const STORE = 'copias'
const DB_VERSION = 1

/** La copia de la colección de un usuario. */
export interface LocalCopy {
  userId: string
  /** Cuándo se guardó lo que vino de la red (ISO 8601). */
  savedAt: string
  plants: readonly CollectionPlant[]
  extras: OwnershipExtras
  /**
   * De qué especies y géneros se leyeron los extras (#274); null o sin el
   * campo, desconocido (copia de una versión anterior).
   */
  extrasCoverage?: ExtrasCoverage | null
}

/** Dónde se guardan las copias; IndexedDB en la app, en memoria en pruebas. */
export interface LocalCopyStorage {
  /** La copia del usuario, o null si no hay (o es de otro formato). */
  read(userId: string): Promise<LocalCopy | null>
  write(copy: LocalCopy): Promise<void>
  /** Borra las copias de todos los usuarios salvo `keepUserId` (null: todas). */
  deleteExcept(keepUserId: string | null): Promise<void>
}

/** Registro tal como se guarda. */
interface StoredCopy {
  format: number
  userId: string
  savedAt: string
  plants: CollectionPlant[]
  speciesNames: [string, SpeciesExtraName[]][]
  genusAbbreviations: [string, string[]][]
  /** Cobertura de los extras (#274); falta en las copias anteriores. */
  extrasSpeciesIds?: string[]
  extrasGenusIds?: string[]
}

const NO_NAMES: ReadonlyMap<string, readonly SpeciesExtraName[]> = new Map()
const NO_ABBREVIATIONS: ReadonlyMap<string, readonly string[]> = new Map()

export function toStoredCopy(copy: LocalCopy): StoredCopy {
  return {
    format: LOCAL_COPY_FORMAT,
    userId: copy.userId,
    savedAt: copy.savedAt,
    plants: [...copy.plants],
    speciesNames: [...(copy.extras.speciesNames ?? NO_NAMES)].map(
      ([id, names]) => [id, [...names]],
    ),
    genusAbbreviations: [
      ...(copy.extras.genusAbbreviations ?? NO_ABBREVIATIONS),
    ].map(([id, abbreviations]) => [id, [...abbreviations]]),
    ...(copy.extrasCoverage && {
      extrasSpeciesIds: [...copy.extrasCoverage.speciesIds],
      extrasGenusIds: [...copy.extrasCoverage.genusIds],
    }),
  }
}

/** La copia de un registro, o null si es de otro formato, de otro usuario o está dañada. */
export function fromStoredCopy(
  value: unknown,
  userId: string,
): LocalCopy | null {
  if (typeof value !== 'object' || value === null) return null
  const stored = value as Partial<StoredCopy>
  if (stored.format !== LOCAL_COPY_FORMAT) return null
  if (stored.userId !== userId) return null
  if (typeof stored.savedAt !== 'string') return null
  if (!Array.isArray(stored.plants)) return null
  if (!Array.isArray(stored.speciesNames)) return null
  if (!Array.isArray(stored.genusAbbreviations)) return null
  return {
    userId,
    savedAt: stored.savedAt,
    plants: stored.plants.map(withNewFields),
    extras: {
      speciesNames: new Map(stored.speciesNames),
      genusAbbreviations: new Map(stored.genusAbbreviations),
    },
    extrasCoverage: coverageFrom(stored),
  }
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/** La cobertura guardada, o null si la copia no la trae o está dañada. */
function coverageFrom(stored: Partial<StoredCopy>): ExtrasCoverage | null {
  const { extrasSpeciesIds, extrasGenusIds } = stored
  if (!isStringList(extrasSpeciesIds) || !isStringList(extrasGenusIds)) {
    return null
  }
  return {
    speciesIds: new Set(extrasSpeciesIds),
    genusIds: new Set(extrasGenusIds),
  }
}

/**
 * La planta guardada, con los campos añadidos sin cambiar el formato aunque
 * la copia sea anterior: photoCount (#184), code y notes (#265).
 */
function withNewFields(plant: CollectionPlant): CollectionPlant {
  const stored = plant as Partial<CollectionPlant>
  const photoCount = photoCountOf(stored.photoCount, plant.photoPath ?? null)
  const code = typeof stored.code === 'string' ? stored.code : null
  const notes = typeof stored.notes === 'string' ? stored.notes : null
  return stored.photoCount === photoCount &&
    stored.code === code &&
    stored.notes === notes
    ? plant
    : { ...plant, photoCount, code, notes }
}

// IndexedDB -------------------------------------------------------------------

function hasIndexedDb(): boolean {
  return typeof globalThis.indexedDB !== 'undefined'
}

function promised<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB'))
  })
}

function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB: transacción abortada'))
  })
}

/** Copias en IndexedDB. Cada operación abre la base y la cierra al terminar. */
export function createIndexedDbCopyStorage(
  dbName: string = LOCAL_COPY_DB,
): LocalCopyStorage {
  async function open(): Promise<IDBDatabase> {
    const request = indexedDB.open(dbName, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'userId' })
      }
    }
    return promised(request)
  }

  async function withStore<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T> {
    const db = await open()
    try {
      const transaction = db.transaction(STORE, mode)
      const done = completed(transaction)
      const result = await run(transaction.objectStore(STORE))
      await done
      return result
    } finally {
      db.close()
    }
  }

  return {
    async read(userId) {
      if (!hasIndexedDb()) return null
      try {
        const value = await withStore('readonly', (store) =>
          promised<unknown>(store.get(userId)),
        )
        if (value === undefined) return null
        const copy = fromStoredCopy(value, userId)
        if (copy === null) {
          // De otro formato o dañada: fuera, la red la vuelve a llenar.
          await withStore('readwrite', (store) =>
            promised(store.delete(userId)),
          )
        }
        return copy
      } catch {
        return null
      }
    },

    async write(copy) {
      if (!hasIndexedDb()) return
      try {
        await withStore('readwrite', (store) =>
          promised(store.put(toStoredCopy(copy))),
        )
      } catch {
        // Sin espacio o sin permiso: la app sigue sin copia.
      }
    },

    async deleteExcept(keepUserId) {
      if (!hasIndexedDb()) return
      try {
        // Con un cursor y en sus callbacks: la transacción sigue activa
        // entre una petición y la siguiente en todos los navegadores.
        await withStore(
          'readwrite',
          (store) =>
            new Promise<void>((resolve, reject) => {
              const request = store.openCursor()
              request.onsuccess = () => {
                const cursor = request.result
                if (cursor === null) {
                  resolve()
                  return
                }
                if (cursor.key !== keepUserId) cursor.delete()
                cursor.continue()
              }
              request.onerror = () =>
                reject(request.error ?? new Error('IndexedDB'))
            }),
        )
      } catch {
        // Sin IndexedDB utilizable no hay nada que borrar.
      }
    },
  }
}

/** Copias en memoria, para las pruebas y la página de muestra. */
export function createMemoryCopyStorage(): LocalCopyStorage & {
  readonly copies: Map<string, unknown>
} {
  const copies = new Map<string, unknown>()
  return {
    copies,
    read(userId) {
      return Promise.resolve(fromStoredCopy(copies.get(userId), userId))
    },
    write(copy) {
      copies.set(copy.userId, structuredClone(toStoredCopy(copy)))
      return Promise.resolve()
    },
    deleteExcept(keepUserId) {
      for (const key of [...copies.keys()]) {
        if (key !== keepUserId) copies.delete(key)
      }
      return Promise.resolve()
    },
  }
}
