import type { RegisterSWOptions } from 'vite-plugin-pwa/types'
import { esPantallaDeTrabajo } from './pantallas-de-trabajo.ts'

// Versión nueva de la app (#278). El service worker se registra en modo
// «prompt» (vite.config.ts): cuando un despliegue trae una versión nueva, su
// service worker se instala y espera, y la pestaña sigue con el código y el
// precaché de la versión que cargó, así que sus chunks siguen llegando. La
// versión nueva entra cuando la persona pulsa «Actualizar» en el aviso
// (UpdateNotice.tsx) o cuando no queda ninguna pestaña de la app abierta.
//
// Estados:
// - 'al-dia': nada que hacer.
// - 'esperando': hay una versión nueva instalada que espera. Se muestra el
//   aviso (salvo en las pantallas de trabajo, pantallas-de-trabajo.ts).
// - 'activa': otra pestaña aceptó la versión nueva y ya controla esta, que
//   sigue con el código viejo porque estaba en una pantalla de trabajo y no
//   se recargó. Se recarga en cuanto sale de ella (alCambiarDePantalla) o al
//   pulsar «Actualizar».
//
// Cuándo se recarga: cuando el service worker que controla la pestaña cambia
// por otro (controllerchange), no cuando lo toma por primera vez (la primera
// visita, con clientsClaim). Se escucha aquí y no con el onNeedReload de
// vite-plugin-pwa, que en la primera sesión tras instalar no avisa (Workbox
// solo lo considera una actualización si la pestaña ya tenía service worker
// al registrarlo).
//
// Cuándo se entera: el navegador busca un service worker nuevo al registrar
// y al navegar entre documentos, que en una app de una sola página casi no
// pasa. Por eso también se busca al volver a la pestaña (si hace más de
// COMPROBAR_AL_VOLVER_MS de la última vez) y cada COMPROBAR_CADA_MS mientras
// se ve.

export type EstadoDeVersion = 'al-dia' | 'esperando' | 'activa'

export interface Actualizacion {
  estado: EstadoDeVersion
  /** La persona cerró el aviso (hasta la próxima versión o recarga). */
  cerrado: boolean
  /** Pulsó «Actualizar» y se espera a que la versión nueva tome el control. */
  actualizando: boolean
}

export const COMPROBAR_CADA_MS = 60 * 60 * 1000
export const COMPROBAR_AL_VOLVER_MS = 15 * 60 * 1000

type Registrar = (
  opciones: RegisterSWOptions,
) => (recargar?: boolean) => Promise<void>

export interface DependenciasDeActualizacion {
  /** registerSW de virtual:pwa-register. */
  registrar: () => Promise<Registrar>
  /** navigator.serviceWorker, o null si el navegador no lo tiene. */
  serviceWorker: () => Pick<
    ServiceWorkerContainer,
    'controller' | 'addEventListener'
  > | null
  recargar: () => void
  ruta: () => string
  ahora: () => number
  enLinea: () => boolean
  /** Dónde se escucha visibilitychange; en la app, document. */
  documento: () => Pick<Document, 'addEventListener' | 'visibilityState'>
  cadaCierto: (tarea: () => void, ms: number) => void
}

// Propiedades con funciones (no métodos): se pasan sueltas, como
// useSyncExternalStore(gestor.suscribir, gestor.leer).
export interface GestorDeActualizacion {
  iniciar: () => void
  leer: () => Actualizacion
  suscribir: (alCambiar: () => void) => () => void
  actualizar: () => void
  cerrarAviso: () => void
  /** La app cambió de pantalla (React Router, sin recargar). */
  alCambiarDePantalla: (pathname: string) => void
}

