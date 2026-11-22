import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LAST_USER_KEY } from '../auth/offline-identity.ts'
import type { CollectionPlant } from '../collection/model.ts'
import { DETAIL_TEXT } from '../detail/texts.ts'
import { initSupabase, setSessionTokenSource } from '../lib/supabase.ts'
import { PhotoProcessingError } from '../photos/errors.ts'
import type { ProcessedPhoto } from '../photos/process.ts'
import { clearQuickAccessGeneraCache } from '../registration/quick-genera.ts'
import { PLANT_UPDATE_ERROR_TEXT } from '../registration/save-plant.ts'
import {
  PLANT_EDIT_NOTICE_TEXT,
  PLANT_EDIT_TEXT,
  PLANT_FORM_TEXT,
} from '../registration/texts.ts'
import { PATHS } from '../routes/paths.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import { resetFakeClerk, setFakeClerk } from '../test/clerk-mock.tsx'
import { plant } from '../test/collection.ts'
import { processedPhoto } from '../test/photos.ts'
import { fakeImageSource, renderPlantRoutes } from '../test/plant-routes.tsx'
import {
  CONFIG,
  fakeSupabase,
  GENERA,
  json,
  SPECIES,
  type FakeSupabase,
} from '../test/supabase-plants.ts'
import EditPlantPage from './EditPlantPage.tsx'

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

// jsdom no tiene canvas: la preparación de la foto es un doble.
const processPhoto = vi.hoisted(() =>
  vi.fn<
    (file: Blob, options: { signal?: AbortSignal }) => Promise<ProcessedPhoto>
  >(),
)
vi.mock('../photos/load.ts', () => ({
  loadPhotoProcessing: () =>
    Promise.resolve({ processPhoto, PhotoProcessingError }),
}))

const USER = 'user_prueba'
const AMABILIS_ID = '6f1c2a4e-8b3d-4e5f-9a7b-0c1d2e3f4a5b'
const PENDING_ID = '7a2b3c4d-0000-4000-8000-000000000002'

/** Planta enlazada a Phalaenopsis amabilis, con foto. */
function amabilis(overrides: Partial<CollectionPlant> = {}): CollectionPlant {
  return plant({
    id: AMABILIS_ID,
    displayName: SPECIES.amabilis.scientific_name,
    enteredName: SPECIES.amabilis.scientific_name,
    species: {
      id: SPECIES.amabilis.id,
      scientificName: SPECIES.amabilis.scientific_name,
      type: 'species',
      status: 'validated',
    },
    genus: GENERA.phalaenopsis,
    type: 'species',
    acquiredOn: '2026-10-01',
    origin: 'Vivero Los Andes',
    nickname: 'La blanca',
    photoInBloom: true,
    photoPath: `${USER}/${AMABILIS_ID}/photo-v1.webp`,
    thumbnailPath: `${USER}/${AMABILIS_ID}/thumb-v1.webp`,
    createdAt: '2026-11-02T10:00:00+00:00',
    ...overrides,
  })
}

/** Planta por validar, sin foto. */
function pending(): CollectionPlant {
  return plant({
    id: PENDING_ID,
    displayName: 'La naranja del mercado',
    displayNameIsScientific: false,
    enteredName: 'La naranja del mercado',
    species: null,
    genus: GENERA.cattleya,
    type: 'unknown',
    validation: 'pending',
    createdAt: '2026-11-01T10:00:00+00:00',
  })
}

let supabase: FakeSupabase

beforeEach(() => {
  document.documentElement.lang = 'es'
  resetFakeClerk()
  setFakeClerk({ signedIn: true, userId: USER })
  clearQuickAccessGeneraCache()
  processPhoto.mockReset()
  processPhoto.mockImplementation(() => Promise.resolve(processedPhoto()))
  URL.createObjectURL = vi.fn((blob: Blob) => `blob:prueba-${blob.size}`)
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  initSupabase(CONFIG)
  setSessionTokenSource(() => Promise.resolve('token_de_prueba'))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setSessionTokenSource(null)
})

/**
 * El inventario, el detalle y la edición con estas plantas, empezando en
 * `entries` (por defecto: inventario → detalle → edición, como al navegar).
 */
