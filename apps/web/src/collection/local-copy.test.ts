import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { plant } from '../test/collection.ts'
import {
  createIndexedDbCopyStorage,
  createMemoryCopyStorage,
  fromStoredCopy,
  LOCAL_COPY_FORMAT,
  toStoredCopy,
  type LocalCopy,
} from './local-copy.ts'

// IndexedDB de las pruebas: fake-indexeddb (dependencia de desarrollo), una
// implementación completa en memoria; jsdom no trae IndexedDB.

let dbCount = 0
function freshDbName() {
  dbCount += 1
  return `orki-coleccion-prueba-${dbCount}`
}

function copyFor(
  userId: string,
  overrides: Partial<LocalCopy> = {},
): LocalCopy {
  return {
    userId,
    savedAt: '2026-11-21T10:00:00.000Z',
    plants: [plant({ displayName: 'Phalaenopsis amabilis' })],
    extras: {
      speciesNames: new Map([
        ['species-amabilis', [{ name: 'Orquídea mariposa', type: 'common' }]],
      ]),
      genusAbbreviations: new Map([['genus-phal', ['Phal.']]]),
    },
    ...overrides,
  }
}

function openRaw(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('copias', { keyPath: 'userId' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB'))
  })
}

async function putRaw(name: string, value: unknown) {
  const db = await openRaw(name)
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('copias', 'readwrite')
    transaction.objectStore('copias').put(value)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('tx'))
  })
  db.close()
}

async function keysRaw(name: string): Promise<IDBValidKey[]> {
  const db = await openRaw(name)
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const request = db
      .transaction('copias', 'readonly')
      .objectStore('copias')
      .getAllKeys()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB'))
  })
  db.close()
  return keys
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('copia local en IndexedDB', () => {
  it('guarda y lee la copia de un usuario con sus extras', async () => {
    const storage = createIndexedDbCopyStorage(freshDbName())
    const copy = copyFor('user_a')
    await storage.write(copy)

    const read = await storage.read('user_a')
    expect(read?.savedAt).toBe(copy.savedAt)
    expect(read?.plants).toEqual(copy.plants)
    expect(read?.extras.speciesNames?.get('species-amabilis')).toEqual([
      { name: 'Orquídea mariposa', type: 'common' },
    ])
    expect(read?.extras.genusAbbreviations?.get('genus-phal')).toEqual([
      'Phal.',
    ])
  })

  it('nunca devuelve la copia de otro usuario', async () => {
    const storage = createIndexedDbCopyStorage(freshDbName())
    await storage.write(copyFor('user_a'))
    expect(await storage.read('user_b')).toBeNull()
  })

  it('borra las copias de los demás usuarios y, con null, todas', async () => {
    const name = freshDbName()
    const storage = createIndexedDbCopyStorage(name)
    await storage.write(copyFor('user_a'))
    await storage.write(copyFor('user_b'))
    await storage.write(copyFor('user_c'))

    await storage.deleteExcept('user_b')
    expect(await keysRaw(name)).toEqual(['user_b'])
    expect(await storage.read('user_b')).not.toBeNull()

    await storage.deleteExcept(null)
    expect(await keysRaw(name)).toEqual([])
  })

  it('descarta y borra una copia de otro formato sin fallar', async () => {
    const name = freshDbName()
    const storage = createIndexedDbCopyStorage(name)
    await storage.write(copyFor('user_a'))
    await putRaw(name, {
      ...toStoredCopy(copyFor('user_a')),
      format: LOCAL_COPY_FORMAT + 1,
    })

    expect(await storage.read('user_a')).toBeNull()
    expect(await keysRaw(name)).toEqual([])
  })

  it('descarta una copia dañada', async () => {
    const name = freshDbName()
    const storage = createIndexedDbCopyStorage(name)
    await putRaw(name, { userId: 'user_a', format: LOCAL_COPY_FORMAT })
    expect(await storage.read('user_a')).toBeNull()
    expect(await keysRaw(name)).toEqual([])
  })

  it('sin IndexedDB no guarda nada ni falla', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const storage = createIndexedDbCopyStorage(freshDbName())
    await expect(storage.write(copyFor('user_a'))).resolves.toBeUndefined()
    await expect(storage.read('user_a')).resolves.toBeNull()
    await expect(storage.deleteExcept(null)).resolves.toBeUndefined()
  })

  it('si IndexedDB falla al abrir, sigue sin copia', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new DOMException('Bloqueado', 'SecurityError')
      },
    })
    const storage = createIndexedDbCopyStorage(freshDbName())
    await expect(storage.write(copyFor('user_a'))).resolves.toBeUndefined()
    await expect(storage.read('user_a')).resolves.toBeNull()
  })
})

describe('formato de la copia', () => {
  it('rechaza lo que no es una copia de ese usuario y de este formato', () => {
    const stored = toStoredCopy(copyFor('user_a'))
    expect(fromStoredCopy(stored, 'user_a')).not.toBeNull()
    expect(fromStoredCopy(stored, 'user_b')).toBeNull()
    expect(fromStoredCopy({ ...stored, format: 0 }, 'user_a')).toBeNull()
    expect(fromStoredCopy({ ...stored, plants: 'x' }, 'user_a')).toBeNull()
    expect(fromStoredCopy(null, 'user_a')).toBeNull()
    expect(fromStoredCopy('copia', 'user_a')).toBeNull()
  })

  it('guarda el número de fotos y lo lee igual', async () => {
    const storage = createIndexedDbCopyStorage(freshDbName())
    const many = plant({ photoPath: 'u/p/photo-1.webp', photoCount: 5 })
    await storage.write(copyFor('user_a', { plants: [many] }))
    const copy = await storage.read('user_a')
    expect(copy?.plants.map((saved) => saved.photoCount)).toEqual([5])
  })

  it('una copia anterior al número de fotos se conserva y lo deduce de la principal', async () => {
    const name = freshDbName()
    const withPhoto = plant({ photoPath: 'u/p/photo-1.webp' })
    const withoutPhoto = plant({ photoPath: null })
    const old = toStoredCopy(
      copyFor('user_a', { plants: [withPhoto, withoutPhoto] }),
    )
    // Como la guardaba la app antes del #184: sin photoCount, mismo formato.
    const legacy = {
      ...old,
      plants: old.plants.map((saved) => {
        const copy: Partial<typeof saved> = { ...saved }
        delete copy.photoCount
        return copy
      }),
    }
    expect(legacy.format).toBe(LOCAL_COPY_FORMAT)
    await putRaw(name, legacy)

    const copy = await createIndexedDbCopyStorage(name).read('user_a')
    expect(copy?.plants.map((saved) => saved.photoCount)).toEqual([1, 0])
    expect(copy?.plants[0]).toEqual(withPhoto)
    expect(await keysRaw(name)).toEqual(['user_a'])
  })

  it('una copia sin extras se guarda con listas vacías', () => {
    const stored = toStoredCopy(copyFor('user_a', { extras: {} }))
    expect(stored.speciesNames).toEqual([])
    expect(stored.genusAbbreviations).toEqual([])
  })
})

describe('copia en memoria', () => {
  it('se comporta como la de IndexedDB', async () => {
    const storage = createMemoryCopyStorage()
    await storage.write(copyFor('user_a'))
    await storage.write(copyFor('user_b'))
    expect((await storage.read('user_a'))?.userId).toBe('user_a')
    await storage.deleteExcept('user_a')
    expect([...storage.copies.keys()]).toEqual(['user_a'])
  })
})
