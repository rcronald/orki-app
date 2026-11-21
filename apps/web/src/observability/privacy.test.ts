import type { ErrorEvent } from '@sentry/react'
import { describe, expect, it } from 'vitest'
import {
  scrubBreadcrumb,
  scrubEvent,
  stripQueriesInText,
  stripUrlQuery,
} from './privacy.ts'

describe('stripUrlQuery', () => {
  it.each([
    ['https://orki.app/coleccion?q=phalaenopsis', 'https://orki.app/coleccion'],
    ['/coleccion?q=phalaenopsis#arriba', '/coleccion'],
    ['/coleccion#q=x', '/coleccion'],
    ['https://orki.app/coleccion', 'https://orki.app/coleccion'],
    ['', ''],
  ])('%s → %s', (url, expected) => {
    expect(stripUrlQuery(url)).toBe(expected)
  })
})

describe('stripQueriesInText', () => {
  it('recorta las URL de un mensaje y deja el resto del texto', () => {
    expect(
      stripQueriesInText(
        'Falló GET https://x.supabase.co/rest/v1/plants?name=ilike.*masdevallia* (500) desde /coleccion?q=masdevallia.',
      ),
    ).toBe(
      'Falló GET https://x.supabase.co/rest/v1/plants (500) desde /coleccion',
    )
  })

  it('no toca un texto sin URL', () => {
    expect(stripQueriesInText('¿Ya la tengo? No.')).toBe('¿Ya la tengo? No.')
  })
})

describe('scrubBreadcrumb', () => {
  it('descarta las migas de la consola', () => {
    expect(
      scrubBreadcrumb({ category: 'console', message: 'Phalaenopsis' }),
    ).toBeNull()
  })

  it('quita la consulta de las navegaciones', () => {
    expect(
      scrubBreadcrumb({
        category: 'navigation',
        data: { from: '/coleccion?q=dracula', to: '/coleccion/nueva' },
      }),
    ).toEqual({
      category: 'navigation',
      data: { from: '/coleccion', to: '/coleccion/nueva' },
    })
  })

  it('quita la consulta de las peticiones y conserva el resto de datos', () => {
    expect(
      scrubBreadcrumb({
        category: 'fetch',
        data: {
          method: 'GET',
          url: 'https://x.supabase.co/rest/v1/plants?name=ilike.*dracula*',
          status_code: 200,
        },
      }),
    ).toEqual({
      category: 'fetch',
      data: {
        method: 'GET',
        url: 'https://x.supabase.co/rest/v1/plants',
        status_code: 200,
      },
    })
  })

  it('quita los textos de los elementos pulsados', () => {
    expect(
      scrubBreadcrumb({
        category: 'ui.click',
        message:
          'main > a.orki-card[aria-label="Ver Dracula vampira"] > img[alt="Foto de Dracula vampira"]',
      }),
    ).toEqual({
      category: 'ui.click',
      message: 'main > a.orki-card[aria-label] > img[alt]',
    })
  })
})

describe('scrubEvent', () => {
  const event: ErrorEvent = {
    type: undefined,
    message: 'Error en /coleccion?q=dracula',
    user: {
      id: 'user_2abc',
      email: 'ana@example.com',
      username: 'Ana Pérez',
      ip_address: '203.0.113.7',
    },
    request: {
      url: 'https://orki.app/coleccion?q=dracula',
      query_string: 'q=dracula',
      cookies: { __session: 'secreto' },
      data: { nombre: 'Dracula vampira' },
      headers: {
        'User-Agent': 'Navegador/1.0',
        Referer: 'https://orki.app/coleccion?q=dracula',
      },
    },
    contexts: {
      culture: { timezone: 'America/Lima', locale: 'es-PE' },
      react: { version: '19' },
    },
    exception: {
      values: [
        {
          type: 'Error',
          value: 'No cargó https://x.supabase.co/rest/v1/plants?q=dracula',
          stacktrace: {
            frames: [
              {
                filename: 'https://orki.app/assets/index-abc.js?v=1',
                abs_path: 'https://orki.app/assets/index-abc.js?v=1',
                lineno: 1,
              },
            ],
          },
        },
      ],
    },
    breadcrumbs: [
      { category: 'console', message: 'Dracula vampira' },
      { category: 'navigation', data: { to: '/coleccion?q=dracula' } },
    ],
  }

  it('deja del usuario solo el id', () => {
    expect(scrubEvent(event).user).toEqual({ id: 'user_2abc' })
  })

  it('sin id, el usuario queda vacío', () => {
    expect(
      scrubEvent({ ...event, user: { email: 'ana@example.com' } }).user,
    ).toEqual({})
  })

  it('deja de la petición solo la URL sin consulta y el User-Agent', () => {
    expect(scrubEvent(event).request).toEqual({
      url: 'https://orki.app/coleccion',
      headers: { 'User-Agent': 'Navegador/1.0' },
    })
  })

  it('quita la zona horaria y conserva los demás contextos', () => {
    expect(scrubEvent(event).contexts).toEqual({ react: { version: '19' } })
  })

  it('recorta las URL del mensaje, la excepción, las trazas y las migas', () => {
    const scrubbed = scrubEvent(event)
    const exception = scrubbed.exception?.values?.[0]

    expect(scrubbed.message).toBe('Error en /coleccion')
    expect(exception?.value).toBe(
      'No cargó https://x.supabase.co/rest/v1/plants',
    )
    expect(exception?.stacktrace?.frames?.[0]).toEqual({
      filename: 'https://orki.app/assets/index-abc.js',
      abs_path: 'https://orki.app/assets/index-abc.js',
      lineno: 1,
    })
    expect(scrubbed.breadcrumbs).toEqual([
      { category: 'navigation', data: { to: '/coleccion' } },
    ])
  })

  it('no modifica el evento recibido', () => {
    const copy = structuredClone(event)
    scrubEvent(event)
    expect(event).toEqual(copy)
  })

  it('nada del resultado lleva correo, nombre, IP ni la búsqueda', () => {
    const json = JSON.stringify(scrubEvent(event))
    for (const forbidden of [
      'ana@example.com',
      'Ana Pérez',
      '203.0.113.7',
      'dracula',
      'secreto',
      'America/Lima',
    ]) {
      expect(json).not.toContain(forbidden)
    }
  })
})
