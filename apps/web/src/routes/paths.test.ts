import { describe, expect, it } from 'vitest'
import {
  internalPathOf,
  PATHS,
  safeRedirectPath,
  signInPathFor,
} from './paths.ts'

const ORIGIN = 'https://orqui.app'

describe('PATHS', () => {
  it('distingue el registro de cuenta del de planta', () => {
    expect(PATHS.signUp).toBe('/registro')
    expect(PATHS.newPlant).toBe('/coleccion/nueva')
    expect(new Set(Object.values(PATHS)).size).toBe(Object.keys(PATHS).length)
  })
})

describe('safeRedirectPath', () => {
  it.each([
    ['/coleccion', '/coleccion'],
    ['/coleccion/nueva?especie=1#foto', '/coleccion/nueva?especie=1#foto'],
    [`${ORIGIN}/catalogo?q=phal`, '/catalogo?q=phal'],
    ['/', '/'],
  ])('acepta la ruta interna %s', (value, expected) => {
    expect(safeRedirectPath(value, ORIGIN)).toBe(expected)
  })

  it.each([
    null,
    undefined,
    '',
    'coleccion',
    '//malicioso.example',
    '/\\malicioso.example',
    '\\\\malicioso.example',
    '/\t/malicioso.example',
    ' /coleccion',
    'https://malicioso.example/coleccion',
    'https://orqui.app.malicioso.example/',
    'http://orqui.app/coleccion',
    'javascript:alert(1)',
    'data:text/html,hola',
    '/iniciar-sesion',
    '/iniciar-sesion/factor-one',
    '/registro?redirect_url=%2F',
  ])('rechaza %s', (value) => {
    expect(safeRedirectPath(value, ORIGIN)).toBeNull()
  })
})

describe('signInPathFor', () => {
  it('lleva la página pedida en redirect_url', () => {
    expect(signInPathFor('/coleccion?x=1')).toBe(
      '/iniciar-sesion?redirect_url=%2Fcoleccion%3Fx%3D1',
    )
  })

  it('sin parámetro si la página es el inicio o no es válida', () => {
    expect(signInPathFor('/')).toBe('/iniciar-sesion')
    expect(signInPathFor('//malicioso.example')).toBe('/iniciar-sesion')
  })
})

describe('internalPathOf', () => {
  it('convierte en ruta lo del mismo origen', () => {
    expect(internalPathOf('/catalogo', ORIGIN)).toBe('/catalogo')
    expect(internalPathOf(`${ORIGIN}/coleccion?x=1#a`, ORIGIN)).toBe(
      '/coleccion?x=1#a',
    )
  })

  it('devuelve null para otro origen', () => {
    expect(
      internalPathOf('https://accounts.google.com/o/oauth2', ORIGIN),
    ).toBeNull()
    expect(internalPathOf('//malicioso.example', ORIGIN)).toBeNull()
  })
})
