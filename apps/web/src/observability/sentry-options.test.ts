import {
  addBreadcrumb,
  captureException,
  close,
  createTransport,
  flush,
  init,
  setUser,
} from '@sentry/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildSentryOptions } from './sentry-options.ts'

// Prueba del evento tal como sale hacia Sentry: el SDK real, con las opciones
// de la app, y un transporte que guarda los sobres (envelopes) en memoria en
// lugar de enviarlos. No sale nada a la red.

const SETTINGS = {
  dsn: 'https://clave@o1.ingest.sentry.io/2',
  environment: 'dev' as const,
  release: 'abc1234',
}

const decoder = new TextDecoder()
let sent: string[] = []
let online = true
let reloading = false
// Lo que dirá la página al esperar a ver si se va (#308), y cuántas veces se
// esperó.
let leaves = false
let leaveWaits = 0

function start() {
  init(
    buildSentryOptions(SETTINGS, {
      isOnline: () => online,
      isReloadingForUpdate: () => reloading,
      waitForPageLeave: () => {
        leaveWaits += 1
        return Promise.resolve(leaves)
      },
      transport: (options) =>
        createTransport(options, (request) => {
          sent.push(
            typeof request.body === 'string'
              ? request.body
              : decoder.decode(request.body),
          )
          return Promise.resolve({ statusCode: 200 })
        }),
    }),
  )
}

/** Sobres con eventos de error (no sesiones ni informes del cliente). */
function sentEvents(): string[] {
  return sent.filter((body) => body.includes('"type":"event"'))
}

beforeEach(() => {
  sent = []
  online = true
  reloading = false
  leaves = false
  leaveWaits = 0
  window.history.replaceState(null, '', '/coleccion?q=masdevallia#arriba')
  start()
})

afterEach(async () => {
  await close()
  window.history.replaceState(null, '', '/')
})

describe('evento saliente', () => {
  it('no lleva correo, nombre, IP ni parámetros de URL', async () => {
    // Aunque algo intentara poner más datos del usuario, solo sale el id.
    setUser({
      id: 'user_2abc',
      email: 'ana@example.com',
      username: 'Ana Pérez',
      ip_address: '203.0.113.7',
    })
    addBreadcrumb({
      category: 'navigation',
      data: { from: '/coleccion?q=masdevallia', to: '/coleccion/nueva' },
    })
    addBreadcrumb({
      category: 'fetch',
      data: {
        method: 'GET',
        url: 'https://x.supabase.co/rest/v1/plants?name=ilike.*masdevallia*',
      },
    })
    addBreadcrumb({ category: 'console', message: 'Ana Pérez' })

    captureException(
      new Error('Falló https://x.supabase.co/rest/v1/plants?q=masdevallia'),
    )
    await flush(2000)

    const events = sentEvents()
    expect(events).toHaveLength(1)
    const body = events[0] ?? ''
    for (const forbidden of [
      'ana@example.com',
      'Ana Pérez',
      '203.0.113.7',
      'masdevallia',
      '?q=',
      '#arriba',
      'timezone',
    ]) {
      expect(body).not.toContain(forbidden)
    }
    // Lo que sí va: el id de Clerk, el ambiente, la versión y la URL sin
    // consulta; y la petición a Sentry de no deducir la IP de la conexión.
    expect(body).toContain('"user":{"id":"user_2abc"}')
    expect(body).toContain('"environment":"dev"')
    expect(body).toContain('"release":"abc1234"')
    expect(body).toContain('"url":"http://localhost:3000/coleccion"')
    expect(body).toContain('"infer_ip":"never"')
  })

  it('no se envía un fallo de red sin conexión', async () => {
    online = false

    captureException(new TypeError('Failed to fetch'))
    await flush(2000)

    expect(sentEvents()).toEqual([])
  })

  it('con conexión, un fallo de red sí se envía', async () => {
    captureException(new TypeError('Failed to fetch'))
    await flush(2000)

    expect(sentEvents()).toHaveLength(1)
  })

  it('un chunk que no llegó mientras la página se recarga por una versión nueva no se envía (#278)', async () => {
    reloading = true

    captureException(
      new TypeError(
        'Failed to fetch dynamically imported module: https://orqui.app/assets/CreditsPage-BJFUgrOu.js',
      ),
    )
    await flush(2000)

    expect(sentEvents()).toEqual([])
  })

  it('el mismo chunk sin recarga en curso (fallo repetido) sí se envía', async () => {
    captureException(
      new TypeError(
        'Failed to fetch dynamically imported module: https://orqui.app/assets/CreditsPage-BJFUgrOu.js',
      ),
    )
    await flush(2000)

    expect(sentEvents()).toHaveLength(1)
  })

  it('un chunk que no llegó porque la página se iba (Safari al volver atrás) no se envía (#308)', async () => {
    // WebKit rechaza el import() antes de beforeunload: solo después de
    // esperar se sabe que la página se iba.
    leaves = true

    captureException(new TypeError('Importing a module script failed.'))
    await flush(2000)

    expect(leaveWaits).toBe(1)
    expect(sentEvents()).toEqual([])
  })

  it('si la página se queda, el chunk que no llegó sí se envía, y otros errores no esperan', async () => {
    captureException(new TypeError('Importing a module script failed.'))
    captureException(new Error('Componente roto'))
    await flush(2000)

    expect(leaveWaits).toBe(1)
    expect(sentEvents()).toHaveLength(2)
  })
})
