import {
  configure,
  getConfig,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
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
import { initSupabase, setSessionTokenSource } from '../lib/supabase.ts'
import { PATHS } from '../routes/paths.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import CatalogAdminPage from './CatalogAdminPage.tsx'

// Escrituras del backoffice del catálogo (#106) con la API de Supabase
// simulada (fetch): alta, edición con aviso de propagación, baja, cambio de
// estado por lote, errores junto al campo, actualización sin recargar,
// teclado y axe en cada estado.

const CONFIG = {
  supabaseUrl: 'https://ejemplo.supabase.co',
  supabasePublishableKey: 'sb_publishable_clave_de_prueba',
  appEnv: 'dev',
  clerkPublishableKey: 'pk_test_clave_de_prueba',
} as const

const PHAL = '22222222-2222-4222-8222-222222222222'
const VANDA = '33333333-3333-4333-8333-333333333333'
const NEW_ID = '44444444-4444-4444-8444-444444444444'

function speciesId(index: number): string {
  return `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`
}

function speciesRow(index: number, extra: Record<string, unknown> = {}) {
  return {
    id: speciesId(index),
    scientific_name: `Phalaenopsis especie${String(index).padStart(3, '0')}`,
    genus_id: PHAL,
    genus_name: 'Phalaenopsis',
    type: 'species',
    status: index % 2 === 0 ? 'validated' : 'imported',
    source: 'col',
    source_ref: `4F${index}`,
    synonym_count: 0,
    common_name_count: 0,
    created_at: '2026-11-20T14:37:00+00:00',
    updated_at: '2026-11-21T08:15:00+00:00',
    ...extra,
  }
}

function listPage(from: number, to: number, total: number) {
  return Array.from({ length: to - from + 1 }, (_, offset) =>
    speciesRow(from + offset, {
      total_count: total,
      has_previous: from > 1,
      has_next: to < total,
    }),
  )
}

const SUMMARY = {
  genus_count: 755,
  species_count: 31056,
  hybrid_count: 1408,
  synonym_count: 60000,
  common_name_count: 0,
  imported_count: 32464,
  validated_count: 0,
  observed_count: 0,
  col_source_count: 32464,
  curated_source_count: 0,
  user_proposal_source_count: 0,
  gbif_source_count: 0,
}

function detail(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    scientific_name: 'Phalaenopsis especie001',
    genus_id: PHAL,
    type: 'species',
    status: 'imported',
    source: 'col',
    source_ref: '4F1',
    created_at: '2026-11-20T14:37:00+00:00',
    updated_at: '2026-11-21T08:15:00+00:00',
    genera: { name: 'Phalaenopsis' },
    species_names: [
      {
        id: 'n1',
        name: 'Doritis pulcherrima',
        type: 'synonym',
        language: null,
      },
    ],
    ...extra,
  }
}

function writtenRow(extra: Record<string, unknown> = {}) {
  return {
    id: speciesId(1),
    scientific_name: 'Phalaenopsis especie001',
    genus_id: PHAL,
    type: 'species',
    status: 'validated',
    source: 'col',
    source_ref: '4F1',
    created_at: '2026-11-20T14:37:00+00:00',
    updated_at: '2026-11-21T08:15:00+00:00',
    ...extra,
  }
}

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
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
  url: URL
  body: Record<string, unknown>
}

