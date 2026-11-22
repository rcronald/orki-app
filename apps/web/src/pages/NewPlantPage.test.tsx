import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { CollectionProvider } from '../collection/CollectionProvider.tsx'
import type {
  CollectionPlant,
  CollectionPlantRow,
} from '../collection/model.ts'
import { initSupabase, setSessionTokenSource } from '../lib/supabase.ts'
import { localDateString } from '../lib/localDate.ts'
import { PhotoProcessingError } from '../photos/errors.ts'
import type { ProcessedPhoto } from '../photos/process.ts'
import {
  PLANT_DRAFT_MAX_AGE_MS,
  PLANT_DRAFT_VERSION,
  plantDraftKey,
} from '../registration/draft.ts'
import {
  appDraftPhotoBackend,
  createMemoryDraftPhotoBackend,
} from '../registration/draft-photo.ts'
import { initialPlantFormValues } from '../registration/form-state.ts'
import { genusBackgroundUrl } from '../registration/genus-backgrounds.ts'
import { clearQuickAccessGeneraCache } from '../registration/quick-genera.ts'
import {
  PLANT_INVALID_TEXT,
  PLANT_SAVE_ERROR_TEXT,
} from '../registration/save-plant.ts'
import {
  PLANT_FORM_ERROR_TEXT,
  PLANT_FORM_TEXT,
} from '../registration/texts.ts'
import { NavigationFocusProvider } from '../routes/NavigationFocusProvider.tsx'
import type { ProductEvent } from '../telemetry/events.ts'
import {
  setProductEventsRuntimeLoader,
  setProductEventsSession,
} from '../telemetry/product-events.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import { resetFakeClerk, setFakeClerk } from '../test/clerk-mock.tsx'
import { plant } from '../test/collection.ts'
import { processedPhoto } from '../test/photos.ts'
import {
  fakeCollectionSource,
  type FakeCollectionSource,
} from '../test/collection-source.ts'
import { CollectionPage } from './CollectionPage.tsx'
import NewPlantPage from './NewPlantPage.tsx'

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

// jsdom no tiene canvas: la preparación de la foto es un doble (#87).
const processPhoto = vi.hoisted(() =>
  vi.fn<
    (file: Blob, options: { signal?: AbortSignal }) => Promise<ProcessedPhoto>
  >(),
)
vi.mock('../photos/load.ts', () => ({
  loadPhotoProcessing: () =>
    Promise.resolve({ processPhoto, PhotoProcessingError }),
}))

// jsdom no tiene IndexedDB: la foto pendiente del borrador va en memoria, la
// misma en todo el archivo, así sobrevive a la "recarga" (volver a montar).
vi.mock('../registration/draft-photo.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../registration/draft-photo.ts')>()
  const backend = actual.createMemoryDraftPhotoBackend()
  return { ...actual, appDraftPhotoBackend: () => backend }
})
const draftPhotos = appDraftPhotoBackend() as ReturnType<
  typeof createMemoryDraftPhotoBackend
>

// Pantalla de registro con la app real hasta supabase-js; solo fetch está
// simulado (PostgREST en memoria): géneros de acceso rápido, las dos
// búsquedas y la inserción en plants. La colección usa una fuente controlada.

const CONFIG = {
  supabaseUrl: 'https://ejemplo.supabase.co',
  supabasePublishableKey: 'sb_publishable_clave_de_prueba',
  appEnv: 'dev',
  clerkPublishableKey: 'pk_test_clave_de_prueba',
} as const
const TOKEN = 'token_de_sesion_de_prueba'

const GENERA = {
  cattleya: { id: '20000000-0000-4000-8000-000000000001', name: 'Cattleya' },
  dendrobium: {
    id: '20000000-0000-4000-8000-000000000002',
    name: 'Dendrobium',
  },
  phalaenopsis: {
    id: '20000000-0000-4000-8000-000000000003',
    name: 'Phalaenopsis',
  },
  masdevallia: {
    id: '20000000-0000-4000-8000-000000000004',
    name: 'Masdevallia',
  },
  miltoniopsis: {
    id: '20000000-0000-4000-8000-000000000005',
    name: 'Miltoniopsis',
  },
}
const QUICK_GENERA = [GENERA.cattleya, GENERA.dendrobium, GENERA.phalaenopsis]
const ALL_GENERA = Object.values(GENERA)

const AMABILIS = {
  id: '10000000-0000-4000-8000-000000000001',
  scientific_name: 'Phalaenopsis amabilis',
  genus_id: GENERA.phalaenopsis.id,
  genus_name: 'Phalaenopsis',
  type: 'species',
  status: 'validated',
  matched_name: 'Phalaenopsis amabilis',
  matched_name_type: 'scientific',
}
const WAKANKI = {
  id: '10000000-0000-4000-8000-000000000002',
  scientific_name: 'Masdevallia veitchiana',
  genus_id: GENERA.masdevallia.id,
  genus_name: 'Masdevallia',
  type: 'species',
  status: 'validated',
  matched_name: 'Wakanki',
  matched_name_type: 'common',
}
const SPECIES = [AMABILIS, WAKANKI]

type FetchArgs = Parameters<typeof fetch>
interface SentRequest {
  url: URL
  method: string
  body: unknown
}

const fetchMock = vi.fn<typeof fetch>()
/** Respuesta de la inserción; por defecto, la fila creada. */
let insertResponder: (body: Record<string, unknown>) => Promise<Response>
/** Respuesta de cada subida a Storage (#87); por defecto, subida. */
let storageUploadResponder: (path: string) => Promise<Response>
let source: FakeCollectionSource

function json(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

function readRequest([input, init]: FetchArgs): SentRequest {
  const url = new URL(input instanceof Request ? input.url : String(input))
  const method = (
    init?.method ?? (input instanceof Request ? input.method : 'GET')
  ).toUpperCase()
  const raw = init?.body
  return {
    url,
    method,
    body: typeof raw === 'string' ? (JSON.parse(raw) as unknown) : undefined,
  }
}

function requests(): SentRequest[] {
  return fetchMock.mock.calls.map(readRequest)
}

function plantInserts(): Record<string, unknown>[] {
  return requests()
    .filter((r) => r.method === 'POST' && r.url.pathname === '/rest/v1/plants')
    .map((r) => r.body as Record<string, unknown>)
}

/** La fila que devolvería PostgREST, con lo que pone el disparador. */
function createdRow(body: Record<string, unknown>): CollectionPlantRow {
  const species = SPECIES.find((s) => s.id === body.species_id) ?? null
  const genusId = species ? species.genus_id : (body.genus_id as string)
  const genus = ALL_GENERA.find((g) => g.id === genusId) ?? GENERA.cattleya
  return {
    id: body.id as string,
    entered_name: body.entered_name as string,
    type: species
      ? (species.type as 'species')
      : (body.type as CollectionPlantRow['type']),
    validation: species ? 'validated' : 'pending',
    status: 'active',
    acquired_on: body.acquired_on as string,
    origin: null,
    location: null,
    nickname: null,
    flower_color: null,
    photo_in_bloom: false,
    photo_path: null,
    thumbnail_path: null,
    created_at: '2026-11-21T15:00:00+00:00',
    updated_at: '2026-11-21T15:00:00+00:00',
    species: species
      ? {
          id: species.id,
          scientific_name: species.scientific_name,
          type: 'species',
          status: 'validated',
        }
      : null,
    genus,
  }
}

function respond(...args: FetchArgs): Promise<Response> {
  const request = readRequest(args)
  const { pathname } = request.url
  if (pathname === '/rest/v1/genera') return json(QUICK_GENERA)
  if (pathname === '/rest/v1/rpc/search_species') return json(SPECIES)
  if (pathname === '/rest/v1/rpc/search_genera') {
    return json([
      {
        id: GENERA.miltoniopsis.id,
        name: 'Miltoniopsis',
        is_quick_access: false,
        matched_abbreviation: 'Mps.',
      },
    ])
  }
  if (pathname === '/rest/v1/plants' && request.method === 'POST') {
    return insertResponder(request.body as Record<string, unknown>)
  }
  if (pathname === '/rest/v1/plants' && request.method === 'GET') {
    const id = request.url.searchParams.get('id')?.replace(/^eq\./, '')
    return json(createdRow({ ...lastInsert(), id }))
  }
  // Apuntar la planta a su foto (replacePlantPhoto).
  if (pathname === '/rest/v1/plants' && request.method === 'PATCH') {
    const body = request.body as Record<string, string | null>
    return json({
      ...createdRow(lastInsert()),
      photo_path: body.photo_path,
      thumbnail_path: body.thumbnail_path,
    })
  }
  const storagePath = pathname.match(
    /^\/storage\/v1\/object\/plant-photos\/(.+)$/,
  )?.[1]
  if (storagePath && request.method === 'POST') {
    return storageUploadResponder(decodeURIComponent(storagePath))
  }
  // Descarga de la miniatura en el inventario.
  if (storagePath && request.method === 'GET') {
    return Promise.resolve(
      new Response(new Uint8Array(8), {
        status: 200,
        headers: { 'Content-Type': 'image/webp' },
      }),
    )
  }
  if (
    pathname === '/storage/v1/object/plant-photos' &&
    request.method === 'DELETE'
  ) {
    return json([])
  }
  return json({ message: `Ruta inesperada ${pathname}` }, 404)
}

function lastInsert(): Record<string, unknown> {
  const insert = plantInserts().at(-1)
  if (!insert) throw new Error('No hubo inserción.')
  return insert
}

const previousTz = process.env.TZ

beforeAll(() => {
  // Huso con desfase respecto a UTC para la fecha por defecto.
  process.env.TZ = 'America/Lima'
})

afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ
  else process.env.TZ = previousTz
})