export function crearGestorDeActualizacion(
  deps: DependenciasDeActualizacion,
): GestorDeActualizacion {
  let actual: Actualizacion = {
    estado: 'al-dia',
    cerrado: false,
    actualizando: false,
  }
  const oyentes = new Set<() => void>()
  let iniciado = false
  let pidioActualizar = false
  let saltarEspera: ((recargar?: boolean) => Promise<void>) | null = null

  const cambiar = (cambios: Partial<Actualizacion>) => {
    actual = { ...actual, ...cambios }
    for (const oyente of oyentes) oyente()
  }

  // La versión nueva tomó el control de esta pestaña: se pulsó «Actualizar»
  // aquí o en otra pestaña. Recargar trae el código nuevo; en una pantalla
  // de trabajo se espera a que salga de ella.
  const versionNuevaAlMando = () => {
    if (pidioActualizar || !esPantallaDeTrabajo(deps.ruta())) {
      deps.recargar()
    } else {
      cambiar({ estado: 'activa', cerrado: false, actualizando: false })
    }
  }

  const vigilarControl = () => {
    const contenedor = deps.serviceWorker()
    if (contenedor === null) return
    let teniaControl = contenedor.controller !== null
    contenedor.addEventListener('controllerchange', () => {
      if (teniaControl) versionNuevaAlMando()
      teniaControl = true
    })
  }

  const vigilarVersiones = (registro: ServiceWorkerRegistration) => {
    let ultima = deps.ahora()
    const comprobar = () => {
      if (deps.documento().visibilityState !== 'visible' || !deps.enLinea()) {
        return
      }
      ultima = deps.ahora()
      // Sin red o con el servidor caído, update() rechaza: no pasa nada,
      // se intentará la próxima vez.
      registro.update().catch(() => undefined)
    }
    deps.cadaCierto(comprobar, COMPROBAR_CADA_MS)
    deps.documento().addEventListener('visibilitychange', () => {
      if (deps.ahora() - ultima >= COMPROBAR_AL_VOLVER_MS) comprobar()
    })
  }

  return {
    iniciar() {
      if (iniciado) return
      iniciado = true
      vigilarControl()
      void deps.registrar().then((registerSW) => {
        saltarEspera = registerSW({
          onNeedRefresh: () => {
            cambiar({ estado: 'esperando', cerrado: false })
          },
          // Lo decide versionNuevaAlMando; sin esto, vite-plugin-pwa
          // recargaría la pestaña por su cuenta.
          onNeedReload: () => undefined,
          onRegisteredSW: (_url, registro) => {
            if (registro !== undefined) vigilarVersiones(registro)
          },
        })
      })
    },
    leer: () => actual,
    suscribir(alCambiar) {
      oyentes.add(alCambiar)
      return () => oyentes.delete(alCambiar)
    },
    actualizar() {
      // Ya activa, sin service worker que espere, o pulsado dos veces (si el
      // que esperaba desapareció, no llegaría el cambio): recargar basta.
      if (
        actual.estado === 'activa' ||
        saltarEspera === null ||
        actual.actualizando
      ) {
        deps.recargar()
        return
      }
      pidioActualizar = true
      cambiar({ actualizando: true })
      // El service worker que espera se activa (skipWaiting), toma el
      // control y versionNuevaAlMando recarga.
      void saltarEspera()
    },
    cerrarAviso() {
      cambiar({ cerrado: true })
    },
    alCambiarDePantalla(pathname) {
      if (actual.estado === 'activa' && !esPantallaDeTrabajo(pathname)) {
        deps.recargar()
      }
    },
  }
}

/**
 * El de la app: registra el service worker de verdad. Las dependencias son
 * funciones y no valores porque el módulo también se evalúa en Node, al
 * prerrenderar la portada (prerender/), donde no hay window ni document.
 */
export const actualizacion = crearGestorDeActualizacion({
  registrar: () =>
    import('virtual:pwa-register').then((modulo) => modulo.registerSW),
  serviceWorker: () =>
    'serviceWorker' in navigator ? navigator.serviceWorker : null,
  recargar: () => window.location.reload(),
  ruta: () => window.location.pathname,
  ahora: () => Date.now(),
  enLinea: () => navigator.onLine !== false,
  documento: () => document,
  cadaCierto: (tarea, ms) => {
    setInterval(tarea, ms)
  },
})
