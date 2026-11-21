import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CATALOG_ADMIN_ERROR_TEXT } from '../lib/catalogAdmin.ts'
import { initSupabase, setSessionTokenSource } from '../lib/supabase.ts'
import { PATHS } from '../routes/paths.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import CatalogAdminPage from './CatalogAdminPage.tsx'

// La pantalla del backoffice del catálogo con la API de Supabase simulada
// (fetch), como las demás pantallas. Comprueba qué se pide, qué se muestra en
// cada estado, que el estado vive en la URL y la accesibilidad con axe.

const CONFIG = {
  supabaseUrl: 'https://ejemplo.supabase.co',
  supabasePublishableKey: 'sb_publishable_clave_de_prueba',
  appEnv: 'dev',
  clerkPublishableKey: 'pk_test_clave_de_prueba',
} as const

const PHAL = '22222222-2222-4222-8222-222222222222'

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
    synonym_count: index % 3,
    common_name_count: 0,
    created_at: '2026-11-20T14:37:00+00:00',
    updated_at: '2026-11-21T08:15:00+00:00',
    ...extra,
  }
}

/** Una página del listado: filas de la `from` a la `to`, con el total. */
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

const DETAIL = {
  id: speciesId(2),
  scientific_name: 'Phalaenopsis especie002',
  genus_id: PHAL,
  type: 'species',
  status: 'validated',
  source: 'col',
  source_ref: '4F2',
  created_at: '2026-11-20T14:37:00+00:00',
  updated_at: '2026-11-21T08:15:00+00:00',
  genera: { name: 'Phalaenopsis' },
  species_names: [
    { id: 'n1', name: 'Doritis pulcherrima', type: 'synonym', language: null },
    { id: 'n2', name: 'orquídea mariposa', type: 'common', language: 'es' },
  ],
}

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
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

function defaultHandlers(): Record<string, Handler> {
  return {
    'rpc/catalog_summary': () => jsonResponse([SUMMARY]),
    'rpc/list_catalog_species': ({ body }) => {
      if (body.after_id === speciesId(50))
        return jsonResponse(listPage(51, 100, 120))
      if (body.last_page) return jsonResponse(listPage(101, 120, 120))
      return jsonResponse(listPage(1, 50, 120))
    },
    'rpc/search_catalog_species': () =>
      jsonResponse([
        {
          ...speciesRow(7),
          matched_name: 'Doritis pulcherrima',
          matched_name_type: 'synonym',
          total_count: 1,
          current_page: 1,
        },
      ]),
    'rpc/list_catalog_genera': () =>
      jsonResponse([
        {
          id: PHAL,
          name: 'Phalaenopsis',
          is_quick_access: true,
          abbreviations: ['Phal.'],
          species_count: 92,
          total_count: 1,
          current_page: 1,
        },
      ]),
    'rpc/count_species_plants': () => jsonResponse(3),
    'rpc/species_history': () => jsonResponse([]),
    'rpc/search_genera': () =>
      jsonResponse([
        {
          id: PHAL,
          name: 'Phalaenopsis',
          is_quick_access: true,
          matched_abbreviation: 'Phal.',
        },
      ]),
    species: () => jsonResponse(DETAIL),
    genera: () => jsonResponse({ id: PHAL, name: 'Phalaenopsis' }),
  }
}

