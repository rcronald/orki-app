import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearAccountDeletionMarker,
  markAccountDeletionStarted,
  resetAccountDeletionMarkers,
} from './account-deletion-marker.ts'
import {
  ensureProfile,
  forgetEnsuredProfile,
  PROFILE_MARK_PREFIX,
  resetEnsuredProfiles,
} from './profile.ts'

// Cliente simulado: cuenta las inserciones del perfil.
const upsert = vi.fn(() => Promise.resolve({ error: null }))
vi.mock('./supabase.ts', () => ({
  getSupabase: () => Promise.resolve({ from: () => ({ upsert }) }),
}))

const USER = 'user_prueba'

afterEach(() => {
  resetEnsuredProfiles()
  resetAccountDeletionMarkers()
  upsert.mockClear()
})

describe('ensureProfile durante la eliminación de la cuenta (#110)', () => {
  it('con la marca de eliminación en curso no crea el perfil ni envía nada', async () => {
    markAccountDeletionStarted(USER)
    await expect(ensureProfile(USER)).resolves.toBe(false)
    // Ni al volver la conexión ni al recargar (la marca está en localStorage).
    resetAccountDeletionMarkers()
    await expect(ensureProfile(USER)).resolves.toBe(false)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('sin marca, lo crea; al abandonar la eliminación lo vuelve a pedir', async () => {
    await expect(ensureProfile(USER)).resolves.toBe(true)
    expect(upsert).toHaveBeenCalledTimes(1)

    markAccountDeletionStarted(USER)
    clearAccountDeletionMarker(USER)
    // Recordado como creado: sin forgetEnsuredProfile no repite la petición.
    await ensureProfile(USER)
    expect(upsert).toHaveBeenCalledTimes(1)

    forgetEnsuredProfile(USER)
    await expect(ensureProfile(USER)).resolves.toBe(true)
    expect(upsert).toHaveBeenCalledTimes(2)
  })
})

describe('ensureProfile en cada arranque (#285)', () => {
  it('con sesión, tres arranques de la app en el mismo dispositivo', async () => {
    for (let start = 0; start < 3; start += 1) {
      // Una carga nueva de la página: el módulo empieza sin nada en memoria.
      vi.resetModules()
      const fresh = await import('./profile.ts')
      await expect(fresh.ensureProfile(USER)).resolves.toBe(true)
    }
    // Antes del #285, uno en cada arranque (3). Ahora, solo el primero.
    expect(upsert).toHaveBeenCalledTimes(1)
    // La marca no lleva datos del perfil: solo «ya está».
    expect(window.localStorage.getItem(`${PROFILE_MARK_PREFIX}${USER}`)).toBe(
      '1',
    )
  })

  it('cada usuario tiene su marca', async () => {
    await ensureProfile(USER)
    vi.resetModules()
    const fresh = await import('./profile.ts')
    await fresh.ensureProfile('user_otra')
    expect(upsert).toHaveBeenCalledTimes(2)
  })

  it('si no sale bien no deja marca y el siguiente arranque lo vuelve a pedir', async () => {
    upsert.mockResolvedValueOnce({ error: { message: 'sin red' } } as never)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(ensureProfile(USER)).resolves.toBe(false)
    expect(window.localStorage.getItem(`${PROFILE_MARK_PREFIX}${USER}`)).toBe(
      null,
    )
    vi.resetModules()
    const fresh = await import('./profile.ts')
    await expect(fresh.ensureProfile(USER)).resolves.toBe(true)
    expect(upsert).toHaveBeenCalledTimes(2)
  })

  it('empezar a eliminar la cuenta quita la marca; abandonarlo lo vuelve a pedir', async () => {
    await ensureProfile(USER)
    markAccountDeletionStarted(USER)
    await expect(ensureProfile(USER)).resolves.toBe(false)
    expect(window.localStorage.getItem(`${PROFILE_MARK_PREFIX}${USER}`)).toBe(
      null,
    )
    // La persona sigue usando orqui.app (la pantalla de cuenta).
    clearAccountDeletionMarker(USER)
    forgetEnsuredProfile(USER)
    vi.resetModules()
    const fresh = await import('./profile.ts')
    await expect(fresh.ensureProfile(USER)).resolves.toBe(true)
    expect(upsert).toHaveBeenCalledTimes(2)
  })

  it('la limpieza del dispositivo al eliminar la cuenta borra la marca', async () => {
    await ensureProfile(USER)
    const { clearDeviceDataFor } = await import('../account/device-cleanup.ts')
    await clearDeviceDataFor(USER, { keepMarker: true })
    expect(window.localStorage.getItem(`${PROFILE_MARK_PREFIX}${USER}`)).toBe(
      null,
    )
  })
})
