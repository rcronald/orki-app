import { afterEach, describe, expect, it, vi } from 'vitest'
import { PREFERENCES_KEY } from '../inventory/preferences.ts'
import { accountDeletionMarkerKey } from '../lib/account-deletion-marker.ts'
import { THUMBNAIL_CACHE_PREFIX } from '../photos/read.ts'
import { plantDraftKey } from '../registration/draft.ts'
import { clearDeviceDataFor } from './device-cleanup.ts'

const USER = 'user_prueba'
const OTHER = 'user_otra'

function fakeCaches(names: string[]) {
  const stores = new Set(names)
  vi.stubGlobal('caches', {
    keys: () => Promise.resolve([...stores]),
    delete: (name: string) => Promise.resolve(stores.delete(name)),
    open: () => Promise.reject(new Error('sin uso')),
  })
  return stores
}

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

describe('clearDeviceDataFor', () => {
  it('borra el borrador, las preferencias, las miniaturas y las claves de la cuenta', async () => {
    localStorage.setItem(plantDraftKey(USER), '{}')
    localStorage.setItem(plantDraftKey(OTHER), '{}')
    localStorage.setItem(PREFERENCES_KEY, '{"view":"grid"}')
    localStorage.setItem(accountDeletionMarkerKey(USER), 'x')
    localStorage.setItem('otra-app', 'se queda')
    sessionStorage.setItem(`orki:algo:${USER}`, 'x')
    const stores = fakeCaches([
      `${THUMBNAIL_CACHE_PREFIX}${USER}`,
      'workbox-precache-v2-https://orki.test/',
    ])

    await clearDeviceDataFor(USER)

    expect(localStorage.getItem(plantDraftKey(USER))).toBeNull()
    expect(localStorage.getItem(PREFERENCES_KEY)).toBeNull()
    expect(localStorage.getItem(accountDeletionMarkerKey(USER))).toBeNull()
    expect(sessionStorage.getItem(`orki:algo:${USER}`)).toBeNull()
    // Lo de otra cuenta y lo ajeno a Orki no se toca.
    expect(localStorage.getItem(plantDraftKey(OTHER))).toBe('{}')
    expect(localStorage.getItem('otra-app')).toBe('se queda')
    // El precache del service worker se queda.
    await vi.waitFor(() =>
      expect([...stores]).toEqual(['workbox-precache-v2-https://orki.test/']),
    )
  })

  it('con keepMarker conserva la marca de eliminación', async () => {
    localStorage.setItem(accountDeletionMarkerKey(USER), 'x')
    localStorage.setItem(plantDraftKey(USER), '{}')
    await clearDeviceDataFor(USER, { keepMarker: true })
    expect(localStorage.getItem(accountDeletionMarkerKey(USER))).toBe('x')
    expect(localStorage.getItem(plantDraftKey(USER))).toBeNull()
  })

  it('sin Cache Storage ni localStorage usables, no falla', async () => {
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    try {
      await expect(clearDeviceDataFor(USER)).resolves.toBeUndefined()
    } finally {
      vi.restoreAllMocks()
    }
  })
})