beforeEach(() => {
  // Como en index.html.
  document.documentElement.lang = 'es'
  handlers = defaultHandlers()
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

function table() {
  return screen.getByRole('table', { name: /Especies/ })
}

async function findTableRows() {
  await screen.findByRole('link', { name: 'Phalaenopsis especie001' })
  return within(table()).getAllByRole('row').slice(1)
}

describe('CatalogAdminPage', () => {
  it('muestra el resumen, la primera página, el total y la atribución', async () => {
    renderAt()
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Administración del catálogo',
      }),
    ).toBeInTheDocument()
    const rows = await findTableRows()
    expect(rows).toHaveLength(50)
    expect(within(rows[0]).getByRole('rowheader')).toHaveTextContent(
      'Phalaenopsis especie001',
    )
    expect(within(rows[1]).getByText('Validada')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Catalogue of Life')).toBeInTheDocument()
    expect(screen.getByText('120 especies. Página 1 de 3.')).toBeInTheDocument()

    const summary = screen.getByRole('region', { name: 'Resumen' })
    await within(summary).findByText('31.056')
    expect(within(summary).getByText('60.000')).toBeInTheDocument()
    expect(within(summary).getByText('755')).toBeInTheDocument()

    expect(
      within(screen.getByRole('contentinfo')).getByText(/COL26\.10 XR/),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by/4.0/',
    )
    expect(
      screen.getByRole('link', { name: 'https://doi.org/10.48580/dgzlf' }),
    ).toBeInTheDocument()

    // Una sola página por petición.
    expect(requestsTo('rpc/list_catalog_species')).toHaveLength(1)
    expect(requestsTo('rpc/list_catalog_species')[0]?.body).toEqual({
      page_size: 50,
    })
    await expectNoAxeViolations()
  })

  it('mientras carga, esqueleto y anuncio; nunca filas de antes', async () => {
    let release: () => void = () => {}
    handlers['rpc/list_catalog_species'] = ({ body }) =>
      body.filter_status === 'observed'
        ? new Promise((resolve) => {
            release = () => resolve(new Response('[]', { status: 200 }))
          })
        : jsonResponse(listPage(1, 50, 120))
    const user = userEvent.setup()
    renderAt()
    await findTableRows()

    await user.click(
      within(screen.getByRole('group', { name: 'Estado' })).getByRole(
        'button',
        {
          name: 'Observada',
        },
      ),
    )
    expect(screen.getByText('Cargando especies…')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Phalaenopsis especie001' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: /Especies del catálogo/ }),
    ).toHaveAttribute('aria-busy', 'true')
    await expectNoAxeViolations()
    act(() => release())
    expect(
      await screen.findByText(
        'Ninguna especie coincide con la búsqueda y los filtros.',
      ),
    ).toBeInTheDocument()
  })

  it('pasa de página por clave y lo guarda en la URL; recargar pide lo mismo', async () => {
    const user = userEvent.setup()
    const { unmount } = renderAt()
    await findTableRows()

    await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    await screen.findByRole('link', { name: 'Phalaenopsis especie051' })
    expect(screen.getByText('120 especies. Página 2 de 3.')).toBeInTheDocument()
    expect(requestsTo('rpc/list_catalog_species').at(-1)?.body).toEqual({
      page_size: 50,
      after_id: speciesId(50),
    })
    const search = currentSearch()
    expect(search.get('pagina')).toBe('2')
    expect(search.get('desde')).toBe(speciesId(50))

    await user.click(screen.getByRole('button', { name: 'Última' }))
    await screen.findByRole('link', { name: 'Phalaenopsis especie101' })
    expect(screen.getByText('120 especies. Página 3 de 3.')).toBeInTheDocument()
    expect(currentSearch().get('ultima')).toBe('1')
    expect(screen.getByRole('button', { name: 'Siguiente' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    // Recargar (o abrir el enlace) en la página 2.
    unmount()
    fetchMock.mockClear()
    renderAt(`?pagina=2&desde=${speciesId(50)}`)
    await screen.findByRole('link', { name: 'Phalaenopsis especie051' })
    expect(requestsTo('rpc/list_catalog_species')[0]?.body).toEqual({
      page_size: 50,
      after_id: speciesId(50),
    })
    expect(screen.getByText('120 especies. Página 2 de 3.')).toBeInTheDocument()
  })

  it('cambiar un filtro vuelve a la primera página y lo envía a la base', async () => {
    const user = userEvent.setup()
    renderAt(`?pagina=2&desde=${speciesId(50)}`)
    await screen.findByRole('link', { name: 'Phalaenopsis especie051' })

    await user.click(
      within(screen.getByRole('group', { name: 'Tipo' })).getByRole('button', {
        name: 'Híbrido',
      }),
    )
    await screen.findByRole('link', { name: 'Phalaenopsis especie001' })
    expect(requestsTo('rpc/list_catalog_species').at(-1)?.body).toEqual({
      filter_type: 'hybrid',
      page_size: 50,
    })
    const search = currentSearch()
    expect(search.get('tipo')).toBe('hybrid')
    expect(search.get('pagina')).toBeNull()
    expect(search.get('desde')).toBeNull()

    await user.click(
      within(screen.getByRole('group', { name: 'Fuente' })).getByRole(
        'button',
        {
          name: 'Lista curada',
        },
      ),
    )
    await waitFor(() =>
      expect(requestsTo('rpc/list_catalog_species').at(-1)?.body).toEqual({
        filter_type: 'hybrid',
        filter_source: 'curated',
        page_size: 50,
      }),
    )
  })

  it('filtra por género con el buscador de géneros', async () => {
    const user = userEvent.setup()
    renderAt()
    await findTableRows()
    await user.type(screen.getByRole('combobox', { name: 'Género' }), 'phal')
    await user.click(
      await screen.findByRole('option', { name: /Phalaenopsis/ }),
    )
    await waitFor(() =>
      expect(requestsTo('rpc/list_catalog_species').at(-1)?.body).toEqual({
        filter_genus_id: PHAL,
        page_size: 50,
      }),
    )
    expect(currentSearch().get('genero')).toBe(PHAL)
    expect(
      await screen.findByRole(
        'button',
        { name: 'Quitar el filtro de género' },
        { timeout: 3000 },
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Phalaenopsis', { selector: 'span' }),
    ).toBeInTheDocument()
  })

  it('busca al dejar de escribir, por relevancia, y muestra el nombre por el que coincidió', async () => {
    const user = userEvent.setup()
    renderAt()
    await findTableRows()
    await user.type(
      screen.getByRole('searchbox', { name: 'Buscar especies' }),
      'doritis pulch',
    )
    expect(screen.getByText('Cargando especies…')).toBeInTheDocument()
    expect(
      await screen.findByText('Sinónimo: Doritis pulcherrima'),
    ).toBeInTheDocument()
    // Una sola petición para todo lo escrito.
    const searches = requestsTo('rpc/search_catalog_species')
    expect(searches).toHaveLength(1)
    expect(searches[0]?.body).toEqual({
      query: 'doritis pulch',
      page_size: 50,
      page_number: 1,
    })
    expect(currentSearch().get('q')).toBe('doritis pulch')
    expect(
      screen.getByText(
        '1 especie coincide con «doritis pulch». Página 1 de 1.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('table', { name: /coinciden con «doritis pulch»/ }),
    ).toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('sin resultados: lo dice y ofrece limpiar la búsqueda y los filtros', async () => {
    handlers['rpc/search_catalog_species'] = () => jsonResponse([])
    const user = userEvent.setup()
    renderAt('?q=xqzvkjw&estado=validated')
    expect(
      await screen.findByText(
        'Ninguna especie coincide con la búsqueda y los filtros.',
      ),
    ).toBeInTheDocument()
    await expectNoAxeViolations()
    const clear = screen.getAllByRole('button', {
      name: 'Limpiar búsqueda y filtros',
    })
    await user.click(clear[clear.length - 1])
    await findTableRows()
    expect(currentSearch().toString()).toBe('')
  })

  it('catálogo vacío', async () => {
    handlers['rpc/list_catalog_species'] = () => jsonResponse([])
    renderAt()
    expect(
      await screen.findByText(/El catálogo está vacío/),
    ).toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('error con reintento, distinto sin conexión', async () => {
    let failures = 1
    handlers['rpc/list_catalog_species'] = () => {
      if (failures > 0) {
        failures -= 1
        return Promise.reject(new TypeError('Failed to fetch'))
      }
      return jsonResponse(listPage(1, 50, 120))
    }
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const user = userEvent.setup()
    renderAt()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Sin conexión')
    expect(alert).toHaveTextContent(CATALOG_ADMIN_ERROR_TEXT.offline)
    await expectNoAxeViolations()

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }))
    await findTableRows()
  })

  it('error del servidor y sin permiso', async () => {
    handlers['rpc/list_catalog_species'] = () =>
      jsonResponse({ code: 'XX000', message: 'internal' }, 500)
    handlers['rpc/catalog_summary'] = () =>
      jsonResponse({ code: '42501', message: 'Solo un administrador…' }, 403)
    renderAt()
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
    expect(
      screen.getByText(CATALOG_ADMIN_ERROR_TEXT.failed),
    ).toBeInTheDocument()
    expect(
      screen.getByText(CATALOG_ADMIN_ERROR_TEXT.forbidden),
    ).toBeInTheDocument()
  })

  it('abre el detalle con sus nombres, la ficha de COL y las plantas, y lo cierra', async () => {
    const user = userEvent.setup()
    renderAt()
    await findTableRows()
    await user.click(
      screen.getByRole('link', { name: 'Phalaenopsis especie002' }),
    )
    expect(currentSearch().get('especie')).toBe(speciesId(2))

    const panel = await screen.findByRole(
      'region',
      { name: 'Detalle de Phalaenopsis especie002' },
      { timeout: 3000 },
    )
    await waitFor(() =>
      expect(within(panel).getByRole('heading', { level: 2 })).toHaveFocus(),
    )
    expect(within(panel).getByText('Doritis pulcherrima')).toBeInTheDocument()
    expect(within(panel).getByText('orquídea mariposa')).toBeInTheDocument()
    expect(
      within(panel).getByText('3 plantas de usuarios la tienen enlazada.'),
    ).toBeInTheDocument()
    const col = within(panel).getByRole('link', {
      name: /Ver la ficha en el Catalogue of Life/,
    })
    expect(col).toHaveAttribute(
      'href',
      'https://www.catalogueoflife.org/data/taxon/4F2',
    )
    expect(col).toHaveAttribute('target', '_blank')
    expect(col).toHaveAttribute('rel', 'noopener noreferrer')
    expect(requestsTo('rpc/count_species_plants')[0]?.body).toEqual({
      target_species_id: speciesId(2),
    })
    expect(requestsTo('species')[0]?.url.searchParams.get('id')).toBe(
      `eq.${speciesId(2)}`,
    )
    await expectNoAxeViolations()

    await user.click(within(panel).getByRole('button', { name: 'Cerrar' }))
    expect(currentSearch().get('especie')).toBeNull()
    await waitFor(() =>
      expect(
        screen.getByRole('link', { name: 'Phalaenopsis especie002' }),
      ).toHaveFocus(),
    )
  })

  it('pestaña de géneros por teclado, en la URL, con enlace a sus especies', async () => {
    const user = userEvent.setup()
    renderAt()
    await findTableRows()
    const speciesTab = screen.getByRole('tab', { name: 'Especies' })
    expect(speciesTab).toHaveAttribute('aria-selected', 'true')
    await user.click(speciesTab)
    await user.keyboard('{ArrowRight}')
    const generaTab = screen.getByRole('tab', { name: 'Géneros' })
    expect(generaTab).toHaveFocus()
    expect(generaTab).toHaveAttribute('aria-selected', 'true')
    expect(currentSearch().get('pestana')).toBe('generos')

    const generaTable = await screen.findByRole('table', {
      name: /Géneros del catálogo/,
    })
    await within(generaTable).findByText('Phal.')
    const row = within(generaTable).getAllByRole('row')[1]
    expect(row).toHaveTextContent('Phal.')
    expect(row).toHaveTextContent('Sí')
    expect(screen.getByText('1 género. Página 1 de 1.')).toBeInTheDocument()
    await expectNoAxeViolations()

    await user.click(
      within(row).getByRole('link', { name: /92 especies de Phalaenopsis/ }),
    )
    await waitFor(() => expect(currentSearch().get('genero')).toBe(PHAL))
    expect(currentSearch().get('pestana')).toBeNull()
    expect(screen.getByRole('tab', { name: 'Especies' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('ignora en la URL los valores que no reconoce', async () => {
    renderAt('?estado=borrada&genero=no-es-un-uuid&pagina=abc&desde=x')
    await findTableRows()
    expect(requestsTo('rpc/list_catalog_species')[0]?.body).toEqual({
      page_size: 50,
    })
    expect(requestsTo('genera')).toHaveLength(0)
  })
})