function requestOf([input, init]: Parameters<typeof fetch>): SentRequest {
  const url = new URL(input instanceof Request ? input.url : String(input))
  return {
    path: url.pathname.replace('/rest/v1/', ''),
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

// Cada prueba encadena varias peticiones (guardar y volver a leer): con toda la
// suite en marcha, el segundo de espera por defecto se queda corto.
const defaultTimeout = getConfig().asyncUtilTimeout
beforeAll(() => configure({ asyncUtilTimeout: 4000 }))
afterAll(() => configure({ asyncUtilTimeout: defaultTimeout }))

beforeEach(() => {
  document.documentElement.lang = 'es'
  handlers = {
    'rpc/catalog_summary': () => jsonResponse([SUMMARY]),
    'rpc/list_catalog_species': ({ body }) =>
      body.after_id === speciesId(50)
        ? jsonResponse(listPage(51, 100, 120))
        : jsonResponse(listPage(1, 50, 120)),
    'rpc/count_species_plants': () => jsonResponse(3),
    'rpc/species_history': () => jsonResponse([]),
    'rpc/search_genera': () =>
      jsonResponse([
        {
          id: VANDA,
          name: 'Vanda',
          is_quick_access: true,
          matched_abbreviation: null,
        },
      ]),
    species: ({ url }) =>
      jsonResponse(detail(url.searchParams.get('id')?.slice(3) ?? '')),
    genera: () => jsonResponse({ id: PHAL, name: 'Phalaenopsis' }),
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

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="ubicacion">{location.search}</output>
}

function renderAt(search = '') {
  return render(
    <MemoryRouter initialEntries={[`${PATHS.catalogAdmin}${search}`]}>
      <Routes>
        <Route path={PATHS.catalogAdmin} element={<CatalogAdminPage />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  )
}

function currentSearch(): URLSearchParams {
  return new URLSearchParams(screen.getByTestId('ubicacion').textContent ?? '')
}

async function waitForTable() {
  await screen.findByRole('link', { name: 'Phalaenopsis especie001' })
}

/** Elige un género en el buscador de géneros de un formulario. */
async function pickGenus(
  user: ReturnType<typeof userEvent.setup>,
  form: HTMLElement,
  text: string,
  option: RegExp,
) {
  await user.type(within(form).getByRole('combobox', { name: 'Género' }), text)
  await user.click(await screen.findByRole('option', { name: option }))
}

async function openDetail(user: ReturnType<typeof userEvent.setup>) {
  await waitForTable()
  await user.click(
    screen.getByRole('link', { name: 'Phalaenopsis especie001' }),
  )
  return screen.findByRole(
    'region',
    { name: 'Detalle de Phalaenopsis especie001' },
    { timeout: 3000 },
  )
}

describe('Backoffice: escritura de especies', () => {
  it('alta: valida antes de enviar, envía el formulario y abre la especie nueva', async () => {
    handlers['rpc/create_catalog_species'] = () =>
      jsonResponse(
        writtenRow({
          id: NEW_ID,
          scientific_name: 'Vanda tricolor',
          genus_id: VANDA,
          source: 'curated',
          source_ref: null,
        }),
      )
    const user = userEvent.setup()
    renderAt('?estado=validated')
    await waitForTable()
    const listCalls = requestsTo('rpc/list_catalog_species').length
    const summaryCalls = requestsTo('rpc/catalog_summary').length

    await user.click(
      screen.getByRole('button', { name: 'Añadir especie o híbrido' }),
    )
    const heading = screen.getByRole('heading', { name: 'Alta en el catálogo' })
    await waitFor(() => expect(heading).toHaveFocus())
    const form = screen.getByRole('form', { name: 'Nueva especie o híbrido' })
    expect(
      within(form).queryByRole('option', { name: 'Importada' }),
    ).not.toBeInTheDocument()
    await expectNoAxeViolations()

    // Sin nombre: el error va junto al campo y se lleva el foco.
    await user.click(within(form).getByRole('button', { name: 'Dar de alta' }))
    const name = within(form).getByRole('textbox', {
      name: 'Nombre científico',
    })
    expect(name).toHaveFocus()
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription(/Escribe el nombre científico\./)
    expect(requestsTo('rpc/create_catalog_species')).toHaveLength(0)
    await expectNoAxeViolations()

    // Al elegir el género con el nombre vacío, el nombre empieza por él.
    await pickGenus(user, form, 'van', /Vanda/)
    expect(name).toHaveValue('Vanda ')
    await user.type(name, '  tricolor ')
    await user.click(within(form).getByRole('button', { name: 'Dar de alta' }))

    await waitFor(() =>
      expect(requestsTo('rpc/create_catalog_species')).toHaveLength(1),
    )
    expect(requestsTo('rpc/create_catalog_species')[0]?.body).toEqual({
      new_scientific_name: 'Vanda tricolor',
      new_genus_id: VANDA,
      new_type: 'species',
      new_status: 'validated',
    })
    expect(
      await screen.findByText(
        'Se dio de alta «Vanda tricolor» (especie, validada).',
      ),
    ).toBeInTheDocument()
    // La especie nueva se abre en el detalle; la búsqueda y los filtros siguen.
    await waitFor(() => expect(currentSearch().get('especie')).toBe(NEW_ID))
    expect(currentSearch().get('estado')).toBe('validated')
    // La tabla y el resumen se vuelven a leer sin recargar la página.
    await waitFor(() =>
      expect(requestsTo('rpc/list_catalog_species').length).toBeGreaterThan(
        listCalls,
      ),
    )
    expect(requestsTo('rpc/catalog_summary').length).toBeGreaterThan(
      summaryCalls,
    )
    expect(
      screen.getByRole('link', { name: 'Phalaenopsis especie001' }),
    ).toBeInTheDocument()
  })

  it('alta: un nombre que ya existe se explica junto al campo', async () => {
    handlers['rpc/create_catalog_species'] = () =>
      rejection(409, '23505', 'similar_name', {
        existing_name: 'Phalaenopsis × intermedia',
      })
    const user = userEvent.setup()
    renderAt()
    await waitForTable()
    await user.click(
      screen.getByRole('button', { name: 'Añadir especie o híbrido' }),
    )
    const form = screen.getByRole('form', { name: 'Nueva especie o híbrido' })
    await pickGenus(user, form, 'van', /Vanda/)
    const name = within(form).getByRole('textbox', {
      name: 'Nombre científico',
    })
    await user.clear(name)
    await user.type(name, 'Phalaenopsis intermedia')
    await user.click(within(form).getByRole('button', { name: 'Dar de alta' }))
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'))
    expect(name).toHaveFocus()
    expect(name).toHaveAccessibleDescription(
      /Ya hay una especie que se escribe casi igual: «Phalaenopsis × intermedia»\./,
    )
    await expectNoAxeViolations()

    // Cancelar devuelve el foco al botón de alta.
    await user.click(within(form).getByRole('button', { name: 'Cancelar' }))
    expect(
      screen.getByRole('button', { name: 'Añadir especie o híbrido' }),
    ).toHaveFocus()
  })

  it('edición: avisa de las plantas afectadas, confirma con un diálogo accesible y anuncia que pasó a validada', async () => {
    handlers['rpc/update_catalog_species'] = () =>
      jsonResponse(writtenRow({ type: 'hybrid', status: 'validated' }))
    const user = userEvent.setup()
    renderAt()
    const panel = await openDetail(user)
    await user.click(
      await within(panel).findByRole('button', { name: 'Editar la especie' }),
    )
    const form = within(panel).getByRole('form', { name: 'Editar la especie' })
    expect(
      within(form).getByText(/Es una especie importada/),
    ).toBeInTheDocument()
    await user.selectOptions(
      within(form).getByRole('combobox', { name: 'Tipo' }),
      'hybrid',
    )
    expect(
      within(form).getByText(
        'Este cambio se aplicará también a 3 plantas de usuarios enlazadas: tomarán el género y el tipo nuevos.',
      ),
    ).toBeInTheDocument()
    expect(
      within(form).getByText('Al guardar quedará «Validada».'),
    ).toBeInTheDocument()
    await expectNoAxeViolations()

    const save = within(form).getByRole('button', { name: 'Guardar cambios' })
    await user.click(save)
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Cambiar también las plantas de los usuarios',
    })
    expect(dialog).toHaveAccessibleDescription(
      /3 plantas de usuarios tienen enlazada esta especie\./,
    )
    expect(dialog).toHaveTextContent('pasarán a ser de tipo «Híbrido»')
    const confirm = within(dialog).getByRole('button', {
      name: 'Guardar y actualizar las plantas',
    })
    expect(confirm).toHaveFocus()
    // El foco no sale del diálogo.
    await user.tab()
    expect(
      within(dialog).getByRole('button', { name: 'Cancelar' }),
    ).toHaveFocus()
    await user.tab()
    expect(confirm).toHaveFocus()
    await expectNoAxeViolations()
    // Escape cancela y el foco vuelve a "Guardar cambios".
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() => expect(save).toHaveFocus())
    expect(requestsTo('rpc/update_catalog_species')).toHaveLength(0)

    await user.click(save)
    await user.click(
      await screen.findByRole('button', {
        name: 'Guardar y actualizar las plantas',
      }),
    )
    await waitFor(() =>
      expect(requestsTo('rpc/update_catalog_species')).toHaveLength(1),
    )
    expect(requestsTo('rpc/update_catalog_species')[0]?.body).toEqual({
      target_species_id: speciesId(1),
      new_scientific_name: 'Phalaenopsis especie001',
      new_genus_id: PHAL,
      new_type: 'hybrid',
      new_status: 'imported',
    })
    expect(
      await screen.findByText(/Pasó a «Validada» porque era importada/),
    ).toBeInTheDocument()
    // El detalle vuelve a leerse y sale de la edición.
    await waitFor(() => expect(requestsTo('species').length).toBeGreaterThan(1))
    expect(
      within(panel).queryByRole('form', { name: 'Editar la especie' }),
    ).not.toBeInTheDocument()
  })

  it('edición: el cambio de solo el estado no pide confirmación', async () => {
    handlers['rpc/update_catalog_species'] = () =>
      jsonResponse(writtenRow({ status: 'observed' }))
    const user = userEvent.setup()
    renderAt()
    const panel = await openDetail(user)
    await user.click(
      await within(panel).findByRole('button', { name: 'Editar la especie' }),
    )
    const form = within(panel).getByRole('form', { name: 'Editar la especie' })
    await user.selectOptions(
      within(form).getByRole('combobox', { name: 'Estado' }),
      'observed',
    )
    await user.click(
      within(form).getByRole('button', { name: 'Guardar cambios' }),
    )
    expect(
      await screen.findByText('«Phalaenopsis especie001» pasó a «Observada».'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(requestsTo('rpc/update_catalog_species')[0]?.body).toMatchObject({
      new_type: 'species',
      new_status: 'observed',
    })
  })

  it('baja: con plantas se explica y no se ofrece', async () => {
    const user = userEvent.setup()
    renderAt()
    const panel = await openDetail(user)
    expect(
      await within(panel).findByText(
        /No se puede borrar: 3 plantas de usuarios/,
      ),
    ).toHaveTextContent('fusionarla con otra especie')
    expect(
      within(panel).queryByRole('button', { name: 'Borrar la especie' }),
    ).not.toBeInTheDocument()
    expect(
      within(panel).getByRole('button', { name: 'Fusionar con otra especie' }),
    ).toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('baja: sin plantas, confirma, borra, cierra el detalle y actualiza la tabla', async () => {
    handlers['rpc/count_species_plants'] = () => jsonResponse(0)
    handlers['rpc/delete_catalog_species'] = () =>
      Promise.resolve(new Response(null, { status: 204 }))
    const user = userEvent.setup()
    renderAt()
    const panel = await openDetail(user)
    await user.click(
      await within(panel).findByRole('button', { name: 'Borrar la especie' }),
    )
    const dialog = screen.getByRole('alertdialog', {
      name: 'Borrar «Phalaenopsis especie001»',
    })
    expect(dialog).toHaveTextContent(
      'junto con 1 sinónimo. No se puede deshacer.',
    )
    // En una acción destructiva el foco empieza en "Cancelar".
    expect(
      within(dialog).getByRole('button', { name: 'Cancelar' }),
    ).toHaveFocus()
    await expectNoAxeViolations()
    const listCalls = requestsTo('rpc/list_catalog_species').length
    await user.click(
      within(dialog).getByRole('button', { name: 'Borrar del catálogo' }),
    )
    expect(
      await screen.findByText(
        'Se borró «Phalaenopsis especie001» del catálogo.',
      ),
    ).toBeInTheDocument()
    expect(requestsTo('rpc/delete_catalog_species')[0]?.body).toEqual({
      target_species_id: speciesId(1),
    })
    // La URL la actualiza el router en su propio pintado.
    await waitFor(() => expect(currentSearch().get('especie')).toBeNull())
    await waitFor(() =>
      expect(requestsTo('rpc/list_catalog_species').length).toBeGreaterThan(
        listCalls,
      ),
    )
  })

  it('baja: si la base dice que ya tiene plantas, lo explica en el diálogo', async () => {
    handlers['rpc/count_species_plants'] = () => jsonResponse(0)
    handlers['rpc/delete_catalog_species'] = () =>
      rejection(409, '23503', 'species_has_plants', { plant_count: 1 })
    const user = userEvent.setup()
    renderAt()
    const panel = await openDetail(user)
    await user.click(
      await within(panel).findByRole('button', { name: 'Borrar la especie' }),
    )
    const dialog = screen.getByRole('alertdialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'Borrar del catálogo' }),
    )
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'No se puede borrar: 1 planta de usuarios la tiene enlazada.',
    )
    await expectNoAxeViolations()
  })

  it('lote: selecciona filas, cambia su estado tras confirmar y vacía la selección', async () => {
    handlers['rpc/set_catalog_species_status'] = () => jsonResponse(1)
    const user = userEvent.setup()
    renderAt()
    await waitForTable()
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Seleccionar Phalaenopsis especie001',
      }),
    )
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Seleccionar Phalaenopsis especie002',
      }),
    )
    const all = screen.getByRole('checkbox', {
      name: 'Seleccionar todas las especies de esta página',
    })
    expect(all).toHaveProperty('indeterminate', true)
    const bar = screen.getByRole('group', { name: '2 especies seleccionadas' })
    await user.selectOptions(
      within(bar).getByRole('combobox', { name: 'Nuevo estado' }),
      'validated',
    )
    await expectNoAxeViolations()
    await user.click(
      within(bar).getByRole('button', { name: 'Cambiar el estado' }),
    )
    const dialog = screen.getByRole('alertdialog', {
      name: 'Cambiar el estado de 2 especies a «Validada»',
    })
    expect(dialog).toHaveTextContent('1 ya está como «Validada» y no cambia.')
    await expectNoAxeViolations()
    await user.click(
      within(dialog).getByRole('button', { name: 'Cambiar a «Validada»' }),
    )
    expect(
      await screen.findByText('1 especie pasó a «Validada». 1 ya lo estaba.'),
    ).toBeInTheDocument()
    expect(requestsTo('rpc/set_catalog_species_status')[0]?.body).toEqual({
      target_species_ids: [speciesId(1), speciesId(2)],
      new_status: 'validated',
    })
    expect(
      screen.queryByRole('group', { name: /seleccionadas?$/ }),
    ).not.toBeInTheDocument()
  })

  it('lote: seleccionar la página entera, y cambiar de página la vacía', async () => {
    const user = userEvent.setup()
    renderAt()
    await waitForTable()
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Seleccionar todas las especies de esta página',
      }),
    )
    expect(
      screen.getByRole('group', { name: '50 especies seleccionadas' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    await screen.findByRole('link', { name: 'Phalaenopsis especie051' })
    expect(
      screen.queryByRole('group', { name: /seleccionadas$/ }),
    ).not.toBeInTheDocument()
  })

  it('lote: sin permiso, el error sale en el diálogo y no cambia nada', async () => {
    handlers['rpc/set_catalog_species_status'] = () =>
      jsonResponse({ code: '42501', message: 'Solo un administrador…' }, 403)
    const user = userEvent.setup()
    renderAt()
    await waitForTable()
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Seleccionar Phalaenopsis especie001',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Cambiar el estado' }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /Cambiar a/ }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Tu cuenta no tiene permiso de administrador del catálogo: no se guardó nada.',
    )
  })
})
