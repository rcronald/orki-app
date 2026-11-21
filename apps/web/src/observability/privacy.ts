import type { Breadcrumb, ErrorEvent, StackFrame } from '@sentry/react'

// Recorte de lo que sale hacia Sentry. Son funciones puras: reciben el evento
// o la miga que ha armado el SDK y devuelven una copia sin datos personales.
// Se aplican en beforeSend y beforeBreadcrumb (ver sentry-options.ts), después
// de las opciones de dataCollection, como segunda barrera: si una integración
// nueva del SDK añade algo, aquí se queda fuera.
//
// Qué se quita:
// - Usuario: solo queda el id (el de Clerk); nunca correo, nombre ni IP.
// - URL: sin parámetros de consulta ni fragmento. La búsqueda del inventario
//   viaja en ?q= y las peticiones a Supabase llevan el texto buscado en la
//   consulta; ninguno de los dos debe salir de la app.
// - Petición: sin cookies, cuerpo ni cabeceras (salvo User-Agent).
// - Contexto cultural (zona horaria e idioma): la zona horaria da una ubicación
//   aproximada.
// - Migas de la consola (pueden llevar cualquier dato) y los atributos de texto
//   de los elementos pulsados (aria-label, title, alt, name), que pueden llevar
//   el nombre de una planta.

/** Quita la consulta (?…) y el fragmento (#…) de una URL, absoluta o no. */
export function stripUrlQuery(url: string): string {
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}

// URL dentro de un texto (mensajes de error): esquema://… o una ruta /…, hasta
// un espacio o comillas. Solo se recorta lo que va desde ? o #.
const URL_WITH_QUERY =
  /((?:[a-z][a-z0-9+.-]*:\/\/|\/)[^\s"'`<>?#]*)[?#][^\s"'`<>]*/gi

/** Recorta la consulta de todas las URL que aparezcan en un texto. */
export function stripQueriesInText(text: string): string {
  return text.replace(URL_WITH_QUERY, '$1')
}

const USER_AGENT = 'User-Agent'

// Atributos de texto que el SDK añade a la descripción de un elemento pulsado
// (por ejemplo button.orki-btn[aria-label="Ver Phalaenopsis"]).
const TEXT_ATTRIBUTES = /\[(aria-label|title|alt|name)="[^"]*"\]/g

function scrubFrame(frame: StackFrame): StackFrame {
  return {
    ...frame,
    ...(frame.filename !== undefined && {
      filename: stripUrlQuery(frame.filename),
    }),
    ...(frame.abs_path !== undefined && {
      abs_path: stripUrlQuery(frame.abs_path),
    }),
  }
}

function scrubData(data: Breadcrumb['data']): Breadcrumb['data'] | undefined {
  if (data === undefined) return undefined
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    result[key] = typeof value === 'string' ? stripQueriesInText(value) : value
  }
  return result
}

/**
 * Miga sin datos personales, o null si no debe enviarse. Las URL (navegación,
 * fetch, xhr) pierden la consulta; las de consola se descartan.
 */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === 'console') return null
  const scrubbed: Breadcrumb = { ...breadcrumb }
  if (scrubbed.message !== undefined) {
    scrubbed.message = stripQueriesInText(scrubbed.message)
    if (scrubbed.category?.startsWith('ui.')) {
      scrubbed.message = scrubbed.message.replace(TEXT_ATTRIBUTES, '[$1]')
    }
  }
  const data = scrubData(scrubbed.data)
  if (data !== undefined) scrubbed.data = data
  return scrubbed
}

/** Evento sin datos personales (ver el comentario del módulo). */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const scrubbed: ErrorEvent = { ...event }

  if (event.user !== undefined) {
    const id = event.user.id
    scrubbed.user =
      id === undefined || id === null || id === '' ? {} : { id: String(id) }
  }

  if (event.request !== undefined) {
    const userAgent = event.request.headers?.[USER_AGENT]
    scrubbed.request = {
      ...(event.request.url !== undefined && {
        url: stripUrlQuery(event.request.url),
      }),
      ...(userAgent !== undefined && { headers: { [USER_AGENT]: userAgent } }),
    }
  }

  if (event.contexts?.culture !== undefined) {
    const contexts = { ...event.contexts }
    delete contexts.culture
    scrubbed.contexts = contexts
  }

  if (event.message !== undefined) {
    scrubbed.message = stripQueriesInText(event.message)
  }

  if (event.exception?.values !== undefined) {
    scrubbed.exception = {
      ...event.exception,
      values: event.exception.values.map((exception) => ({
        ...exception,
        ...(exception.value !== undefined && {
          value: stripQueriesInText(exception.value),
        }),
        ...(exception.stacktrace?.frames !== undefined && {
          stacktrace: {
            ...exception.stacktrace,
            frames: exception.stacktrace.frames.map(scrubFrame),
          },
        }),
      })),
    }
  }

  if (event.breadcrumbs !== undefined) {
    scrubbed.breadcrumbs = event.breadcrumbs.flatMap((breadcrumb) => {
      const result = scrubBreadcrumb(breadcrumb)
      return result === null ? [] : [result]
    })
  }

  return scrubbed
}