beforeEach(() => {
  document.documentElement.lang = 'es'
  resetFakeClerk()
  setFakeClerk({ signedIn: true, userId: 'user_prueba' })
  clearQuickAccessGeneraCache()
  fetchMock.mockReset()
  fetchMock.mockImplementation(respond)
  insertResponder = (body) => json(createdRow(body), 201)
  storageUploadResponder = (path) =>
    json({ Id: `id-${path}`, Key: `plant-photos/${path}` })
  processPhoto.mockReset()
  processPhoto.mockImplementation(() => Promise.resolve(processedPhoto()))
  draftPhotos.entries.clear()
  URL.createObjectURL = vi.fn((blob: Blob) => `blob:prueba-${blob.size}`)
  URL.revokeObjectURL = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  initSupabase(CONFIG)
  setSessionTokenSource(() => Promise.resolve(TOKEN))
  source = fakeCollectionSource()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setSessionTokenSource(null)
})

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

/**
 * Pinta la pantalla de registro. Con `plants` (por defecto, vacía), la
 * colección llega enseguida; con null, la lectura queda pendiente.
 */
async function renderPage(
  plants: readonly CollectionPlant[] | null = [],
  entry = '/coleccion/nueva',
) {
  const view = render(
    <MemoryRouter initialEntries={['/coleccion', entry]}>
      <NavigationFocusProvider>
        <CollectionProvider source={source}>
          <main>
            <Routes>
              <Route path="/coleccion" element={<CollectionPage />} />
              <Route path="/coleccion/nueva" element={<NewPlantPage />} />
            </Routes>
          </main>
          <LocationProbe />
        </CollectionProvider>
      </NavigationFocusProvider>
    </MemoryRouter>,
  )
  // La colección del usuario (vacía si no se indica) y los géneros de acceso
  // rápido.
  await act(async () => {
    if (plants !== null) source.last().resolve(plants)
    await Promise.resolve()
  })
  await screen.findByRole('button', { name: 'Phalaenopsis' })
  return view
}

const nameInput = () => screen.getByRole('combobox', { name: 'Nombre' })
const dateInput = () => screen.getByLabelText('Fecha de adquisición')
const chip = (name: string) => screen.getByRole('button', { name })
const genusGroup = () => screen.getByRole('group', { name: 'Género' })
const typeGroup = () => screen.getByRole('group', { name: 'Tipo' })
const submitButton = () =>
  screen.getByRole('button', { name: /^(Registrar orquídea|Registrando…)$/ })
const location = () => screen.getByTestId('location').textContent

async function chooseAmabilis(user: ReturnType<typeof userEvent.setup>) {
  await user.type(nameInput(), 'phal amab')
  await user.click(
    await screen.findByRole('option', { name: 'Phalaenopsis amabilis' }),
  )
}

/** Rellena un nombre libre con género y tipo. */
async function fillFreeName(user: ReturnType<typeof userEvent.setup>) {
  await user.type(nameInput(), 'La naranja del mercado')
  await user.click(
    within(genusGroup()).getByRole('button', { name: 'Cattleya' }),
  )
  await user.click(within(typeGroup()).getByRole('button', { name: 'No sé' }))
}

