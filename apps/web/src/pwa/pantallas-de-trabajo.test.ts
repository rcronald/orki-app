import { describe, expect, it } from 'vitest'
import { esPantallaDeTrabajo } from './pantallas-de-trabajo.ts'

describe('esPantallaDeTrabajo', () => {
  it('el registro, la edición, la ficha, el backoffice y el acceso lo son', () => {
    for (const ruta of [
      '/coleccion/nueva',
      '/coleccion/abc-123',
      '/coleccion/abc-123/editar',
      '/administracion/catalogo',
      '/iniciar-sesion',
      '/iniciar-sesion/factor-one',
      '/registro/verificar',
    ]) {
      expect(esPantallaDeTrabajo(ruta), ruta).toBe(true)
    }
  })

  it('el resto no', () => {
    for (const ruta of [
      '/',
      '/coleccion',
      '/ya-la-tengo',
      '/catalogo',
      '/catalogo/phalaenopsis',
      '/cuenta',
      '/privacidad',
      '/creditos',
      '/no-existe',
    ]) {
      expect(esPantallaDeTrabajo(ruta), ruta).toBe(false)
    }
  })
})
