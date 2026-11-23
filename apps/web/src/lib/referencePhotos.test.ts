import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONFIG, fakeReferencePhoto } from '../test/public-catalog.ts'
import {
  getSpeciesReferencePhoto,
  REFERENCE_LICENSES,
  ReferencePhotoError,
  toReferencePicture,
} from './referencePhotos.ts'
import { initSupabase, setSessionTokenSource } from './supabase.ts'

const resolve = (path: string) => `https://cdn.invalid/${path}`
const SPECIES = '00000001-0000-4000-8000-000000000001'

describe('toReferencePicture', () => {
  it('resuelve las dos imágenes y el crédito', () => {
    expect(toReferencePicture(fakeReferencePhoto(SPECIES), resolve)).toEqual({
      medium: {
        src: `https://cdn.invalid/${SPECIES}/medium-12345.webp`,
        width: 480,
        height: 360,
      },
      thumbnail: {
        src: `https://cdn.invalid/${SPECIES}/thumb-12345.webp`,
        width: 160,
        height: 120,
      },
      credit: {
        author: 'Ana Pérez',
        license: 'cc-by',
        sourceUrl: 'https://www.inaturalist.org/photos/12345',
        modified: true,
      },
      sourcePhotoId: '12345',
    })
  })

  it('la miniatura de las listas no trae la media', () => {
    const thumbnail = { ...fakeReferencePhoto(SPECIES), medium_path: undefined }
    expect(toReferencePicture(thumbnail, resolve)?.medium).toBeNull()
  })

  it.each([
    ['sin foto', null],
    ['una licencia no aceptada', { license: 'cc-by-nc' }],
    ['sin autor', { author_name: '  ' }],
    [
      'un original que no es de iNaturalist',
      { source_url: 'https://x.invalid/photos/1' },
    ],
    ['sin miniatura', { thumbnail_path: null }],
    ['un tamaño que no es un entero positivo', { thumbnail_width: 0 }],
    ['otra fuente', { source: 'flickr' }],
  ])('%s: null', (_case, value) => {
    const row =
      value === null ? null : { ...fakeReferencePhoto(SPECIES), ...value }
    expect(toReferencePicture(row, resolve)).toBeNull()
  })

  it('las cuatro licencias aceptadas enlazan a Creative Commons', () => {
    for (const { url } of Object.values(REFERENCE_LICENSES)) {
      expect(url).toMatch(/^https:\/\/creativecommons\.org\//)
    }
  })
})

describe('getSpeciesReferencePhoto', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
  let online = true

  beforeEach(() => {
    initSupabase(CONFIG)
    setSessionTokenSource(() => Promise.resolve('token-de-prueba'))
    online = true
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
    fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    setSessionTokenSource(null)
  })

  it('una consulta por clave a species_photos, con la sesión', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([fakeReferencePhoto(SPECIES)]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const picture = await getSpeciesReferencePhoto(SPECIES)
    expect(picture?.medium?.src).toBe(
      `https://ejemplo.supabase.co/storage/v1/object/public/species-photos/${SPECIES}/medium-12345.webp`,
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [input, init] = fetchMock.mock.calls[0] ?? []
    const url = new URL(input as string)
    expect(url.pathname).toBe('/rest/v1/species_photos')
    expect(url.searchParams.get('species_id')).toBe(`eq.${SPECIES}`)
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer token-de-prueba',
    )
  })

  it('sin foto, null', async () => {
    fetchMock.mockResolvedValue(
      new Response('[]', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(await getSpeciesReferencePhoto(SPECIES)).toBeNull()
  })

  it('sin conexión no pide nada', async () => {
    online = false
    await expect(getSpeciesReferencePhoto(SPECIES)).rejects.toBeInstanceOf(
      ReferencePhotoError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('un fallo no es «sin foto»: se rechaza', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 400 }))
    await expect(getSpeciesReferencePhoto(SPECIES)).rejects.toBeInstanceOf(
      ReferencePhotoError,
    )
  })
})