describe('NewPlantPage', () => {
  it('pinta los cuatro campos obligatorios y pasa la revisión de accesibilidad', async () => {
    await renderPage()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Registrar una orquídea' }),
    ).toBeInTheDocument()
    expect(nameInput()).toBeInTheDocument()
    // Los chips de género salen del catálogo, más "Otro".
    expect(
      within(genusGroup())
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Cattleya', 'Dendrobium', 'Phalaenopsis', 'Otro'])
    expect(
      within(typeGroup())
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Especie', 'Híbrido', 'No sé'])
    expect(dateInput()).toHaveAttribute('type', 'date')
    // Los géneros de acceso rápido, con una sola consulta filtrada.
    const genera = requests().filter(
      (r) => r.url.pathname === '/rest/v1/genera',
    )
    expect(genera).toHaveLength(1)
    expect(genera[0]?.url.searchParams.get('is_quick_access')).toBe('eq.true')
    await expectNoAxeViolations()
  })

  it('precarga la fecha local de hoy, no la de UTC, y no admite fechas futuras', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // 20:00 del 21 en Lima: en UTC ya es el 22.
    vi.setSystemTime(new Date('2026-11-22T01:00:00Z'))
    const user = userEvent.setup()
    await renderPage()

    expect(dateInput()).toHaveValue('2026-11-21')
    expect(dateInput()).toHaveAttribute('max', '2026-11-21')

    await fillFreeName(user)
    await user.clear(dateInput())
    await user.type(dateInput(), '2026-11-22')
    await user.click(submitButton())

    expect(dateInput()).toHaveFocus()
    expect(dateInput()).toHaveAccessibleDescription(
      PLANT_FORM_ERROR_TEXT.dateFuture,
    )
    expect(plantInserts()).toHaveLength(0)

    // Corregida, el error desaparece sin volver a enviar.
    await user.clear(dateInput())
    await user.type(dateInput(), '2026-11-20')
    expect(dateInput()).not.toHaveAccessibleDescription(
      PLANT_FORM_ERROR_TEXT.dateFuture,
    )
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(lastInsert().acquired_on).toBe('2026-11-20')
  })

  it('elegir una especie marca y bloquea el género y el tipo; cambiar el nombre los libera', async () => {
    const user = userEvent.setup()
    await renderPage()

    await user.type(nameInput(), 'wakanki')
    const option = await screen.findByRole('option', {
      name: /^Masdevallia veitchiana,\s*Nombre común: Wakanki$/,
    })
    // Muestra el nombre científico y, debajo, por qué coincidió.
    expect(
      within(option).getByText('Nombre común: Wakanki'),
    ).toBeInTheDocument()
    await user.click(option)

    expect(nameInput()).toHaveValue('Masdevallia veitchiana')
    // El género de la especie no es de acceso rápido: aparece como chip.
    const genus = chip('Masdevallia')
    expect(genus).toHaveAttribute('aria-pressed', 'true')
    expect(genus).toHaveAttribute('aria-disabled', 'true')
    expect(genus).toHaveAccessibleDescription(PLANT_FORM_TEXT.lockedHint)
    const species = within(typeGroup()).getByRole('button', { name: 'Especie' })
    expect(species).toHaveAttribute('aria-pressed', 'true')
    expect(species).toHaveAttribute('aria-disabled', 'true')

    // Bloqueados: tocar otro chip no cambia nada.
    await user.click(chip('Cattleya'))
    await user.click(
      within(typeGroup()).getByRole('button', { name: 'Híbrido' }),
    )
    expect(chip('Masdevallia')).toHaveAttribute('aria-pressed', 'true')
    expect(species).toHaveAttribute('aria-pressed', 'true')
    await expectNoAxeViolations()

    // Cambiar el texto desenlaza: siguen marcados y vuelven a ser editables.
    await user.type(nameInput(), ' x')
    expect(chip('Masdevallia')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('Masdevallia')).not.toHaveAttribute('aria-disabled')
    expect(species).not.toHaveAttribute('aria-disabled')
    expect(screen.queryByText(PLANT_FORM_TEXT.lockedHint)).toBeNull()
    await user.click(chip('Cattleya'))
    expect(chip('Cattleya')).toHaveAttribute('aria-pressed', 'true')
  })

  it('guardar con especie envía species_id, sin validation ni user_id, y vuelve al inventario con la planta', async () => {
    const user = userEvent.setup()
    await renderPage()

    await chooseAmabilis(user)
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))

    const insert = lastInsert()
    expect(insert).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      entered_name: 'Phalaenopsis amabilis',
      species_id: AMABILIS.id,
      genus_id: GENERA.phalaenopsis.id,
      type: 'species',
      acquired_on: localDateString(),
    })
    expect(insert).not.toHaveProperty('validation')
    expect(insert).not.toHaveProperty('user_id')
    const post = requests().find(
      (r) => r.method === 'POST' && r.url.pathname === '/rest/v1/plants',
    )
    expect(post?.url.searchParams.get('select')).toContain('species:species_id')

    // La planta está en la colección sin volver a leerla, con el aviso.
    expect(source.loads).toHaveLength(1)
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(
      screen.getByRole('heading', { level: 2, name: 'Phalaenopsis amabilis' }),
    ).toBeInTheDocument()
    const notice = await screen.findByText(/Registraste/)
    expect(notice).toHaveTextContent(
      'Registraste Phalaenopsis amabilis en tu colección.',
    )
    expect(
      screen.getByRole('link', { name: 'Registrar otra' }),
    ).toHaveAttribute('href', '/coleccion/nueva')
    expect(
      screen.getByRole('heading', { level: 1, name: 'Mi colección' }),
    ).toHaveFocus()
    await expectNoAxeViolations()

    await user.click(screen.getByRole('button', { name: 'Cerrar el aviso' }))
    expect(screen.queryByText(/Registraste/)).toBeNull()
  })

  it('dos registros de la misma especie crean dos ejemplares', async () => {
    const user = userEvent.setup()
    await renderPage()

    await chooseAmabilis(user)
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))

    await user.click(
      await screen.findByRole('link', { name: 'Registrar otra' }),
    )
    await screen.findByRole('button', { name: 'Phalaenopsis' })
    await chooseAmabilis(user)
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))

    const [first, second] = plantInserts()
    expect(first?.species_id).toBe(AMABILIS.id)
    expect(second?.species_id).toBe(AMABILIS.id)
    expect(first?.id).not.toBe(second?.id)
    expect(screen.getAllByRole('article')).toHaveLength(2)
  })

  it('un nombre que no está en el catálogo se guarda tal cual, por validar', async () => {
    const user = userEvent.setup()
    await renderPage()

    await user.type(nameInput(), '  La   naranja del mercado')
    const action = await screen.findByRole('option', {
      name: 'No la encuentro: guardarla como «La naranja del mercado»',
    })
    await user.click(action)
    expect(nameInput()).toHaveAccessibleDescription(
      PLANT_FORM_TEXT.namePendingHint,
    )
    await user.click(chip('Cattleya'))
    await user.click(
      within(typeGroup()).getByRole('button', { name: 'Híbrido' }),
    )
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))

    expect(lastInsert()).toEqual({
      id: expect.any(String) as unknown,
      entered_name: 'La naranja del mercado',
      genus_id: GENERA.cattleya.id,
      type: 'hybrid',
      acquired_on: localDateString(),
    })
    // El aviso y la tarjeta lo muestran con la etiqueta (#12).
    const notice = await screen.findByText(/Registraste/)
    expect(notice).toHaveTextContent(
      'Registraste La naranja del mercado en tu colección. Nombre por validar',
    )
    const card = screen.getByRole('article', { name: 'La naranja del mercado' })
    expect(within(card).getByText('Nombre por validar')).toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('un nombre por validar no añade pasos y explica qué pasará (#12)', async () => {
    const user = userEvent.setup()
    await renderPage()

    // Los mismos pasos que con una especie: escribir, género, tipo y guardar,
    // sin elegir la acción de la lista ni confirmar nada más.
    await fillFreeName(user)
    await waitFor(() =>
      expect(nameInput()).toHaveAccessibleDescription(
        'No está en el catálogo: quedará en tu inventario como «Nombre por validar» y un administrador confirmará el nombre.',
      ),
    )
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(plantInserts()).toHaveLength(1)
    expect(lastInsert()).not.toHaveProperty('species_id')

    // Con especie, el aviso lleva "Validada".
    await user.click(
      await screen.findByRole('link', { name: 'Registrar otra' }),
    )
    await screen.findByRole('button', { name: 'Phalaenopsis' })
    await chooseAmabilis(user)
    expect(nameInput()).toHaveAccessibleDescription(
      PLANT_FORM_TEXT.nameLinkedHint,
    )
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(await screen.findByText(/Registraste/)).toHaveTextContent(
      'Registraste Phalaenopsis amabilis en tu colección. Validada',
    )
  })

  it('"Otro" abre el buscador de géneros y guarda un género real del catálogo', async () => {
    const user = userEvent.setup()
    await renderPage()

    await user.type(nameInput(), 'Miltoniopsis Herr Alexandre')
    await user.click(chip('Otro'))
    expect(chip('Otro')).toHaveAttribute('aria-pressed', 'true')
    await user.click(
      within(typeGroup()).getByRole('button', { name: 'Híbrido' }),
    )

    // Con "Otro" y sin elegir género, no se guarda.
    await user.click(submitButton())
    const search = screen.getByRole('combobox', { name: 'Buscar otro género' })
    expect(search).toHaveFocus()
    expect(
      screen.getByText(PLANT_FORM_ERROR_TEXT.genusNotFound),
    ).toBeInTheDocument()
    expect(plantInserts()).toHaveLength(0)

    await user.type(search, 'mps')
    await user.click(
      await screen.findByRole('option', {
        name: /^Miltoniopsis,\s*Abreviatura: Mps\.$/,
      }),
    )
    expect(
      screen.queryByRole('combobox', { name: 'Buscar otro género' }),
    ).toBeNull()
    expect(chip('Miltoniopsis')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('Miltoniopsis')).toHaveFocus()
    expect(screen.queryByText(PLANT_FORM_ERROR_TEXT.genusNotFound)).toBeNull()

    const searchCall = requests().find(
      (r) => r.url.pathname === '/rest/v1/rpc/search_genera',
    )
    expect(searchCall?.body).toMatchObject({ query: 'mps' })

    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(lastInsert().genus_id).toBe(GENERA.miltoniopsis.id)
  })

  it('al guardar vacío marca cada campo, asocia los errores y lleva el foco al primero', async () => {
    const user = userEvent.setup()
    await renderPage()

    // Sin validar mientras se escribe.
    await user.type(nameInput(), 'a')
    await user.clear(nameInput())
    expect(screen.queryByText(PLANT_FORM_ERROR_TEXT.nameMissing)).toBeNull()

    await user.clear(dateInput())
    await user.click(submitButton())

    expect(nameInput()).toHaveFocus()
    expect(nameInput()).toHaveAttribute('aria-invalid', 'true')
    expect(nameInput()).toHaveAccessibleDescription(
      new RegExp(`^${PLANT_FORM_ERROR_TEXT.nameMissing}`),
    )
    expect(chip('Cattleya')).toHaveAccessibleDescription(
      PLANT_FORM_ERROR_TEXT.genusMissing,
    )
    expect(
      within(typeGroup()).getByRole('button', { name: 'Especie' }),
    ).toHaveAccessibleDescription(PLANT_FORM_ERROR_TEXT.typeMissing)
    expect(dateInput()).toHaveAccessibleDescription(
      PLANT_FORM_ERROR_TEXT.dateMissing,
    )
    expect(plantInserts()).toHaveLength(0)
    await expectNoAxeViolations()

    // Solo espacios tampoco vale; con el nombre, el foco va al siguiente.
    await user.type(nameInput(), '   ')
    await user.click(submitButton())
    expect(nameInput()).toHaveFocus()
    await user.type(nameInput(), 'Stanhopea')
    await user.click(submitButton())
    expect(chip('Cattleya')).toHaveFocus()
    expect(nameInput()).not.toHaveAttribute('aria-invalid')
  })

  it('el nombre tiene un tope de 200 caracteres', async () => {
    await renderPage()
    expect(nameInput()).toHaveAttribute('maxlength', '200')
  })

  it('desde "Aún no la tienes" (?nombre=) empieza con el nombre escrito', async () => {
    const user = userEvent.setup()
    await renderPage([], '/coleccion/nueva?nombre=La%20naranja%20del%20mercado')
    expect(nameInput()).toHaveValue('La naranja del mercado')

    await user.click(
      within(genusGroup()).getByRole('button', { name: 'Cattleya' }),
    )
    await user.click(within(typeGroup()).getByRole('button', { name: 'No sé' }))
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(lastInsert()).toMatchObject({
      entered_name: 'La naranja del mercado',
    })
  })

  it('con un borrador guardado, gana el borrador; al descartarlo, el nombre de ?nombre=', async () => {
    const user = userEvent.setup()
    const view = await renderPage()
    await fillFreeName(user)
    view.unmount()
    await renderPage([], '/coleccion/nueva?nombre=Cattleya%20maxima')

    expect(nameInput()).toHaveValue('La naranja del mercado')
    await user.click(
      await screen.findByRole('button', { name: PLANT_FORM_TEXT.draftDiscard }),
    )
    expect(nameInput()).toHaveValue('Cattleya maxima')
  })

  it('no envía dos veces: el botón queda en "Registrando…" mientras guarda', async () => {
    const user = userEvent.setup()
    let finish: (response: Response) => void = () => {}
    insertResponder = () =>
      new Promise((resolve) => {
        finish = resolve
      })
    await renderPage()

    await fillFreeName(user)
    await user.click(submitButton())
    expect(submitButton()).toHaveTextContent('Registrando…')
    expect(submitButton()).toHaveAttribute('aria-disabled', 'true')
    await user.click(submitButton())
    await user.type(dateInput(), '{Enter}')
    expect(plantInserts()).toHaveLength(1)

    await act(async () => {
      finish(
        new Response(JSON.stringify(createdRow(lastInsert())), { status: 201 }),
      )
      await Promise.resolve()
    })
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(plantInserts()).toHaveLength(1)
  })

  describe('si falla el guardado, lo dice, conserva lo escrito y permite reintentar', () => {
    const cases: {
      title: string
      arrange: () => void
      message: string
    }[] = [
      {
        title: 'sin conexión',
        arrange: () => {
          insertResponder = () =>
            Promise.reject(new TypeError('Failed to fetch'))
        },
        message: PLANT_SAVE_ERROR_TEXT.offline,
      },
      {
        title: 'sesión terminada',
        arrange: () => {
          insertResponder = () =>
            json({ code: 'PGRST303', message: 'JWT expired' }, 401)
        },
        message: PLANT_SAVE_ERROR_TEXT['session-ended'],
      },
      {
        title: 'error del servidor',
        arrange: () => {
          insertResponder = () => json({ message: 'Internal error' }, 500)
        },
        message: PLANT_SAVE_ERROR_TEXT.failed,
      },
      {
        title: 'rechazo de la base, traducido',
        arrange: () => {
          insertResponder = () =>
            json(
              {
                code: '23514',
                message:
                  'new row for relation "plants" violates check constraint "plants_acquired_on_not_future"',
                details: null,
                hint: null,
              },
              400,
            )
        },
        message: PLANT_INVALID_TEXT.futureDate,
      },
    ]

    it.each(cases)('$title', async ({ arrange, message }) => {
      const user = userEvent.setup()
      await renderPage()
      await fillFreeName(user)
      arrange()

      await user.click(submitButton())
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(message)
      expect(location()).toBe('/coleccion/nueva')
      expect(nameInput()).toHaveValue('La naranja del mercado')
      expect(chip('Cattleya')).toHaveAttribute('aria-pressed', 'true')
      expect(submitButton()).toHaveTextContent('Registrar orquídea')
      await expectNoAxeViolations()

      // Reintentar con el mismo id: no crea dos plantas.
      insertResponder = (body) => json(createdRow(body), 201)
      storageUploadResponder = (path) =>
        json({ Id: `id-${path}`, Key: `plant-photos/${path}` })
      processPhoto.mockReset()
      processPhoto.mockImplementation(() => Promise.resolve(processedPhoto()))
      draftPhotos.entries.clear()
      URL.createObjectURL = vi.fn((blob: Blob) => `blob:prueba-${blob.size}`)
      URL.revokeObjectURL = vi.fn()
      await user.click(
        within(alert).getByRole('button', { name: 'Reintentar' }),
      )
      await waitFor(() => expect(location()).toBe('/coleccion'))
      const [first, second] = plantInserts()
      expect(second?.id).toBe(first?.id)
    })

    it('sesión terminada sin token: ofrece iniciar sesión y no envía nada', async () => {
      const user = userEvent.setup()
      await renderPage()
      await fillFreeName(user)
      setSessionTokenSource(() => Promise.resolve(null))

      await user.click(submitButton())
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(PLANT_SAVE_ERROR_TEXT['session-ended'])
      expect(
        within(alert).getByRole('link', { name: 'Iniciar sesión' }),
      ).toHaveAttribute(
        'href',
        '/iniciar-sesion?redirect_url=%2Fcoleccion%2Fnueva',
      )
      expect(plantInserts()).toHaveLength(0)
    })
  })

  it('si el primer intento llegó a la base y se perdió la respuesta, el reintento no duplica', async () => {
    const user = userEvent.setup()
    await renderPage()
    await fillFreeName(user)
    insertResponder = () =>
      json(
        {
          code: '23505',
          message:
            'duplicate key value violates unique constraint "plants_pkey"',
        },
        409,
      )

    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    const read = requests().find(
      (r) => r.method === 'GET' && r.url.pathname === '/rest/v1/plants',
    )
    expect(read?.url.searchParams.get('id')).toBe(
      `eq.${String(lastInsert().id)}`,
    )
    expect(screen.getAllByRole('article')).toHaveLength(1)
  })

  it('sin conexión, el registro se muestra desactivado con el motivo y vuelve solo', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/coleccion/nueva']}>
        <CollectionProvider source={source}>
          <Routes>
            <Route path="/coleccion/nueva" element={<NewPlantPage />} />
          </Routes>
        </CollectionProvider>
      </MemoryRouter>,
    )

    expect(screen.getByText(PLANT_FORM_TEXT.offline)).toBeInTheDocument()
    expect(nameInput()).toBeDisabled()
    expect(submitButton()).toHaveAttribute('aria-disabled', 'true')
    expect(submitButton()).toHaveAccessibleDescription(PLANT_FORM_TEXT.offline)
    await user.click(submitButton())
    expect(plantInserts()).toHaveLength(0)
    await expectNoAxeViolations()

    onLine.mockReturnValue(true)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(screen.queryByText(PLANT_FORM_TEXT.offline)).toBeNull()
    expect(nameInput()).toBeEnabled()
    expect(submitButton()).not.toHaveAttribute('aria-disabled')
    // Los géneros que no cargaron sin conexión se vuelven a pedir.
    expect(
      await screen.findByRole('button', { name: 'Phalaenopsis' }),
    ).toBeInTheDocument()
  })

  it('cancelar sin cambios vuelve al inventario; con cambios, pregunta antes', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    await renderPage()

    await user.click(chip('Dendrobium'))
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(confirm).toHaveBeenCalledWith(PLANT_FORM_TEXT.confirmDiscard)
    expect(location()).toBe('/coleccion/nueva')
    expect(chip('Dendrobium')).toHaveAttribute('aria-pressed', 'true')

    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(location()).toBe('/coleccion')
    expect(plantInserts()).toHaveLength(0)
  })

  it('cancelar con el formulario intacto no pregunta', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const user = userEvent.setup()
    await renderPage()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(confirm).not.toHaveBeenCalled()
    expect(location()).toBe('/coleccion')
  })

  it('se completa solo con el teclado', async () => {
    const user = userEvent.setup()
    await renderPage()

    await user.click(nameInput())
    await user.keyboard('phal amab')
    await screen.findByRole('option', { name: 'Phalaenopsis amabilis' })
    await user.keyboard('{ArrowDown}{Enter}')
    expect(nameInput()).toHaveValue('Phalaenopsis amabilis')

    // Género y tipo bloqueados siguen en el orden del tabulador.
    await user.tab()
    expect(chip('Cattleya')).toHaveFocus()
    for (let i = 0; i < 4; i += 1) await user.tab()
    expect(
      within(typeGroup()).getByRole('button', { name: 'Especie' }),
    ).toHaveFocus()
    await user.tab()
    await user.tab()
    await user.tab()
    expect(dateInput()).toHaveFocus()
    // La foto, opcional, se salta con un tabulador más.
    await user.tab()
    expect(screen.getByRole('button', { name: 'Elegir foto' })).toHaveFocus()
    await user.tab()
    expect(originInput()).toHaveFocus()
    await user.keyboard('Feria de Miraflores')
    // "Más detalles" se abre con Enter y sus campos siguen en orden.
    await user.tab()
    expect(detailsButton()).toHaveFocus()
    await user.keyboard('{Enter}')
    await user.tab()
    expect(locationInput()).toHaveFocus()
    await user.keyboard('Balcón')
    await user.tab()
    expect(nicknameInput()).toHaveFocus()
    await user.tab()
    expect(chip('Blanco')).toHaveFocus()
    await user.keyboard('{Enter}')
    for (let i = 0; i < 6; i += 1) await user.tab()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    await user.tab()
    expect(submitButton()).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(lastInsert()).toMatchObject({
      species_id: AMABILIS.id,
      origin: 'Feria de Miraflores',
      location: 'Balcón',
      flower_color: 'white',
    })
  })
})

