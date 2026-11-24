import { describe, expect, it, vi } from 'vitest'
import type { OrkiSupabaseClient } from '../lib/supabase.ts'
import { SessionTokenError } from '../lib/supabase.ts'
import { AccountDeletionError } from './deletion.ts'
import { createSupabaseAccountDataEffects } from './supabase-effects.ts'

const USER = 'user_prueba'
const PLANT_A = '11111111-1111-4111-8111-111111111111'
const PLANT_B = '22222222-2222-4222-8222-222222222222'

/**
 * Doble del cliente: un bucket en memoria (rutas planas, con list() que
 * devuelve archivos y subcarpetas como Storage) y las dos tablas, que anotan
 * los borrados.
 */
function fakeClient(
  options: {
    objects?: string[]
    listError?: unknown
    removeError?: unknown
    tableError?: { error: unknown; status: number }
  } = {},
) {
  const objects = new Set(options.objects ?? [])
  const deletes: string[] = []
  const removed: string[][] = []

  const bucket = {
    list(prefix: string, { limit, offset }: { limit: number; offset: number }) {
      if (options.listError) {
        return Promise.resolve({ data: null, error: options.listError })
      }
      const entries = new Map<string, string | null>()
      for (const path of objects) {
        if (!path.startsWith(`${prefix}/`)) continue
        const rest = path.slice(prefix.length + 1)
        const [first, ...more] = rest.split('/')
        entries.set(first, more.length > 0 ? null : `id-${path}`)
      }
      const data = [...entries]
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(offset, offset + limit)
        .map(([name, id]) => ({ name, id }))
      return Promise.resolve({ data, error: null })
    },
    remove(paths: string[]) {
      if (options.removeError) {
        return Promise.resolve({ data: null, error: options.removeError })
      }
      removed.push(paths)
      for (const path of paths) objects.delete(path)
      return Promise.resolve({ data: [], error: null })
    },
  }

  const table = (name: string) => ({
    delete: () => ({
      eq: (column: string, value: string) => {
        deletes.push(`${name}.${column}=${value}`)
        return Promise.resolve(
          options.tableError ?? { error: null, status: 204 },
        )
      },
    }),
  })

  const client = {
    storage: { from: () => bucket },
    from: table,
  } as unknown as OrkiSupabaseClient

  return { client, objects, deletes, removed }
}

