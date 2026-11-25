// @vitest-environment node
import { esMX } from '@clerk/localizations/es-MX'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  MODULO_ES_MX,
  moduloEsMx,
  sinCadenasSinTraducir,
} from './localizacion-clerk.ts'

/** Cada cadena de un objeto anidado, como «ruta.de.la.clave» → texto. */
function cadenas(valor: unknown, prefijo = ''): Map<string, unknown> {
  const encontradas = new Map<string, unknown>()
  if (valor === null || typeof valor !== 'object') {
    if (valor !== undefined) encontradas.set(prefijo, valor)
    return encontradas
  }
  for (const [clave, interior] of Object.entries(valor)) {
    for (const entrada of cadenas(interior, `${prefijo}${clave}.`)) {
      encontradas.set(...entrada)
    }
  }
  return encontradas
}

describe('sinCadenasSinTraducir', () => {
  it('quita los undefined y los objetos que se quedan vacíos', () => {
    expect(
      sinCadenasSinTraducir({
        locale: 'es-MX',
        titulo: undefined,
        signIn: { start: { title: 'Inicia sesión', subtitle: undefined } },
        apiKeys: {
          action__add: undefined,
          copySecret: { formTitle: undefined },
        },
      }),
    ).toEqual({
      locale: 'es-MX',
      signIn: { start: { title: 'Inicia sesión' } },
    })
  })

  it('conserva cada cadena traducida de es-MX, con su ruta y su texto', () => {
    const limpia = sinCadenasSinTraducir(esMX)
    expect(cadenas(limpia)).toEqual(cadenas(esMX))
    expect(cadenas(limpia).size).toBeGreaterThan(500)
    // Y no queda ningún undefined ni objeto vacío.
    const sobrantes: string[] = []
    const recorrer = (valor: unknown, ruta: string) => {
      if (valor === undefined) sobrantes.push(ruta)
      if (valor === null || typeof valor !== 'object') return
      if (Object.keys(valor).length === 0) sobrantes.push(ruta)
      for (const [clave, interior] of Object.entries(valor)) {
        recorrer(interior, `${ruta}.${clave}`)
      }
    }
    recorrer(limpia, 'esMX')
    expect(sobrantes).toEqual([])
  })
})

describe('moduloEsMx', () => {
  it('exporta esMX con el mismo contenido traducido', async () => {
    const codigo = moduloEsMx(esMX)
    const modulo = (await import(
      `data:text/javascript,${encodeURIComponent(codigo)}`
    )) as { esMX: unknown }
    expect(cadenas(modulo.esMX)).toEqual(cadenas(esMX))
    expect(codigo.length).toBeLessThan(60_000)
  })
})

describe('MODULO_ES_MX', () => {
  it('reconoce el archivo al que resuelve @clerk/localizations/es-MX', () => {
    const ruta = fileURLToPath(
      import.meta.resolve('@clerk/localizations/es-MX'),
    )
    expect(ruta).toMatch(MODULO_ES_MX)
  })
})