const originInput = () => screen.getByRole('combobox', { name: 'Origen' })
const detailsButton = () => screen.getByRole('button', { name: 'Más detalles' })
const locationInput = () => screen.getByLabelText('Ubicación')
const nicknameInput = () => screen.getByLabelText('Apodo')
const draftKey = plantDraftKey('user_prueba')

function storedDraft(key = draftKey): {
  plantId: string
  savedAt: number
  values: Record<string, unknown>
} | null {
  const raw = window.localStorage.getItem(key)
  return raw === null ? null : (JSON.parse(raw) as never)
}

describe('NewPlantPage: origen, "Más detalles" y borrador (#86)', () => {
  it('el origen sugiere los ya usados, sin distinguir mayúsculas ni tildes, y acepta uno nuevo', async () => {
    const user = userEvent.setup()
    await renderPage([
      plant({ origin: 'vivero  sol', createdAt: '2026-10-01T10:00:00Z' }),
      plant({ origin: 'Vivero Sol', createdAt: '2026-11-10T10:00:00Z' }),
      // Las dadas de baja también cuentan: la tienda sigue siendo suya.
      plant({
        origin: 'Vivero Sol',
        status: 'lost',
        createdAt: '2026-09-01T10:00:00Z',
      }),
      plant({ origin: 'Orquídeas del Valle' }),
      plant({ origin: 'Intercambio con Ana' }),
    ])

    await user.type(originInput(), 'VIVERO')
    // Uno solo, con la forma escrita en el registro más reciente.
    expect(
      screen.getAllByRole('option').map((option) => option.textContent),
    ).toEqual(['Vivero Sol'])

    await user.clear(originInput())
    await user.type(originInput(), 'orquideas')
    await user.click(
      screen.getByRole('option', { name: 'Orquídeas del Valle' }),
    )
    expect(originInput()).toHaveValue('Orquídeas del Valle')

    // Un origen nuevo: sin sugerencias, sin "sin resultados".
    await user.clear(originInput())
    await user.type(originInput(), 'Feria de Lima')
    expect(screen.queryByRole('option')).toBeNull()
    expect(screen.queryByText('Sin resultados')).toBeNull()

    await chooseAmabilis(user)
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(lastInsert().origin).toBe('Feria de Lima')
  })

  it('origen, ubicación y apodo tienen el tope de la base, 120 caracteres', async () => {
    await renderPage()
    expect(originInput()).toHaveAttribute('maxlength', '120')
    expect(locationInput()).toHaveAttribute('maxlength', '120')
    expect(nicknameInput()).toHaveAttribute('maxlength', '120')
  })

  it('"Más detalles" está cerrado; lo de dentro va en la inserción, sin espacios sobrantes', async () => {
    const user = userEvent.setup()
    await renderPage()

    expect(detailsButton()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('textbox', { name: 'Ubicación' })).toBeNull()

    await user.click(detailsButton())
    expect(detailsButton()).toHaveAttribute('aria-expanded', 'true')
    expect(
      within(screen.getByRole('group', { name: 'Color de la flor' }))
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Blanco', 'Rosado', 'Morado', 'Amarillo', 'Naranja', 'Bicolor'])
    await user.type(locationInput(), '  Ventana   de la sala ')
    await user.type(nicknameInput(), 'La lila')
    await user.click(chip('Rosado'))
    // Tocar el color elegido lo quita; se elige otro.
    await user.click(chip('Rosado'))
    expect(chip('Rosado')).toHaveAttribute('aria-pressed', 'false')
    await user.click(chip('Morado'))
    await expectNoAxeViolations()

    await fillFreeName(user)
    await user.type(originInput(), 'Vivero Sol')
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(lastInsert()).toEqual({
      id: expect.any(String) as unknown,
      entered_name: 'La naranja del mercado',
      genus_id: GENERA.cattleya.id,
      type: 'unknown',
      acquired_on: localDateString(),
      origin: 'Vivero Sol',
      location: 'Ventana de la sala',
      nickname: 'La lila',
      flower_color: 'purple',
    })
  })

  it('sin opcionales, la inserción no los lleva', async () => {
    const user = userEvent.setup()
    await renderPage()
    await chooseAmabilis(user)
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    const insert = lastInsert()
    for (const column of [
      'origin',
      'location',
      'nickname',
      'flower_color',
      'photo_in_bloom',
    ]) {
      expect(insert).not.toHaveProperty(column)
    }
  })

  it('recargar a mitad no pierde lo escrito: se recupera con un aviso y se guarda con el mismo id', async () => {
    const user = userEvent.setup()
    const view = await renderPage()

    await chooseAmabilis(user)
    await user.type(originInput(), 'Vivero Sol')
    await user.click(detailsButton())
    await user.type(nicknameInput(), 'La blanca')
    const saved = storedDraft()
    expect(saved).toMatchObject({
      version: PLANT_DRAFT_VERSION,
      values: { name: 'Phalaenopsis amabilis', origin: 'Vivero Sol' },
    })

    // La recarga: la app se vuelve a montar desde cero.
    view.unmount()
    await renderPage()

    expect(
      await screen.findByText(PLANT_FORM_TEXT.draftRestored),
    ).toBeInTheDocument()
    expect(nameInput()).toHaveValue('Phalaenopsis amabilis')
    expect(chip('Phalaenopsis')).toHaveAttribute('aria-disabled', 'true')
    expect(originInput()).toHaveValue('Vivero Sol')
    // Lo de "Más detalles" se ve: la sección vuelve abierta.
    expect(detailsButton()).toHaveAttribute('aria-expanded', 'true')
    expect(nicknameInput()).toHaveValue('La blanca')
    await expectNoAxeViolations()

    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(lastInsert()).toMatchObject({
      id: saved?.plantId,
      species_id: AMABILIS.id,
      origin: 'Vivero Sol',
      nickname: 'La blanca',
    })
    // Guardar con éxito borra el borrador.
    expect(window.localStorage.getItem(draftKey)).toBeNull()
  })

  it('el borrador de una cuenta no aparece con otra en el mismo dispositivo', async () => {
    const user = userEvent.setup()
    const view = await renderPage()
    await user.type(nameInput(), 'Stanhopea')
    view.unmount()

    setFakeClerk({ signedIn: true, userId: 'user_otra' })
    const other = await renderPage()
    expect(nameInput()).toHaveValue('')
    expect(screen.queryByText(PLANT_FORM_TEXT.draftRestored)).toBeNull()
    // El de la primera cuenta sigue ahí, para cuando vuelva.
    expect(storedDraft()?.values.name).toBe('Stanhopea')
    other.unmount()

    setFakeClerk({ signedIn: true, userId: 'user_prueba' })
    await renderPage()
    expect(nameInput()).toHaveValue('Stanhopea')
  })

  it('el borrador caduca a las 24 horas del último cambio', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-21T15:00:00Z'))
    const user = userEvent.setup()
    const view = await renderPage()
    await user.type(nameInput(), 'Stanhopea')
    view.unmount()

    // Un poco antes de caducar, sigue.
    vi.setSystemTime(new Date(Date.now() + PLANT_DRAFT_MAX_AGE_MS - 60_000))
    const before = await renderPage()
    expect(nameInput()).toHaveValue('Stanhopea')
    before.unmount()

    // Recuperarlo sin tocarlo no renueva la caducidad.
    vi.setSystemTime(new Date(Date.now() + 2 * 60_000))
    await renderPage()
    expect(nameInput()).toHaveValue('')
    expect(screen.queryByText(PLANT_FORM_TEXT.draftRestored)).toBeNull()
    expect(window.localStorage.getItem(draftKey)).toBeNull()
  })

  it('descartar el borrador deja el formulario vacío, con otro id', async () => {
    const user = userEvent.setup()
    const view = await renderPage()
    await fillFreeName(user)
    const first = storedDraft()?.plantId
    view.unmount()
    await renderPage()

    await user.click(
      await screen.findByRole('button', { name: PLANT_FORM_TEXT.draftDiscard }),
    )
    expect(screen.queryByText(PLANT_FORM_TEXT.draftRestored)).toBeNull()
    expect(nameInput()).toHaveValue('')
    expect(nameInput()).toHaveFocus()
    expect(chip('Cattleya')).toHaveAttribute('aria-pressed', 'false')
    expect(window.localStorage.getItem(draftKey)).toBeNull()

    await fillFreeName(user)
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(lastInsert().id).not.toBe(first)
  })

  it('"Cancelar" con borrador pregunta y, si se confirma, lo borra', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    const view = await renderPage()
    await user.type(nameInput(), 'Stanhopea')
    view.unmount()
    await renderPage()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(confirm).toHaveBeenCalledWith(PLANT_FORM_TEXT.confirmDiscard)
    expect(location()).toBe('/coleccion')
    expect(window.localStorage.getItem(draftKey)).toBeNull()
  })

  it('vaciar el formulario a mano borra el borrador', async () => {
    const user = userEvent.setup()
    await renderPage()
    await user.type(nameInput(), 'Sta')
    expect(storedDraft()).not.toBeNull()
    await user.clear(nameInput())
    expect(window.localStorage.getItem(draftKey)).toBeNull()
  })

  it('un borrador de otra versión o ilegible se ignora y se borra', async () => {
    window.localStorage.setItem(
      draftKey,
      JSON.stringify({ version: 99, plantId: 'x', savedAt: Date.now() }),
    )
    const view = await renderPage()
    expect(nameInput()).toHaveValue('')
    expect(window.localStorage.getItem(draftKey)).toBeNull()
    view.unmount()

    window.localStorage.setItem(draftKey, '{"version":1,')
    await renderPage()
    expect(nameInput()).toHaveValue('')
    expect(window.localStorage.getItem(draftKey)).toBeNull()
  })

  it('sin almacenamiento disponible, el formulario funciona igual', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Bloqueado', 'SecurityError')
    })
    const user = userEvent.setup()
    await renderPage()
    await fillFreeName(user)
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(plantInserts()).toHaveLength(1)
  })

  it('con el almacenamiento lleno, el formulario funciona igual', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Lleno', 'QuotaExceededError')
    })
    const user = userEvent.setup()
    await renderPage()
    await fillFreeName(user)
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(plantInserts()).toHaveLength(1)
  })

  it('un error dentro de "Más detalles" la abre al intentar guardar y lleva el foco al campo', async () => {
    // Un borrador con una ubicación más larga que el tope (el campo no deja
    // escribirla, pero puede llegar así de otra versión).
    window.localStorage.setItem(
      draftKey,
      JSON.stringify({
        version: PLANT_DRAFT_VERSION,
        plantId: '30000000-0000-4000-8000-000000000001',
        savedAt: Date.now(),
        values: {
          ...initialPlantFormValues(localDateString()),
          name: 'Stanhopea',
          genus: GENERA.cattleya,
          type: 'species',
          location: 'a'.repeat(121),
        },
      }),
    )
    const user = userEvent.setup()
    await renderPage()
    // Se cierra a mano para comprobar que se abre sola.
    await user.click(detailsButton())
    expect(detailsButton()).toHaveAttribute('aria-expanded', 'false')

    await user.click(submitButton())
    expect(detailsButton()).toHaveAttribute('aria-expanded', 'true')
    expect(locationInput()).toHaveFocus()
    expect(locationInput()).toHaveAccessibleDescription(
      new RegExp(`^${PLANT_FORM_ERROR_TEXT.textTooLong}`),
    )
    expect(plantInserts()).toHaveLength(0)
    await expectNoAxeViolations()
  })
})

