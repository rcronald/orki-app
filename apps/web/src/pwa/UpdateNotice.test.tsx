import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '../test/axe.ts'
import type { Actualizacion, GestorDeActualizacion } from './actualizacion.ts'
import { UpdateNotice, UpdateWatcher } from './UpdateNotice.tsx'

/** Gestor de prueba: el estado lo pone la prueba. */
function gestorDePrueba(inicial: Partial<Actualizacion> = {}) {
  let actual: Actualizacion = {
    estado: 'al-dia',
    cerrado: false,
    actualizando: false,
    ...inicial,
  }
  const oyentes = new Set<() => void>()
  const poner = (cambios: Partial<Actualizacion>) => {
    actual = { ...actual, ...cambios }
    for (const oyente of oyentes) oyente()
  }
  const gestor: GestorDeActualizacion = {
    iniciar: vi.fn(),
    leer: () => actual,
    suscribir: (oyente) => {
      oyentes.add(oyente)
      return () => oyentes.delete(oyente)
    },
    actualizar: vi.fn(() => poner({ actualizando: true })),
    cerrarAviso: vi.fn(() => poner({ cerrado: true })),
    alCambiarDePantalla: vi.fn(),
  }
  return { gestor, poner }
}

/** La región viva del aviso (siempre montada). */
function region() {
  const elemento = document.querySelector('[aria-live="polite"]')
  if (elemento === null) throw new Error('Falta la región viva del aviso')
  return elemento
}

function pintar(gestor: GestorDeActualizacion, ruta = '/coleccion') {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <UpdateNotice gestor={gestor} />
      <main id="contenido" tabIndex={-1}>
        <h1>Mi colección</h1>
      </main>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'orqui.app'
})

describe('UpdateNotice', () => {
  it('sin versión nueva no muestra nada, pero la región viva ya está', () => {
    const { gestor } = gestorDePrueba()
    pintar(gestor)

    expect(region()).toBeEmptyDOMElement()
    expect(
      screen.queryByRole('button', { name: 'Actualizar' }),
    ).not.toBeInTheDocument()
  })

  it('con una versión nueva, la anuncia en la región viva con «Actualizar» y «Cerrar el aviso»', async () => {
    const { gestor, poner } = gestorDePrueba()
    pintar(gestor)

    act(() => poner({ estado: 'esperando' }))

    expect(region()).toHaveTextContent('Hay una versión nueva de orqui.app.')
    expect(
      screen.getByRole('button', { name: 'Actualizar' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Cerrar el aviso' }),
    ).toBeInTheDocument()
    // No se lleva el foco: es discreto.
    expect(document.body).toHaveFocus()
    await expectNoAxeViolations()
  })

  it('«Actualizar» pide la versión nueva y lo dice mientras tanto', async () => {
    const { gestor } = gestorDePrueba({ estado: 'esperando' })
    pintar(gestor)

    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }))

    expect(gestor.actualizar).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole('button', { name: 'Actualizando…' }),
    ).toBeInTheDocument()
  })

  it('«Cerrar el aviso» lo oculta y deja el foco en el contenido', async () => {
    const { gestor } = gestorDePrueba({ estado: 'esperando' })
    pintar(gestor)

    await userEvent.click(
      screen.getByRole('button', { name: 'Cerrar el aviso' }),
    )

    expect(gestor.cerrarAviso).toHaveBeenCalledTimes(1)
    expect(region()).toBeEmptyDOMElement()
    expect(screen.getByRole('main')).toHaveFocus()
  })

  it('se maneja con el teclado', async () => {
    const { gestor } = gestorDePrueba({ estado: 'esperando' })
    pintar(gestor)
    const user = userEvent.setup()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Actualizar' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(gestor.actualizar).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['el registro', '/coleccion/nueva'],
    ['la edición', '/coleccion/abc/editar'],
    ['la ficha', '/coleccion/abc'],
  ])('no aparece en %s, donde recargar perdería lo escrito', (_, ruta) => {
    const { gestor } = gestorDePrueba({ estado: 'esperando' })
    pintar(gestor, ruta)

    expect(region()).toBeEmptyDOMElement()
    expect(
      screen.queryByRole('button', { name: 'Actualizar' }),
    ).not.toBeInTheDocument()
  })
})

describe('UpdateWatcher', () => {
  it('inicia el gestor y le avisa de cada pantalla', () => {
    const { gestor } = gestorDePrueba()
    render(
      <MemoryRouter initialEntries={['/creditos']}>
        <UpdateWatcher gestor={gestor} />
      </MemoryRouter>,
    )

    expect(gestor.iniciar).toHaveBeenCalledTimes(1)
    expect(gestor.alCambiarDePantalla).toHaveBeenCalledWith('/creditos')
  })
})
