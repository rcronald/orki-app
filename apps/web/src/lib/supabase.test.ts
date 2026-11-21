import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getSessionToken,
  getSupabase,
  initSupabase,
  isSupabaseConfigured,
  SESSION_TOKEN_ERROR_TEXT,
  SessionTokenError,
  sessionTokenFailure,
  setSessionTokenSource,
} from './supabase.ts'

const CONFIG = {
  supabaseUrl: 'https://ejemplo.supabase.co',
  supabasePublishableKey: 'sb_publishable_clave_de_prueba',
  appEnv: 'dev',
  clerkPublishableKey: 'pk_test_clave_de_prueba',
} as const

const TOKEN = 'token_de_sesion_de_prueba'

// Simula la API de Supabase: responde a toda petición con JSON y guarda las
// cabeceras de cada una para comprobar qué credencial llevó.
const fetchMock = vi.fn<typeof fetch>()

function requestHeaders(): Headers[] {
  return fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers))
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify('user_prueba'), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
  vi.stubGlobal('fetch', fetchMock)
  setSessionTokenSource(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
  setSessionTokenSource(null)
})

describe('cliente de Supabase', () => {
  // Va primero: el cliente es único para todo el archivo.
  it('falla si se pide antes de inicializarlo', async () => {
    await expect(getSupabase()).rejects.toThrow('no se ha inicializado')
    expect(isSupabaseConfigured()).toBe(false)
  })

  it('crea un único cliente compartido, de forma diferida', async () => {
    initSupabase(CONFIG)
    expect(isSupabaseConfigured()).toBe(true)
    const [first, second] = await Promise.all([getSupabase(), getSupabase()])

    expect(first).toBe(second)
    expect(await getSupabase()).toBe(first)
  })
})

describe('token de sesión en las peticiones', () => {
  beforeEach(() => {
    initSupabase(CONFIG)
  })

  it('sin sesión, la petición va solo con la clave publicable', async () => {
    const supabase = await getSupabase()
    const { data, error } = await supabase.rpc('requesting_user_id')

    expect(error).toBeNull()
    expect(data).toBe('user_prueba')
    const [headers] = requestHeaders()
    expect(headers?.get('apikey')).toBe(CONFIG.supabasePublishableKey)
    expect(headers?.get('Authorization')).not.toContain(TOKEN)
  })

  it('con sesión, la petición lleva el token de Clerk', async () => {
    setSessionTokenSource(() => Promise.resolve(TOKEN))
    const supabase = await getSupabase()
    await supabase.rpc('requesting_user_id')

    const [headers] = requestHeaders()
    expect(headers?.get('Authorization')).toBe(`Bearer ${TOKEN}`)
    expect(headers?.get('apikey')).toBe(CONFIG.supabasePublishableKey)
  })

  it('tras cerrar sesión, la petición siguiente ya no lleva el token', async () => {
    const unregister = setSessionTokenSource(() => Promise.resolve(TOKEN))
    const supabase = await getSupabase()
    await supabase.rpc('requesting_user_id')
    unregister()
    await supabase.rpc('requesting_user_id')

    const [withSession, afterSignOut] = requestHeaders()
    expect(withSession?.get('Authorization')).toBe(`Bearer ${TOKEN}`)
    expect(afterSignOut?.get('Authorization')).not.toContain(TOKEN)
  })

  it('quitar una fuente que ya no está registrada no quita la nueva', async () => {
    const unregisterOld = setSessionTokenSource(() => Promise.resolve('viejo'))
    setSessionTokenSource(() => Promise.resolve(TOKEN))
    unregisterOld()

    expect(await getSessionToken()).toBe(TOKEN)
  })

  it.each([
    [
      'sin conexión',
      () => Promise.reject(new SessionTokenError('offline')),
      'offline',
    ],
    ['la sesión ya no existe', () => Promise.resolve(null), 'session-ended'],
    [
      'getToken falla',
      () => Promise.reject(new Error('fallo de red')),
      'failed',
    ],
  ] as const)(
    '%s: la petición no se envía y el error es reconocible',
    async (_case, source, reason) => {
      setSessionTokenSource(source)
      const supabase = await getSupabase()
      const { data, error } = await supabase.rpc('requesting_user_id')

      expect(fetchMock).not.toHaveBeenCalled()
      expect(data).toBeNull()
      expect(sessionTokenFailure(error)).toBe(reason)
      expect(error?.message).toContain(SESSION_TOKEN_ERROR_TEXT[reason])
    },
  )

  it('una lectura (GET) reintenta pidiendo el token de nuevo antes de dar el error', async () => {
    vi.useFakeTimers()
    try {
      const source = vi.fn(() => Promise.resolve<string | null>(null))
      setSessionTokenSource(source)
      const supabase = await getSupabase()

      // El constructor de consultas no envía nada hasta que se pide el
      // resultado (then).
      const pending = supabase
        .from('genera')
        .select('id')
        .then((response) => response)
      // Reintentos de supabase-js: 1, 2 y 4 s.
      await vi.advanceTimersByTimeAsync(7_000)
      const { error } = await pending

      expect(source).toHaveBeenCalledTimes(4)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(sessionTokenFailure(error)).toBe('session-ended')
    } finally {
      vi.useRealTimers()
    }
  })

  it('con throwOnError, lanza el SessionTokenError', async () => {
    setSessionTokenSource(() => Promise.resolve(null))
    const supabase = await getSupabase()

    const request = supabase.rpc('requesting_user_id').throwOnError()
    await expect(request).rejects.toBeInstanceOf(SessionTokenError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('sessionTokenFailure', () => {
  it('no confunde otros errores con los del token', () => {
    expect(sessionTokenFailure(null)).toBeNull()
    expect(sessionTokenFailure(new Error('otro'))).toBeNull()
    expect(sessionTokenFailure({ message: 'permission denied' })).toBeNull()
    expect(
      sessionTokenFailure({ message: 'SessionTokenError: texto desconocido' }),
    ).toBeNull()
  })

  it('el error lleva el motivo y la causa', () => {
    const cause = new Error('original')
    const error = new SessionTokenError('failed', { cause })

    expect(error.name).toBe('SessionTokenError')
    expect(error.reason).toBe('failed')
    expect(error.cause).toBe(cause)
  })
})
