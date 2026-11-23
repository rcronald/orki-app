import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectionPlant } from '../collection/model.ts'
import {
  DETAIL_TEXT,
  GALLERY_ERROR_TEXT,
  GALLERY_TEXT,
} from '../detail/texts.ts'
import type { ReferencePicture } from '../lib/referencePhotos.ts'
import { forgetReferencePhotos } from '../lib/useReferencePhoto.ts'
import { PhotoStorageError } from '../photos/storage.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import { resetFakeClerk, setFakeClerk } from '../test/clerk-mock.tsx'
import { plant } from '../test/collection.ts'
import {
  fakeImageSource,
  memoryRowsFor,
  renderPlantRoutes,
} from '../test/plant-routes.tsx'

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

// La foto de referencia de la especie (#234), sin red: un doble.
const loadReference = vi.hoisted(() =>
  vi.fn<(speciesId: string) => Promise<ReferencePicture | null>>(),
)
vi.mock('../lib/referencePhotos.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/referencePhotos.ts')>()),
  getSpeciesReferencePhoto: loadReference,
}))

const REFERENCE: ReferencePicture = {
  medium: { src: '/referencia-media.webp', width: 480, height: 360 },
  thumbnail: { src: '/referencia-miniatura.webp', width: 160, height: 120 },
  credit: {
    author: 'Ana Pérez',
    license: 'cc-by',
    sourceUrl: 'https://www.inaturalist.org/photos/12345',
    modified: true,
  },
  sourcePhotoId: '12345',
}

// Galería del detalle (#183): ver las fotos, el visor, la fecha y la nota,
// la principal y el orden, sin conexión y con axe.

const USER = 'user_prueba'
const ID = '6f1c2a4e-8b3d-4e5f-9a7b-0c1d2e3f4a5b'
const NAME = 'Phalaenopsis amabilis'

function path(kind: 'photo' | 'thumb', n: number) {
  return `${USER}/${ID}/${kind}-${String(n)}.webp`
}

const AMABILIS = plant({
  id: ID,
  photoPath: path('photo', 1),
  thumbnailPath: path('thumb', 1),
  photoInBloom: false,
})

/** Las fotos de más (de la 2 en adelante), con fecha y nota en la tercera. */
function extra(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    photoPath: path('photo', i + 2),
    thumbnailPath: path('thumb', i + 2),
    ...(i === 1
      ? { takenAt: '2026-10-05', note: 'Primera vara floral', inBloom: true }
      : {}),
  }))
}

async function renderDetail({
  photos = 3,
  base = AMABILIS,
  entries = [`/coleccion/${ID}`],
  images = fakeImageSource(),
}: {
  photos?: number
  base?: CollectionPlant
  entries?: string[]
  images?: ReturnType<typeof fakeImageSource>
} = {}) {
  const subject: CollectionPlant =
    photos === 0 ? { ...base, photoPath: null, thumbnailPath: null } : base
  const rows = memoryRowsFor([subject], USER, {
    [ID]: extra(Math.max(0, photos - 1)),
  })
  const user = userEvent.setup()
  const view = await renderPlantRoutes({
    entries,
    plants: [subject],
    images: images.source,
    photoRows: rows,
  })
  // La lista de plant_photos.
  await act(async () => {
    await Promise.resolve()
  })
  return { ...view, rows, user, images }
}

const gallery = () => screen.getByRole('region', { name: GALLERY_TEXT.title })
const mainButton = () =>
  within(gallery()).getByRole('button', { name: /^Ver en grande: / })
const thumbs = () =>
  within(
    within(gallery()).getByRole('list', { name: GALLERY_TEXT.choose }),
  ).getAllByRole('button')
const tool = (name: string) => within(gallery()).getByRole('button', { name })
const status = () => within(gallery()).getByRole('status')

