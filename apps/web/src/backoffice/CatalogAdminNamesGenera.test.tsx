import {
  configure,
  getConfig,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
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
import { initSupabase, setSessionTokenSource } from '../lib/supabase.ts'
import { PATHS } from '../routes/paths.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import CatalogAdminPage from './CatalogAdminPage.tsx'
import { findAnnouncement } from '../test/announcement.ts'

// Sinónimos, nombres comunes, géneros y abreviaturas en el backoffice (#107)
// con la API de Supabase simulada (fetch): qué se envía, errores junto al
// campo, confirmaciones, foco, actualización sin recargar y axe.

const CONFIG = {
  supabaseUrl: 'https://ejemplo.supabase.co',
  supabasePublishableKey: 'sb_publishable_clave_de_prueba',
  appEnv: 'dev',
  clerkPublishableKey: 'pk_test_clave_de_prueba',
} as const

const PHAL = '22222222-2222-4222-8222-222222222222'
const MOKARA = '33333333-3333-4333-8333-333333333333'
const SPECIES = '11111111-1111-4111-8111-000000000001'

const SUMMARY = {
  genus_count: 755,
  species_count: 1,
  hybrid_count: 0,
  synonym_count: 1,
  common_name_count: 1,
  imported_count: 1,
  validated_count: 0,
  observed_count: 0,
  col_source_count: 1,
  curated_source_count: 0,
  user_proposal_source_count: 0,
  gbif_source_count: 0,
}

const LIST_ROW = {
  id: SPECIES,
  scientific_name: 'Phalaenopsis amabilis',
  genus_id: PHAL,
  genus_name: 'Phalaenopsis',
  type: 'species',
  status: 'imported',
  source: 'col',
  source_ref: '4FR2J',
  synonym_count: 1,
  common_name_count: 1,
  created_at: '2026-11-20T14:37:00+00:00',
  updated_at: '2026-11-21T08:15:00+00:00',
  total_count: 1,
  has_previous: false,
  has_next: false,
}

const DETAIL = {
  id: SPECIES,
  scientific_name: 'Phalaenopsis amabilis',
  genus_id: PHAL,
  type: 'species',
  status: 'imported',
  source: 'col',
  source_ref: '4FR2J',
  created_at: '2026-11-20T14:37:00+00:00',
  updated_at: '2026-11-21T08:15:00+00:00',
  genera: { name: 'Phalaenopsis' },
  species_names: [
    { id: 'n1', name: 'Doritis pulcherrima', type: 'synonym', language: null },
    { id: 'n2', name: 'orquídea mariposa', type: 'common', language: 'es' },
  ],
}

const GENUS_ROWS = [
  {
    id: PHAL,
    name: 'Phalaenopsis',
    is_quick_access: true,
    abbreviations: ['Phal.'],
    species_count: 92,
    total_count: 2,
    current_page: 1,
  },
  {
    id: MOKARA,
    name: '× Mokara',
    is_quick_access: false,
    abbreviations: ['Mkra.'],
    species_count: 0,
    total_count: 2,
    current_page: 1,
  },
]

function genusDetail(id: string) {
  return id === PHAL
    ? {
        id: PHAL,
        name: 'Phalaenopsis',
        is_quick_access: true,
        genus_abbreviations: [{ id: 'a1', abbreviation: 'Phal.' }],
      }
    : {
        id: MOKARA,
        name: '× Mokara',
        is_quick_access: false,
        genus_abbreviations: [{ id: 'a2', abbreviation: 'Mkra.' }],
      }
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    }),
  )
}

function rejection(
  status: number,
  code: string,
  reason: string,
  extra: Record<string, unknown> = {},
) {
  return jsonResponse(
    {
      code,
      message: 'mensaje de la base',
      details: JSON.stringify({ reason, ...extra }),
    },
    status,
  )
}

const fetchMock = vi.fn<typeof fetch>()

