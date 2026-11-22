import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  persistentStorageState,
  requestPersistentStorage,
  resetPersistentStorageRequest,
} from './persistent-storage.ts'

function stubStorage(storage: Partial<StorageManager> | undefined) {
  Object.defineProperty(navigator, 'storage', {
    value: storage,
    configurable: true,
  })
}

const original = Object.getOwnPropertyDescriptor(navigator, 'storage')

beforeEach(() => {
  resetPersistentStorageRequest()
})

afterEach(() => {
  if (original) Object.defineProperty(navigator, 'storage', original)
  else Reflect.deleteProperty(navigator, 'storage')
})

describe('almacenamiento persistente', () => {
  it('lo pide una sola vez y devuelve lo que responde el navegador', async () => {
    const persist = vi.fn(() => Promise.resolve(true))
    stubStorage({ persist, persisted: () => Promise.resolve(false) })
    expect(await requestPersistentStorage()).toBe('granted')
    expect(await requestPersistentStorage()).toBe('granted')
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('si ya es persistente, no lo vuelve a pedir', async () => {
    const persist = vi.fn(() => Promise.resolve(true))
    stubStorage({ persist, persisted: () => Promise.resolve(true) })
    expect(await requestPersistentStorage()).toBe('granted')
    expect(persist).not.toHaveBeenCalled()
  })

  it('denegado o sin la API, lo dice sin fallar', async () => {
    stubStorage({
      persist: () => Promise.resolve(false),
      persisted: () => Promise.resolve(false),
    })
    expect(await requestPersistentStorage()).toBe('denied')
    expect(await persistentStorageState()).toBe('denied')

    resetPersistentStorageRequest()
    stubStorage(undefined)
    expect(await requestPersistentStorage()).toBe('unsupported')
    expect(await persistentStorageState()).toBe('unsupported')

    resetPersistentStorageRequest()
    stubStorage({
      persist: () => Promise.reject(new Error('no')),
      persisted: () => Promise.reject(new Error('no')),
    })
    expect(await requestPersistentStorage()).toBe('unsupported')
  })
})