beforeEach(() => {
  forgetReferencePhotos()
  loadReference.mockReset()
  loadReference.mockResolvedValue(null)
  document.documentElement.lang = 'es'
  resetFakeClerk()
  setFakeClerk({ signedIn: true, userId: USER })
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('foto de referencia de la especie (#234)', () => {
  it('sin fotos propias, la de su especie en lugar del hueco, rotulada y sin contar', async () => {
    loadReference.mockResolvedValue(REFERENCE)
    await renderDetail({ photos: 0 })
    const image = await within(gallery()).findByRole('img', {
      name: 'Foto de referencia de Phalaenopsis amabilis',
    })
    expect(image).toHaveAttribute('src', '/referencia-media.webp')
    expect(loadReference).toHaveBeenCalledTimes(1)
    expect(loadReference.mock.calls[0]?.[0]).toBe('species-amabilis')
    expect(gallery()).toHaveTextContent('Foto de referencia')
    expect(gallery()).toHaveTextContent(GALLERY_TEXT.referenceNote)
    expect(gallery()).toHaveTextContent('Foto: Ana Pérez')
    // Ni principal, ni «N de 6», ni visor, ni herramientas.
    expect(gallery()).not.toHaveTextContent(/de 6/)
    expect(gallery()).not.toHaveTextContent('Principal')
    expect(
      within(gallery()).queryByRole('button', { name: /^Ver en grande/ }),
    ).toBeNull()
    expect(
      within(gallery()).queryByRole('button', {
        name: GALLERY_TEXT.editDetails,
      }),
    ).toBeNull()
    expect(
      within(gallery()).getByRole('link', { name: GALLERY_TEXT.addPhotos }),
    ).toBeVisible()
    await expectNoAxeViolations()
  })

  it('si la imagen no carga, el marcador de siempre', async () => {
    loadReference.mockResolvedValue(REFERENCE)
    await renderDetail({ photos: 0 })
    const image = await within(gallery()).findByRole('img', {
      name: /Foto de referencia/,
    })
    act(() => {
      image.dispatchEvent(new Event('error'))
    })
    expect(
      within(gallery()).getByRole('img', { name: GALLERY_TEXT.noPhoto }),
    ).toBeVisible()
  })

  it('con fotos propias no se pide ni se muestra', async () => {
    loadReference.mockResolvedValue(REFERENCE)
    await renderDetail({ photos: 2 })
    expect(loadReference).not.toHaveBeenCalled()
    expect(screen.queryByText(/Foto de referencia/)).toBeNull()
  })

  it('sin especie del catálogo no se pide', async () => {
    await renderDetail({ photos: 0, base: { ...AMABILIS, species: null } })
    expect(loadReference).not.toHaveBeenCalled()
  })

  it('sin conexión no se pide', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await renderDetail({ photos: 0 })
    expect(loadReference).not.toHaveBeenCalled()
  })
})

describe('galería del detalle', () => {
  it('sin fotos: el marcador de siempre y «Añadir fotos», que lleva a la edición', async () => {
    await renderDetail({ photos: 0 })
    expect(
      within(gallery()).getByRole('img', { name: GALLERY_TEXT.noPhoto }),
    ).toBeVisible()
    expect(
      within(gallery()).queryByRole('button', { name: /^Ver en grande/ }),
    ).toBeNull()
    expect(within(gallery()).queryByRole('list')).toBeNull()
    expect(
      within(gallery()).queryByRole('button', {
        name: GALLERY_TEXT.editDetails,
      }),
    ).toBeNull()
    expect(
      within(gallery()).getByRole('link', { name: GALLERY_TEXT.addPhotos }),
    ).toHaveAttribute('href', `/coleccion/${ID}/editar`)
    await expectNoAxeViolations()
  })

  it('una foto: en grande, sin miniaturas ni orden, con su fecha y nota editables', async () => {
    await renderDetail({ photos: 1 })
    expect(
      await within(gallery()).findByRole('img', {
        name: `Foto principal de ${NAME}`,
      }),
    ).toHaveAttribute('src', `blob:${path('thumb', 1)}`)
    expect(within(gallery()).getByText('1 de 6')).toBeVisible()
    expect(within(gallery()).queryByRole('list')).toBeNull()
    expect(tool(GALLERY_TEXT.editDetails)).toBeVisible()
    expect(
      within(gallery()).queryByRole('button', { name: GALLERY_TEXT.makeMain }),
    ).toBeNull()
    expect(
      within(gallery()).getByRole('link', { name: GALLERY_TEXT.manage }),
    ).toBeVisible()
    await expectNoAxeViolations()
  })

  it('seis fotos: la principal en grande y seis miniaturas; elegir una la muestra con su fecha y nota', async () => {
    const { user } = await renderDetail({ photos: 6 })
    expect(within(gallery()).getByText('6 de 6')).toBeVisible()
    expect(thumbs().map((thumb) => thumb.getAttribute('aria-label'))).toEqual([
      'Foto principal',
      'Foto 2 de 6',
      'Foto 3 de 6',
      'Foto 4 de 6',
      'Foto 5 de 6',
      'Foto 6 de 6',
    ])
    expect(thumbs()[0]).toHaveAttribute('aria-pressed', 'true')
    expect(within(gallery()).queryByText('Primera vara floral')).toBeNull()

    await user.click(thumbs()[2])
    expect(thumbs()[2]).toHaveAttribute('aria-pressed', 'true')
    expect(thumbs()[0]).toHaveAttribute('aria-pressed', 'false')
    expect(mainButton()).toHaveAccessibleName(
      `Ver en grande: Foto 3 de 6 de ${NAME}, en flor`,
    )
    expect(
      await within(mainButton()).findByRole('img', {
        name: `Foto 3 de 6 de ${NAME}, en flor`,
      }),
    ).toHaveAttribute('src', `blob:${path('thumb', 3)}`)
    expect(within(gallery()).getByText('Primera vara floral')).toBeVisible()
    expect(
      within(gallery()).getByText('Foto del 5 de octubre de 2026'),
    ).toBeVisible()
    expect(within(gallery()).getByText(GALLERY_TEXT.inBloom)).toBeVisible()
    await expectNoAxeViolations()
  })

  it('el visor: se abre con el teclado, recorre con las flechas, atrapa el foco, Escape cierra y devuelve el foco', async () => {
    const { user, images } = await renderDetail({ photos: 3 })
    // En la página solo miniaturas: la foto completa no se ha pedido.
    expect(
      images.acquire.mock.calls.filter(([, kind]) => kind === 'photo'),
    ).toEqual([])

    mainButton().focus()
    await user.keyboard('{Enter}')
    const viewer = screen.getByRole('dialog', { name: `Fotos de ${NAME}` })
    expect(within(viewer).getByRole('button', { name: 'Cerrar' })).toHaveFocus()
    expect(within(viewer).getByText('Foto 1 de 3')).toBeVisible()
    expect(
      await within(viewer).findByRole('img', {
        name: `Foto principal de ${NAME}`,
      }),
    ).toHaveAttribute('src', `blob:${path('photo', 1)}`)
    expect(
      within(viewer).getByRole('button', { name: 'Foto anterior' }),
    ).toHaveAttribute('aria-disabled', 'true')
    await expectNoAxeViolations()

    await user.keyboard('{ArrowRight}')
    expect(within(viewer).getByText('Foto 2 de 3')).toBeVisible()
    expect(
      await within(viewer).findByRole('img', {
        name: `Foto 2 de 3 de ${NAME}`,
      }),
    ).toHaveAttribute('src', `blob:${path('photo', 2)}`)
    await user.click(
      within(viewer).getByRole('button', { name: 'Foto siguiente' }),
    )
    expect(within(viewer).getByText('Foto 3 de 3')).toBeVisible()
    // La tercera lleva su fecha y su nota también en el visor.
    expect(within(viewer).getByText('Primera vara floral')).toBeVisible()
    expect(
      within(viewer).getByRole('button', { name: 'Foto siguiente' }),
    ).toHaveAttribute('aria-disabled', 'true')
    await user.keyboard('{ArrowRight}')
    expect(within(viewer).getByText('Foto 3 de 3')).toBeVisible()
    await user.keyboard('{ArrowLeft}')
    expect(within(viewer).getByText('Foto 2 de 3')).toBeVisible()
    // Solo se pidieron completas las que se vieron.
    expect(
      images.acquire.mock.calls
        .filter(([, kind]) => kind === 'photo')
        .map(([requested]) => requested),
    ).toEqual([
      path('photo', 1),
      path('photo', 2),
      path('photo', 3),
      path('photo', 2),
    ])

    // El foco no sale del visor.
    await user.tab()
    await user.tab()
    await user.tab()
    await user.tab()
    expect(viewer).toContainElement(document.activeElement as HTMLElement)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mainButton()).toHaveFocus()
    // Queda elegida la última que se vio.
    expect(thumbs()[1]).toHaveAttribute('aria-pressed', 'true')
  })

  it('fecha y nota: comprueba lo escrito, guarda con su estado y devuelve el foco', async () => {
    const { user, rows } = await renderDetail({ photos: 3 })
    await user.click(thumbs()[1])
    await user.click(tool(GALLERY_TEXT.editDetails))

    const form = within(gallery()).getByRole('form', {
      name: GALLERY_TEXT.formTitle,
    })
    const date = within(form).getByLabelText(GALLERY_TEXT.dateLabel)
    const note = within(form).getByLabelText(GALLERY_TEXT.noteLabel)
    expect(date).toHaveFocus()
    expect(within(form).getByText('0 de 500 caracteres')).toBeVisible()

    await user.type(date, '2999-01-01')
    await user.click(note)
    await user.paste('x'.repeat(501))
    await user.click(
      within(form).getByRole('button', { name: GALLERY_TEXT.save }),
    )
    expect(date).toHaveAccessibleDescription(GALLERY_TEXT.dateFuture)
    expect(date).toHaveFocus()
    expect(note).toHaveAccessibleDescription(
      `${GALLERY_TEXT.noteTooLong(500)} 501 de 500 caracteres`,
    )
    expect(rows.photosOf(ID)[1].note).toBeNull()
    await expectNoAxeViolations()

    await user.clear(date)
    await user.type(date, '2026-11-01')
    await user.clear(note)
    await user.type(note, '  Hojas nuevas ')
    await user.click(
      within(form).getByRole('button', { name: GALLERY_TEXT.inBloomLabel }),
    )
    await user.click(
      within(form).getByRole('button', { name: GALLERY_TEXT.save }),
    )

    await waitFor(() => expect(status()).toHaveTextContent(GALLERY_TEXT.saved))
    expect(rows.photosOf(ID)[1]).toMatchObject({
      takenAt: '2026-11-01',
      note: 'Hojas nuevas',
      inBloom: true,
    })
    expect(within(gallery()).queryByRole('form')).toBeNull()
    expect(within(gallery()).getByText('Hojas nuevas')).toBeVisible()
    expect(
      within(gallery()).getByText('Foto del 1 de noviembre de 2026'),
    ).toBeVisible()
    expect(tool(GALLERY_TEXT.editDetails)).toHaveFocus()
  })

  it('fecha y nota: si falla, lo dice y conserva lo escrito; «Cancelar» no guarda', async () => {
    const { user, rows } = await renderDetail({ photos: 2 })
    rows.failUpdate = () => ({ error: new PhotoStorageError('failed') })
    await user.click(tool(GALLERY_TEXT.editDetails))
    const form = within(gallery()).getByRole('form', {
      name: GALLERY_TEXT.formTitle,
    })
    await user.type(within(form).getByLabelText(GALLERY_TEXT.noteLabel), 'Hola')
    await user.click(
      within(form).getByRole('button', { name: GALLERY_TEXT.save }),
    )
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      GALLERY_ERROR_TEXT.failed,
    )
    expect(within(form).getByLabelText(GALLERY_TEXT.noteLabel)).toHaveValue(
      'Hola',
    )

    await user.click(
      within(form).getByRole('button', { name: GALLERY_TEXT.cancel }),
    )
    expect(within(gallery()).queryByRole('form')).toBeNull()
    expect(tool(GALLERY_TEXT.editDetails)).toHaveFocus()
    expect(rows.photosOf(ID)[0].note).toBeNull()
  })

  it('«Hacer principal»: cambia el orden de una vez y la tarjeta del inventario muestra la nueva', async () => {
    const { user, rows } = await renderDetail({
      photos: 3,
      entries: ['/coleccion', `/coleccion/${ID}`],
    })
    const reorder = vi.spyOn(rows, 'reorder')
    await user.click(thumbs()[2])
    const makeMain = tool(GALLERY_TEXT.makeMain)
    await user.click(makeMain)

    await waitFor(() =>
      expect(status()).toHaveTextContent(GALLERY_TEXT.madeMain),
    )
    expect(reorder).toHaveBeenCalledTimes(1)
    expect(rows.photosOf(ID).map((photo) => photo.thumbnailPath)).toEqual([
      path('thumb', 3),
      path('thumb', 1),
      path('thumb', 2),
    ])
    // Sigue elegida, ahora la principal; el botón queda desactivado con el foco.
    expect(thumbs()[0]).toHaveAttribute('aria-pressed', 'true')
    expect(thumbs()[0]).toHaveAccessibleName('Foto principal')
    expect(makeMain).toHaveFocus()
    expect(makeMain).toHaveAttribute('aria-disabled', 'true')
    expect(makeMain).toHaveAccessibleDescription(GALLERY_TEXT.alreadyMain)

    await user.click(screen.getByRole('link', { name: DETAIL_TEXT.back }))
    const card = await screen.findByRole('img', {
      name: /Phalaenopsis amabilis/,
    })
    expect(card).toHaveAttribute('src', `blob:${path('thumb', 3)}`)
  })

  it('«Mover antes» y «Mover después»: cambian el lugar y se desactivan en los extremos', async () => {
    const { user, rows } = await renderDetail({ photos: 3 })
    await user.click(thumbs()[1])
    expect(tool(GALLERY_TEXT.moveEarlier)).not.toHaveAttribute('aria-disabled')

    await user.click(tool(GALLERY_TEXT.moveLater))
    await waitFor(() =>
      expect(status()).toHaveTextContent(GALLERY_TEXT.moved(3, 3)),
    )
    expect(rows.photosOf(ID).map((photo) => photo.thumbnailPath)).toEqual([
      path('thumb', 1),
      path('thumb', 3),
      path('thumb', 2),
    ])
    expect(thumbs()[2]).toHaveAttribute('aria-pressed', 'true')
    expect(tool(GALLERY_TEXT.moveLater)).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(tool(GALLERY_TEXT.moveLater)).toHaveAccessibleDescription(
      GALLERY_TEXT.lastAlready,
    )
    // Desactivado no hace nada.
    const reorder = vi.spyOn(rows, 'reorder')
    await user.click(tool(GALLERY_TEXT.moveLater))
    expect(reorder).not.toHaveBeenCalled()

    await user.click(tool(GALLERY_TEXT.moveEarlier))
    await user.click(tool(GALLERY_TEXT.moveEarlier))
    await waitFor(() =>
      expect(status()).toHaveTextContent(GALLERY_TEXT.madeMain),
    )
    expect(rows.photosOf(ID)[0].thumbnailPath).toBe(path('thumb', 2))
    await expectNoAxeViolations()
  })

  it('si otra foto llegó entre tanto, no cambia nada, lo dice y vuelve a leer las fotos', async () => {
    const { user, rows } = await renderDetail({ photos: 2 })
    // Otro dispositivo añade una tercera.
    rows.rows.set('otra', {
      ...rows.photosOf(ID)[1],
      id: 'otra',
      userId: USER,
      photoPath: path('photo', 9),
      thumbnailPath: path('thumb', 9),
      position: 2,
    })
    await user.click(thumbs()[1])
    await user.click(tool(GALLERY_TEXT.makeMain))
    expect(await within(gallery()).findByRole('alert')).toHaveTextContent(
      GALLERY_ERROR_TEXT.changed,
    )
    expect(rows.photosOf(ID)[0].thumbnailPath).toBe(path('thumb', 1))
    await waitFor(() => expect(thumbs()).toHaveLength(3))
  })
})

