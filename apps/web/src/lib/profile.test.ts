import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearAccountDeletionMarker,
  markAccountDeletionStarted,
  resetAccountDeletionMarkers,
} from './account-deletion-marker.ts'
import {
  ensureProfile,
  forgetEnsuredProfile,
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
    expect(upsert.mock.calls.length).toMatchInlineSnapshot(`3`)
  })
})
