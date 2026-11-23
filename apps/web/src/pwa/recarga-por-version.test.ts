import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  esFalloDeCargaDeChunk,
  MARCA_DE_RECARGA,
  recargaEnCurso,
  recargarPorVersion,
  reiniciarRecargaPorVersion,
  SALIDA_MS,
  VENTANA_MS,
  vigilarFallosDeCarga,
  seEstaYendo,
  vigilarSalida,
  type DependenciasDeRecarga,
} from './recarga-por-version.ts'

const CHROME = new TypeError(
  'Failed to fetch dynamically imported module: https://orqui.app/assets/CreditsPage-BJFUgrOu.js',
)

function almacenEnMemoria(inicial: Record<string, string> = {}) {
  const datos = new Map(Object.entries(inicial))
  return {
    getItem: (clave: string) => datos.get(clave) ?? null,
    setItem: (clave: string, valor: string) => {
      datos.set(clave, valor)
    },
    datos,
  }
}

function dependencias(
  cambios: Partial<DependenciasDeRecarga> = {},
): DependenciasDeRecarga & { recargar: ReturnType<typeof vi.fn> } {
  const almacen = almacenEnMemoria()
  return {
    enLinea: () => true,
    almacen: () => almacen,
    ahora: () => 1_000_000,
    recargar: vi.fn(),
    saliendo: () => false,
    programar: vi.fn(),
    ...cambios,
  } as DependenciasDeRecarga & { recargar: ReturnType<typeof vi.fn> }
}

afterEach(() => {
  reiniciarRecargaPorVersion()
})

describe('esFalloDeCargaDeChunk', () => {
  it('reconoce el import() que no llega en Chrome, Firefox y Safari, y la hoja de estilos de Vite', () => {
    expect(esFalloDeCargaDeChunk(CHROME)).toBe(true)
    expect(
      esFalloDeCargaDeChunk(
        new TypeError(
          'error loading dynamically imported module: https://orqui.app/assets/x.js',
        ),
      ),
    ).toBe(true)
    expect(
      esFalloDeCargaDeChunk(new TypeError('Importing a module script failed.')),
    ).toBe(true)
    expect(
      esFalloDeCargaDeChunk(
        new Error('Unable to preload CSS for /assets/index.css'),
      ),
    ).toBe(true)
  })

  it('no confunde otros errores', () => {
    expect(esFalloDeCargaDeChunk(new TypeError('Failed to fetch'))).toBe(false)
    expect(esFalloDeCargaDeChunk(new Error('Componente roto'))).toBe(false)
    expect(esFalloDeCargaDeChunk(undefined)).toBe(false)
  })
})

describe('recargarPorVersion', () => {
  it('con conexión recarga una vez y deja la marca en la sesión', () => {
    const almacen = almacenEnMemoria()
    const deps = dependencias({ almacen: () => almacen })

    expect(recargarPorVersion(CHROME, deps)).toBe(true)
    expect(deps.recargar).toHaveBeenCalledTimes(1)
    expect(almacen.datos.get(MARCA_DE_RECARGA)).toBe('1000000')
    expect(recargaEnCurso()).toBe(true)

    // Lo que siga fallando mientras recarga no vuelve a recargar.
    expect(recargarPorVersion(CHROME, deps)).toBe(true)
    expect(deps.recargar).toHaveBeenCalledTimes(1)
  })

  it('si ya recargó hace menos de la ventana, es un fallo real: no recarga', () => {
    const almacen = almacenEnMemoria({
      [MARCA_DE_RECARGA]: String(1_000_000 - VENTANA_MS + 1),
    })
    const deps = dependencias({ almacen: () => almacen })

    expect(recargarPorVersion(CHROME, deps)).toBe(false)
    expect(deps.recargar).not.toHaveBeenCalled()
    expect(recargaEnCurso()).toBe(false)
  })

  it('pasada la ventana, un despliegue nuevo vuelve a recargar', () => {
    const almacen = almacenEnMemoria({
      [MARCA_DE_RECARGA]: String(1_000_000 - VENTANA_MS),
    })
    const deps = dependencias({ almacen: () => almacen })

    expect(recargarPorVersion(CHROME, deps)).toBe(true)
    expect(deps.recargar).toHaveBeenCalledTimes(1)
  })

  it('sin conexión no recarga: no es un despliegue', () => {
    const deps = dependencias({ enLinea: () => false })

    expect(recargarPorVersion(CHROME, deps)).toBe(false)
    expect(deps.recargar).not.toHaveBeenCalled()
  })

  it('sin sessionStorage no recarga: no habría protección contra los bucles', () => {
    const bloqueado = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('SecurityError')
      },
    }
    expect(
      recargarPorVersion(CHROME, dependencias({ almacen: () => null })),
    ).toBe(false)
    const deps = dependencias({ almacen: () => bloqueado })
    expect(recargarPorVersion(CHROME, deps)).toBe(false)
    expect(deps.recargar).not.toHaveBeenCalled()
  })

  it('otro error no recarga', () => {
    const deps = dependencias()

    expect(recargarPorVersion(new Error('Componente roto'), deps)).toBe(false)
    expect(deps.recargar).not.toHaveBeenCalled()
  })
})