describe('galería del detalle sin conexión', () => {
  function goOffline() {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
  }

  /** Sin red: solo las miniaturas guardadas (la principal) se pueden leer. */
  function offlineImages() {
    const images = fakeImageSource()
    images.acquire.mockImplementation((requested) =>
      requested === path('thumb', 1)
        ? Promise.resolve(`blob:${requested}`)
        : Promise.reject(new Error('sin red')),
    )
    return images
  }

  it('al abrir sin conexión: solo la principal, el motivo y nada que cambiar', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const images = offlineImages()
    const rows = memoryRowsFor([AMABILIS], USER, { [ID]: extra(2) })
    rows.failList = () => new PhotoStorageError('offline', { uncertain: true })
    await renderPlantRoutes({
      entries: [`/coleccion/${ID}`],
      plants: [AMABILIS],
      images: images.source,
      photoRows: rows,
    })
    expect(
      await within(gallery()).findByRole('img', {
        name: `Foto principal de ${NAME}`,
      }),
    ).toHaveAttribute('src', `blob:${path('thumb', 1)}`)
    expect(within(gallery()).getByText(GALLERY_TEXT.onlyMain)).toBeVisible()
    expect(within(gallery()).queryByRole('list')).toBeNull()
    expect(
      within(gallery()).queryByRole('button', {
        name: GALLERY_TEXT.editDetails,
      }),
    ).toBeNull()
    expect(tool(GALLERY_TEXT.manage)).toHaveAttribute('aria-disabled', 'true')
    expect(tool(GALLERY_TEXT.manage)).toHaveAccessibleDescription(
      GALLERY_TEXT.offline,
    )
    // Ninguna imagen rota.
    for (const image of within(gallery()).queryAllByRole('img')) {
      expect(image).toHaveAttribute('src', expect.stringMatching(/^blob:/))
    }
    await expectNoAxeViolations()

    // Al volver la conexión, se leen las demás.
    rows.failList = undefined
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await Promise.resolve()
    })
    await waitFor(() => expect(thumbs()).toHaveLength(3))
  })

  it('con la galería ya vista: las fotos sin copia dicen «Disponible con conexión» y no se puede escribir', async () => {
    const images = offlineImages()
    const { user, rows } = await renderDetail({ photos: 3, images })
    goOffline()
    rows.failList = () => new PhotoStorageError('offline', { uncertain: true })

    await waitFor(() =>
      expect(thumbs()[1]).toHaveAccessibleName(
        `Foto 2 de 3: ${GALLERY_TEXT.unavailable}`,
      ),
    )
    await user.click(thumbs()[1])
    expect(
      await within(mainButton()).findByText(GALLERY_TEXT.unavailable),
    ).toBeVisible()
    expect(within(mainButton()).queryByRole('img')).toBeNull()
    for (const name of [
      GALLERY_TEXT.editDetails,
      GALLERY_TEXT.makeMain,
      GALLERY_TEXT.moveEarlier,
      GALLERY_TEXT.moveLater,
    ]) {
      expect(tool(name)).toHaveAttribute('aria-disabled', 'true')
    }
    expect(tool(GALLERY_TEXT.editDetails)).toHaveAccessibleDescription(
      GALLERY_TEXT.offline,
    )
    const reorder = vi.spyOn(rows, 'reorder')
    await user.click(tool(GALLERY_TEXT.makeMain))
    await user.click(tool(GALLERY_TEXT.editDetails))
    expect(reorder).not.toHaveBeenCalled()
    expect(within(gallery()).queryByRole('form')).toBeNull()

    // El visor sin la foto: el hueco, sin imagen rota.
    await user.click(mainButton())
    const viewer = screen.getByRole('dialog')
    expect(
      await within(viewer).findByText(GALLERY_TEXT.unavailable),
    ).toBeVisible()
    expect(within(viewer).queryByRole('img')).toBeNull()
    await expectNoAxeViolations()
  })

  it('recuerda la galería al volver a la planta sin conexión', async () => {
    const images = offlineImages()
    const { user, rows } = await renderDetail({
      photos: 3,
      images,
      entries: ['/coleccion', `/coleccion/${ID}`],
    })
    await user.click(screen.getByRole('link', { name: DETAIL_TEXT.back }))
    goOffline()
    rows.failList = () => new PhotoStorageError('offline', { uncertain: true })
    await user.click(screen.getByRole('link', { name: NAME }))
    expect(thumbs()).toHaveLength(3)
    expect(within(gallery()).queryByText(GALLERY_TEXT.onlyMain)).toBeNull()
  })
})