/** Planta de la colección enlazada a Phalaenopsis amabilis. */
function amabilisPlant(overrides: Partial<CollectionPlant> = {}) {
  return plant({
    species: {
      id: AMABILIS.id,
      scientificName: AMABILIS.scientific_name,
      type: 'species',
      status: 'validated',
    },
    ...overrides,
  })
}

const duplicateRegion = () =>
  screen.getByText(/^Ya tienes/).closest('[role="status"]')

describe('NewPlantPage: aviso de duplicado (#88)', () => {
  it('al elegir una especie que ya tiene, dice cuántos ejemplares activos hay, sin mover el foco', async () => {
    const user = userEvent.setup()
    await renderPage([
      amabilisPlant(),
      amabilisPlant({ nickname: 'La de la sala' }),
      // Las dadas de baja no cuentan.
      amabilisPlant({ status: 'lost' }),
      amabilisPlant({ status: 'gifted' }),
      // Otra especie, tampoco.
      plant({ species: null, displayName: 'Cattleya rex' }),
    ])
    expect(screen.queryByText(/^Ya tienes/)).toBeNull()

    await chooseAmabilis(user)
    const region = duplicateRegion()
    expect(region).toHaveTextContent(
      'Ya tienes 2 ejemplares de Phalaenopsis amabilis. Puedes registrar otro igualmente.',
    )
    // Lo anuncia una región role="status" que ya estaba montada.
    expect(region).toHaveAttribute('role', 'status')
    expect(nameInput()).toHaveFocus()
    await expectNoAxeViolations()

    // Cambiar el nombre desenlaza la especie: el aviso desaparece.
    await user.type(nameInput(), ' x')
    expect(screen.queryByText(/^Ya tienes/)).toBeNull()
  })

  it('con un solo ejemplar, en singular', async () => {
    const user = userEvent.setup()
    await renderPage([amabilisPlant()])
    await chooseAmabilis(user)
    expect(duplicateRegion()).toHaveTextContent(
      'Ya tienes 1 ejemplar de Phalaenopsis amabilis.',
    )
  })

  it('no aparece sin especie enlazada ni con una especie que no tiene', async () => {
    const user = userEvent.setup()
    await renderPage([
      // Un nombre por validar igual al de la especie no cuenta.
      plant({
        species: null,
        validation: 'pending',
        displayName: 'Phalaenopsis amabilis',
        enteredName: 'Phalaenopsis amabilis',
      }),
      amabilisPlant({ status: 'lost' }),
    ])

    await user.type(nameInput(), 'Phalaenopsis amabilis')
    expect(screen.queryByText(/^Ya tienes/)).toBeNull()

    await user.clear(nameInput())
    await chooseAmabilis(user)
    expect(screen.queryByText(/^Ya tienes/)).toBeNull()
  })

  it('no bloquea: se guarda igual y crea otro ejemplar', async () => {
    const user = userEvent.setup()
    await renderPage([amabilisPlant(), amabilisPlant()])
    await chooseAmabilis(user)
    expect(duplicateRegion()).toBeInTheDocument()

    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(lastInsert().species_id).toBe(AMABILIS.id)
    expect(screen.getAllByRole('article')).toHaveLength(3)
  })

  it('si la colección llega después de elegir la especie, el aviso aparece entonces', async () => {
    const user = userEvent.setup()
    await renderPage(null)
    await chooseAmabilis(user)
    expect(screen.queryByText(/^Ya tienes/)).toBeNull()

    await act(async () => {
      source.last().resolve([amabilisPlant()])
      await Promise.resolve()
    })
    expect(duplicateRegion()).toHaveTextContent('Ya tienes 1 ejemplar')
  })

  it('si la colección no se pudo leer, no hay aviso y el formulario funciona', async () => {
    const user = userEvent.setup()
    await renderPage(null)
    await act(async () => {
      source.last().reject(new Error('Fallo de la colección'))
      await Promise.resolve()
    })

    await chooseAmabilis(user)
    expect(screen.queryByText(/^Ya tienes/)).toBeNull()
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(plantInserts()).toHaveLength(1)
  })
})