describe('con la página yéndose (Safari cancela los import() al navegar)', () => {
  it('no recarga, no deja ver la pantalla de fallo ni lo envía, y no deja marca', () => {
    const almacen = almacenEnMemoria()
    const programar = vi.fn()
    const deps = dependencias({
      saliendo: () => true,
      almacen: () => almacen,
      programar,
    })

    expect(
      recargarPorVersion(
        new TypeError('Importing a module script failed.'),
        deps,
      ),
    ).toBe(true)
    expect(deps.recargar).not.toHaveBeenCalled()
    expect(recargaEnCurso()).toBe(true)
    expect(almacen.datos.has(MARCA_DE_RECARGA)).toBe(false)
    expect(programar).toHaveBeenCalledWith(expect.any(Function), SALIDA_MS)
  })

  it('si la página sigue aquí pasado el plazo (navegación cancelada), recarga con su marca', () => {
    const almacen = almacenEnMemoria()
    let tarea: (() => void) | undefined
    const deps = dependencias({
      saliendo: () => true,
      almacen: () => almacen,
      programar: (t) => {
        tarea = t
      },
    })
    recargarPorVersion(CHROME, deps)

    tarea?.()

    expect(deps.recargar).toHaveBeenCalledTimes(1)
    expect(almacen.datos.get(MARCA_DE_RECARGA)).toBe('1000000')
  })

  it('vigilarSalida anota beforeunload, lo olvida con pageshow y caduca', () => {
    const objetivo = new EventTarget()
    vigilarSalida(objetivo)
    expect(seEstaYendo()).toBe(false)

    objetivo.dispatchEvent(new Event('beforeunload'))
    expect(seEstaYendo()).toBe(true)
    expect(seEstaYendo(Date.now() + SALIDA_MS)).toBe(false)

    objetivo.dispatchEvent(new Event('pageshow'))
    expect(seEstaYendo()).toBe(false)
  })
})

describe('vigilarFallosDeCarga', () => {
  function evento(payload: unknown) {
    const e = new Event('vite:preloadError', { cancelable: true })
    Object.assign(e, { payload })
    return e
  }

  it('recarga con el vite:preloadError de un chunk y no cancela el evento', () => {
    const objetivo = new EventTarget()
    const deps = dependencias()
    vigilarFallosDeCarga(() => false, objetivo, deps)

    const e = evento(CHROME)
    objetivo.dispatchEvent(e)

    expect(deps.recargar).toHaveBeenCalledTimes(1)
    // El error sigue hasta quien hizo el import().
    expect(e.defaultPrevented).toBe(false)
  })

  it('en una pantalla de trabajo no recarga', () => {
    const objetivo = new EventTarget()
    const deps = dependencias()
    vigilarFallosDeCarga(() => true, objetivo, deps)

    objetivo.dispatchEvent(evento(CHROME))

    expect(deps.recargar).not.toHaveBeenCalled()
  })
})
