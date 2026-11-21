import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CATALOG_SEARCH_ERROR_TEXT } from '../lib/catalogSearch.ts'
import { initSupabase, setSessionTokenSource } from '../lib/supabase.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import ShowcasePage from './ShowcasePage.tsx'

// La muestra con configuración de Supabase: los buscadores de especies y de
// géneros usan la búsqueda real (con fetch simulado). Va en un archivo aparte
// porque la configuración de supabase.ts es única por archivo de pruebas. La
// muestra está fuera de Clerk: no hay fuente de token y las peticiones van sin
// sesión.

const CONFIG = {
  supabaseUrl: 'https://ejemplo.supabase.co',
  supabasePublishableKey: 'sb_publishable_clave_de_prueba',
  appEnv: 'dev',
  clerkPublishableKey: 'pk_test_clave_de_prueba',
} as const

const GENUS_ID = '22222222-2222-2222-2222-222222222222'

const SPECIES_ROWS = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    scientific_name: 'Phalaenopsis amabilis',
    genus_id: GENUS_ID,
    genus_name: 'Phalaenopsis',
    type: 'species',
    status: 'validated',
    matched_name: 'Phalaenopsis amabilis',
    matched_name_type: 'scientific',
  },
  {
    id: '11111111-1111-1111-1111-111111111112',
    scientific_name: 'Phalaenopsis aphrodite',
    genus_id: GENUS_ID,
    genus_name: 'Phalaenopsis',
    type: 'species',
    status: 'imported',
    matched_name: 'Phalaenopsis amabilis var. aphrodite',
    matched_name_type: 'synonym',
  },
  {
    id: '11111111-1111-1111-1111-111111111113',
    scientific_name: 'Phalaenopsis schilleriana',
    genus_id: GENUS_ID,
    genus_name: 'Phalaenopsis',
    type: 'species',
    status: 'observed',
    matched_name: 'Orquídea de Schiller',
    matched_name_type: 'common',
  },
]

const GENUS_ROWS = [
  {
    id: GENUS_ID,
    name: 'Phalaenopsis',
    is_quick_access: true,
    matched_abbreviation: 'Phal.',
  },
]

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

const fetchMock = vi.fn<typeof fetch>()

