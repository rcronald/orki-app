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
import type { CollectionPlantRow } from '../collection/model.ts'
import { initSupabase, setSessionTokenSource } from '../lib/supabase.ts'
import { localDateString } from '../lib/localDate.ts'
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
import { expectNoAxeViolations } from '../test/axe.ts'
import { resetFakeClerk, setFakeClerk } from '../test/clerk-mock.tsx'
import {
  fakeCollectionSource,
  type FakeCollectionSource,
} from '../test/collection-source.ts'
import { CollectionPage } from './CollectionPage.tsx'
import NewPlantPage from './NewPlantPage.tsx'

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

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

async function renderPage() {
  const view = render(
    <MemoryRouter initialEntries={['/coleccion', '/coleccion/nueva']}>
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
  // La colección del usuario (vacía) y los géneros de acceso rápido.
  await act(async () => {
    source.last().resolve([])
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
    expect(await screen.findByText(/Registraste/)).toHaveTextContent(
      'Registraste La naranja del mercado en tu colección.',
    )
    expect(screen.getByText('Nombre por validar')).toBeInTheDocument()
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
    await user.tab()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    await user.tab()
    expect(submitButton()).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(location()).toBe('/coleccion'))
    expect(lastInsert().species_id).toBe(AMABILIS.id)
  })
})