// Foto en el registro (#87) ----------------------------------------------------

const photoGroup = () => screen.getByRole('group', { name: 'Foto' })
const chooseButton = () => screen.getByRole('button', { name: 'Elegir foto' })
const bloomChip = () =>
  screen.queryByRole('button', { name: PLANT_FORM_TEXT.photoInBloom })
const previewImage = () =>
  screen.queryByRole('img', { name: 'Vista previa de la foto elegida' })

function photoFile() {
  return new File([new Uint8Array(10)], 'IMG_0001.jpg', { type: 'image/jpeg' })
}

function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('No hay campo de archivo.')
  return input
}

/** Elige una foto con el campo (el <input type="file"> oculto). */
async function choosePhoto(
  user: ReturnType<typeof userEvent.setup>,
  container: HTMLElement,
) {
  await user.upload(fileInput(container), photoFile())
  await screen.findByRole('img', { name: 'Vista previa de la foto elegida' })
}

/** Peticiones en orden, como "MÉTODO ruta". */
function requestLog(): string[] {
  return requests().map((r) => `${r.method} ${r.url.pathname}`)
}

const STORAGE_PREFIX = '/storage/v1/object/plant-photos/'

function storageUploads(): string[] {
  return requests()
    .filter(
      (r) => r.method === 'POST' && r.url.pathname.startsWith(STORAGE_PREFIX),
    )
    .map((r) => decodeURIComponent(r.url.pathname.slice(STORAGE_PREFIX.length)))
}

function photoPatches(): Record<string, unknown>[] {
  return requests()
    .filter((r) => r.method === 'PATCH' && r.url.pathname === '/rest/v1/plants')
    .map((r) => r.body as Record<string, unknown>)
}

function uploaded(path: string): Promise<Response> {
  return json({ Id: `id-${path}`, Key: `plant-photos/${path}` })
}

/** Subidas que no responden hasta llamar a la función devuelta. */
function holdUploads(): () => void {
  const pending: (() => void)[] = []
  storageUploadResponder = (path) =>
    new Promise((resolve) => {
      pending.push(() => resolve(uploaded(path)))
    })
  return () => {
    for (const release of pending.splice(0)) release()
  }
}

function failUploads(status: number) {
  storageUploadResponder = () =>
    json(
      { statusCode: String(status), error: 'Error', message: 'Fallo' },
      status,
    )
}

