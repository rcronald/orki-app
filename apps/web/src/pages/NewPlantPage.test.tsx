import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router'
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
import { SessionUnverifiedContext } from '../collection/useReadOnly.ts'
import type {
  CollectionPlant,
  CollectionPlantRow,
} from '../collection/model.ts'
import { resetOfflineIdentity } from '../auth/offline-identity.ts'
import { initSupabase, setSessionTokenSource } from '../lib/supabase.ts'
import { localDateString } from '../lib/localDate.ts'
import { PhotoProcessingError } from '../photos/errors.ts'
import type { ProcessedPhoto } from '../photos/process.ts'
import {
  clearPlantDraft,
  PLANT_DRAFT_MAX_AGE_MS,
  PLANT_DRAFT_VERSION,
  plantDraftKey,
  readPlantDrafts,
} from '../registration/draft.ts'
import {
  appDraftPhotoBackend,
  createMemoryDraftPhotoBackend,
  draftPhotoKey,
} from '../registration/draft-photo.ts'
import { initialPlantFormValues } from '../registration/form-state.ts'
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
import { fakeReferencePhoto } from '../test/public-catalog.ts'
import { forgetReferencePhotos } from '../lib/useReferencePhoto.ts'
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

// Pantalla de registro con la app real hasta el cliente de Supabase; solo fetch está
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
  laelia: { id: '20000000-0000-4000-8000-000000000006', name: 'Laelia' },
  vanda: { id: '20000000-0000-4000-8000-000000000007', name: 'Vanda' },
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
// Para la coincidencia exacta (#280): un sinónimo, su homónimo aceptado y un
// híbrido natural con «×».
const PURPURATA = {
  id: '10000000-0000-4000-8000-000000000003',
  scientific_name: 'Cattleya purpurata',
  genus_id: GENERA.cattleya.id,
  genus_name: 'Cattleya',
  type: 'species',
  status: 'validated',
  matched_name: 'Laelia purpurata',
  matched_name_type: 'synonym',
}
const LAELIA_PURPURATA = {
  id: '10000000-0000-4000-8000-000000000004',
  scientific_name: 'Laelia purpurata',
  genus_id: GENERA.laelia.id,
  genus_name: 'Laelia',
  type: 'species',
  status: 'imported',
  matched_name: 'Laelia purpurata',
  matched_name_type: 'scientific',
}
const INTERMEDIA = {
  id: '10000000-0000-4000-8000-000000000005',
  scientific_name: 'Phalaenopsis × intermedia',
  genus_id: GENERA.phalaenopsis.id,
  genus_name: 'Phalaenopsis',
  type: 'hybrid',
  status: 'validated',
  matched_name: 'Phalaenopsis × intermedia',
  matched_name_type: 'scientific',
}
// La especie que llega de la ficha del catálogo con un borrador de otra (#296).
const VANDA_COERULEA = {
  id: '10000000-0000-4000-8000-000000000006',
  scientific_name: 'Vanda coerulea',
  genus_id: GENERA.vanda.id,
  genus_name: 'Vanda',
  type: 'species',
  status: 'validated',
  matched_name: 'Vanda coerulea',
  matched_name_type: 'scientific',
}
const ALL_SPECIES = [
  ...SPECIES,
  PURPURATA,
  LAELIA_PURPURATA,
  INTERMEDIA,
  VANDA_COERULEA,
]

/** Géneros del catálogo para search_genera, con sus abreviaturas. */
const GENUS_ROWS = [
  { ...GENERA.cattleya, is_quick_access: true, abbreviations: ['C.'] },
  { ...GENERA.dendrobium, is_quick_access: true, abbreviations: ['Den.'] },
  { ...GENERA.phalaenopsis, is_quick_access: true, abbreviations: ['Phal.'] },
  { ...GENERA.masdevallia, is_quick_access: false, abbreviations: ['Masd.'] },
  { ...GENERA.miltoniopsis, is_quick_access: false, abbreviations: ['Mps.'] },
  { ...GENERA.laelia, is_quick_access: false, abbreviations: ['L.'] },
]