async function renderEdit(
  plants: readonly CollectionPlant[],
  entries?: string[],
) {
  supabase = fakeSupabase(plants)
  vi.stubGlobal('fetch', supabase.fetch)
  const images = fakeImageSource()
  const user = userEvent.setup()
  const view = await renderPlantRoutes({
    entries: entries ?? ['/coleccion'],
    plants,
    images: images.source,
    extraRoutes: <Route path={PATHS.editPlant} element={<EditPlantPage />} />,
  })
  if (entries === undefined) {
    const first = plants[0]
    if (!first) throw new Error('Sin plantas.')
    await user.click(screen.getByRole('link', { name: first.displayName }))
    await user.click(screen.getByRole('link', { name: DETAIL_TEXT.edit }))
  }
  // Los géneros de acceso rápido.
  await screen.findByRole('button', { name: 'Phalaenopsis' })
  return { ...view, user, images }
}

const location = () => screen.getByTestId('location').textContent
const nameInput = () => screen.getByRole('combobox', { name: 'Nombre' })
const nicknameInput = () => screen.getByLabelText('Apodo')
const typeGroup = () => screen.getByRole('group', { name: 'Tipo' })
const submitButton = () =>
  screen.getByRole('button', {
    name: /^(Guardar cambios|Guardando…|Actualizando la foto…)$/,
  })

function datum(label: string): HTMLElement {
  const term = screen.getByText(label, { selector: 'dt' })
  const value = term.nextElementSibling
  if (!(value instanceof HTMLElement)) throw new Error(`Sin valor: ${label}`)
  return value
}