describe('NewPlantPage: foto (#87)', () => {
  it('sin foto no sube nada: solo la inserción', async () => {
    const user = userEvent.setup()
    await renderPage()
    expect(photoGroup()).toHaveAccessibleDescription(PLANT_FORM_TEXT.photoHint)
    await chooseAmabilis(user)
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(storageUploads()).toEqual([])
    expect(photoPatches()).toEqual([])
    expect(processPhoto).not.toHaveBeenCalled()
  })

  it('con foto: guarda la planta, después sube foto y miniatura, apunta la planta a ellas y el inventario muestra la miniatura', async () => {
    const user = userEvent.setup()
    const { container } = await renderPage()
    await chooseAmabilis(user)
    await choosePhoto(user, container)
    expect(processPhoto).toHaveBeenCalledTimes(1)
    await expectNoAxeViolations()

    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))

    const insert = lastInsert()
    const id = String(insert.id)
    // "En floración" no se marcó.
    expect(insert).not.toHaveProperty('photo_in_bloom')
    const uploads = storageUploads()
    expect(uploads).toHaveLength(2)
    for (const path of uploads)
      expect(path.startsWith(`user_prueba/${id}/`)).toBe(true)
    expect(photoPatches()).toHaveLength(1)
    const patch = photoPatches()[0] ?? {}
    expect(String(patch.photo_path)).toMatch(
      new RegExp(`^user_prueba/${id}/photo-.+\\.webp$`),
    )
    expect(String(patch.thumbnail_path)).toMatch(
      new RegExp(`^user_prueba/${id}/thumb-.+\\.webp$`),
    )
    // Orden: primero la planta, después los archivos y al final las rutas.
    const log = requestLog()
    const inserted = log.indexOf('POST /rest/v1/plants')
    const firstUpload = log.findIndex((line) =>
      line.startsWith(`POST ${STORAGE_PREFIX}`),
    )
    const patched = log.indexOf('PATCH /rest/v1/plants')
    expect(inserted).toBeGreaterThanOrEqual(0)
    expect(inserted).toBeLessThan(firstUpload)
    expect(firstUpload).toBeLessThan(patched)

    // La tarjeta pide la miniatura (no la foto grande) y la muestra.
    const thumbnail = await screen.findByRole('img', {
      name: 'Foto de Phalaenopsis amabilis',
    })
    await waitFor(() =>
      expect(thumbnail.getAttribute('src')).toMatch(/^blob:prueba-/),
    )
    const downloads = requests().filter(
      (r) => r.method === 'GET' && r.url.pathname.startsWith(STORAGE_PREFIX),
    )
    expect(downloads.map((r) => r.url.pathname)).toEqual([
      `${STORAGE_PREFIX}${String(patch.thumbnail_path)}`,
    ])
  })

  it('"La foto es en floración" solo aparece con foto, se envía y se quita al quitar la foto', async () => {
    const user = userEvent.setup()
    const { container } = await renderPage()
    await chooseAmabilis(user)
    await user.click(detailsButton())
    expect(bloomChip()).toBeNull()

    await choosePhoto(user, container)
    expect(bloomChip()).toHaveAttribute('aria-pressed', 'false')
    await user.click(bloomChip() as HTMLElement)
    expect(bloomChip()).toHaveAttribute('aria-pressed', 'true')
    await expectNoAxeViolations()

    // Quitar la foto la esconde y la desmarca; el foco vuelve al campo.
    await user.click(screen.getByRole('button', { name: 'Quitar foto' }))
    expect(bloomChip()).toBeNull()
    expect(chooseButton()).toHaveFocus()
    await choosePhoto(user, container)
    expect(bloomChip()).toHaveAttribute('aria-pressed', 'false')
    await user.click(bloomChip() as HTMLElement)

    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(lastInsert()).toMatchObject({ photo_in_bloom: true })
  })

  it('con un nombre por validar recomienda añadir una foto, sin exigirla', async () => {
    const user = userEvent.setup()
    await renderPage()
    await fillFreeName(user)
    expect(photoGroup()).toHaveAccessibleDescription(
      PLANT_FORM_TEXT.pendingPhotoHint,
    )
    await expectNoAxeViolations()

    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(lastInsert()).not.toHaveProperty('species_id')
    expect(storageUploads()).toEqual([])
  })

  it('si la subida falla, la planta queda registrada; se reintenta con la misma foto, sin prepararla otra vez', async () => {
    failUploads(503)
    const user = userEvent.setup()
    const { container } = await renderPage()
    await chooseAmabilis(user)
    await choosePhoto(user, container)
    await user.click(submitButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(PLANT_FORM_TEXT.photoUploadFailed)
    expect(alert).toHaveTextContent(
      'No se pudo guardar la foto. Vuelve a intentarlo.',
    )
    expect(alert).toHaveTextContent(PLANT_FORM_TEXT.photoUploadRetryHint)
    const retry = screen.getByRole('button', {
      name: PLANT_FORM_TEXT.photoUploadRetry,
    })
    await waitFor(() => expect(retry).toHaveFocus())
    expect(
      screen.getByRole('button', {
        name: PLANT_FORM_TEXT.photoContinueWithout,
      }),
    ).toBeInTheDocument()
    // Ya registrada: el formulario no se puede tocar ni volver a enviar, y el
    // borrador ya no está.
    expect(nameInput()).toBeDisabled()
    expect(location()).toBe('/coleccion/nueva')
    expect(plantInserts()).toHaveLength(1)
    expect(photoPatches()).toEqual([])
    expect(window.localStorage.getItem(draftKey)).toBeNull()
    await expectNoAxeViolations()

    storageUploadResponder = uploaded
    await user.click(retry)
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(plantInserts()).toHaveLength(1)
    expect(processPhoto).toHaveBeenCalledTimes(1)
    expect(photoPatches()).toHaveLength(1)
    // El reintento sube a las mismas rutas (la misma versión de la foto).
    const uploads = storageUploads()
    expect(uploads).toHaveLength(4)
    expect(new Set(uploads).size).toBe(2)
  })

  it('si la subida falla, se puede continuar sin foto: la planta ya está en el inventario', async () => {
    failUploads(503)
    const user = userEvent.setup()
    const { container } = await renderPage()
    await chooseAmabilis(user)
    await choosePhoto(user, container)
    await user.click(submitButton())
    await user.click(
      await screen.findByRole('button', {
        name: PLANT_FORM_TEXT.photoContinueWithout,
      }),
    )
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(photoPatches()).toEqual([])
    expect(await screen.findByText(/^Registraste/)).toBeInTheDocument()
  })

  it('con la sesión terminada al subir no ofrece reintentar, solo continuar', async () => {
    failUploads(401)
    const user = userEvent.setup()
    const { container } = await renderPage()
    await chooseAmabilis(user)
    await choosePhoto(user, container)
    await user.click(submitButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(PLANT_FORM_TEXT.photoUploadFailed)
    expect(alert).not.toHaveTextContent(PLANT_FORM_TEXT.photoUploadRetryHint)
    expect(
      screen.queryByRole('button', { name: PLANT_FORM_TEXT.photoUploadRetry }),
    ).toBeNull()
    const continueButton = screen.getByRole('button', {
      name: PLANT_FORM_TEXT.photoContinueWithout,
    })
    await waitFor(() => expect(continueButton).toHaveFocus())
    await user.click(continueButton)
    await waitFor(() => expect(location()).toBe('/coleccion'))
  })

  it('mientras sube no se envía dos veces; "Cancelar subida" deja la planta registrada sin foto', async () => {
    const release = holdUploads()
    const user = userEvent.setup()
    const { container } = await renderPage()
    await chooseAmabilis(user)
    await choosePhoto(user, container)
    await user.click(submitButton())

    const busy = await screen.findByRole('button', {
      name: PLANT_FORM_TEXT.photoUploadingButton,
    })
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    expect(busy).toHaveFocus()
    expect(
      await screen.findByText(/^Tu orquídea quedó registrada\. Subiendo/),
    ).toBeInTheDocument()
    await user.click(busy)
    await user.keyboard('{Enter}')
    expect(plantInserts()).toHaveLength(1)
    await waitFor(() => expect(storageUploads()).toHaveLength(2))
    await expectNoAxeViolations()

    await user.click(
      screen.getByRole('button', { name: PLANT_FORM_TEXT.photoUploadCancel }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      PLANT_FORM_TEXT.photoUploadCancelled,
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: PLANT_FORM_TEXT.photoUploadRetry }),
      ).toHaveFocus(),
    )
    // Lo que llegue a subirse tras cancelar no apunta la planta.
    await act(async () => {
      release()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(photoPatches()).toEqual([])

    await user.click(
      screen.getByRole('button', {
        name: PLANT_FORM_TEXT.photoContinueWithout,
      }),
    )
    await waitFor(() => expect(location()).toBe('/coleccion'))
  })

  it('mientras se prepara la foto no se puede registrar', async () => {
    let finish: (photo: ProcessedPhoto) => void = () => undefined
    processPhoto.mockImplementation(
      () =>
        new Promise<ProcessedPhoto>((resolve) => {
          finish = resolve
        }),
    )
    const user = userEvent.setup()
    const { container } = await renderPage()
    await chooseAmabilis(user)
    await user.upload(fileInput(container), photoFile())
    const preparing = await screen.findByRole('button', {
      name: PLANT_FORM_TEXT.photoPreparing,
    })
    expect(preparing).toHaveAttribute('aria-disabled', 'true')
    await user.click(preparing)
    expect(plantInserts()).toHaveLength(0)

    await act(async () => {
      finish(processedPhoto())
      await Promise.resolve()
    })
    await user.click(
      await screen.findByRole('button', { name: PLANT_FORM_TEXT.submit }),
    )
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(plantInserts()).toHaveLength(1)
    expect(storageUploads()).toHaveLength(2)
  })

  it('recargar con una foto elegida conserva lo escrito y la foto, con el mismo id de planta', async () => {
    const user = userEvent.setup()
    const first = await renderPage()
    await user.type(nameInput(), 'Stanhopea')
    await choosePhoto(user, first.container)
    const saved = storedDraft()
    await waitFor(() => expect(draftPhotos.entries.size).toBe(1))
    expect(draftPhotos.entries.get('user_prueba')?.plantId).toBe(saved?.plantId)

    first.unmount()
    await renderPage()
    expect(
      await screen.findByText(PLANT_FORM_TEXT.draftRestored),
    ).toBeInTheDocument()
    expect(nameInput()).toHaveValue('Stanhopea')
    expect(
      await screen.findByRole('img', {
        name: 'Vista previa de la foto elegida',
      }),
    ).toBeInTheDocument()
    // No se vuelve a preparar.
    expect(processPhoto).toHaveBeenCalledTimes(1)
    await expectNoAxeViolations()

    await user.click(chip('Cattleya'))
    await user.click(within(typeGroup()).getByRole('button', { name: 'No sé' }))
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(lastInsert().id).toBe(saved?.plantId)
    expect(storageUploads()).toHaveLength(2)
    for (const path of storageUploads()) {
      expect(path.startsWith(`user_prueba/${String(saved?.plantId)}/`)).toBe(
        true,
      )
    }
    // Guardar borra el borrador y su foto.
    expect(window.localStorage.getItem(draftKey)).toBeNull()
    expect(draftPhotos.entries.size).toBe(0)
  })

  it('una foto sola, sin nada escrito, también se conserva al recargar', async () => {
    const user = userEvent.setup()
    const first = await renderPage()
    await choosePhoto(user, first.container)
    expect(storedDraft()?.plantId).toBeTruthy()
    await waitFor(() => expect(draftPhotos.entries.size).toBe(1))

    first.unmount()
    await renderPage()
    expect(
      await screen.findByRole('img', {
        name: 'Vista previa de la foto elegida',
      }),
    ).toBeInTheDocument()

    // Quitarla, con el formulario vacío, borra el borrador entero.
    await user.click(screen.getByRole('button', { name: 'Quitar foto' }))
    expect(window.localStorage.getItem(draftKey)).toBeNull()
    await waitFor(() => expect(draftPhotos.entries.size).toBe(0))
  })

  it('una foto pendiente que no va con el borrador se descarta', async () => {
    await draftPhotos.put('user_prueba', {
      version: 1,
      plantId: '30000000-0000-4000-8000-000000000009',
      savedAt: Date.now(),
      fileName: 'vieja.jpg',
      photo: processedPhoto(),
    } as never)
    await renderPage()
    await waitFor(() => expect(draftPhotos.entries.size).toBe(0))
    expect(previewImage()).toBeNull()
  })

  it('descartar el borrador quita también la foto', async () => {
    const user = userEvent.setup()
    const first = await renderPage()
    await user.type(nameInput(), 'Stanhopea')
    await choosePhoto(user, first.container)
    first.unmount()
    await renderPage()
    await screen.findByRole('img', { name: 'Vista previa de la foto elegida' })

    await user.click(
      await screen.findByRole('button', { name: PLANT_FORM_TEXT.draftDiscard }),
    )
    expect(previewImage()).toBeNull()
    await waitFor(() => expect(draftPhotos.entries.size).toBe(0))
  })

  it('"Cancelar" con solo una foto pregunta antes de salir', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    const { container } = await renderPage()
    await choosePhoto(user, container)
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(confirm).toHaveBeenCalledWith(PLANT_FORM_TEXT.confirmDiscard)
    expect(location()).toBe('/coleccion/nueva')
  })

  it('desde la cámara (?foto=1): la foto va lo primero y, al elegirla, el foco pasa al nombre', async () => {
    const user = userEvent.setup()
    const { container } = await renderPage([], '/coleccion/nueva?foto=1')
    const form = screen.getByRole('form', { name: PLANT_FORM_TEXT.title })
    // El primer control del formulario es el de la foto.
    expect(within(form).getAllByRole('button')[0]).toBe(chooseButton())
    expect(photoGroup()).toHaveAccessibleDescription(
      PLANT_FORM_TEXT.photoFirstHint,
    )
    expect(
      photoGroup().compareDocumentPosition(nameInput()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    await expectNoAxeViolations()

    // El toque en el botón abre el selector (el <input> oculto).
    const open = vi.spyOn(fileInput(container), 'click')
    await user.click(chooseButton())
    expect(open).toHaveBeenCalled()
    await choosePhoto(user, container)
    expect(nameInput()).toHaveFocus()

    await user.keyboard('phal amab')
    await user.click(
      await screen.findByRole('option', { name: 'Phalaenopsis amabilis' }),
    )
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(storageUploads()).toHaveLength(2)
  })

  describe('evento "registro completado" (#146)', () => {
    const recorded: ProductEvent[] = []
    beforeEach(() => {
      recorded.length = 0
      setProductEventsRuntimeLoader(() =>
        Promise.resolve({
          setSession: () => {},
          record: (_userId: string, event: ProductEvent) => {
            recorded.push(event)
          },
          flush: () => Promise.resolve(),
          settle: () => Promise.resolve(),
        }),
      )
      setProductEventsSession({
        userId: 'user_prueba',
        confirmed: true,
        online: true,
      })
    })
    afterEach(() => {
      setProductEventsRuntimeLoader(null)
    })

    it('desde la cámara, con foto y nombre del catálogo, sin nombres en el evento', async () => {
      const user = userEvent.setup()
      const { container } = await renderPage([], '/coleccion/nueva?foto=1')
      await choosePhoto(user, container)
      await user.keyboard('phal amab')
      await user.click(
        await screen.findByRole('option', { name: 'Phalaenopsis amabilis' }),
      )
      await user.click(submitButton())
      await waitFor(() => expect(location()).toBe('/coleccion'))
      await waitFor(() => expect(recorded).toHaveLength(1))
      expect(recorded[0]).toMatchObject({
        type: 'plant_registered',
        result: null,
        has_photo: true,
        name_pending: false,
        generated_offline: false,
      })
      expect(recorded[0]?.duration_ms).toBeGreaterThanOrEqual(0)
      expect(JSON.stringify(recorded)).not.toMatch(/phal|amabilis/i)
    })

    it('sin foto y con el nombre por validar', async () => {
      const user = userEvent.setup()
      await renderPage()
      await fillFreeName(user)
      await user.click(submitButton())
      await waitFor(() => expect(location()).toBe('/coleccion'))
      await waitFor(() => expect(recorded).toHaveLength(1))
      expect(recorded[0]).toMatchObject({
        type: 'plant_registered',
        has_photo: false,
        name_pending: true,
      })
    })
  })

  it('sin conexión, el campo de foto queda desactivado con el resto y la foto se conserva', async () => {
    const user = userEvent.setup()
    const { container } = await renderPage()
    await choosePhoto(user, container)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(
      screen.getByRole('button', { name: 'Elegir otra foto' }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Quitar foto' })).toBeDisabled()
    expect(previewImage()).toBeInTheDocument()
    await expectNoAxeViolations()
  })
})

describe('NewPlantPage: fondo por género (#13)', () => {
  // jsdom no carga imágenes: un doble de Image que "carga" al momento y
  // apunta qué fotos se pidieron.
  let requested: string[]

  beforeEach(() => {
    requested = []
    class LoadingImage {
      decoding = 'auto'
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(value: string) {
        requested.push(value)
        queueMicrotask(() => this.onload?.())
      }
    }
    vi.stubGlobal('Image', LoadingImage)
  })

  const backdrop = () => screen.getByTestId('fondo-genero')
  const phalaenopsis = genusBackgroundUrl('Phalaenopsis')
  const cattleya = genusBackgroundUrl('Cattleya')

  it('cambia solo al fijarse el género, no mientras se escribe, y pasa la revisión de accesibilidad', async () => {
    const user = userEvent.setup()
    await renderPage()
    expect(backdrop()).toHaveAttribute('data-fondo', 'neutro')

    // Escribir y ver sugerencias no toca el fondo: ni descarga ni cambio.
    const seen = new Set<string | null>()
    const observer = new MutationObserver(() =>
      seen.add(backdrop().getAttribute('data-fondo')),
    )
    observer.observe(backdrop(), { attributes: true, childList: true })
    await user.type(nameInput(), 'phal amab')
    await screen.findByRole('option', { name: 'Phalaenopsis amabilis' })
    expect(requested).toEqual([])
    expect(seen.size).toBe(0)

    // Elegir la especie fija Phalaenopsis: aparece su foto.
    await user.click(
      screen.getByRole('option', { name: 'Phalaenopsis amabilis' }),
    )
    await waitFor(() =>
      expect(backdrop()).toHaveAttribute('data-fondo', phalaenopsis),
    )
    expect(requested).toEqual([phalaenopsis])

    // Seguir escribiendo desenlaza la especie pero el género se queda: el
    // fondo no cambia.
    seen.clear()
    await user.type(nameInput(), ' x')
    expect(backdrop()).toHaveAttribute('data-fondo', phalaenopsis)
    expect([...seen].every((value) => value === phalaenopsis)).toBe(true)
    await expectNoAxeViolations()

    // Un chip de género con foto la cambia; "Otro" (sin género) la quita.
    await user.click(chip('Cattleya'))
    await waitFor(() =>
      expect(backdrop()).toHaveAttribute('data-fondo', cattleya),
    )
    await user.click(chip('Otro'))
    expect(backdrop()).toHaveAttribute('data-fondo', 'neutro')
    observer.disconnect()
  })

  it('un género sin foto deja el fondo neutro', async () => {
    const user = userEvent.setup()
    await renderPage()

    await user.type(nameInput(), 'wakanki')
    await user.click(
      await screen.findByRole('option', {
        name: /^Masdevallia veitchiana,\s*Nombre común: Wakanki$/,
      }),
    )
    expect(chip('Masdevallia')).toHaveAttribute('aria-pressed', 'true')
    expect(backdrop()).toHaveAttribute('data-fondo', 'neutro')
    expect(requested).toEqual([])
  })
})
