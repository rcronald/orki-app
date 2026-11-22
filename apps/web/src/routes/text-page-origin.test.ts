import { describe, expect, it } from 'vitest'
import {
  privacyLinkProps,
  textPageBack,
  textPageOrigin,
  textPageState,
} from './text-page-origin.ts'

describe('origen de las páginas de texto', () => {
  it('construye el estado y las props del enlace a la privacidad', () => {
    expect(textPageState('registro')).toEqual({ origen: 'registro' })
    expect(privacyLinkProps('cuenta')).toEqual({
      to: '/privacidad',
      state: { origen: 'cuenta' },
    })
  })

  it.each([
    [{ origen: 'inicio' }, '/', 'Volver al inicio'],
    [{ origen: 'registro' }, '/registro', 'Volver al registro'],
    [{ origen: 'coleccion' }, '/coleccion', 'Volver a Mi colección'],
    [{ origen: 'cuenta' }, '/cuenta', 'Volver a Tu cuenta'],
  ])('%o lleva a %s', (state, to, label) => {
    expect(textPageBack(state)).toEqual({ to, label })
  })

  it.each([
    null,
    undefined,
    'cuenta',
    {},
    { origen: 'toString' },
    { origen: 3 },
  ])('sin un origen válido (%o), al inicio', (state) => {
    expect(textPageOrigin(state)).toBeNull()
    expect(textPageBack(state)).toEqual({ to: '/', label: 'Volver al inicio' })
  })
})
