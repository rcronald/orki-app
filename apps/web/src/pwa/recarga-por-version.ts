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

/** Clave con la que se comprueba que sessionStorage admite escrituras. */
const PRUEBA_DE_ESCRITURA = 'orki:recarga-por-version:prueba'

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

/**
 * Tiempo desde beforeunload en el que se considera que la página se está
 * yendo, y lo que se espera antes de recargar igualmente si sigue aquí.
 */
export const SALIDA_MS = 10_000

export interface DependenciasDeRecarga {
  enLinea: () => boolean
  /** sessionStorage, o null si no se puede usar. */
  almacen: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
  ahora: () => number
  recargar: () => void
  /** Si la página empezó a irse (beforeunload) hace menos de SALIDA_MS. */
  saliendo: () => boolean
  /** setTimeout. */
  programar: (tarea: () => void, ms: number) => void
}

function almacenDeSesion(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

let salidaDesde: number | null = null

const DEPENDENCIAS: DependenciasDeRecarga = {
  enLinea: () => navigator.onLine !== false,
  almacen: almacenDeSesion,
  ahora: () => Date.now(),
  recargar: () => window.location.reload(),
  saliendo: () => seEstaYendo(),
  programar: (tarea, ms) => {
    setTimeout(tarea, ms)
  },
}

/** La página empezó a irse (beforeunload) hace menos de SALIDA_MS. */
export function seEstaYendo(ahora = Date.now()): boolean {
  return salidaDesde !== null && ahora - salidaDesde < SALIDA_MS
}

/**
 * Lo que se espera, tras un chunk que no llegó, a que la página diga que se
 * va (beforeunload) antes de tratarlo como un despliegue o como un fallo
 * (#308). Al volver atrás o adelante en el historial a otro documento, WebKit
 * cancela los import() en curso y los rechaza unos milisegundos antes de
 * disparar beforeunload (medido en las pruebas: entre 1 y 7 ms, también con
 * la máquina muy cargada); al pulsar un enlace, en cambio, beforeunload llega
 * primero.
 */
export const ESPERA_SALIDA_MS = 500

/**
 * Anota cuándo empieza a irse la página (beforeunload, solo escuchado: no
 * pregunta nada). Safari cancela los import() en curso al empezar una
 * navegación a otra página, antes de que la página se vaya: sin esto, ese
 * fallo recargaba la página actual y la recarga interrumpía la navegación
 * (visto en las pruebas de WebKit: ir de la portada a /catalogo mientras
 * llegaba el chunk de la app terminaba otra vez en la portada). Se llama una
 * vez desde main.tsx.
 */
export function vigilarSalida(
  objetivo: Pick<Window, 'addEventListener'> = window,
): void {
  objetivo.addEventListener('beforeunload', () => {
    salidaDesde = Date.now()
  })
  objetivo.addEventListener('pageshow', () => {
    salidaDesde = null
  })
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
 * Se resuelve, pasado ESPERA_SALIDA_MS, con si la página empezó a irse: así
 * un chunk que no llegó porque la navegación lo canceló no se confunde con
 * un fallo aunque beforeunload llegue después del rechazo (#308). Lo usa el
 * envío a Sentry (observability/sentry-options.ts).
 */
export function esperarSalida(
  deps: Pick<DependenciasDeRecarga, 'saliendo' | 'programar'> = DEPENDENCIAS,
): Promise<boolean> {
  return new Promise((resolver) => {
    deps.programar(() => resolver(deps.saliendo()), ESPERA_SALIDA_MS)
  })
}

/** Recarga pasado SALIDA_MS si la página sigue aquí (no llegó a irse). */
function recargarSiNoSeVa(deps: DependenciasDeRecarga): void {
  deps.programar(() => {
    marcar(deps)
    deps.recargar()
  }, SALIDA_MS)
}

/**
 * Si el error es un chunk que no llegó con conexión y no se recargó hace
 * poco, recarga la página y devuelve true; si no, false (el error sigue su
 * camino: pantalla de fallo y Sentry).
 *
 * Si la página se está yendo (vigilarSalida), el fallo es la navegación que
 * cancela la carga, no un despliegue: no se recarga, ni se muestra la
 * pantalla de fallo, ni se envía a Sentry (devuelve true). Si la navegación
 * no llega a ocurrir (por ejemplo, se canceló el aviso de cambios sin
 * guardar), se recarga pasado SALIDA_MS, para no dejar la pantalla a medias.
 *
 * La recarga espera ESPERA_SALIDA_MS: al volver atrás en el historial, Safari
 * rechaza el import() antes de avisar de que la página se va (#308). Si en
 * ese tiempo llega el aviso, es la navegación y se sigue como arriba; si no,
 * se deja la marca y se recarga. La marca no se deja antes: la página a la
 * que se va comparte sessionStorage, y perdería la red de seguridad.
 */
export function recargarPorVersion(
  error: unknown,
  deps: DependenciasDeRecarga = DEPENDENCIAS,
): boolean {
  if (!esFalloDeCargaDeChunk(error)) return false
  if (recargando) return true
  if (deps.saliendo()) {
    recargando = true
    recargarSiNoSeVa(deps)
    return true
  }
  if (!deps.enLinea()) return false
  const almacen = deps.almacen()
  if (almacen === null) return false
  try {
    const anterior = Number(almacen.getItem(MARCA_DE_RECARGA))
    if (anterior > 0 && deps.ahora() - anterior < VENTANA_MS) return false
    // Ya, y no al recargar: si no se puede escribir, no habría marca contra
    // los bucles y no se recarga.
    almacen.setItem(PRUEBA_DE_ESCRITURA, '1')
    almacen.removeItem(PRUEBA_DE_ESCRITURA)
  } catch {
    return false
  }
  recargando = true
  deps.programar(() => {
    if (deps.saliendo()) {
      recargarSiNoSeVa(deps)
      return
    }
    marcar(deps)
    deps.recargar()
  }, ESPERA_SALIDA_MS)
  return true
}

function marcar(deps: DependenciasDeRecarga): void {
  try {
    deps.almacen()?.setItem(MARCA_DE_RECARGA, String(deps.ahora()))
  } catch {
    // Sin almacenamiento, sin marca.
  }
}

/** Solo para pruebas: olvida que hay una recarga en curso. */
export function reiniciarRecargaPorVersion(): void {
  recargando = false
  salidaDesde = null
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