/** search_genera simplificada: por nombre o por el comienzo de una abreviatura. */
function searchGeneraRows(query: string) {
  const plain = (text: string) => text.toLowerCase().replace(/\./g, '').trim()
  const text = plain(query)
  return GENUS_ROWS.flatMap(({ abbreviations, ...genus }) => {
    const byName = plain(genus.name).includes(text)
    const abbreviation = abbreviations.find((a) => plain(a).startsWith(text))
    if (!byName && abbreviation === undefined) return []
    return [{ ...genus, matched_abbreviation: byName ? null : abbreviation }]
  })
}

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
/** Lo que devuelve search_species, sea cual sea la consulta. */
let speciesRows: readonly Record<string, unknown>[]

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
  const species = ALL_SPECIES.find((s) => s.id === body.species_id) ?? null
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
    code: 'CAT-001',
    notes: null,
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
  if (pathname === '/rest/v1/rpc/search_species') return json(speciesRows)
  if (pathname === '/rest/v1/rpc/search_genera') {
    const { query } = request.body as { query: string }
    return json(searchGeneraRows(query))
  }
  if (pathname === '/rest/v1/plants' && request.method === 'POST') {
    return insertResponder(request.body as Record<string, unknown>)
  }
  // La planta releída (readPlant), con la principal ya copiada, como hace la
  // base (sync_plant).
  if (pathname === '/rest/v1/plants' && request.method === 'GET') {
    const id = request.url.searchParams.get('id')?.replace(/^eq\./, '') ?? ''
    const [main] = photoRowsOf(id)
    return json({
      ...createdRow({ ...lastInsert(), id }),
      photo_path: main?.photo_path ?? null,
      thumbnail_path: main?.thumbnail_path ?? null,
      photo_in_bloom: main?.in_bloom ?? false,
    })
  }
  if (pathname === '/rest/v1/plant_photos') {
    return photoRowsResponder(request)
  }
  // La foto de referencia de la especie elegida (#234): solo amabilis tiene.
  if (pathname === '/rest/v1/species_photos') {
    const id = request.url.searchParams.get('species_id')?.replace(/^eq\./, '')
    return json(id === AMABILIS.id ? [fakeReferencePhoto(AMABILIS.id)] : [])
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

/** Una fila de plant_photos, como la guarda PostgREST. */
interface PhotoRow {
  id: string
  plant_id: string
  photo_path: string
  thumbnail_path: string
  in_bloom: boolean
  taken_at: string | null
  note: string | null
  position: number
  created_at: string
}

/** plant_photos en memoria: lo que la galería guardó. */
let photoRowStore: PhotoRow[] = []
/** Respuesta a cada inserción en plant_photos; por defecto, guardada. */
let photoInsertResponder: (row: PhotoRow) => Promise<Response> | null

function photoRowsOf(plantId: string): PhotoRow[] {
  return photoRowStore
    .filter((row) => row.plant_id === plantId)
    .sort((a, b) => a.position - b.position)
}

function photoRowsResponder(request: SentRequest): Promise<Response> {
  const plantId =
    request.url.searchParams.get('plant_id')?.replace(/^eq\./, '') ?? ''
  if (request.method === 'GET') return json(photoRowsOf(plantId))
  if (request.method === 'POST') {
    const body = request.body as Omit<PhotoRow, 'id' | 'created_at'>
    const row: PhotoRow = {
      id: crypto.randomUUID(),
      created_at: '2026-11-21T15:00:00+00:00',
      ...body,
      in_bloom: body.in_bloom,
      taken_at: body.taken_at,
      note: body.note,
    }
    const custom = photoInsertResponder(row)
    if (custom) return custom
    if (
      photoRowsOf(row.plant_id).some((other) => other.position === row.position)
    ) {
      return json({ code: '23505', message: 'duplicate key' }, 409)
    }
    photoRowStore.push(row)
    return json(row, 201)
  }
  return json({ message: 'Ruta inesperada plant_photos' }, 404)
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
  forgetReferencePhotos()
  document.documentElement.lang = 'es'
  resetFakeClerk()
  setFakeClerk({ signedIn: true, userId: 'user_prueba' })
  clearQuickAccessGeneraCache()
  fetchMock.mockReset()
  fetchMock.mockImplementation(respond)
  insertResponder = (body) => json(createdRow(body), 201)
  storageUploadResponder = (path) =>
    json({ Id: `id-${path}`, Key: `plant-photos/${path}` })
  photoRowStore = []
  photoInsertResponder = () => null
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
  speciesRows = SPECIES
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
  entry:
    | string
    | {
        pathname: string
        search?: string
        state?: unknown
      } = '/coleccion/nueva',
  /** Esperar al formulario (sus géneros); no, si se abre con la elección (#296). */
  { form = true }: { form?: boolean } = {},
) {
  const view = render(
    <MemoryRouter initialEntries={['/coleccion', entry]}>
      <NavigationFocusProvider>
        <CollectionProvider source={source}>
          <main>
            <Routes>
              <Route path="/coleccion" element={<CollectionPage />} />
              <Route path="/coleccion/nueva" element={<NewPlantPage />} />
              <Route
                path="/privacidad"
                element={<Link to="/coleccion/nueva">Volver al registro</Link>}
              />
            </Routes>
          </main>
          <LocationProbe />
        </CollectionProvider>
      </NavigationFocusProvider>
    </MemoryRouter>,
  )
  // La colección del usuario (vacía si no se indica) y los géneros de acceso
  // rápido.
  if (plants !== null) await source.respond(plants)
  else await act(() => Promise.resolve())
  if (form) await screen.findByRole('button', { name: 'Phalaenopsis' })
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

    // Enviado justo después de escribir el nombre, el registro espera a la
    // búsqueda del nombre (#280) antes de validar.
    await waitFor(() => expect(dateInput()).toHaveFocus())
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
    // «Coincidencia en el catálogo» bajo el campo, dentro de su ayuda (#221).
    expect(screen.getByText(PLANT_FORM_TEXT.nameMatch)).toHaveClass(
      'orki-match',
    )
    expect(nameInput()).toHaveAccessibleDescription(
      `${PLANT_FORM_TEXT.nameMatch} ${PLANT_FORM_TEXT.nameHint}`,
    )
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

    // Cambiar el texto desenlaza: la coincidencia se limpia y el género y el
    // tipo siguen marcados, pero vuelven a ser editables.
    await user.type(nameInput(), ' x')
    expect(screen.queryByText(PLANT_FORM_TEXT.nameMatch)).toBeNull()
    expect(chip('Masdevallia')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('Masdevallia')).not.toHaveAttribute('aria-disabled')
    expect(species).not.toHaveAttribute('aria-disabled')
    expect(screen.queryByText(PLANT_FORM_TEXT.lockedHint)).toBeNull()
    await user.click(chip('Cattleya'))
    expect(chip('Cattleya')).toHaveAttribute('aria-pressed', 'true')

    // Volver a elegir una sugerencia vuelve a dar la coincidencia.
    await user.clear(nameInput())
    await user.type(nameInput(), 'wakanki')
    await user.click(
      await screen.findByRole('option', { name: /^Masdevallia veitchiana,/ }),
    )
    expect(screen.getByText(PLANT_FORM_TEXT.nameMatch)).toBeInTheDocument()
    expect(chip('Masdevallia')).toHaveAttribute('aria-pressed', 'true')
  })

  it('al elegir una especie con foto de referencia, «Así es esta especie» con su crédito (#234)', async () => {
    const user = userEvent.setup()
    await renderPage()
    await chooseAmabilis(user)

    const image = await screen.findByRole('img', {
      name: 'Foto de referencia de Phalaenopsis amabilis',
    })
    expect(image).toHaveAttribute(
      'src',
      `https://ejemplo.supabase.co/storage/v1/object/public/species-photos/${AMABILIS.id}/thumb-12345.webp`,
    )
    const preview = image.closest('figure') as HTMLElement
    expect(preview).toHaveTextContent(PLANT_FORM_TEXT.speciesPreview)
    expect(preview).toHaveTextContent('Foto: Ana Pérez')
    const lookups = () =>
      requests().filter((r) => r.url.pathname === '/rest/v1/species_photos')
    expect(lookups()).toHaveLength(1)
    await expectNoAxeViolations()

    // Cambiar el nombre desenlaza la especie: la vista se va.
    await user.type(nameInput(), ' x')
    expect(screen.queryByText(PLANT_FORM_TEXT.speciesPreview)).toBeNull()

    // Una especie sin foto no enseña nada.
    await user.clear(nameInput())
    await user.type(nameInput(), 'wakanki')
    await user.click(
      await screen.findByRole('option', { name: /^Masdevallia veitchiana,/ }),
    )
    await waitFor(() => expect(lookups()).toHaveLength(2))
    expect(screen.queryByText(PLANT_FORM_TEXT.speciesPreview)).toBeNull()
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
      `${PLANT_FORM_TEXT.nameMatch} ${PLANT_FORM_TEXT.nameHint}`,
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
    await waitFor(() => expect(search).toHaveFocus())
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

    // La primera palabra del nombre ya buscó su género (#280); el buscador,
    // lo escrito en él.
    const searchCall = requests().find(
      (r) =>
        r.url.pathname === '/rest/v1/rpc/search_genera' &&
        (r.body as { query: string }).query === 'mps',
    )
    expect(searchCall).toBeDefined()

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
    await waitFor(() => expect(chip('Cattleya')).toHaveFocus())
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

  it('desde la ficha del catálogo (#232) empieza con la especie elegida', async () => {
    const user = userEvent.setup()
    const species = {
      id: AMABILIS.id,
      scientificName: 'Phalaenopsis amabilis',
      genus: { id: GENERA.phalaenopsis.id, name: 'Phalaenopsis' },
      type: 'species',
    }
    await renderPage([], {
      pathname: '/coleccion/nueva',
      search: '?nombre=Phalaenopsis+amabilis',
      state: { catalogSpecies: species },
    })

    expect(nameInput()).toHaveValue('Phalaenopsis amabilis')
    expect(screen.getByText(PLANT_FORM_TEXT.nameMatch)).toBeInTheDocument()
    expect(chip('Phalaenopsis')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('Phalaenopsis')).toHaveAttribute('aria-disabled', 'true')
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(lastInsert()).toMatchObject({
      entered_name: 'Phalaenopsis amabilis',
      species_id: AMABILIS.id,
      genus_id: GENERA.phalaenopsis.id,
      type: 'species',
    })
  })

  it('una especie en el estado con otro nombre que el de la dirección no se usa', async () => {
    await renderPage([], {
      pathname: '/coleccion/nueva',
      search: '?nombre=Cattleya+maxima',
      state: {
        catalogSpecies: {
          id: AMABILIS.id,
          scientificName: 'Phalaenopsis amabilis',
          genus: { id: GENERA.phalaenopsis.id, name: 'Phalaenopsis' },
          type: 'species',
        },
      },
    })
    expect(nameInput()).toHaveValue('Cattleya maxima')
    expect(screen.queryByText(PLANT_FORM_TEXT.nameMatch)).toBeNull()
  })

  it('con un borrador de otro nombre, se elige (#296); al descartarlo, el nombre de ?nombre=', async () => {
    const user = userEvent.setup()
    const view = await renderPage()
    await fillFreeName(user)
    view.unmount()
    await renderPage([], '/coleccion/nueva?nombre=Cattleya%20maxima', {
      form: false,
    })
    await user.click(
      await screen.findByRole('button', {
        name: /^Continuar borrador La naranja del mercado/,
      }),
    )

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
    await waitFor(() =>
      expect(submitButton()).toHaveTextContent('Registrando…'),
    )
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

  it('sin conexión y sin una sesión identificada en el dispositivo, el registro se muestra desactivado con el motivo y vuelve solo', async () => {
    // Nadie recordado: sin conexión, la app no sabe de quién sería el
    // borrador (#296), así que sigue como antes.
    setFakeClerk({ signedIn: false })
    resetOfflineIdentity()
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

    // Los enlaces del crédito de «Así es esta especie» (#234) van detrás del
    // nombre.
    await screen.findByText(PLANT_FORM_TEXT.speciesPreview)
    await user.tab()
    expect(screen.getByRole('link', { name: /CC BY 4.0/ })).toHaveFocus()
    await user.tab()
    expect(
      screen.getByRole('link', { name: /Ver el original en iNaturalist/ }),
    ).toHaveFocus()

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
    await user.tab()
    expect(originInput()).toHaveFocus()
    await user.keyboard('Feria de Miraflores')
    // La galería, opcional, se salta con un tabulador más (sin pantalla
    // táctil, solo «Elegir fotos»).
    await user.tab()
    expect(screen.getByRole('button', { name: 'Elegir fotos' })).toHaveFocus()
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

// El nombre exacto de una especie del catálogo la enlaza (#280): escrito, al
// llegar con ?nombre= desde «¿Ya la tengo?» o con Enter sin elegir la
// sugerencia. Un sinónimo, varias especies o un parecido no se enlazan solos.
describe('NewPlantPage: el nombre exacto del catálogo enlaza la especie (#280)', () => {
  const pendingText = /No está en el catálogo/

  it('al llegar con ?nombre= y el nombre exacto de una especie, la enlaza y se guarda validada', async () => {
    const user = userEvent.setup()
    await renderPage([], '/coleccion/nueva?nombre=Phalaenopsis%20amabilis')

    expect(
      await screen.findByText(PLANT_FORM_TEXT.nameMatch),
    ).toBeInTheDocument()
    expect(nameInput()).toHaveAccessibleDescription(
      `${PLANT_FORM_TEXT.nameMatch} ${PLANT_FORM_TEXT.nameHint}`,
    )
    expect(screen.queryByText(pendingText)).toBeNull()
    expect(chip('Phalaenopsis')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('Phalaenopsis')).toHaveAttribute('aria-disabled', 'true')
    expect(
      within(typeGroup()).getByRole('button', { name: 'Especie' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expectNoAxeViolations()

    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(lastInsert()).toEqual({
      id: expect.any(String) as unknown,
      entered_name: 'Phalaenopsis amabilis',
      species_id: AMABILIS.id,
      genus_id: GENERA.phalaenopsis.id,
      type: 'species',
      acquired_on: localDateString(),
    })
    expect(await screen.findByText(/Registraste/)).toHaveTextContent(
      'Registraste Phalaenopsis amabilis en tu colección. Validada',
    )
  })

  it('escribir el nombre exacto y pulsar Enter enseguida, sin elegir la sugerencia, la enlaza', async () => {
    const user = userEvent.setup()
    await renderPage()

    // Enter antes de que llegue la búsqueda: el registro espera a saber si
    // el nombre está en el catálogo.
    await user.type(nameInput(), 'phalaenopsis amabilis{Enter}')
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(plantInserts()).toHaveLength(1)
    expect(lastInsert()).toMatchObject({
      entered_name: 'Phalaenopsis amabilis',
      species_id: AMABILIS.id,
      genus_id: GENERA.phalaenopsis.id,
      type: 'species',
    })
  })

  it('escribir el nombre exacto enlaza la especie sin el aviso de «por validar»; Enter la guarda', async () => {
    const user = userEvent.setup()
    await renderPage()

    await user.type(nameInput(), 'Phalaenopsis amabilis')
    expect(
      await screen.findByText(PLANT_FORM_TEXT.nameMatch),
    ).toBeInTheDocument()
    // Ni el aviso de «por validar» ni la lista con «No la encuentro».
    expect(screen.queryByText(pendingText)).toBeNull()
    expect(screen.queryByRole('option')).toBeNull()
    expect(nameInput()).toHaveAttribute('aria-expanded', 'false')
    expect(chip('Phalaenopsis')).toHaveAttribute('aria-disabled', 'true')

    await user.keyboard('{Enter}')
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(lastInsert()).toMatchObject({ species_id: AMABILIS.id })
  })

  it('sin tildes ni mayúsculas, con espacios de más y con «x» por «×» también es exacto', async () => {
    speciesRows = [INTERMEDIA, AMABILIS]
    const user = userEvent.setup()
    await renderPage()

    await user.type(nameInput(), '  PHALÁENOPSIS   x  Intermedia ')
    expect(
      await screen.findByText(PLANT_FORM_TEXT.nameMatch),
    ).toBeInTheDocument()
    expect(nameInput()).toHaveValue('Phalaenopsis × intermedia')
    expect(
      within(typeGroup()).getByRole('button', { name: 'Híbrido' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(lastInsert()).toMatchObject({
      species_id: INTERMEDIA.id,
      type: 'hybrid',
    })
  })

  it('un sinónimo exacto (?nombre=) no se enlaza solo: se ofrece la especie aceptada y se elige con un toque', async () => {
    speciesRows = [PURPURATA]
    const user = userEvent.setup()
    await renderPage([], '/coleccion/nueva?nombre=Laelia%20purpurata')

    expect(await screen.findByText(/es un sinónimo de/)).toHaveTextContent(
      'Laelia purpurata es un sinónimo de Cattleya purpurata en el catálogo. Si la eliges, se guarda con ese nombre; si no, quedará como «Nombre por validar».',
    )
    // Sin enlazar ni cambiarle el nombre, y sin decir que no está.
    expect(nameInput()).toHaveValue('Laelia purpurata')
    expect(screen.queryByText(PLANT_FORM_TEXT.nameMatch)).toBeNull()
    expect(screen.queryByText(pendingText)).toBeNull()
    await expectNoAxeViolations()

    await user.click(
      screen.getByRole('button', { name: 'Elegir Cattleya purpurata' }),
    )
    expect(nameInput()).toHaveValue('Cattleya purpurata')
    expect(screen.getByText(PLANT_FORM_TEXT.nameMatch)).toBeInTheDocument()
    expect(screen.queryByText(/es un sinónimo de/)).toBeNull()
    expect(chip('Cattleya')).toHaveAttribute('aria-disabled', 'true')
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(lastInsert()).toMatchObject({
      entered_name: 'Cattleya purpurata',
      species_id: PURPURATA.id,
    })
  })

  it('al escribir un sinónimo exacto, la sugerencia queda destacada y Enter la elige', async () => {
    speciesRows = [PURPURATA]
    const user = userEvent.setup()
    await renderPage()

    await user.type(nameInput(), 'laelia purpurata')
    const option = await screen.findByRole('option', {
      name: /^Cattleya purpurata,\s*Sinónimo: Laelia purpurata$/,
    })
    await waitFor(() => expect(option).toHaveAttribute('aria-selected', 'true'))
    expect(nameInput()).toHaveAttribute('aria-activedescendant', option.id)
    expect(screen.queryByText(pendingText)).toBeNull()

    await user.keyboard('{Enter}')
    expect(nameInput()).toHaveValue('Cattleya purpurata')
    expect(screen.getByText(PLANT_FORM_TEXT.nameMatch)).toBeInTheDocument()
    expect(plantInserts()).toHaveLength(0)
  })

  it('con varias especies con ese nombre no enlaza ninguna: las muestra para elegir', async () => {
    speciesRows = [LAELIA_PURPURATA, PURPURATA]
    const user = userEvent.setup()
    await renderPage()

    await user.type(nameInput(), 'Laelia purpurata')
    expect(
      await screen.findByText(/Hay 2 especies del catálogo con este nombre/),
    ).toBeInTheDocument()
    expect(screen.queryByText(PLANT_FORM_TEXT.nameMatch)).toBeNull()
    expect(screen.queryByText(pendingText)).toBeNull()
    // Ninguna destacada: Enter no elige por la persona.
    for (const option of screen.getAllByRole('option')) {
      expect(option).toHaveAttribute('aria-selected', 'false')
    }
    expect(
      screen.getByRole('button', { name: 'Elegir Laelia purpurata' }),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: 'Elegir Cattleya purpurata (sinónimo: Laelia purpurata)',
      }),
    )
    expect(nameInput()).toHaveValue('Cattleya purpurata')
    expect(screen.getByText(PLANT_FORM_TEXT.nameMatch)).toBeInTheDocument()
  })

  it('un parecido (error de tipeo) nunca se enlaza solo: queda por validar', async () => {
    const user = userEvent.setup()
    await renderPage()

    await user.type(nameInput(), 'Phalaenopsis amabilys')
    await screen.findByRole('option', { name: 'Phalaenopsis amabilis' })
    expect(screen.queryByText(PLANT_FORM_TEXT.nameMatch)).toBeNull()
    expect(nameInput()).toHaveAccessibleDescription(
      PLANT_FORM_TEXT.namePendingHint,
    )
    await user.click(chip('Phalaenopsis'))
    await user.click(
      within(typeGroup()).getByRole('button', { name: 'Especie' }),
    )
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(lastInsert()).not.toHaveProperty('species_id')
    expect(lastInsert()).toMatchObject({
      entered_name: 'Phalaenopsis amabilys',
      genus_id: GENERA.phalaenopsis.id,
    })
  })

  it('el foco está en «Nombre» al abrir el registro', async () => {
    await renderPage()
    expect(nameInput()).toHaveFocus()
  })

  it('un nombre libre marca de antemano el género de su primera palabra, y se puede cambiar', async () => {
    const user = userEvent.setup()
    await renderPage()

    await user.type(nameInput(), 'Cattleya Mini Purple')
    await waitFor(() =>
      expect(chip('Cattleya')).toHaveAttribute('aria-pressed', 'true'),
    )
    expect(chip('Cattleya')).not.toHaveAttribute('aria-disabled')
    await user.click(chip('Dendrobium'))
    expect(chip('Dendrobium')).toHaveAttribute('aria-pressed', 'true')
    // Lo elegido a mano no lo cambia lo que se siga escribiendo.
    await user.type(nameInput(), ' 2')
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)))
    expect(chip('Dendrobium')).toHaveAttribute('aria-pressed', 'true')

    await user.click(
      within(typeGroup()).getByRole('button', { name: 'Híbrido' }),
    )
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(lastInsert()).toMatchObject({
      entered_name: 'Cattleya Mini Purple 2',
      genus_id: GENERA.dendrobium.id,
    })
  })

  it('también por la abreviatura del género («Mps.»)', async () => {
    const user = userEvent.setup()
    await renderPage()

    await user.type(nameInput(), 'Mps. Rojo de la sierra')
    await waitFor(() =>
      expect(chip('Miltoniopsis')).toHaveAttribute('aria-pressed', 'true'),
    )
  })
})

const originInput = () => screen.getByRole('combobox', { name: 'Origen' })
const detailsButton = () =>
  screen.getByRole('button', { name: 'Más detalles (opcional)' })
const locationInput = () => screen.getByLabelText('Ubicación')
const nicknameInput = () => screen.getByLabelText('Apodo')
const draftKey = plantDraftKey('user_prueba')

interface StoredDraftForTest {
  version: number
  plantId: string
  savedAt: number
  values: Record<string, unknown>
}

/** El borrador más reciente tal como está en localStorage, con la versión. */
function storedDraft(key = draftKey): StoredDraftForTest | null {
  const raw = window.localStorage.getItem(key)
  if (raw === null) return null
  const parsed = JSON.parse(raw) as {
    version: number
    drafts: Omit<StoredDraftForTest, 'version'>[]
  }
  const [latest] = parsed.drafts
  return latest ? { version: parsed.version, ...latest } : null
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
    // En el formato de un solo borrador (versión 1, anterior al #296), que se
    // sigue leyendo.
    window.localStorage.setItem(
      draftKey,
      JSON.stringify({
        version: 1,
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
    await waitFor(() =>
      expect(detailsButton()).toHaveAttribute('aria-expanded', 'true'),
    )
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

    await source.respond([amabilisPlant()])
    expect(duplicateRegion()).toHaveTextContent('Ya tienes 1 ejemplar')
  })

  it('si la colección no se pudo leer, no hay aviso y el formulario funciona', async () => {
    const user = userEvent.setup()
    await renderPage(null)
    await source.fail(new Error('Fallo de la colección'))

    await chooseAmabilis(user)
    expect(screen.queryByText(/^Ya tienes/)).toBeNull()
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(plantInserts()).toHaveLength(1)
  })
})

// Galería de fotos en el registro (#221) ----------------------------------------

const gallery = () => screen.getByRole('region', { name: 'Fotos (opcional)' })
const chooseButton = () => screen.getByRole('button', { name: 'Elegir fotos' })
const bloomChip = () =>
  screen.queryByRole('button', { name: PLANT_FORM_TEXT.photoInBloom })
const thumbnails = () =>
  within(gallery())
    .queryAllByRole('img')
    .map(
      (image) => image.getAttribute('aria-label') ?? image.getAttribute('alt'),
    )

function photoFile(index = 1) {
  return new File([new Uint8Array(10)], `IMG_000${String(index)}.jpg`, {
    type: 'image/jpeg',
  })
}

function filesInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    'input[type="file"][multiple]',
  )
  if (!input) throw new Error('No hay campo de archivos.')
  return input
}

/** Elige `count` fotos de una vez y espera a que estén preparadas. */
async function choosePhotos(
  user: ReturnType<typeof userEvent.setup>,
  container: HTMLElement,
  count = 1,
) {
  await user.upload(
    filesInput(container),
    Array.from({ length: count }, (_, index) => photoFile(index + 1)),
  )
  await waitFor(() =>
    expect(
      container.querySelector('.orki-gallery__item--preparing'),
    ).toBeNull(),
  )
}

/** Peticiones en orden, como "MÉTODO ruta". */
/** Lecturas de las fotos de la planta (GET plant_photos). */
function photoRowReads(): number {
  return requests().filter(
    (r) => r.method === 'GET' && r.url.pathname === '/rest/v1/plant_photos',
  ).length
}

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

function photoRowInserts(): Record<string, unknown>[] {
  return requests()
    .filter(
      (r) => r.method === 'POST' && r.url.pathname === '/rest/v1/plant_photos',
    )
    .map((r) => r.body as Record<string, unknown>)
}

function uploaded(path: string): Promise<Response> {
  return json({ Id: `id-${path}`, Key: `plant-photos/${path}` })
}

/** Versión de una ruta de foto o miniatura. */
function versionOf(path: string): string {
  return /(?:photo|thumb)-([^.]+)\./.exec(path)?.[1] ?? ''
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

describe('NewPlantPage: galería de fotos (#221)', () => {
  it('sin fotos no sube nada: solo la inserción, con la galería vacía', async () => {
    const user = userEvent.setup()
    await renderPage()
    expect(within(gallery()).getByText('0 de 6')).toBeInTheDocument()
    expect(within(gallery()).getByText('Aún no hay fotos.')).toBeInTheDocument()
    // En el escritorio (sin pantalla táctil) no se ofrece «Tomar foto».
    expect(
      within(gallery()).queryByRole('button', { name: 'Tomar foto' }),
    ).toBeNull()
    await chooseAmabilis(user)
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(storageUploads()).toEqual([])
    expect(photoRowInserts()).toEqual([])
    expect(processPhoto).not.toHaveBeenCalled()
  })

  it('con una foto: guarda la planta, después sube foto y miniatura y crea su fila; el inventario muestra la principal', async () => {
    const user = userEvent.setup()
    const { container } = await renderPage()
    await chooseAmabilis(user)
    // «Elegir fotos» abre el selector (el <input> oculto, múltiple).
    const open = vi.spyOn(filesInput(container), 'click')
    await user.click(chooseButton())
    expect(open).toHaveBeenCalled()
    await choosePhotos(user, container)
    expect(processPhoto).toHaveBeenCalledTimes(1)
    expect(thumbnails()).toEqual(['Foto principal'])
    expect(within(gallery()).getByText('1 de 6')).toBeInTheDocument()
    expect(within(gallery()).getByText('Principal')).toBeInTheDocument()
    expect(
      within(gallery()).getByText('Foto añadida: 1 de 6.'),
    ).toHaveAttribute('role', 'status')
    await expectNoAxeViolations()

    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))

    const insert = lastInsert()
    const id = String(insert.id)
    expect(insert).not.toHaveProperty('photo_in_bloom')
    const uploads = storageUploads()
    expect(uploads).toHaveLength(2)
    for (const path of uploads)
      expect(path.startsWith(`user_prueba/${id}/`)).toBe(true)
    expect(photoRowStore).toHaveLength(1)
    expect(photoRowStore[0]).toMatchObject({
      plant_id: id,
      position: 0,
      in_bloom: false,
    })
    // Orden: primero la planta, después los archivos y al final la fila.
    const log = requestLog()
    const inserted = log.indexOf('POST /rest/v1/plants')
    const firstUpload = log.findIndex((line) =>
      line.startsWith(`POST ${STORAGE_PREFIX}`),
    )
    const row = log.indexOf('POST /rest/v1/plant_photos')
    expect(inserted).toBeGreaterThanOrEqual(0)
    expect(inserted).toBeLessThan(firstUpload)
    expect(firstUpload).toBeLessThan(row)

    // La tarjeta pide la miniatura de la principal y la muestra.
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
      `${STORAGE_PREFIX}${String(photoRowStore[0]?.thumbnail_path)}`,
    ])
  })

  it('con seis: las sube en orden, la primera es la principal, y las acciones se deshabilitan', async () => {
    const user = userEvent.setup()
    const { container } = await renderPage()
    await fillFreeName(user)
    await choosePhotos(user, container, 6)
    expect(thumbnails()).toEqual([
      'Foto principal',
      'Foto 2 de 6',
      'Foto 3 de 6',
      'Foto 4 de 6',
      'Foto 5 de 6',
      'Foto 6 de 6',
    ])
    expect(within(gallery()).getByText('6 de 6')).toBeInTheDocument()
    expect(chooseButton()).toHaveAttribute('aria-disabled', 'true')
    expect(chooseButton()).toHaveAccessibleDescription(
      'Ya tienes 6 fotos. Quita una para añadir otra.',
    )
    const open = vi.spyOn(filesInput(container), 'click')
    await user.click(chooseButton())
    expect(open).not.toHaveBeenCalled()
    await expectNoAxeViolations()

    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(storageUploads()).toHaveLength(12)
    const id = String(lastInsert().id)
    expect(photoRowsOf(id).map((row) => row.position)).toEqual([
      0, 1, 2, 3, 4, 5,
    ])
    // La principal es la primera elegida.
    expect(versionOf(photoRowsOf(id)[0]?.photo_path ?? '')).toBe(
      versionOf(storageUploads()[0] ?? ''),
    )
  })

  it('una selección que no cabe añade las que caben, dice cuántas quedaron fuera y conserva las ya elegidas; la séptima no entra', async () => {
    const user = userEvent.setup()
    const { container } = await renderPage()
    await choosePhotos(user, container, 4)
    await choosePhotos(user, container, 3)
    expect(thumbnails()).toHaveLength(6)
    expect(processPhoto).toHaveBeenCalledTimes(6)
    expect(
      within(gallery()).getAllByText(
        'Se añadieron 2 fotos; 1 quedó fuera: el máximo es 6.',
      ).length,
    ).toBeGreaterThan(0)
    // Con seis, otra selección no añade nada.
    await user.upload(filesInput(container), photoFile(9))
    expect(thumbnails()).toHaveLength(6)
    expect(processPhoto).toHaveBeenCalledTimes(6)
  })

  it('quitar la principal promueve la siguiente, lo anuncia y vuelve a habilitar las acciones', async () => {
    const user = userEvent.setup()
    const { container } = await renderPage()
    await choosePhotos(user, container, 6)
    expect(chooseButton()).toHaveAttribute('aria-disabled', 'true')

    await user.click(
      within(gallery()).getByRole('button', { name: 'Quitar foto principal' }),
    )
    expect(thumbnails()).toEqual([
      'Foto principal',
      'Foto 2 de 5',
      'Foto 3 de 5',
      'Foto 4 de 5',
      'Foto 5 de 5',
    ])
    expect(
      within(gallery()).getByText(
        'Foto quitada: quedan 5 de 6. La siguiente pasa a ser la principal.',
      ),
    ).toHaveAttribute('role', 'status')
    // El foco pasa a la que ocupa su lugar, la nueva principal.
    expect(
      within(gallery()).getByRole('button', { name: 'Quitar foto principal' }),
    ).toHaveFocus()
    expect(chooseButton()).not.toHaveAttribute('aria-disabled')
    expect(within(gallery()).getByText('5 de 6')).toBeInTheDocument()
  })

  it('"La foto principal es en floración" solo aparece con fotos, va en la principal y se quita al quedarse sin fotos', async () => {
    const user = userEvent.setup()
    const { container } = await renderPage()
    await chooseAmabilis(user)
    await user.click(detailsButton())
    expect(bloomChip()).toBeNull()

    await choosePhotos(user, container)
    await user.click(bloomChip() as HTMLElement)
    expect(bloomChip()).toHaveAttribute('aria-pressed', 'true')
    await user.click(
      within(gallery()).getByRole('button', { name: 'Quitar foto principal' }),
    )
    expect(bloomChip()).toBeNull()
    expect(chooseButton()).toHaveFocus()

    await choosePhotos(user, container, 2)
    await user.click(bloomChip() as HTMLElement)
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(lastInsert()).toMatchObject({ photo_in_bloom: true })
    expect(photoRowStore.map((row) => row.in_bloom)).toEqual([true, false])
  })

  it('mientras se preparan las fotos no se puede registrar', async () => {
    let finish: (photo: ProcessedPhoto) => void = () => {}
    processPhoto.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const user = userEvent.setup()
    const { container } = await renderPage()
    await chooseAmabilis(user)
    await user.upload(filesInput(container), photoFile())
    expect(thumbnails()).toEqual(['Foto principal'])
    expect(within(gallery()).getByText('Preparando…')).toBeInTheDocument()
    const busy = screen.getByRole('button', {
      name: PLANT_FORM_TEXT.photosPreparing,
    })
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    await user.click(busy)
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

  it('una foto que no se puede preparar se quita con su motivo; las demás siguen', async () => {
    processPhoto
      .mockImplementationOnce(() => Promise.resolve(processedPhoto()))
      .mockImplementationOnce(() =>
        Promise.reject(new PhotoProcessingError('not-an-image')),
      )
    const user = userEvent.setup()
    const { container } = await renderPage()
    await choosePhotos(user, container, 2)
    expect(thumbnails()).toEqual(['Foto principal'])
    expect(within(gallery()).getByRole('alert')).toHaveTextContent(
      /^No se pudo preparar «IMG_0002\.jpg»\./,
    )
  })

  describe('nombre por validar (#12, #210)', () => {
    it('sin fotos las recomienda, sin exigirlas, y se registra igual', async () => {
      const user = userEvent.setup()
      await renderPage()
      await fillFreeName(user)
      expect(gallery()).toHaveAccessibleDescription(
        `${PLANT_FORM_TEXT.pendingPhotoHint} Más en Privacidad.`,
      )
      await expectNoAxeViolations()

      await user.click(submitButton())
      await waitFor(() => expect(location()).toBe('/coleccion'))
      expect(lastInsert()).not.toHaveProperty('species_id')
      expect(storageUploads()).toEqual([])
    })

    it('con fotos avisa, en plural, de que el equipo del catálogo podrá verlas', async () => {
      const user = userEvent.setup()
      const { container } = await renderPage()
      expect(gallery()).not.toHaveAccessibleDescription()
      await fillFreeName(user)
      await choosePhotos(user, container)
      expect(gallery()).toHaveAccessibleDescription(
        `${PLANT_FORM_TEXT.pendingPhotoNotice(1)} Más en Privacidad.`,
      )
      await choosePhotos(user, container, 2)
      expect(gallery()).toHaveAccessibleDescription(
        'Como el nombre queda por validar, el equipo del catálogo podrá ver estas fotos para identificarla. Más en Privacidad.',
      )
      const link = within(gallery()).getByRole('link', { name: 'Privacidad' })
      expect(link).toHaveAttribute('href', '/privacidad')
      expect(link).not.toHaveAttribute('target')
      await expectNoAxeViolations()

      await user.click(submitButton())
      await waitFor(() => expect(location()).toBe('/coleccion'))
      expect(photoRowStore).toHaveLength(3)
    })

    it('con «Otro» y fotos: guarda el género elegido y las fotos', async () => {
      const user = userEvent.setup()
      const { container } = await renderPage()
      await user.type(nameInput(), 'Miltoniopsis Herr Alexandre')
      await user.click(chip('Otro'))
      await user.type(
        screen.getByRole('combobox', { name: 'Buscar otro género' }),
        'mps',
      )
      await user.click(
        await screen.findByRole('option', { name: /^Miltoniopsis,/ }),
      )
      await user.click(
        within(typeGroup()).getByRole('button', { name: 'Híbrido' }),
      )
      await choosePhotos(user, container, 2)
      expect(gallery()).toHaveAccessibleDescription(/^Como el nombre queda/)
      await user.click(submitButton())
      await waitFor(() => expect(location()).toBe('/coleccion'))
      expect(lastInsert()).toMatchObject({
        entered_name: 'Miltoniopsis Herr Alexandre',
        genus_id: GENERA.miltoniopsis.id,
        type: 'hybrid',
      })
      expect(lastInsert()).not.toHaveProperty('species_id')
      expect(photoRowStore).toHaveLength(2)
    })

    it('con una especie del catálogo no hay aviso', async () => {
      const user = userEvent.setup()
      const { container } = await renderPage()
      await chooseAmabilis(user)
      await choosePhotos(user, container)
      expect(gallery()).not.toHaveAccessibleDescription()
      expect(screen.queryByRole('link', { name: 'Privacidad' })).toBeNull()
    })

    it('el enlace a Privacidad no pierde lo escrito ni las fotos: al volver se recupera el borrador', async () => {
      const user = userEvent.setup()
      const { container } = await renderPage()
      await fillFreeName(user)
      await choosePhotos(user, container, 2)
      await waitFor(() => expect(draftPhotos.entries.size).toBe(1))

      await user.click(screen.getByRole('link', { name: 'Privacidad' }))
      expect(location()).toBe('/privacidad')
      await user.click(screen.getByRole('link', { name: 'Volver al registro' }))

      expect(
        await screen.findByText(PLANT_FORM_TEXT.draftRestored),
      ).toBeInTheDocument()
      expect(nameInput()).toHaveValue('La naranja del mercado')
      await waitFor(() => expect(thumbnails()).toHaveLength(2))
    })
  })

  describe('si falla la subida', () => {
    it('una foto falla: la planta queda registrada, dice cuál y reintenta solo esa, sin duplicar la planta', async () => {
      const user = userEvent.setup()
      const { container } = await renderPage()
      await chooseAmabilis(user)
      await choosePhotos(user, container, 3)
      // Falla la segunda foto (sus dos archivos) hasta que se diga.
      let failing: string | null = null
      let healed = false
      storageUploadResponder = (path) => {
        const version = versionOf(path)
        const seen = [...new Set(storageUploads().map(versionOf))]
        if (failing === null && seen.indexOf(version) === 1) failing = version
        return version === failing && !healed
          ? json({ statusCode: '503', error: 'Error', message: 'Fallo' }, 503)
          : uploaded(path)
      }
      await user.click(submitButton())

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        'Tu orquídea quedó registrada, pero no se pudo subir la foto 2 de 3.',
      )
      expect(alert).toHaveTextContent(PLANT_FORM_TEXT.photosRetryHint)
      expect(within(gallery()).getByText('No se subió')).toBeInTheDocument()
      expect(within(gallery()).getAllByText('Guardada')).toHaveLength(2)
      const retry = screen.getByRole('button', {
        name: PLANT_FORM_TEXT.photosRetry,
      })
      await waitFor(() => expect(retry).toHaveFocus())
      expect(
        screen.getByRole('button', {
          name: PLANT_FORM_TEXT.photosContinueWithout,
        }),
      ).toBeInTheDocument()
      // Ya registrada: no se edita ni se quitan fotos; el borrador ya no está.
      expect(nameInput()).toBeDisabled()
      expect(
        within(gallery()).queryByRole('button', { name: /^Quitar/ }),
      ).toBeNull()
      expect(location()).toBe('/coleccion/nueva')
      expect(plantInserts()).toHaveLength(1)
      const id = String(lastInsert().id)
      expect(photoRowsOf(id)).toHaveLength(2)
      expect(window.localStorage.getItem(draftKey)).toBeNull()
      // La planta recién creada no tiene fotos: no se leen (#285).
      expect(photoRowReads()).toBe(0)
      await expectNoAxeViolations()

      // Reintentar solo esa, desde su miniatura.
      healed = true
      const before = storageUploads().length
      await user.click(
        within(gallery()).getByRole('button', {
          name: 'Reintentar foto 2 de 3',
        }),
      )
      await waitFor(() => expect(location()).toBe('/coleccion'))
      expect(plantInserts()).toHaveLength(1)
      expect(processPhoto).toHaveBeenCalledTimes(3)
      // Solo los dos archivos de la que faltaba, a las mismas rutas.
      const retried = storageUploads().slice(before)
      expect(retried).toHaveLength(2)
      expect(retried.map(versionOf)).toEqual([failing, failing])
      // Conserva su lugar entre las demás.
      expect(photoRowsOf(id).map((row) => row.position)).toEqual([0, 1, 2])
      expect(photoRowInserts()).toHaveLength(3)
      // El reintento sí lee: el intento anterior dejó filas.
      expect(photoRowReads()).toBe(1)
    })

    it('«Reintentar fotos» reintenta todas las que fallaron', async () => {
      failUploads(503)
      const user = userEvent.setup()
      const { container } = await renderPage()
      await chooseAmabilis(user)
      await choosePhotos(user, container, 2)
      await user.click(submitButton())
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        'Tu orquídea quedó registrada, pero no se pudieron subir 2 fotos: la foto principal y la foto 2 de 2.',
      )
      storageUploadResponder = uploaded
      await user.click(
        screen.getByRole('button', { name: PLANT_FORM_TEXT.photosRetry }),
      )
      await waitFor(() => expect(location()).toBe('/coleccion'))
      expect(plantInserts()).toHaveLength(1)
      expect(photoRowStore).toHaveLength(2)
    })

    it('se puede continuar sin ellas: la planta ya está en el inventario', async () => {
      failUploads(503)
      const user = userEvent.setup()
      const { container } = await renderPage()
      await chooseAmabilis(user)
      await choosePhotos(user, container)
      await user.click(submitButton())
      await user.click(
        await screen.findByRole('button', {
          name: PLANT_FORM_TEXT.photosContinueWithout,
        }),
      )
      await waitFor(() => expect(location()).toBe('/coleccion'))
      expect(screen.getAllByRole('article')).toHaveLength(1)
      expect(photoRowStore).toEqual([])
      expect(await screen.findByText(/^Registraste/)).toBeInTheDocument()
    })

    it('con la sesión terminada no ofrece reintentar, solo continuar', async () => {
      failUploads(401)
      const user = userEvent.setup()
      const { container } = await renderPage()
      await chooseAmabilis(user)
      await choosePhotos(user, container)
      await user.click(submitButton())

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(/^Tu orquídea quedó registrada, pero/)
      expect(alert).not.toHaveTextContent(PLANT_FORM_TEXT.photosRetryHint)
      expect(
        screen.queryByRole('button', { name: PLANT_FORM_TEXT.photosRetry }),
      ).toBeNull()
      const continueButton = screen.getByRole('button', {
        name: PLANT_FORM_TEXT.photosContinue,
      })
      await waitFor(() => expect(continueButton).toHaveFocus())
      await user.click(continueButton)
      await waitFor(() => expect(location()).toBe('/coleccion'))
    })

    it('mientras sube no se envía dos veces y se ve el progreso; «Cancelar subida» deja la planta registrada', async () => {
      const release = holdUploads()
      const user = userEvent.setup()
      const { container } = await renderPage()
      await chooseAmabilis(user)
      await choosePhotos(user, container, 2)
      await user.click(submitButton())

      const busy = await screen.findByRole('button', {
        name: PLANT_FORM_TEXT.photosUploadingButton,
      })
      expect(busy).toHaveAttribute('aria-disabled', 'true')
      expect(
        await screen.findByText(
          'Tu orquídea quedó registrada. Subiendo las fotos… (0 de 2)',
        ),
      ).toBeInTheDocument()
      expect(
        within(gallery()).getAllByText(/^Subiendo…/).length,
      ).toBeGreaterThan(0)
      await user.click(busy)
      expect(plantInserts()).toHaveLength(1)

      await user.click(
        screen.getByRole('button', {
          name: PLANT_FORM_TEXT.photosUploadCancel,
        }),
      )
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        PLANT_FORM_TEXT.photosCancelled(PLANT_FORM_TEXT.savedPrefix),
      )
      release()
      await user.click(
        screen.getByRole('button', {
          name: PLANT_FORM_TEXT.photosContinueWithout,
        }),
      )
      await waitFor(() => expect(location()).toBe('/coleccion'))
      expect(plantInserts()).toHaveLength(1)
    })
  })

  describe('borrador con fotos', () => {
    const draftedPhotos = () =>
      draftPhotos.entries.get(
        draftPhotoKey('user_prueba', storedDraft()?.plantId ?? ''),
      )?.photos as { fileName: string }[] | undefined

    it('recargar conserva lo escrito y las fotos en su orden, con el mismo id de planta', async () => {
      const user = userEvent.setup()
      const first = await renderPage()
      await user.type(nameInput(), 'Stanhopea')
      await choosePhotos(user, first.container, 3)
      const saved = storedDraft()
      await waitFor(() => expect(draftedPhotos()).toHaveLength(3))
      expect(
        draftPhotos.entries.get(
          draftPhotoKey('user_prueba', saved?.plantId ?? ''),
        )?.plantId,
      ).toBe(saved?.plantId)
      expect(draftedPhotos()?.map((photo) => photo.fileName)).toEqual([
        'IMG_0001.jpg',
        'IMG_0002.jpg',
        'IMG_0003.jpg',
      ])

      first.unmount()
      await renderPage()
      expect(
        await screen.findByText(PLANT_FORM_TEXT.draftRestored),
      ).toBeInTheDocument()
      expect(nameInput()).toHaveValue('Stanhopea')
      await waitFor(() => expect(thumbnails()).toHaveLength(3))
      // No se vuelven a preparar.
      expect(processPhoto).toHaveBeenCalledTimes(3)
      await expectNoAxeViolations()

      await user.click(chip('Cattleya'))
      await user.click(
        within(typeGroup()).getByRole('button', { name: 'No sé' }),
      )
      await user.click(submitButton())
      await waitFor(() => expect(location()).toBe('/coleccion'))
      expect(lastInsert().id).toBe(saved?.plantId)
      expect(storageUploads()).toHaveLength(6)
      // Guardar borra el borrador y sus fotos.
      expect(window.localStorage.getItem(draftKey)).toBeNull()
      expect(draftPhotos.entries.size).toBe(0)
    })

    it('solo fotos, sin nada escrito, también se conservan; quitarlas todas borra el borrador', async () => {
      const user = userEvent.setup()
      const first = await renderPage()
      await choosePhotos(user, first.container)
      expect(storedDraft()?.plantId).toBeTruthy()
      await waitFor(() => expect(draftPhotos.entries.size).toBe(1))

      first.unmount()
      await renderPage()
      await waitFor(() => expect(thumbnails()).toHaveLength(1))

      await user.click(
        within(gallery()).getByRole('button', {
          name: 'Quitar foto principal',
        }),
      )
      expect(window.localStorage.getItem(draftKey)).toBeNull()
      await waitFor(() => expect(draftPhotos.entries.size).toBe(0))
    })

    it('unas fotos pendientes que no van con el borrador se descartan', async () => {
      await draftPhotos.put('user_prueba', {
        version: 2,
        plantId: '30000000-0000-4000-8000-000000000009',
        savedAt: Date.now(),
        photos: [{ fileName: 'vieja.jpg', photo: processedPhoto() }],
      })
      await renderPage()
      await waitFor(() => expect(draftPhotos.entries.size).toBe(0))
      expect(thumbnails()).toEqual([])
    })

    it('descartar el borrador quita también las fotos', async () => {
      const user = userEvent.setup()
      const first = await renderPage()
      await user.type(nameInput(), 'Stanhopea')
      await choosePhotos(user, first.container, 2)
      first.unmount()
      await renderPage()
      await waitFor(() => expect(thumbnails()).toHaveLength(2))

      await user.click(
        await screen.findByRole('button', {
          name: PLANT_FORM_TEXT.draftDiscard,
        }),
      )
      expect(thumbnails()).toEqual([])
      await waitFor(() => expect(draftPhotos.entries.size).toBe(0))
    })

    it('"Cancelar" con solo una foto pregunta antes de salir', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      const user = userEvent.setup()
      const { container } = await renderPage()
      await choosePhotos(user, container)
      await user.click(screen.getByRole('button', { name: 'Cancelar' }))
      expect(confirm).toHaveBeenCalledWith(PLANT_FORM_TEXT.confirmDiscard)
      expect(location()).toBe('/coleccion/nueva')
    })
  })

  it('la antigua entrada desde la cámara (?foto=1) abre el registro de siempre', async () => {
    await renderPage([], '/coleccion/nueva?foto=1')
    expect(
      screen.getByRole('form', { name: PLANT_FORM_TEXT.title }),
    ).toBeInTheDocument()
    // El nombre va antes que la galería.
    expect(
      nameInput().compareDocumentPosition(gallery()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('sin conexión, la galería sigue activa y las fotos van al borrador (#296)', async () => {
    const user = userEvent.setup()
    const { container } = await renderPage()
    await choosePhotos(user, container)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(chooseButton()).not.toHaveAttribute('aria-disabled')
    await choosePhotos(user, container, 1)
    expect(thumbnails()).toEqual(['Foto principal', 'Foto 2 de 2'])
    await waitFor(() =>
      expect(
        draftPhotos.entries.get(
          draftPhotoKey('user_prueba', storedDraft()?.plantId ?? ''),
        )?.photos,
      ).toHaveLength(2),
    )
    await user.click(
      within(gallery()).getByRole('button', { name: 'Quitar foto 2 de 2' }),
    )
    expect(thumbnails()).toEqual(['Foto principal'])
    await expectNoAxeViolations()
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

    it('con fotos y nombre del catálogo, sin nombres en el evento', async () => {
      const user = userEvent.setup()
      const { container } = await renderPage()
      await chooseAmabilis(user)
      await choosePhotos(user, container, 2)
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

    // #184: has_photo sigue siendo «al menos una foto» con la galería.
    it('con las seis fotos, «con foto»', async () => {
      const user = userEvent.setup()
      const { container } = await renderPage()
      await chooseAmabilis(user)
      await choosePhotos(user, container, 6)
      await user.click(submitButton())
      await waitFor(() => expect(location()).toBe('/coleccion'))
      await waitFor(() => expect(recorded).toHaveLength(1))
      expect(recorded[0]).toMatchObject({ has_photo: true })
    })

    it('si fallan todas las fotos y se sigue sin ellas, «sin foto»', async () => {
      failUploads(401)
      const user = userEvent.setup()
      const { container } = await renderPage()
      await chooseAmabilis(user)
      await choosePhotos(user, container, 2)
      await user.click(submitButton())
      await user.click(
        await screen.findByRole('button', {
          name: PLANT_FORM_TEXT.photosContinue,
        }),
      )
      await waitFor(() => expect(location()).toBe('/coleccion'))
      await waitFor(() => expect(recorded).toHaveLength(1))
      expect(recorded[0]).toMatchObject({ has_photo: false })
    })

    it('sin fotos y con el nombre por validar', async () => {
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
})

describe('NewPlantPage: un borrador y la especie recién elegida (#296)', () => {
  const VANDA: Record<string, unknown> = {
    id: VANDA_COERULEA.id,
    scientificName: 'Vanda coerulea',
    genus: GENERA.vanda,
    type: 'species',
  }
  const fromCatalog = {
    pathname: '/coleccion/nueva',
    search: '?nombre=Vanda+coerulea',
    state: { catalogSpecies: VANDA },
  }
  const fromHaveIt = '/coleccion/nueva?nombre=Vanda%20coerulea'
  const choiceHeading = () =>
    screen.findByRole('heading', { name: PLANT_FORM_TEXT.choiceTitle })
  const continueDraft = (name: RegExp) => screen.findByRole('button', { name })
  const registerVanda = () =>
    screen.findByRole('button', { name: /^Registrar Vanda coerulea/ })

  /** Deja guardado un borrador de «Cattleya maxima» con una foto. */
  async function cattleyaDraft(user: ReturnType<typeof userEvent.setup>) {
    const view = await renderPage()
    await user.type(nameInput(), 'Cattleya maxima')
    await user.click(
      within(genusGroup()).getByRole('button', { name: 'Cattleya' }),
    )
    await choosePhotos(user, view.container)
    const plantId = storedDraft()?.plantId ?? ''
    await waitFor(() =>
      expect(
        draftPhotos.entries.get(draftPhotoKey('user_prueba', plantId)),
      ).toBeDefined(),
    )
    view.unmount()
    return plantId
  }

  const savedDraftNames = () =>
    readPlantDrafts('user_prueba', new Date()).map((d) => d.values.name)

  it('registrar Vanda coerulea teniendo un borrador de Cattleya maxima: desde la ficha del catálogo, se elige y el borrador se conserva con su foto', async () => {
    const user = userEvent.setup()
    const cattleya = await cattleyaDraft(user)

    await renderPage([], fromCatalog, { form: false })
    // Se muestran los dos nombres y se elige; nada se elige por la persona.
    const heading = await choiceHeading()
    await waitFor(() => expect(heading).toHaveFocus())
    expect(screen.queryByRole('combobox', { name: 'Nombre' })).toBeNull()
    expect(
      await continueDraft(/^Continuar borrador Cattleya maxima \(1 foto\)$/),
    ).toBeInTheDocument()
    await expectNoAxeViolations()

    await user.click(await registerVanda())
    // La especie queda enlazada como si se hubiera elegido (#280).
    expect(nameInput()).toHaveValue('Vanda coerulea')
    expect(screen.getByText(PLANT_FORM_TEXT.nameMatch)).toBeInTheDocument()
    expect(chip('Vanda')).toHaveAttribute('aria-pressed', 'true')
    expect(thumbnails()).toEqual([])
    expect(screen.queryByText(PLANT_FORM_TEXT.draftRestored)).toBeNull()
    // El borrador anterior sigue guardado, con su foto.
    expect(await screen.findByText(/sigue guardado\.$/)).toHaveTextContent(
      'Tu borrador de Cattleya maxima (1 foto) sigue guardado.',
    )
    expect(savedDraftNames()).toEqual(['Cattleya maxima'])
    expect(
      draftPhotos.entries.get(draftPhotoKey('user_prueba', cattleya)),
    ).toBeDefined()

    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(lastInsert()).toMatchObject({
      entered_name: 'Vanda coerulea',
      species_id: VANDA_COERULEA.id,
      genus_id: GENERA.vanda.id,
    })
    expect(lastInsert().id).not.toBe(cattleya)
    // Registrar Vanda no tocó el de Cattleya: se retoma al volver.
    expect(savedDraftNames()).toEqual(['Cattleya maxima'])
    await renderPage()
    expect(nameInput()).toHaveValue('Cattleya maxima')
    expect(
      await screen.findByText(PLANT_FORM_TEXT.draftRestored),
    ).toBeInTheDocument()
    await waitFor(() => expect(thumbnails()).toHaveLength(1))
  })

  it('registrar Vanda coerulea teniendo un borrador de Cattleya maxima: desde «¿Ya la tengo?», «Continuar borrador» sigue con Cattleya maxima', async () => {
    const user = userEvent.setup()
    const cattleya = await cattleyaDraft(user)

    await renderPage([], fromHaveIt, { form: false })
    await choiceHeading()
    expect(await registerVanda()).toBeInTheDocument()
    await user.click(await continueDraft(/^Continuar borrador Cattleya maxima/))
    expect(nameInput()).toHaveValue('Cattleya maxima')
    expect(
      await screen.findByText(PLANT_FORM_TEXT.draftRestored),
    ).toBeInTheDocument()
    await waitFor(() => expect(thumbnails()).toHaveLength(1))
    expect(chip('Cattleya')).toHaveAttribute('aria-pressed', 'true')
    expect(storedDraft()?.plantId).toBe(cattleya)
  })

  it('desde «¿Ya la tengo?», «Registrar Vanda coerulea» empieza con ese nombre y lo enlaza si es exacto', async () => {
    const user = userEvent.setup()
    await cattleyaDraft(user)
    speciesRows = [VANDA_COERULEA]

    await renderPage([], fromHaveIt, { form: false })
    await user.click(await registerVanda())
    expect(nameInput()).toHaveValue('Vanda coerulea')
    expect(
      await screen.findByText(PLANT_FORM_TEXT.nameMatch),
    ).toBeInTheDocument()
    // Enlazarse solo no es un cambio de la persona: no crea otro borrador.
    expect(savedDraftNames()).toEqual(['Cattleya maxima'])
  })

  it('con un borrador del mismo nombre (sin tildes ni mayúsculas) o de la misma especie, no pregunta', async () => {
    const user = userEvent.setup()
    const view = await renderPage()
    await user.type(nameInput(), 'vanda  COERULEA')
    view.unmount()

    const same = await renderPage([], fromCatalog)
    expect(screen.queryByText(PLANT_FORM_TEXT.choiceTitle)).toBeNull()
    expect(nameInput()).toHaveValue('vanda  COERULEA')
    expect(
      await screen.findByText(PLANT_FORM_TEXT.draftRestored),
    ).toBeInTheDocument()
    same.unmount()

    // Un borrador ya enlazado a la especie.
    clearPlantDraft('user_prueba')
    const linked = await renderPage([], fromCatalog)
    await user.type(originInput(), 'Vivero Sol')
    linked.unmount()
    await renderPage([], fromHaveIt)
    expect(screen.queryByText(PLANT_FORM_TEXT.choiceTitle)).toBeNull()
    expect(originInput()).toHaveValue('Vivero Sol')
  })

  it('sin borrador no pregunta', async () => {
    await renderPage([], fromCatalog)
    expect(screen.queryByText(PLANT_FORM_TEXT.choiceTitle)).toBeNull()
    expect(nameInput()).toHaveValue('Vanda coerulea')
  })

  it('con dos borradores guardados, para registrar otra hay que continuar o descartar uno; el otro se ofrece al registrar', async () => {
    const user = userEvent.setup()
    const cattleya = await cattleyaDraft(user)
    // El segundo: se elige «Registrar Vanda coerulea» y se escribe algo.
    const second = await renderPage([], fromCatalog, { form: false })
    await user.click(await registerVanda())
    await user.type(originInput(), 'Vivero Sol')
    second.unmount()
    expect(savedDraftNames()).toEqual(['Vanda coerulea', 'Cattleya maxima'])

    await renderPage([], '/coleccion/nueva?nombre=Stanhopea', { form: false })
    await choiceHeading()
    const full = screen.getByRole('button', { name: /^Registrar Stanhopea/ })
    expect(full).toHaveAttribute('aria-disabled', 'true')
    expect(full).toHaveAccessibleName(
      `Registrar Stanhopea ${PLANT_FORM_TEXT.choiceRegisterFull}`,
    )
    await user.click(full)
    expect(screen.queryByRole('combobox', { name: 'Nombre' })).toBeNull()
    await expectNoAxeViolations()

    await user.click(
      screen.getByRole('button', {
        name: 'Descartar el borrador de Vanda coerulea',
      }),
    )
    expect(savedDraftNames()).toEqual(['Cattleya maxima'])
    expect(
      await screen.findByText('Borrador de Vanda coerulea descartado.'),
    ).toBeInTheDocument()
    await user.click(
      await screen.findByRole('button', { name: /^Registrar Stanhopea/ }),
    )
    expect(nameInput()).toHaveValue('Stanhopea')
    // El de Cattleya se puede retomar desde el formulario.
    await user.click(
      await screen.findByRole('button', {
        name: PLANT_FORM_TEXT.otherDraftContinue,
      }),
    )
    expect(nameInput()).toHaveValue('Cattleya maxima')
    await waitFor(() => expect(thumbnails()).toHaveLength(1))
    expect(storedDraft()?.plantId).toBe(cattleya)
  })

  it('la elección se recorre con el teclado', async () => {
    const user = userEvent.setup()
    await cattleyaDraft(user)
    await renderPage([], fromCatalog, { form: false })
    const heading = await choiceHeading()
    await waitFor(() => expect(heading).toHaveFocus())
    await user.tab()
    expect(
      await continueDraft(/^Continuar borrador Cattleya maxima/),
    ).toHaveFocus()
    await user.tab()
    expect(await registerVanda()).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(nameInput()).toHaveValue('Vanda coerulea')
    await waitFor(() => expect(nameInput()).toHaveFocus())
  })
})

describe('NewPlantPage: sin conexión, con la sesión identificada en el dispositivo (#296)', () => {
  const offlineSaved = `${PLANT_FORM_TEXT.offlineTitle} ${PLANT_FORM_TEXT.draftSavedHere(PLANT_FORM_TEXT.whenOnline)}`
  const offlineEmpty = `${PLANT_FORM_TEXT.offlineTitle} ${PLANT_FORM_TEXT.draftWillSaveHere(PLANT_FORM_TEXT.whenOnline)}`

  /** Sin red de verdad: el navegador lo dice y las peticiones fallan. */
  function goOffline() {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    fetchMock.mockImplementation(() =>
      Promise.reject(new TypeError('Failed to fetch')),
    )
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
  }

  function goOnline() {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    fetchMock.mockImplementation(respond)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
  }

  const speciesSearches = () =>
    requests().filter((r) => r.url.pathname === '/rest/v1/rpc/search_species')

  it('perder la conexión mientras se registra una planta: se sigue completando el borrador y el envío espera a que vuelva', async () => {
    const user = userEvent.setup()
    const { container } = await renderPage()
    await user.type(nameInput(), 'La naranja')

    goOffline()
    // Nada se desactiva: se sigue escribiendo.
    expect(nameInput()).toBeEnabled()
    await user.type(nameInput(), ' del mercado')
    expect(nameInput()).toHaveValue('La naranja del mercado')
    expect(nameInput()).toHaveAccessibleDescription(
      PLANT_FORM_TEXT.nameOfflineHint,
    )
    await user.click(
      within(genusGroup()).getByRole('button', { name: 'Cattleya' }),
    )
    await user.click(within(typeGroup()).getByRole('button', { name: 'No sé' }))
    await user.clear(dateInput())
    await user.type(dateInput(), '2026-11-01')
    await user.type(originInput(), 'Feria de Lima')
    await user.click(detailsButton())
    await user.type(locationInput(), 'Balcón')
    await user.type(nicknameInput(), 'La naranja')
    await user.click(chip('Naranja'))
    await choosePhotos(user, container)

    // El aviso dice qué pasa y el botón queda desactivado con su motivo.
    expect(await screen.findByText(/Borrador guardado/)).toHaveTextContent(
      offlineSaved,
    )
    expect(submitButton()).toHaveAttribute('aria-disabled', 'true')
    expect(submitButton()).toHaveAccessibleDescription(offlineSaved)
    await user.click(submitButton())
    expect(plantInserts()).toHaveLength(0)
    expect(storedDraft()?.values).toMatchObject({
      name: 'La naranja del mercado',
      genus: GENERA.cattleya,
      type: 'unknown',
      acquiredOn: '2026-11-01',
      origin: 'Feria de Lima',
      location: 'Balcón',
      nickname: 'La naranja',
      flowerColor: 'orange',
    })
    await waitFor(() =>
      expect(
        draftPhotos.entries.get(
          draftPhotoKey('user_prueba', storedDraft()?.plantId ?? ''),
        )?.photos,
      ).toHaveLength(1),
    )
    await expectNoAxeViolations()

    // Al volver, nada se envía solo: la persona pulsa.
    goOnline()
    expect(screen.queryByText(offlineSaved)).toBeNull()
    expect(submitButton()).not.toHaveAttribute('aria-disabled')
    await waitFor(() => expect(speciesSearches().length).toBeGreaterThan(0))
    expect(plantInserts()).toHaveLength(0)
    await user.click(submitButton())
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(lastInsert()).toMatchObject({
      entered_name: 'La naranja del mercado',
      genus_id: GENERA.cattleya.id,
      type: 'unknown',
      origin: 'Feria de Lima',
    })
  })

  it('sin conexión no se busca en el catálogo; al volver se comprueba el nombre y el exacto se enlaza solo', async () => {
    speciesRows = [AMABILIS]
    const user = userEvent.setup()
    await renderPage()
    goOffline()
    const before = speciesSearches().length
    await user.type(nameInput(), 'Phalaenopsis amabilis')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.queryByText(PLANT_FORM_TEXT.namePendingHint)).toBeNull()
    expect(screen.getByText(PLANT_FORM_TEXT.nameOfflineHint)).toBeVisible()
    expect(speciesSearches()).toHaveLength(before)

    goOnline()
    expect(
      await screen.findByText(PLANT_FORM_TEXT.nameMatch),
    ).toBeInTheDocument()
    expect(chip('Phalaenopsis')).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByText('Enlazada con Phalaenopsis amabilis, del catálogo.'),
    ).toBeInTheDocument()
  })

  it('al volver, lo que la persona eligió sin conexión no cambia: si el género o el tipo no son los de la especie exacta, se ofrece', async () => {
    speciesRows = [AMABILIS]
    const user = userEvent.setup()
    await renderPage()
    goOffline()
    await user.type(nameInput(), 'Phalaenopsis amabilis')
    await user.click(
      within(typeGroup()).getByRole('button', { name: 'Híbrido' }),
    )

    goOnline()
    expect(
      await screen.findByRole('button', {
        name: 'Elegir Phalaenopsis amabilis',
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText(PLANT_FORM_TEXT.nameMatch)).toBeNull()
    expect(
      within(typeGroup()).getByRole('button', { name: 'Híbrido' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('si al abrir el registro hay un borrador y no hay conexión, se retoma igual; los géneros salen de la colección', async () => {
    const user = userEvent.setup()
    const view = await renderPage()
    await user.type(nameInput(), 'Stanhopea')
    view.unmount()

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    fetchMock.mockImplementation(() =>
      Promise.reject(new TypeError('Failed to fetch')),
    )
    clearQuickAccessGeneraCache()
    await renderPage(
      [plant({ genus: GENERA.masdevallia, species: null })],
      '/coleccion/nueva',
      { form: false },
    )
    expect(
      await screen.findByText(PLANT_FORM_TEXT.draftRestored),
    ).toBeInTheDocument()
    expect(nameInput()).toHaveValue('Stanhopea')
    expect(nameInput()).toBeEnabled()
    expect(screen.getByText(offlineSaved)).toBeInTheDocument()
    // Sin los géneros frecuentes (no cargaron), los de la colección.
    await user.click(
      await within(genusGroup()).findByRole('button', { name: 'Masdevallia' }),
    )
    expect(storedDraft()?.values.genus).toEqual(GENERA.masdevallia)
  })

  it('sin conexión con el formulario vacío, dice que lo que se complete se guardará', async () => {
    await renderPage()
    goOffline()
    expect(await screen.findByText(offlineEmpty)).toBeInTheDocument()
    expect(nameInput()).toBeEnabled()
  })

  it('si el dispositivo no puede guardar el borrador, lo dice', async () => {
    const user = userEvent.setup()
    await renderPage()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Lleno', 'QuotaExceededError')
    })
    goOffline()
    await user.type(nameInput(), 'Stanhopea')
    expect(
      await screen.findByText(
        `${PLANT_FORM_TEXT.offlineTitle} ${PLANT_FORM_TEXT.draftNotSavedHere(PLANT_FORM_TEXT.whenOnline)}`,
      ),
    ).toBeInTheDocument()
  })

  it('con la sesión sin confirmar (con red), se completa igual y el envío espera a que se confirme', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/coleccion/nueva']}>
        <CollectionProvider source={source}>
          <SessionUnverifiedContext.Provider value>
            <Routes>
              <Route path="/coleccion/nueva" element={<NewPlantPage />} />
            </Routes>
          </SessionUnverifiedContext.Provider>
        </CollectionProvider>
      </MemoryRouter>,
    )
    await user.type(
      await screen.findByRole('combobox', { name: 'Nombre' }),
      'Sta',
    )
    const notice = `${PLANT_FORM_TEXT.unverifiedTitle} ${PLANT_FORM_TEXT.draftSavedHere(PLANT_FORM_TEXT.whenVerified)}`
    expect(await screen.findByText(notice)).toBeInTheDocument()
    expect(submitButton()).toHaveAttribute('aria-disabled', 'true')
    expect(submitButton()).toHaveAccessibleDescription(notice)
  })
})