interface SentRequest {
  path: string
  method: string
  url: URL
  body: Record<string, unknown>
}

function requestOf([input, init]: Parameters<typeof fetch>): SentRequest {
  const url = new URL(input instanceof Request ? input.url : String(input))
  return {
    path: url.pathname.replace('/rest/v1/', ''),
    method: init?.method ?? 'GET',
    url,
    body:
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {},
  }
}

function requestsTo(path: string): SentRequest[] {
  return fetchMock.mock.calls
    .map((call) => requestOf(call))
    .filter((request) => request.path === path)
}

type Handler = (request: SentRequest) => Promise<Response>
let handlers: Record<string, Handler>
let speciesInGenus: Record<string, number>

const defaultTimeout = getConfig().asyncUtilTimeout
beforeAll(() => configure({ asyncUtilTimeout: 4000 }))
afterAll(() => configure({ asyncUtilTimeout: defaultTimeout }))

beforeEach(() => {
  document.documentElement.lang = 'es'
  speciesInGenus = { [PHAL]: 92, [MOKARA]: 0 }
  handlers = {
    'rpc/catalog_summary': () => jsonResponse([SUMMARY]),
    'rpc/list_catalog_species': () => jsonResponse([LIST_ROW]),
    'rpc/list_catalog_genera': () => jsonResponse(GENUS_ROWS),
    'rpc/count_species_plants': () => jsonResponse(0),
    'rpc/species_history': () => jsonResponse([]),
    // El detalle de una especie y, con HEAD, el número de especies de un género.
    species: ({ method, url }) => {
      if (method === 'HEAD') {
        const genusId = url.searchParams.get('genus_id')?.slice(3) ?? ''
        return jsonResponse(null, 200, {
          'Content-Range': `*/${speciesInGenus[genusId] ?? 0}`,
        })
      }
      return jsonResponse(DETAIL)
    },
    genera: ({ url }) =>
      jsonResponse(genusDetail(url.searchParams.get('id')?.slice(3) ?? '')),
  }
  fetchMock.mockReset()
  fetchMock.mockImplementation((...args) => {
    const request = requestOf(args)
    const handler = handlers[request.path]
    if (!handler)
      return Promise.reject(new Error(`sin respuesta para ${request.path}`))
    return handler(request)
  })
  vi.stubGlobal('fetch', fetchMock)
  setSessionTokenSource(null)
  initSupabase(CONFIG)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function renderAt(search = '') {
  return render(
    <MemoryRouter initialEntries={[`${PATHS.catalogAdmin}${search}`]}>
      <Routes>
        <Route path={PATHS.catalogAdmin} element={<CatalogAdminPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function openSpecies() {
  renderAt(`?especie=${SPECIES}`)
  return screen.findByRole('region', {
    name: 'Detalle de Phalaenopsis amabilis',
  })
}

async function openGenusPanel(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  renderAt('?pestana=generos')
  await user.click(
    await screen.findByRole('button', { name: `Editar el género ${name}` }),
  )
  return screen.findByRole('region', { name: `Género ${name}` })
}

describe('Backoffice: nombres de una especie', () => {
  it('añade un sinónimo: valida, envía, anuncia, devuelve el foco y relee el detalle', async () => {
    handlers['rpc/add_species_name'] = () =>
      jsonResponse({
        id: 'n3',
        species_id: SPECIES,
        name: 'Phalaenopsis grandiflora',
        type: 'synonym',
        language: null,
      })
    const user = userEvent.setup()
    const panel = await openSpecies()
    const add = await within(panel).findByRole('button', {
      name: 'Añadir sinónimo',
    })
    await user.click(add)
    const form = within(panel).getByRole('form', { name: 'Añadir sinónimo' })
    const field = within(form).getByRole('textbox', { name: 'Sinónimo' })
    expect(field).toHaveFocus()
    expect(
      within(form).queryByRole('textbox', { name: 'Idioma (opcional)' }),
    ).not.toBeInTheDocument()

    await user.click(within(form).getByRole('button', { name: 'Guardar' }))
    expect(field).toHaveAccessibleDescription(/Escribe el nombre\./)
    expect(field).toHaveAttribute('aria-invalid', 'true')
    await expectNoAxeViolations()

    const detailReads = requestsTo('species').length
    await user.type(field, '  Phalaenopsis   grandiflora ')
    await user.click(within(form).getByRole('button', { name: 'Guardar' }))
    expect(
      await findAnnouncement(
        'Se añadió el sinónimo «Phalaenopsis grandiflora» a «Phalaenopsis amabilis».',
      ),
    ).toBeInTheDocument()
    expect(requestsTo('rpc/add_species_name')[0]?.body).toEqual({
      target_species_id: SPECIES,
      new_name: 'Phalaenopsis grandiflora',
      new_type: 'synonym',
    })
    await waitFor(() =>
      expect(
        within(panel).getByRole('button', { name: 'Añadir sinónimo' }),
      ).toHaveFocus(),
    )
    await waitFor(() =>
      expect(requestsTo('species').length).toBeGreaterThan(detailReads),
    )
  })

  it('añadir un nombre común relee solo lo que cambia (#285)', async () => {
    handlers['rpc/add_species_name'] = () =>
      jsonResponse({
        id: 'n3',
        species_id: SPECIES,
        name: 'flor de mayo',
        type: 'common',
        language: null,
      })
    const user = userEvent.setup()
    const panel = await openSpecies()
    await user.click(
      await within(panel).findByRole('button', { name: 'Añadir nombre común' }),
    )
    const form = within(panel).getByRole('form', {
      name: 'Añadir nombre común',
    })
    await user.type(
      within(form).getByRole('textbox', { name: 'Nombre común' }),
      'flor de mayo',
    )
    // Todo lo leído al abrir ya llegó.
    await waitFor(() =>
      expect(requestsTo('rpc/species_history')).toHaveLength(1),
    )
    const before = fetchMock.mock.calls.length
    await user.click(within(form).getByRole('button', { name: 'Guardar' }))
    expect(
      await findAnnouncement(
        'Se añadió el nombre común «flor de mayo» a «Phalaenopsis amabilis».',
      ),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(requestsTo('rpc/species_history')).toHaveLength(2),
    )
    // Las lecturas que salieron tras la escritura, por ruta.
    const reads = fetchMock.mock.calls
      .slice(before)
      .map((call) => requestOf(call).path)
      .filter((path) => path !== 'rpc/add_species_name')
      .sort()
    expect(reads).toMatchInlineSnapshot(`
      [
        "rpc/catalog_summary",
        "rpc/count_proposal_groups",
        "rpc/count_species_plants",
        "rpc/list_catalog_species",
        "rpc/species_history",
        "species",
      ]
    `)
  })

  it('un nombre común con idioma mal escrito: el error va junto al idioma', async () => {
    handlers['rpc/add_species_name'] = () =>
      rejection(400, '22023', 'invalid_language')
    const user = userEvent.setup()
    const panel = await openSpecies()
    await user.click(
      await within(panel).findByRole('button', { name: 'Añadir nombre común' }),
    )
    const form = within(panel).getByRole('form', {
      name: 'Añadir nombre común',
    })
    await user.type(
      within(form).getByRole('textbox', { name: 'Nombre común' }),
      'flor de mayo',
    )
    const language = within(form).getByRole('textbox', {
      name: 'Idioma (opcional)',
    })
    await user.type(language, 'español')
    await user.click(within(form).getByRole('button', { name: 'Guardar' }))
    await waitFor(() =>
      expect(language).toHaveAttribute('aria-invalid', 'true'),
    )
    expect(language).toHaveFocus()
    expect(language).toHaveAccessibleDescription(
      /El idioma es una etiqueta corta/,
    )
    expect(requestsTo('rpc/add_species_name')[0]?.body).toEqual({
      target_species_id: SPECIES,
      new_name: 'flor de mayo',
      new_type: 'common',
      new_language: 'español',
    })
    await expectNoAxeViolations()
  })

  it('edita un nombre (también su tipo) y un duplicado se explica junto al campo', async () => {
    let attempts = 0
    handlers['rpc/update_species_name'] = () => {
      attempts += 1
      return attempts === 1
        ? rejection(409, '23505', 'duplicate_alternative_name', {
            existing_name: 'orquídea mariposa',
            existing_type: 'common',
          })
        : jsonResponse({
            id: 'n1',
            species_id: SPECIES,
            name: 'Doritis pulcherrima',
            type: 'common',
            language: null,
          })
    }
    const user = userEvent.setup()
    const panel = await openSpecies()
    await user.click(
      await within(panel).findByRole('button', {
        name: 'Editar el sinónimo Doritis pulcherrima',
      }),
    )
    const form = within(panel).getByRole('form', {
      name: 'Editar el sinónimo Doritis pulcherrima',
    })
    const field = within(form).getByRole('textbox', { name: 'Sinónimo' })
    expect(field).toHaveValue('Doritis pulcherrima')
    await user.clear(field)
    await user.type(field, 'Orquídea Mariposa')
    await user.click(within(form).getByRole('button', { name: 'Guardar' }))
    await waitFor(() =>
      expect(field).toHaveAccessibleDescription(
        /La especie ya tiene este nombre: «orquídea mariposa» \(nombre común\)/,
      ),
    )
    expect(field).toHaveFocus()

    await user.clear(field)
    await user.type(field, 'Doritis pulcherrima')
    await user.selectOptions(
      within(form).getByRole('combobox', { name: 'Tipo de nombre' }),
      'common',
    )
    await user.click(within(form).getByRole('button', { name: 'Guardar' }))
    expect(
      await findAnnouncement('Se guardó el nombre «Doritis pulcherrima».'),
    ).toBeInTheDocument()
    expect(requestsTo('rpc/update_species_name')[1]?.body).toEqual({
      target_name_id: 'n1',
      new_name: 'Doritis pulcherrima',
      new_type: 'common',
    })
  })

  it('quita un nombre tras confirmar y el foco va a "Añadir" de su lista', async () => {
    handlers['rpc/delete_species_name'] = () => jsonResponse(null, 204)
    const user = userEvent.setup()
    const panel = await openSpecies()
    await user.click(
      await within(panel).findByRole('button', {
        name: 'Quitar el nombre común orquídea mariposa',
      }),
    )
    const dialog = screen.getByRole('alertdialog', {
      name: 'Quitar el nombre común «orquídea mariposa»',
    })
    expect(
      within(dialog).getByRole('button', { name: 'Cancelar' }),
    ).toHaveFocus()
    await expectNoAxeViolations()
    await user.click(within(dialog).getByRole('button', { name: 'Quitar' }))
    expect(
      await findAnnouncement(
        'Se quitó el nombre común «orquídea mariposa» de «Phalaenopsis amabilis».',
      ),
    ).toBeInTheDocument()
    expect(requestsTo('rpc/delete_species_name')[0]?.body).toEqual({
      target_name_id: 'n2',
    })
    await waitFor(() =>
      expect(
        within(panel).getByRole('button', { name: 'Añadir nombre común' }),
      ).toHaveFocus(),
    )
  })
})

describe('Backoffice: géneros y abreviaturas', () => {
  it('crea un género (nothogénero de acceso rápido) y abre su panel', async () => {
    handlers['rpc/create_catalog_genus'] = () =>
      jsonResponse({
        id: MOKARA,
        name: '× Mokara',
        is_quick_access: true,
        photo_path: null,
      })
    const user = userEvent.setup()
    renderAt('?pestana=generos')
    await user.click(
      await screen.findByRole('button', { name: 'Añadir género' }),
    )
    const form = screen.getByRole('form', { name: 'Añadir género' })
    const name = within(form).getByRole('textbox', {
      name: 'Nombre del género',
    })
    expect(name).toHaveFocus()
    await user.type(name, '×Mokara')
    await user.click(
      within(form).getByRole('checkbox', {
        name: 'Acceso rápido en el registro',
      }),
    )
    await expectNoAxeViolations()
    const listReads = requestsTo('rpc/list_catalog_genera').length
    await user.click(
      within(form).getByRole('button', { name: 'Crear el género' }),
    )
    expect(
      await findAnnouncement('Se creó el género «× Mokara», de acceso rápido.'),
    ).toBeInTheDocument()
    expect(requestsTo('rpc/create_catalog_genus')[0]?.body).toEqual({
      new_name: '× Mokara',
      new_is_quick_access: true,
    })
    const panel = await screen.findByRole('region', { name: 'Género × Mokara' })
    await waitFor(() =>
      expect(within(panel).getByRole('heading', { level: 2 })).toHaveFocus(),
    )
    await waitFor(() =>
      expect(requestsTo('rpc/list_catalog_genera').length).toBeGreaterThan(
        listReads,
      ),
    )
  })

  it('renombra y quita el acceso rápido tras una confirmación que dice a quién afecta', async () => {
    handlers['rpc/update_catalog_genus'] = () =>
      jsonResponse({
        id: PHAL,
        name: 'Phalaenopsis',
        is_quick_access: false,
        photo_path: null,
      })
    const user = userEvent.setup()
    const panel = await openGenusPanel(user, 'Phalaenopsis')
    const quick = await within(panel).findByRole('checkbox', {
      name: 'Acceso rápido en el registro',
    })
    expect(quick).toBeChecked()
    expect(quick).toHaveAccessibleDescription(
      'Sale como chip en el formulario de registro de todos los usuarios.',
    )
    expect(
      within(panel).getByText(/No se puede borrar: tiene 92 especies/),
    ).toBeInTheDocument()
    expect(
      within(panel).queryByRole('button', { name: 'Borrar el género' }),
    ).not.toBeInTheDocument()
    await user.click(quick)
    await user.click(
      within(panel).getByRole('button', { name: 'Guardar el género' }),
    )
    const dialog = screen.getByRole('alertdialog', {
      name: 'Quitar «Phalaenopsis» del acceso rápido',
    })
    expect(dialog).toHaveAccessibleDescription(
      /dejará de aparecer como chip de acceso rápido en el formulario de registro de todos los usuarios/,
    )
    await expectNoAxeViolations()
    await user.click(
      within(dialog).getByRole('button', { name: 'Quitar del acceso rápido' }),
    )
    expect(
      await findAnnouncement(
        '«Phalaenopsis» ya no sale como chip de acceso rápido en el registro.',
      ),
    ).toBeInTheDocument()
    expect(requestsTo('rpc/update_catalog_genus')[0]?.body).toEqual({
      target_genus_id: PHAL,
      new_name: 'Phalaenopsis',
      new_is_quick_access: false,
    })
  })

  it('un nombre que solo cambia en el signo se explica junto al campo', async () => {
    handlers['rpc/update_catalog_genus'] = () =>
      rejection(409, '23505', 'similar_genus', {
        existing_name: 'Mokara',
      })
    const user = userEvent.setup()
    const panel = await openGenusPanel(user, '× Mokara')
    const name = await within(panel).findByRole('textbox', {
      name: 'Nombre del género',
    })
    await user.clear(name)
    await user.type(name, 'Mokara')
    await user.click(
      within(panel).getByRole('button', { name: 'Guardar el género' }),
    )
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'))
    expect(name).toHaveAccessibleDescription(
      /Ya hay un género que se escribe casi igual: «Mokara»/,
    )
    expect(name).toHaveFocus()
  })

  it('abreviaturas: añade con su punto, el choque nombra el género, y quita', async () => {
    let attempts = 0
    handlers['rpc/add_genus_abbreviation'] = () => {
      attempts += 1
      return attempts === 1
        ? rejection(409, '23505', 'abbreviation_taken', {
            genus_name: 'Phalaenopsis',
            existing_abbreviation: 'Phal.',
          })
        : jsonResponse({ id: 'a3', genus_id: MOKARA, abbreviation: 'Mok.' })
    }
    handlers['rpc/delete_genus_abbreviation'] = () => jsonResponse(null, 204)
    const user = userEvent.setup()
    const panel = await openGenusPanel(user, '× Mokara')
    await user.click(
      await within(panel).findByRole('button', { name: 'Añadir abreviatura' }),
    )
    const form = within(panel).getByRole('form', { name: 'Añadir abreviatura' })
    const field = within(form).getByRole('textbox', { name: 'Abreviatura' })
    await user.type(field, 'phal')
    await user.click(within(form).getByRole('button', { name: 'Guardar' }))
    await waitFor(() =>
      expect(field).toHaveAccessibleDescription(
        /La abreviatura «Phal\.» ya es del género Phalaenopsis/,
      ),
    )
    expect(requestsTo('rpc/add_genus_abbreviation')[0]?.body).toEqual({
      target_genus_id: MOKARA,
      new_abbreviation: 'phal.',
    })
    await expectNoAxeViolations()

    await user.clear(field)
    await user.type(field, 'Mok')
    await user.click(within(form).getByRole('button', { name: 'Guardar' }))
    expect(
      await findAnnouncement('Se añadió la abreviatura «Mok.» a × Mokara.'),
    ).toBeInTheDocument()

    await user.click(
      within(panel).getByRole('button', {
        name: 'Quitar la abreviatura Mkra.',
      }),
    )
    const dialog = screen.getByRole('alertdialog', {
      name: 'Quitar la abreviatura «Mkra.»',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Quitar' }))
    expect(
      await findAnnouncement('Se quitó la abreviatura «Mkra.» de × Mokara.'),
    ).toBeInTheDocument()
    expect(requestsTo('rpc/delete_genus_abbreviation')[0]?.body).toEqual({
      target_abbreviation_id: 'a2',
    })
  })

  it('borra un género sin especies tras confirmar y cierra su panel', async () => {
    handlers['rpc/delete_catalog_genus'] = () => jsonResponse(null, 204)
    const user = userEvent.setup()
    const panel = await openGenusPanel(user, '× Mokara')
    await user.click(
      await within(panel).findByRole('button', { name: 'Borrar el género' }),
    )
    const dialog = screen.getByRole('alertdialog', {
      name: 'Borrar el género «× Mokara»',
    })
    expect(dialog).toHaveTextContent(
      'Se borran también sus abreviaturas (Mkra.).',
    )
    await user.click(
      within(dialog).getByRole('button', { name: 'Borrar del catálogo' }),
    )
    expect(
      await findAnnouncement('Se borró el género «× Mokara» del catálogo.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Género × Mokara' }),
    ).not.toBeInTheDocument()
    expect(requestsTo('rpc/delete_catalog_genus')[0]?.body).toEqual({
      target_genus_id: MOKARA,
    })
  })

  it('si la base dice que hay plantas con el género, lo explica en el diálogo', async () => {
    handlers['rpc/delete_catalog_genus'] = () =>
      rejection(409, '23503', 'genus_has_plants', { plant_count: 2 })
    const user = userEvent.setup()
    const panel = await openGenusPanel(user, '× Mokara')
    await user.click(
      await within(panel).findByRole('button', { name: 'Borrar el género' }),
    )
    const dialog = screen.getByRole('alertdialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'Borrar del catálogo' }),
    )
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'No se puede borrar: 2 plantas de usuarios están registradas con este género.',
    )
  })
})
