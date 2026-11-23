import { describe, expect, it, vi } from 'vitest'
import type { RegisterSWOptions } from 'vite-plugin-pwa/types'
import {
  COMPROBAR_AL_VOLVER_MS,
  COMPROBAR_CADA_MS,
  crearGestorDeActualizacion,
} from './actualizacion.ts'

/** Un entorno simulado: service worker, registro, documento y reloj. */
function entorno({
  ruta = '/coleccion',
  conControl = true,
}: { ruta?: string; conControl?: boolean } = {}) {
  const contenedor = Object.assign(new EventTarget(), {
    controller: conControl ? ({} as ServiceWorker) : null,
  })
  const documento: EventTarget & { visibilityState: DocumentVisibilityState } =
    Object.assign(new EventTarget(), { visibilityState: 'visible' as const })
  const registro = { update: vi.fn(() => Promise.resolve()) }
  const saltarEspera = vi.fn(() => Promise.resolve())
  let opciones: RegisterSWOptions = {}
  let tareaPeriodica: { tarea: () => void; ms: number } | null = null
  const reloj = { ahora: 0 }
  const estado = { ruta }
  const recargar = vi.fn()
  const registrar = vi.fn()

  const gestor = crearGestorDeActualizacion({
    registrar: () =>
      Promise.resolve((o: RegisterSWOptions) => {
        registrar()
        opciones = o
        return saltarEspera
      }),
    serviceWorker: () => contenedor,
    recargar,
    ruta: () => estado.ruta,
    ahora: () => reloj.ahora,
    enLinea: () => true,
    documento: () => documento,
    cadaCierto: (tarea, ms) => {
      tareaPeriodica = { tarea, ms }
    },
  })

  return {
    gestor,
    recargar,
    registrar,
    saltarEspera,
    registro,
    reloj,
    estado,
    documento,
    async iniciar() {
      gestor.iniciar()
      await Promise.resolve()
      await Promise.resolve()
      opciones.onRegisteredSW?.(
        '/sw.js',
        registro as unknown as ServiceWorkerRegistration,
      )
    },
    versionNuevaEsperando() {
      opciones.onNeedRefresh?.()
    },
    /** El service worker de la versión nueva toma el control. */
    cambioDeControl() {
      contenedor.dispatchEvent(new Event('controllerchange'))
    },
    get opciones() {
      return opciones
    },
    get tareaPeriodica() {
      return tareaPeriodica
    },
  }
}