describe('EditPlantPage', () => {
  it('abre el formulario del registro precargado con la planta y su foto', async () => {
    await renderEdit([amabilis()])

    expect(location()).toBe(`/coleccion/${AMABILIS_ID}/editar`)
    expect(
      screen.getByRole('heading', { level: 1, name: PLANT_EDIT_TEXT.title }),
    ).toHaveFocus()
    expect(
      screen.getByRole('form', { name: PLANT_EDIT_TEXT.title }),
    ).toBeInTheDocument()
    expect(nameInput()).toHaveValue('Phalaenopsis amabilis')
    // Enlazada: el género y el tipo son los de la especie y no se cambian.
    const genus = screen.getByRole('button', { name: 'Phalaenopsis' })
    expect(genus).toHaveAttribute('aria-pressed', 'true')
    expect(genus).toHaveAttribute('aria-disabled', 'true')
    expect(
      within(typeGroup()).getByRole('button', { name: 'Especie' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Fecha de adquisición')).toHaveValue(
      '2026-10-01',
    )
    expect(screen.getByRole('combobox', { name: 'Origen' })).toHaveValue(
      'Vivero Los Andes',
    )
    // "Más detalles" se abre sola: trae el apodo.
    expect(nicknameInput()).toHaveValue('La blanca')
    // La foto ya subida, con "en floración" marcado.
    const photo = await screen.findByRole('img', {
      name: PLANT_EDIT_NOTICE_TEXT.storedPhotoAlt,
    })
    expect(photo).toHaveAttribute(
      'src',
      `blob:${USER}/${AMABILIS_ID}/photo-v1.webp`,
    )
    expect(
      screen.getByRole('button', { name: PLANT_FORM_TEXT.photoInBloom }),
    ).toHaveAttribute('aria-pressed', 'true')
    // Sin borrador: la edición no escribe el del registro. (Solo está el
    // último usuario con sesión, para verlo sin conexión, #18.)
    expect(
      Object.keys(window.localStorage).filter((key) => key !== LAST_USER_KEY),
    ).toEqual([])
    expect(submitButton()).toHaveTextContent('Guardar cambios')
    await expectNoAxeViolations()
  })

  it('cambiar solo el apodo envía solo el apodo y vuelve al detalle con los datos nuevos', async () => {
    const { user, source } = await renderEdit([amabilis()])

    await user.clear(nicknameInput())
    await user.type(nicknameInput(), 'La reina')
    await user.click(submitButton())

    await waitFor(() => expect(location()).toBe(`/coleccion/${AMABILIS_ID}`))
    // Solo el apodo: ni la especie ni la foto, ni validation ni user_id.
    expect(supabase.patches()).toEqual([{ nickname: 'La reina' }])
    expect(supabase.uploads()).toEqual([])
    expect(supabase.removed()).toEqual([])
    const patch = supabase
      .requests()
      .find((r) => r.method === 'PATCH' && r.url.pathname === '/rest/v1/plants')
    expect(patch?.url.searchParams.get('id')).toBe(`eq.${AMABILIS_ID}`)
    expect(patch?.url.searchParams.get('user_id')).toBe(`eq.${USER}`)

    // El detalle, con el aviso y el apodo nuevo, sin volver a leer nada.
    expect(await screen.findByText(DETAIL_TEXT.saved)).toBeInTheDocument()
    expect(datum(DETAIL_TEXT.nickname)).toHaveTextContent('La reina')
    expect(
      screen.getByRole('heading', { level: 1, name: 'Phalaenopsis amabilis' }),
    ).toHaveFocus()
    expect(source.loads).toHaveLength(1)
    await expectNoAxeViolations()

    // Y el inventario también.
    await user.click(screen.getByRole('link', { name: DETAIL_TEXT.back }))
    expect(location()).toBe('/coleccion')
    const card = screen.getByRole('article', { name: 'Phalaenopsis amabilis' })
    expect(within(card).getByText('La reina')).toBeInTheDocument()
    expect(source.loads).toHaveLength(1)
  })

  it('guardar sin cambios no escribe nada ni muestra aviso', async () => {
    const { user } = await renderEdit([amabilis()])
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe(`/coleccion/${AMABILIS_ID}`))
    expect(supabase.patches()).toEqual([])
    expect(screen.queryByText(DETAIL_TEXT.saved)).toBeNull()
  })

  it('un nombre fuera del catálogo avisa antes de guardar y la planta vuelve a "por validar"', async () => {
    const { user } = await renderEdit([
      amabilis({ photoPath: null, thumbnailPath: null, photoInBloom: false }),
    ])

    await user.clear(nameInput())
    await user.type(nameInput(), 'Mariposa blanca')
    expect(
      await screen.findByText(
        /^Al guardar, la planta dejará de estar enlazada a/,
      ),
    ).toHaveTextContent(
      'Al guardar, la planta dejará de estar enlazada a Phalaenopsis amabilis y volverá a «Nombre por validar».',
    )
    // El género y el tipo se conservan y vuelven a ser editables.
    const genus = screen.getByRole('button', { name: 'Phalaenopsis' })
    expect(genus).toHaveAttribute('aria-pressed', 'true')
    expect(genus).not.toHaveAttribute('aria-disabled')
    await expectNoAxeViolations()

    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe(`/coleccion/${AMABILIS_ID}`))
    expect(supabase.patches()).toEqual([
      { entered_name: 'Mariposa blanca', species_id: null },
    ])
    expect(supabase.patches()[0]).not.toHaveProperty('validation')
    expect(datum(DETAIL_TEXT.validation)).toHaveTextContent(
      'Nombre por validar',
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'Mariposa blanca' }),
    ).toBeInTheDocument()
  })

  it('con la foto que ya tenía, al pasar a «por validar» avisa de que el equipo del catálogo podrá verla', async () => {
    const { user } = await renderEdit([amabilis()])
    const photoGroup = () => screen.getByRole('group', { name: 'Foto' })
    // Especie del catálogo: sin aviso ni enlace.
    expect(photoGroup()).toHaveAccessibleDescription(PLANT_FORM_TEXT.photoHint)
    expect(screen.queryByRole('link', { name: /^Privacidad/ })).toBeNull()

    await user.clear(nameInput())
    await user.type(nameInput(), 'Mariposa blanca')

    // La edición no guarda borrador: el enlace se abre en otra pestaña.
    expect(photoGroup()).toHaveAccessibleDescription(
      `${PLANT_EDIT_TEXT.pendingPhotoNotice} Más en Privacidad (se abre en otra pestaña).`,
    )
    const link = within(photoGroup()).getByRole('link', {
      name: 'Privacidad (se abre en otra pestaña)',
    })
    expect(link).toHaveAttribute('href', PATHS.privacy)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    await expectNoAxeViolations()
  })

  it('una planta por validar sin foto recomienda añadirla, con el aviso', async () => {
    await renderEdit([pending()])
    expect(
      screen.getByRole('group', { name: 'Foto' }),
    ).toHaveAccessibleDescription(
      `${PLANT_EDIT_TEXT.pendingPhotoHint} Más en Privacidad (se abre en otra pestaña).`,
    )
    await expectNoAxeViolations()
  })

  it('elegir otra especie actualiza solos el género y el tipo, y avisa del duplicado sin contarse', async () => {
    const otherVeitchiana = plant({
      id: '7a2b3c4d-0000-4000-8000-000000000009',
      displayName: SPECIES.veitchiana.scientific_name,
      species: {
        id: SPECIES.veitchiana.id,
        scientificName: SPECIES.veitchiana.scientific_name,
        type: 'species',
        status: 'validated',
      },
      genus: GENERA.masdevallia,
    })
    const { user } = await renderEdit([pending(), otherVeitchiana])
    // Por validar: no hay aviso de duplicado ni de desenlace.
    expect(screen.queryByText(/^Ya tienes/)).toBeNull()

    await user.clear(nameInput())
    await user.type(nameInput(), 'masde')
    await user.click(
      await screen.findByRole('option', { name: /^Masdevallia veitchiana/ }),
    )
    const genus = screen.getByRole('button', { name: 'Masdevallia' })
    expect(genus).toHaveAttribute('aria-pressed', 'true')
    expect(genus).toHaveAttribute('aria-disabled', 'true')
    expect(
      within(typeGroup()).getByRole('button', { name: 'Especie' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/^Ya tienes/)).toHaveTextContent(
      'Ya tienes 1 ejemplar de Masdevallia veitchiana. Puedes guardarla igualmente.',
    )

    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe(`/coleccion/${PENDING_ID}`))
    expect(supabase.patches()).toEqual([
      {
        entered_name: 'Masdevallia veitchiana',
        species_id: SPECIES.veitchiana.id,
        genus_id: GENERA.masdevallia.id,
        type: 'species',
      },
    ])
    expect(datum(DETAIL_TEXT.validation)).toHaveTextContent('Validada')
    expect(datum(DETAIL_TEXT.genus)).toHaveTextContent('Masdevallia')
  })

  it('sin cambiar de especie no avisa de duplicado aunque haya otras iguales', async () => {
    const twin = amabilis({ id: '7a2b3c4d-0000-4000-8000-00000000000a' })
    await renderEdit([amabilis(), twin], [`/coleccion/${AMABILIS_ID}/editar`])
    expect(screen.queryByText(/^Ya tienes/)).toBeNull()
  })

  it('reemplazar la foto sube la nueva, apunta la planta y borra la anterior', async () => {
    const { user, container } = await renderEdit([amabilis()])
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('Sin campo de archivo.')
    await user.upload(
      input,
      new File([new Uint8Array(10)], 'IMG_0002.jpg', { type: 'image/jpeg' }),
    )
    await screen.findByRole('img', { name: 'Vista previa de la foto elegida' })

    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe(`/coleccion/${AMABILIS_ID}`))

    const uploads = supabase.uploads()
    expect(uploads).toHaveLength(2)
    for (const path of uploads) {
      expect(path.startsWith(`${USER}/${AMABILIS_ID}/`)).toBe(true)
    }
    // Una sola escritura: las rutas nuevas (los datos no cambiaron).
    expect(supabase.patches()).toEqual([
      {
        photo_path: expect.stringMatching(/photo-.+\.webp$/) as unknown,
        thumbnail_path: expect.stringMatching(/thumb-.+\.webp$/) as unknown,
      },
    ])
    // Sin huérfanos: la foto y la miniatura anteriores se borran.
    expect(supabase.removed().sort()).toEqual([
      `${USER}/${AMABILIS_ID}/photo-v1.webp`,
      `${USER}/${AMABILIS_ID}/thumb-v1.webp`,
    ])
    expect(supabase.rows.get(AMABILIS_ID)?.photo_path).toBe(
      uploads.find((path) => path.includes('/photo-')),
    )
    expect(await screen.findByText(DETAIL_TEXT.saved)).toBeInTheDocument()
  })

  it('quitar la foto deja la planta sin foto y borra los archivos', async () => {
    const { user } = await renderEdit([amabilis()])
    await screen.findByRole('img', {
      name: PLANT_EDIT_NOTICE_TEXT.storedPhotoAlt,
    })
    await user.click(screen.getByRole('button', { name: 'Quitar foto' }))
    // Sin foto, "en floración" desaparece y se desmarca.
    expect(
      screen.queryByRole('button', { name: PLANT_FORM_TEXT.photoInBloom }),
    ).toBeNull()

    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe(`/coleccion/${AMABILIS_ID}`))
    expect(supabase.patches()).toEqual([
      { photo_in_bloom: false },
      { photo_path: null, thumbnail_path: null },
    ])
    expect(supabase.removed().sort()).toEqual([
      `${USER}/${AMABILIS_ID}/photo-v1.webp`,
      `${USER}/${AMABILIS_ID}/thumb-v1.webp`,
    ])
    expect(screen.getByRole('img', { name: DETAIL_TEXT.noPhoto })).toBeVisible()
  })

  it('si falla el guardado lo dice según el motivo, conserva lo escrito y permite reintentar', async () => {
    const { user } = await renderEdit([amabilis()])
    supabase.patchResponder = () => json({ message: 'Internal error' }, 500)

    await user.clear(nicknameInput())
    await user.type(nicknameInput(), 'La reina')
    await user.click(submitButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(PLANT_UPDATE_ERROR_TEXT.failed)
    expect(location()).toBe(`/coleccion/${AMABILIS_ID}/editar`)
    expect(nicknameInput()).toHaveValue('La reina')
    await expectNoAxeViolations()

    supabase.patchResponder = null
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(location()).toBe(`/coleccion/${AMABILIS_ID}`))
    expect(datum(DETAIL_TEXT.nickname)).toHaveTextContent('La reina')
  })

  it('si la planta ya no existe al guardar, lo dice', async () => {
    const { user } = await renderEdit([amabilis()])
    supabase.rows.clear()
    await user.type(nicknameInput(), ' 2')
    await user.click(submitButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      PLANT_UPDATE_ERROR_TEXT['not-found'],
    )
  })

  it('sin conexión, el formulario se desactiva con el motivo', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    // Sin conexión el detalle no ofrece editar: se abre la dirección.
    await renderEdit([amabilis()], [`/coleccion/${AMABILIS_ID}/editar`])
    expect(screen.getByText(PLANT_EDIT_TEXT.offline)).toBeInTheDocument()
    expect(nameInput()).toBeDisabled()
    expect(submitButton()).toHaveAttribute('aria-disabled', 'true')
    expect(submitButton()).toHaveAccessibleDescription(PLANT_EDIT_TEXT.offline)
  })

  it('cancelar sin cambios vuelve al detalle; con cambios, pregunta antes', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user } = await renderEdit([amabilis()])

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(confirm).not.toHaveBeenCalled()
    expect(location()).toBe(`/coleccion/${AMABILIS_ID}`)

    await user.click(screen.getByRole('link', { name: DETAIL_TEXT.edit }))
    await screen.findByRole('button', { name: 'Phalaenopsis' })
    await user.type(nicknameInput(), ' 2')
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(confirm).toHaveBeenCalledWith(PLANT_EDIT_TEXT.confirmDiscard)
    expect(location()).toBe(`/coleccion/${AMABILIS_ID}/editar`)
    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(location()).toBe(`/coleccion/${AMABILIS_ID}`)
    expect(supabase.patches()).toEqual([])
  })

  it('al abrir la dirección directamente, guardar lleva al detalle', async () => {
    const { user } = await renderEdit(
      [pending()],
      [`/coleccion/${PENDING_ID}/editar`],
    )
    // Sin nada dentro, "Más detalles" empieza cerrada.
    await user.click(screen.getByRole('button', { name: 'Más detalles' }))
    await user.type(nicknameInput(), 'Naranjita')
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe(`/coleccion/${PENDING_ID}`))
    expect(datum(DETAIL_TEXT.nickname)).toHaveTextContent('Naranjita')
  })

  it('una planta inexistente o de otra cuenta se ve como "no encontrada"', async () => {
    supabase = fakeSupabase([])
    vi.stubGlobal('fetch', supabase.fetch)
    await renderPlantRoutes({
      entries: ['/coleccion/00000000-0000-4000-8000-0000000000ff/editar'],
      plants: [amabilis()],
      extraRoutes: <Route path={PATHS.editPlant} element={<EditPlantPage />} />,
    })
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: DETAIL_TEXT.notFoundTitle,
      }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('form')).toBeNull()
  })

  it('se completa con el teclado', async () => {
    const { user } = await renderEdit([amabilis()])
    nameInput().focus()
    for (let i = 0; i < 40 && document.activeElement !== nicknameInput(); i++) {
      await user.tab()
    }
    expect(nicknameInput()).toHaveFocus()
    await user.keyboard('{Control>}a{/Control}La de la sala')
    for (let i = 0; i < 40 && document.activeElement !== submitButton(); i++) {
      await user.tab()
    }
    expect(submitButton()).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(location()).toBe(`/coleccion/${AMABILIS_ID}`))
    expect(supabase.patches()).toEqual([{ nickname: 'La de la sala' }])
  })
})

// Para que act() espere las promesas pendientes al final de cada prueba.
afterEach(async () => {
  await act(async () => {
    await Promise.resolve()
  })
})
