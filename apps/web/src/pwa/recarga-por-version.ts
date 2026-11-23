// Red de seguridad tras un despliegue (#278). Si una pestaña con el código
// viejo pide un chunk que ya no existe (Vercel responde 404 en assets/), el
// import() falla. Con conexión, eso es casi siempre un despliegue de por
// medio, no un fallo de la app: en lugar de la pantalla «Algo salió mal», la
// página se recarga una sola vez y arranca con la versión nueva. No se envía
// a Sentry.
//
// - Sin conexión no se recarga: no es un despliegue, es que no hay red (lo de
//   siempre: la pantalla de fallo, y noise.ts no lo envía).
// - Una sola vez: antes de recargar se deja la hora en sessionStorage. Si
//   vuelve a fallar antes de VENTANA_MS, no es un despliegue (el chunk falta
//   de verdad): pantalla de fallo y Sentry, como cualquier error. Sin
//   sessionStorage (bloqueado) no hay protección contra los bucles, así que
//   tampoco se recarga.
//
// Llegan aquí los import() rechazados de las rutas diferidas (lazy(), por el
// límite de errores, ErrorBoundary.tsx) y el evento vite:preloadError, con el
// que Vite avisa de cualquier import() dinámico que falla (vigilarFallosDeCarga,
// desde UpdateNotice.tsx, en el chunk de la app). Este módulo va en el
// JavaScript inicial (lo usa el límite de errores), así que no importa nada:
// la comprobación de las pantallas de trabajo llega como parámetro.

/** Clave de sessionStorage con la hora (ms) de la última recarga. */
export const MARCA_DE_RECARGA = 'orki:recarga-por-version'

/** Tiempo en el que un segundo fallo ya no provoca otra recarga. */
export const VENTANA_MS = 60_000

// Mensajes con los que los navegadores rechazan un import() que no llega:
// Chrome, Firefox y Safari, y el de Vite cuando no llega una hoja de estilos
// de un chunk.
const FALLO_DE_CARGA = [
  /^Failed to fetch dynamically imported module/,
  /^error loading dynamically imported module/,
  /^Importing a module script failed/,
  /^Unable to preload CSS/,
]

export function esFalloDeCargaDeChunk(error: unknown): boolean {
  const mensaje =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : undefined
  return (
    mensaje !== undefined &&
    FALLO_DE_CARGA.some((patron) => patron.test(mensaje))
  )
}

export interface DependenciasDeRecarga {
  enLinea: () => boolean
  /** sessionStorage, o null si no se puede usar. */
  almacen: () => Pick<Storage, 'getItem' | 'setItem'> | null
  ahora: () => number
  recargar: () => void
}

function almacenDeSesion(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

const DEPENDENCIAS: DependenciasDeRecarga = {
  enLinea: () => navigator.onLine !== false,
  almacen: almacenDeSesion,
  ahora: () => Date.now(),
  recargar: () => window.location.reload(),
}

let recargando = false

/**
 * true desde que se decidió recargar por una versión nueva: los errores de
 * carga que lleguen mientras tanto no son fallos (ver noise.ts).
 */
export function recargaEnCurso(): boolean {
  return recargando
}

/**
 * Si el error es un chunk que no llegó con conexión y no se recargó hace
 * poco, recarga la página y devuelve true; si no, false (el error sigue su
 * camino: pantalla de fallo y Sentry).
 */
export function recargarPorVersion(
  error: unknown,
  deps: DependenciasDeRecarga = DEPENDENCIAS,
): boolean {
  if (!esFalloDeCargaDeChunk(error)) return false
  if (recargando) return true
  if (!deps.enLinea()) return false
  const almacen = deps.almacen()
  if (almacen === null) return false
  const ahora = deps.ahora()
  try {
    const anterior = Number(almacen.getItem(MARCA_DE_RECARGA))
    if (anterior > 0 && ahora - anterior < VENTANA_MS) return false
    almacen.setItem(MARCA_DE_RECARGA, String(ahora))
  } catch {
    return false
  }
  recargando = true
  deps.recargar()
  return true
}

/** Solo para pruebas: olvida que hay una recarga en curso. */
export function reiniciarRecargaPorVersion(): void {
  recargando = false
}

/**
 * Escucha vite:preloadError. No cancela el evento: el error sigue hasta quien
 * hizo el import() (en una ruta diferida, el límite de errores, que ve la
 * recarga en curso y no muestra la pantalla de fallo). En una pantalla de
 * trabajo no recarga por un import() fuera del pintado (por ejemplo, el que
 * prepara una foto): la pantalla muestra su propio error y no se pierde lo
 * escrito.
 */
export function vigilarFallosDeCarga(
  enPantallaDeTrabajo: () => boolean,
  objetivo: Pick<Window, 'addEventListener'> = window,
  deps: DependenciasDeRecarga = DEPENDENCIAS,
): void {
  objetivo.addEventListener('vite:preloadError', (event) => {
    if (enPantallaDeTrabajo()) return
    recargarPorVersion(event.payload, deps)
  })
}
