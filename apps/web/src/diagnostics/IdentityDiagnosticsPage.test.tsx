import { ClerkOfflineError } from '@clerk/react/errors'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../config/env.ts'
import { initSupabase, SESSION_TOKEN_ERROR_TEXT } from '../lib/supabase.ts'
import { AppRouter } from '../routes/AppRouter.tsx'
import { expectNoAxeViolations } from '../test/axe.ts'
import {
  FAKE_SESSION_TOKEN,
  FAKE_USER_ID,
  getToken,
  resetFakeClerk,
  setFakeClerk,
} from '../test/clerk-mock.tsx'

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

const CONFIG = {
  supabaseUrl: 'https://ejemplo.supabase.co',
  supabasePublishableKey: 'sb_publishable_clave_de_prueba',
  appEnv: 'dev',
  clerkPublishableKey: 'pk_test_clave_de_prueba',
} as const

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

// Simula PostgREST: requesting_user_id() devuelve el sub del token, como hace
// Postgres con un token válido de Clerk; con la clave publicable, null.
const fetchMock = vi.fn<typeof fetch>()

function postgresSeesToken(input: RequestInfo | URL, init?: RequestInit) {
  void input
  const authorization = new Headers(init?.headers).get('Authorization')
  return jsonResponse(
    authorization === `Bearer ${FAKE_SESSION_TOKEN}` ? FAKE_USER_ID : null,
  )
}

beforeEach(() => {
  resetFakeClerk()
  document.documentElement.lang = 'es'
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  fetchMock.mockReset()
  fetchMock.mockImplementation(postgresSeesToken)
  vi.stubGlobal('fetch', fetchMock)
  initSupabase(CONFIG)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Cabeceras de la petición al RPC del panel. Se busca por su dirección y no por
 * su posición: con sesión, la app también hace la petición que crea el perfil.
 */
function rpcRequestHeaders() {
  const call = fetchMock.mock.calls.find(([input]) =>
    (input instanceof Request ? input.url : String(input)).includes(
      '/rpc/requesting_user_id',
    ),
  )
  expect(call).toBeDefined()
  return new Headers(call?.[1]?.headers)
}

function renderPanel(appEnv: AppEnv = 'dev') {
  return render(
    <MemoryRouter initialEntries={['/diagnostico']}>
      <AppRouter
        appEnv={appEnv}
        clerkPublishableKey="pk_test_clave_de_prueba"
      />
    </MemoryRouter>,
  )
}

// Valor (dd) de una fila del panel por su término (dt).
function valueOf(term: string) {
  const dt = screen.getByText(term, { selector: 'dt' })
  return dt.nextElementSibling as HTMLElement
}

async function findPanel() {
  await screen.findByRole('heading', {
    level: 1,
    name: 'Diagnóstico de identidad',
  })
}

describe('panel de diagnóstico de identidad', () => {
  it('sin sesión: Clerk sin sesión y Postgres vacío, coinciden', async () => {
    renderPanel()
    await findPanel()

    expect(await screen.findByText('Vacío (sin sesión)')).toBeInTheDocument()
    expect(valueOf('Usuario según Clerk')).toHaveTextContent('Sin sesión')
    expect(valueOf('¿Coinciden?')).toHaveTextContent('Sí, los dos sin sesión')
    expect(valueOf('Claim app_role')).toHaveTextContent('Sin sesión')
    const headers = rpcRequestHeaders()
    expect(headers.get('Authorization')).not.toContain(FAKE_SESSION_TOKEN)
    await expectNoAxeViolations()
  })

  it('con sesión: el mismo id en Clerk y en Postgres, y el rol', async () => {
    setFakeClerk({ signedIn: true, appRole: 'catalog_admin' })
    renderPanel()
    await findPanel()

    const postgres = valueOf('Usuario según Postgres')
    expect(await within(postgres).findByText(FAKE_USER_ID)).toBeInTheDocument()
    expect(valueOf('Usuario según Clerk')).toHaveTextContent(FAKE_USER_ID)
    expect(valueOf('¿Coinciden?')).toHaveTextContent(/^Sí$/)
    expect(valueOf('Claim app_role')).toHaveTextContent('catalog_admin')
    // El token viaja en la petición, pero nunca se muestra.
    const headers = rpcRequestHeaders()
    expect(headers.get('Authorization')).toBe(`Bearer ${FAKE_SESSION_TOKEN}`)
    expect(document.body).not.toHaveTextContent(FAKE_SESSION_TOKEN)
    await expectNoAxeViolations()
  })

  it('con sesión y sin rol: "Sin rol"', async () => {
    setFakeClerk({ signedIn: true })
    renderPanel()
    await findPanel()

    expect(valueOf('Claim app_role')).toHaveTextContent('Sin rol')
  })

  it('si Postgres ve otro usuario, dice que no coinciden', async () => {
    setFakeClerk({ signedIn: true })
    fetchMock.mockImplementation(() => jsonResponse('user_otro'))
    renderPanel()
    await findPanel()

    expect(await screen.findByText('user_otro')).toBeInTheDocument()
    expect(valueOf('¿Coinciden?')).toHaveTextContent('No')
  })

  it('sin conexión, el error del token se muestra y la petición no sale', async () => {
    setFakeClerk({ signedIn: true })
    getToken.mockRejectedValue(new ClerkOfflineError('Sin red'))
    renderPanel()
    await findPanel()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      SESSION_TOKEN_ERROR_TEXT.offline,
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(valueOf('Usuario según Postgres')).toHaveTextContent(
      'Error (ver el aviso)',
    )
    await expectNoAxeViolations()
  })

  it('si la llamada falla, muestra el error y permite volver a consultar', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(() =>
      jsonResponse(
        {
          code: 'PGRST202',
          message: 'Could not find the function public.requesting_user_id',
          details: null,
          hint: null,
        },
        404,
      ),
    )
    renderPanel()
    await findPanel()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not find the function public.requesting_user_id (código PGRST202)',
    )

    fetchMock.mockImplementation(postgresSeesToken)
    await user.click(screen.getByRole('button', { name: 'Volver a consultar' }))

    expect(await screen.findByText('Vacío (sin sesión)')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('no existe en producción', async () => {
    renderPanel('prod')

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Página no encontrada',
      }),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