function requestUrl(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

function rpcCalls(name: string) {
  return fetchMock.mock.calls.filter(([input]) =>
    requestUrl(input).endsWith(`/rest/v1/rpc/${name}`),
  )
}

beforeEach(() => {
  document.documentElement.lang = 'es'
  fetchMock.mockReset()
  fetchMock.mockImplementation((input) =>
    requestUrl(input).endsWith('/rpc/search_genera')
      ? jsonResponse(GENUS_ROWS)
      : jsonResponse(SPECIES_ROWS),
  )
  vi.stubGlobal('fetch', fetchMock)
  setSessionTokenSource(null)
  initSupabase(CONFIG)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function speciesInput() {
  return screen.getByRole('combobox', { name: 'Nombre científico' })
}

// La muestra incluye la pantalla de inventario, que usa enlaces del enrutador.
function renderShowcase() {
  return render(
    <MemoryRouter>
      <ShowcasePage />
    </MemoryRouter>,
  )
}

describe('ShowcasePage con Supabase', () => {
  it('el buscador de especies usa la búsqueda real, sin sesión', async () => {
    const user = userEvent.setup()
    renderShowcase()
    expect(screen.queryByText(/^Datos fijos/)).not.toBeInTheDocument()

    // Con un carácter no se busca ni se dice "sin resultados".
    await user.type(speciesInput(), 'p')
    expect(screen.queryByText('Sin resultados')).not.toBeInTheDocument()

    await user.type(speciesInput(), 'hal')
    expect(screen.getByText('Buscando…', { selector: 'p' })).toBeVisible()

    await screen.findByRole('option', { name: 'Phalaenopsis amabilis' })
    const listbox = screen.getByRole('listbox', { name: 'Nombre científico' })
    const options = within(listbox).getAllByRole('option')
    expect(options[0]).toHaveAccessibleName('Phalaenopsis amabilis')
    expect(options[1]).toHaveAccessibleName(
      /^Phalaenopsis aphrodite,\s*Sinónimo: Phalaenopsis amabilis var\. aphrodite$/,
    )
    expect(options[2]).toHaveAccessibleName(
      /^Phalaenopsis schilleriana,\s*Nombre común: Orquídea de Schiller$/,
    )
    // El nombre científico va en cursiva, con el estilo del sistema.
    expect(within(listbox).getByText('Phalaenopsis amabilis')).toHaveClass(
      'orki-autocomplete__label--scientific',
    )

    // Una sola petición, con la consulta entera y sin token de sesión.
    const calls = rpcCalls('search_species')
    expect(calls).toHaveLength(1)
    const [, init] = calls[0] ?? []
    expect(init?.body).toBe(JSON.stringify({ query: 'phal', max_results: 10 }))
    expect(new Headers(init?.headers).get('apikey')).toBe(
      CONFIG.supabasePublishableKey,
    )

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(speciesInput()).toHaveValue('Phalaenopsis aphrodite')
    expect(
      screen.getByText('Elegiste Phalaenopsis aphrodite.'),
    ).toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('el buscador de géneros dice por qué abreviatura coincidió', async () => {
    const user = userEvent.setup()
    renderShowcase()

    await user.type(
      screen.getByRole('combobox', { name: 'Otro género' }),
      'phal.',
    )
    expect(
      await screen.findByRole('option', {
        name: /^Phalaenopsis,\s*Abreviatura: Phal\.$/,
      }),
    ).toBeVisible()
    expect(rpcCalls('search_genera')).toHaveLength(1)
  })

  it('sin resultados lo dice y ofrece la acción final', async () => {
    fetchMock.mockImplementation(() => jsonResponse([]))
    const user = userEvent.setup()
    renderShowcase()

    await user.type(speciesInput(), 'stanhopea')
    expect(
      await screen.findByText('Sin resultados', {
        selector: '.orki-autocomplete__message',
      }),
    ).toBeVisible()
    expect(
      screen.getByRole('option', {
        name: 'No la encuentro: guardarla con este nombre',
      }),
    ).toBeVisible()
    await expectNoAxeViolations()
  })

  it('sin conexión muestra el aviso y el campo sigue usable', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const user = userEvent.setup()
    renderShowcase()

    await user.type(speciesInput(), 'phal')
    const message = { selector: '.orki-autocomplete__message' }
    expect(
      await screen.findByText(CATALOG_SEARCH_ERROR_TEXT.offline, message),
    ).toBeVisible()
    // El anuncio del propio buscador (su región role="status").
    const field = speciesInput().closest('.orki-autocomplete')
    expect(field).not.toBeNull()
    if (field instanceof HTMLElement) {
      expect(within(field).getByRole('status')).toHaveTextContent(
        CATALOG_SEARCH_ERROR_TEXT.offline,
      )
    }
    await expectNoAxeViolations()

    // Se puede seguir escribiendo y usar la acción final.
    await user.keyboard('{ArrowDown}{Enter}')
    expect(
      screen.getByText('Se guardaría con el nombre «phal», por validar.'),
    ).toBeInTheDocument()
  })

  it('con un fallo del servidor muestra el mensaje de error general', async () => {
    fetchMock.mockImplementation(() =>
      jsonResponse({ message: 'internal error' }, 500),
    )
    const user = userEvent.setup()
    renderShowcase()

    await user.type(speciesInput(), 'phal')
    expect(
      await screen.findByText(CATALOG_SEARCH_ERROR_TEXT.failed, {
        selector: '.orki-autocomplete__message',
      }),
    ).toBeVisible()
  })

  it('no tiene fallos A ni AA mientras busca', async () => {
    // La respuesta no llega: el buscador se queda en "Buscando…".
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}))
    const user = userEvent.setup()
    renderShowcase()

    await user.type(speciesInput(), 'phal')
    await waitFor(() => expect(rpcCalls('search_species')).toHaveLength(1))
    expect(screen.getByText('Buscando…', { selector: 'p' })).toBeVisible()
    await expectNoAxeViolations()
  })
})
