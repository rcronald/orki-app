import { describe, expect, it, vi } from 'vitest'
import { SessionTokenError, type OrkiSupabaseClient } from '../lib/supabase.ts'
import {
  classifyStorageError,
  createSupabasePhotoStorage,
  PHOTO_CACHE_CONTROL,
  PhotoStorageError,
} from './storage.ts'

// Errores con la forma de los de @supabase/storage-js.
function apiError(status: number, statusCode = String(status), code?: string) {
  return Object.assign(new Error('rechazo'), {
    name: 'StorageApiError',
    status,
    statusCode,
    code,
  })
}

function unknownError(originalError: unknown) {
  return Object.assign(new Error('fallo'), {
    name: 'StorageUnknownError',
    originalError,
  })
}

function fakeClient(bucket: Record<string, unknown>) {
  const from = vi.fn(() => bucket)
  const client = { storage: { from } } as unknown as OrkiSupabaseClient
  return { client, from }
}

describe('classifyStorageError', () => {
  it.each([
    [apiError(413), 'too-large'],
    [apiError(400, '413'), 'too-large'],
    [apiError(415), 'unsupported-type'],
    [apiError(400, '415'), 'unsupported-type'],
    [apiError(400, '400', 'InvalidMimeType'), 'unsupported-type'],
    [apiError(401), 'session-ended'],
    [apiError(400, '400', 'InvalidJWT'), 'session-ended'],
    [apiError(403), 'forbidden'],
    [apiError(400, '403'), 'forbidden'],
    [apiError(404), 'not-found'],
    [apiError(500), 'failed'],
  ])('%o es %s', (error, reason) => {
    expect(classifyStorageError(error).reason).toBe(reason)
  })

  it('un fallo de red es "offline" e incierto', () => {
    const error = classifyStorageError(
      unknownError(new TypeError('Failed to fetch')),
    )
    expect(error.reason).toBe('offline')
    expect(error.uncertain).toBe(true)
  })

  it('sin token de sesión, la petición no salió: es seguro', () => {
    const error = classifyStorageError(
      unknownError(new SessionTokenError('session-ended')),
    )
    expect(error.reason).toBe('session-ended')
    expect(error.uncertain).toBe(false)
  })

  it('un rechazo del servidor no es incierto; un 5xx sí', () => {
    expect(classifyStorageError(apiError(413)).uncertain).toBe(false)
    expect(classifyStorageError(apiError(503)).uncertain).toBe(true)
  })
})

describe('createSupabasePhotoStorage', () => {
  it('sube un Blob con su tipo, caché de un año y sin upsert', async () => {
    const upload = vi.fn().mockResolvedValue({ data: {}, error: null })
    const { client, from } = fakeClient({ upload })
    const storage = createSupabasePhotoStorage({
      getClient: () => Promise.resolve(client),
    })

    // Un Blob sin tipo: se envuelve con el tipo correcto.
    await storage.upload('u/p/photo-v.webp', new Blob(['x']), {
      contentType: 'image/webp',
    })

    expect(from).toHaveBeenCalledWith('plant-photos')
    const [path, body, options] = upload.mock.calls[0] as [
      string,
      Blob,
      Record<string, unknown>,
    ]
    expect(path).toBe('u/p/photo-v.webp')
    expect(body.type).toBe('image/webp')
    expect(options).toEqual({
      contentType: 'image/webp',
      cacheControl: PHOTO_CACHE_CONTROL,
      upsert: false,
    })
    expect(PHOTO_CACHE_CONTROL).toBe('31536000')
  })

  it('da por subida una ruta que ya existe (409)', async () => {
    const upload = vi
      .fn()
      .mockResolvedValue({ data: null, error: apiError(400, '409') })
    const { client } = fakeClient({ upload })
    const storage = createSupabasePhotoStorage({
      getClient: () => Promise.resolve(client),
    })
    await expect(
      storage.upload('u/p/photo-v.webp', new Blob(['x']), {
        contentType: 'image/webp',
      }),
    ).resolves.toBeUndefined()
  })

  it('rechaza con el motivo del bucket', async () => {
    const upload = vi
      .fn()
      .mockResolvedValue({ data: null, error: apiError(400, '413') })
    const { client } = fakeClient({ upload })
    const storage = createSupabasePhotoStorage({
      getClient: () => Promise.resolve(client),
    })
    await expect(
      storage.upload('u/p/photo-v.webp', new Blob(['x']), {
        contentType: 'image/webp',
      }),
    ).rejects.toMatchObject({ reason: 'too-large' })
  })

  it('lista la carpeta por páginas y sin subcarpetas', async () => {
    const page = (count: number, start = 0) =>
      Array.from({ length: count }, (_, index) => ({
        id: `id-${start + index}`,
        name: `photo-${start + index}.webp`,
      }))
    const list = vi
      .fn()
      .mockResolvedValueOnce({ data: page(100), error: null })
      .mockResolvedValueOnce({
        data: [...page(1, 100), { id: null, name: 'carpeta' }],
        error: null,
      })
    const { client } = fakeClient({ list })
    const storage = createSupabasePhotoStorage({
      getClient: () => Promise.resolve(client),
    })

    const names = await storage.list('u/p/')
    expect(names).toHaveLength(101)
    expect(names[0]).toBe('u/p/photo-0.webp')
    expect(list).toHaveBeenNthCalledWith(
      2,
      'u/p',
      expect.objectContaining({ offset: 100 }),
    )
  })

  it('sin cliente (sin conexión al cargar el cliente de Supabase) da offline', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const storage = createSupabasePhotoStorage({
      getClient: () => Promise.reject(new Error('chunk')),
    })
    await expect(storage.remove(['a'])).rejects.toBeInstanceOf(
      PhotoStorageError,
    )
    await expect(storage.remove(['a'])).rejects.toMatchObject({
      reason: 'offline',
    })
    online.mockRestore()
  })
})