describe('gestor de la versión nueva', () => {
  it('al registrar, una versión nueva que espera pone el estado en «esperando»', async () => {
    const e = entorno()
    await e.iniciar()
    expect(e.gestor.leer().estado).toBe('al-dia')

    const oyente = vi.fn()
    e.gestor.suscribir(oyente)
    e.versionNuevaEsperando()

    expect(e.gestor.leer()).toEqual({
      estado: 'esperando',
      cerrado: false,
      actualizando: false,
    })
    expect(oyente).toHaveBeenCalled()
  })

  it('«Actualizar» activa la versión que espera y recarga cuando toma el control', async () => {
    const e = entorno()
    await e.iniciar()
    e.versionNuevaEsperando()

    e.gestor.actualizar()
    expect(e.saltarEspera).toHaveBeenCalledTimes(1)
    expect(e.gestor.leer().actualizando).toBe(true)
    expect(e.recargar).not.toHaveBeenCalled()

    e.cambioDeControl()
    expect(e.recargar).toHaveBeenCalledTimes(1)
  })

  it('pulsado otra vez mientras actualiza, recarga sin esperar', async () => {
    const e = entorno()
    await e.iniciar()
    e.versionNuevaEsperando()

    e.gestor.actualizar()
    e.gestor.actualizar()

    expect(e.saltarEspera).toHaveBeenCalledTimes(1)
    expect(e.recargar).toHaveBeenCalledTimes(1)
  })

  it('no deja que vite-plugin-pwa recargue por su cuenta', async () => {
    const e = entorno()
    await e.iniciar()
    expect(e.opciones.onNeedReload).toBeTypeOf('function')
    e.opciones.onNeedReload?.()
    expect(e.recargar).not.toHaveBeenCalled()
  })

  it('el primer control (primera visita, clientsClaim) no recarga', async () => {
    const e = entorno({ conControl: false })
    await e.iniciar()

    e.cambioDeControl()
    expect(e.recargar).not.toHaveBeenCalled()

    // El siguiente cambio sí es una versión nueva.
    e.cambioDeControl()
    expect(e.recargar).toHaveBeenCalledTimes(1)
  })

  it('si otra pestaña acepta y esta no está en una pantalla de trabajo, se recarga', async () => {
    const e = entorno({ ruta: '/coleccion' })
    await e.iniciar()
    e.versionNuevaEsperando()

    e.cambioDeControl()

    expect(e.recargar).toHaveBeenCalledTimes(1)
  })

  it('si otra pestaña acepta y esta está en el registro, no se recarga hasta salir de él', async () => {
    const e = entorno({ ruta: '/coleccion/nueva' })
    await e.iniciar()
    e.versionNuevaEsperando()

    e.cambioDeControl()
    expect(e.recargar).not.toHaveBeenCalled()
    expect(e.gestor.leer().estado).toBe('activa')

    // Entre pantallas de trabajo, sigue sin recargar.
    e.gestor.alCambiarDePantalla('/coleccion/abc/editar')
    expect(e.recargar).not.toHaveBeenCalled()

    e.gestor.alCambiarDePantalla('/coleccion')
    expect(e.recargar).toHaveBeenCalledTimes(1)
  })

  it('con la versión ya activa, «Actualizar» solo recarga', async () => {
    const e = entorno({ ruta: '/coleccion/abc' })
    await e.iniciar()
    e.versionNuevaEsperando()
    e.cambioDeControl()

    e.gestor.actualizar()

    expect(e.saltarEspera).not.toHaveBeenCalled()
    expect(e.recargar).toHaveBeenCalledTimes(1)
  })

  it('sin versión nueva, cambiar de pantalla no recarga', async () => {
    const e = entorno()
    await e.iniciar()

    e.gestor.alCambiarDePantalla('/creditos')

    expect(e.recargar).not.toHaveBeenCalled()
  })

  it('«Cerrar el aviso» lo oculta hasta la próxima versión', async () => {
    const e = entorno()
    await e.iniciar()
    e.versionNuevaEsperando()

    e.gestor.cerrarAviso()
    expect(e.gestor.leer().cerrado).toBe(true)

    e.versionNuevaEsperando()
    expect(e.gestor.leer().cerrado).toBe(false)
  })

  it('busca versiones nuevas cada cierto tiempo y al volver a la pestaña', async () => {
    const e = entorno()
    await e.iniciar()
    expect(e.tareaPeriodica?.ms).toBe(COMPROBAR_CADA_MS)

    e.tareaPeriodica?.tarea()
    expect(e.registro.update).toHaveBeenCalledTimes(1)

    // Al volver poco después, no.
    e.reloj.ahora = COMPROBAR_AL_VOLVER_MS - 1
    e.documento.dispatchEvent(new Event('visibilitychange'))
    expect(e.registro.update).toHaveBeenCalledTimes(1)

    e.reloj.ahora = COMPROBAR_AL_VOLVER_MS
    e.documento.dispatchEvent(new Event('visibilitychange'))
    expect(e.registro.update).toHaveBeenCalledTimes(2)

    // Con la pestaña oculta no se busca.
    e.documento.visibilityState = 'hidden'
    e.tareaPeriodica?.tarea()
    expect(e.registro.update).toHaveBeenCalledTimes(2)
  })

  it('se inicia una sola vez', async () => {
    const e = entorno()
    await e.iniciar()
    e.gestor.iniciar()
    await Promise.resolve()
    await Promise.resolve()
    expect(e.registrar).toHaveBeenCalledTimes(1)
    // Y escucha una sola vez: un cambio de control, una recarga.
    e.versionNuevaEsperando()
    e.cambioDeControl()
    expect(e.recargar).toHaveBeenCalledTimes(1)
  })
})