describe('createSupabaseAccountDataEffects', () => {
  it('borra todos los archivos de la carpeta del usuario, de todas sus plantas', async () => {
    const paths = [
      `${USER}/${PLANT_A}/photo-v1.webp`,
      `${USER}/${PLANT_A}/thumb-v1.webp`,
      `${USER}/${PLANT_A}/photo-v0.webp`,
      `${USER}/${PLANT_B}/photo-v2.jpg`,
      `${USER}/suelto.txt`,
    ]
    const fake = fakeClient({
      objects: [...paths, `otro_usuario/${PLANT_A}/photo-x.webp`],
    })
    const effects = createSupabaseAccountDataEffects({
      getClient: () => Promise.resolve(fake.client),
    })

    await effects.deletePhotos(USER)

    expect([...fake.objects]).toEqual([`otro_usuario/${PLANT_A}/photo-x.webp`])
    expect(fake.removed.flat().sort()).toEqual([...paths].sort())
  })

  it('borra también las fotos secundarias de la galería (varias por planta)', async () => {
    // Seis fotos en una planta y dos en otra, cada una con su versión.
    const gallery = [
      ...Array.from({ length: 6 }, (_, index) => [
        `${USER}/${PLANT_A}/photo-v${index}.webp`,
        `${USER}/${PLANT_A}/thumb-v${index}.webp`,
      ]),
      ...Array.from({ length: 2 }, (_, index) => [
        `${USER}/${PLANT_B}/photo-w${index}.jpg`,
        `${USER}/${PLANT_B}/thumb-w${index}.jpg`,
      ]),
    ].flat()
    const fake = fakeClient({ objects: gallery })
    const effects = createSupabaseAccountDataEffects({
      getClient: () => Promise.resolve(fake.client),
    })

    await effects.deletePhotos(USER)
    // Las filas de plant_photos se van con las plantas (on delete cascade).
    await effects.deletePlants(USER)

    expect(fake.objects.size).toBe(0)
    expect(fake.removed.flat()).toHaveLength(16)
    expect(fake.deletes).toEqual([`plants.user_id=${USER}`])
  })

  it('borra también las fotos de la bitácora (<planta>/log/, #267)', async () => {
    const paths = [
      `${USER}/${PLANT_A}/photo-v1.webp`,
      `${USER}/${PLANT_A}/thumb-v1.webp`,
      `${USER}/${PLANT_A}/log/photo-r1.webp`,
      `${USER}/${PLANT_A}/log/thumb-r1.webp`,
      `${USER}/${PLANT_B}/log/photo-r2.jpg`,
      `${USER}/${PLANT_B}/log/thumb-r2.jpg`,
    ]
    const fake = fakeClient({
      objects: [...paths, `otro_usuario/${PLANT_A}/log/photo-x.webp`],
    })
    const effects = createSupabaseAccountDataEffects({
      getClient: () => Promise.resolve(fake.client),
    })

    await effects.deletePhotos(USER)
    // Los registros se van con las plantas (on delete cascade).
    await effects.deletePlants(USER)

    expect([...fake.objects]).toEqual([
      `otro_usuario/${PLANT_A}/log/photo-x.webp`,
    ])
    expect(fake.removed.flat().sort()).toEqual([...paths].sort())
  })

  it('pagina el listado y borra de 100 en 100', async () => {
    const paths = Array.from(
      { length: 250 },
      (_, index) =>
        `${USER}/${PLANT_A}/photo-${String(index).padStart(3, '0')}.webp`,
    )
    const fake = fakeClient({ objects: paths })
    const effects = createSupabaseAccountDataEffects({
      getClient: () => Promise.resolve(fake.client),
    })

    await effects.deletePhotos(USER)

    expect(fake.objects.size).toBe(0)
    expect(fake.removed.map((batch) => batch.length)).toEqual([100, 100, 50])
  })

  it('sin fotos no borra nada y no falla (idempotente)', async () => {
    const fake = fakeClient()
    const effects = createSupabaseAccountDataEffects({
      getClient: () => Promise.resolve(fake.client),
    })
    await expect(effects.deletePhotos(USER)).resolves.toBeUndefined()
    expect(fake.removed).toEqual([])
  })

  it('un fallo de red de Storage es offline; un 401, session-ended', async () => {
    const offline = createSupabaseAccountDataEffects({
      getClient: () =>
        Promise.resolve(
          fakeClient({ listError: { name: 'StorageUnknownError' } }).client,
        ),
    })
    await expect(offline.deletePhotos(USER)).rejects.toMatchObject({
      reason: 'offline',
    })

    const ended = createSupabaseAccountDataEffects({
      getClient: () =>
        Promise.resolve(
          fakeClient({
            objects: [`${USER}/${PLANT_A}/photo-v1.webp`],
            removeError: { status: 401, statusCode: '401', message: 'jwt' },
          }).client,
        ),
    })
    await expect(ended.deletePhotos(USER)).rejects.toMatchObject({
      reason: 'session-ended',
    })
  })

  it('borra las plantas y el perfil del usuario', async () => {
    const fake = fakeClient()
    const effects = createSupabaseAccountDataEffects({
      getClient: () => Promise.resolve(fake.client),
    })
    await effects.deletePlants(USER)
    await effects.deleteProfile(USER)
    expect(fake.deletes).toEqual([
      `plants.user_id=${USER}`,
      `profiles.id=${USER}`,
    ])
  })

  it('traduce los errores de las tablas', async () => {
    const cases = [
      [
        { error: { message: 'TypeError: Failed to fetch' }, status: 0 },
        'offline',
      ],
      [{ error: { message: 'JWT expired' }, status: 401 }, 'session-ended'],
      [
        {
          error: {
            message: `SessionTokenError: ${new SessionTokenError('offline').message}`,
          },
          status: 0,
        },
        'offline',
      ],
      [{ error: { message: 'boom' }, status: 500 }, 'failed'],
    ] as const
    for (const [tableError, reason] of cases) {
      const effects = createSupabaseAccountDataEffects({
        getClient: () => Promise.resolve(fakeClient({ tableError }).client),
      })
      const error = await effects
        .deletePlants(USER)
        .catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(AccountDeletionError)
      expect(error).toMatchObject({ reason })
    }
  })

  it('si no carga el cliente de Supabase sin conexión, offline', async () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const effects = createSupabaseAccountDataEffects({
      getClient: () => Promise.reject(new Error('chunk')),
    })
    await expect(effects.deleteProfile(USER)).rejects.toMatchObject({
      reason: 'offline',
    })
    spy.mockRestore()
  })
})
