import { act, render, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureProfile, resetEnsuredProfiles } from '../lib/profile.ts'
import { initSupabase, setSessionTokenSource } from '../lib/supabase.ts'
import {
  FAKE_SESSION_TOKEN,
  FAKE_USER_ID,
  resetFakeClerk,
  setFakeClerk,
} from '../test/clerk-mock.tsx'
import { ProfileBootstrap } from './ProfileBootstrap.tsx'
import { SupabaseSessionBridge } from './SupabaseSessionBridge.tsx'

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

const CONFIG = {
  supabaseUrl: 'https://ejemplo.supabase.co',
  supabasePublishableKey: 'sb_publishable_clave_de_prueba',
  appEnv: 'dev',
  clerkPublishableKey: 'pk_test_clave_de_prueba',
} as const

// Simula PostgREST. Un insert con "resolution=ignore-duplicates" responde 201
// sin cuerpo tanto si crea la fila como si ya existía (on conflict do nothing).
const fetchMock = vi.fn<typeof fetch>()

function created() {
  return Promise.resolve(new Response(null, { status: 201 }))
}

const warn = vi.spyOn(console, 'warn')

beforeEach(() => {
  resetFakeClerk()
  resetEnsuredProfiles()
  setSessionTokenSource(null)
  fetchMock.mockReset()
  fetchMock.mockImplementation(created)
  vi.stubGlobal('fetch', fetchMock)
  warn.mockReset()
  warn.mockImplementation(() => {})
  initSupabase(CONFIG)
})

afterEach(() => {
  vi.unstubAllGlobals()
  setSessionTokenSource(null)
})

function Bootstrap() {
  return (
    <>
      <SupabaseSessionBridge />
      <ProfileBootstrap />
    </>
  )
}

interface SentRequest {
  url: URL
  method: string | undefined
  headers: Headers
  body: unknown
}

function sentRequests(): SentRequest[] {
  return fetchMock.mock.calls.map(([input, init]) => ({
    url: new URL(input instanceof Request ? input.url : String(input)),
    method: init?.method,
    headers: new Headers(init?.headers),
    body:
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as unknown)
        : undefined,
  }))
}

describe('ProfileBootstrap', () => {
  it('con sesión, crea el perfil sin pisar uno existente', async () => {
    setFakeClerk({ signedIn: true })
    const { container } = render(<Bootstrap />)

    expect(await ensureProfile(FAKE_USER_ID)).toBe(true)
    const [request, ...rest] = sentRequests()
    expect(rest).toHaveLength(0)
    expect(request?.method).toBe('POST')
    expect(request?.url.pathname).toBe('/rest/v1/profiles')
    expect(request?.url.searchParams.get('on_conflict')).toBe('id')
    // ignore-duplicates: "on conflict do nothing". Nunca merge-duplicates, que
    // actualizaría la fila existente (y pediría el permiso de update).
    expect(request?.headers.get('Prefer')).toContain(
      'resolution=ignore-duplicates',
    )
    expect(request?.headers.get('Prefer')).not.toContain('merge-duplicates')
    expect(request?.headers.get('Authorization')).toBe(
      `Bearer ${FAKE_SESSION_TOKEN}`,
    )
    // Solo el id: el idioma y las fechas los pone la base y no se tocan.
    expect(request?.body).toEqual({ id: FAKE_USER_ID })
    expect(container).toBeEmptyDOMElement()
  })

  it('si el perfil ya existe, no da error', async () => {
    // Segunda carga de la página del mismo usuario: la fila ya está y
    // PostgREST responde igual que al crearla.
    setFakeClerk({ signedIn: true })
    render(<Bootstrap />)

    expect(await ensureProfile(FAKE_USER_ID)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
  })

  it('sin sesión, no hace nada', async () => {
    render(<Bootstrap />)
    await act(() => Promise.resolve())

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('mientras Clerk carga, no hace nada', async () => {
    setFakeClerk({ status: 'loading', signedIn: true })
    render(<Bootstrap />)
    await act(() => Promise.resolve())

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('no se repite al volver a pintar ni con StrictMode', async () => {
    setFakeClerk({ signedIn: true })
    const { rerender } = render(
      <StrictMode>
        <Bootstrap />
      </StrictMode>,
    )
    await ensureProfile(FAKE_USER_ID)
    rerender(
      <StrictMode>
        <Bootstrap />
      </StrictMode>,
    )
    rerender(
      <StrictMode>
        <Bootstrap />
      </StrictMode>,
    )
    await ensureProfile(FAKE_USER_ID)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('al cambiar de usuario, lo hace para el nuevo', async () => {
    setFakeClerk({ signedIn: true })
    const { rerender } = render(<Bootstrap />)
    await ensureProfile(FAKE_USER_ID)

    setFakeClerk({ signedIn: false })
    rerender(<Bootstrap />)
    setFakeClerk({ signedIn: true, userId: 'user_otro' })
    rerender(<Bootstrap />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(await ensureProfile('user_otro')).toBe(true)
    expect(sentRequests().map((request) => request.body)).toEqual([
      { id: FAKE_USER_ID },
      { id: 'user_otro' },
    ])
  })

  it('un fallo de red no rompe ni muestra nada, y se reintenta al recuperar la conexión', async () => {
    setFakeClerk({ signedIn: true })
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const { container } = render(<Bootstrap />)

    expect(await ensureProfile(FAKE_USER_ID)).toBe(false)
    expect(container).toBeEmptyDOMElement()
    expect(warn).toHaveBeenCalledTimes(1)

    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(await ensureProfile(FAKE_USER_ID)).toBe(true)

    // Ya creado, otra vuelta de la conexión no hace otra petición.
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await ensureProfile(FAKE_USER_ID)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('un error del servidor no rompe nada y se reintenta en el siguiente ingreso', async () => {
    setFakeClerk({ signedIn: true })
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Error interno' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { container, unmount } = render(<Bootstrap />)

    expect(await ensureProfile(FAKE_USER_ID)).toBe(false)
    expect(container).toBeEmptyDOMElement()
    unmount()

    // Siguiente ingreso (o recarga): se monta de nuevo y lo vuelve a intentar.
    render(<Bootstrap />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(await ensureProfile(FAKE_USER_ID)).toBe(true)
  })

  it('sin conexión con Clerk (sin token), no envía nada y no rompe', async () => {
    setFakeClerk({ signedIn: true })
    // Sin el puente, una fuente del token que falla como getToken() sin red.
    setSessionTokenSource(() => Promise.reject(new Error('sin red')))
    const { container } = render(<ProfileBootstrap />)

    expect(await ensureProfile(FAKE_USER_ID)).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })
})
