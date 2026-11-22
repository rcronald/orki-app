import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '../../test/axe.ts'
import { MenuButton, type MenuItem } from './MenuButton.tsx'

const onSignOut = vi.fn()

const ITEMS: MenuItem[] = [
  { kind: 'link', label: 'Mi cuenta', icon: 'user', to: '/cuenta' },
  { kind: 'link', label: 'Administración', to: '/administracion/catalogo' },
  { kind: 'separator' },
  { kind: 'action', label: 'Cerrar sesión', onSelect: onSignOut },
]

function renderMenu() {
  return render(
    <MemoryRouter initialEntries={['/coleccion']}>
      <main>
        <MenuButton items={ITEMS} header={<strong>Ana López</strong>}>
          Tu cuenta
        </MenuButton>
        <button type="button">Después</button>
        <Routes>
          <Route path="/coleccion" element={<p>En la colección</p>} />
          <Route path="/cuenta" element={<p>En la cuenta</p>} />
        </Routes>
      </main>
    </MemoryRouter>,
  )
}

const button = () => screen.getByRole('button', { name: 'Tu cuenta' })
const item = (name: string) => screen.getByRole('menuitem', { name })

beforeEach(() => {
  onSignOut.mockReset()
  document.documentElement.lang = 'es'
  document.title = 'Prueba'
})

describe('MenuButton', () => {
  it('cerrado: botón con aria-haspopup y aria-expanded="false"; el menú oculto', async () => {
    renderMenu()

    expect(button()).toHaveAttribute('aria-haspopup', 'menu')
    expect(button()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('al abrir con clic: menú con su nombre, opciones y foco en la primera', async () => {
    const user = userEvent.setup()
    renderMenu()

    await user.click(button())
    expect(button()).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('menu', { name: 'Tu cuenta' })
    expect(button()).toHaveAttribute('aria-controls', menu.id)
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual(
      ['Mi cuenta', 'Administración', 'Cerrar sesión'],
    )
    expect(screen.getByRole('separator')).toHaveClass('orki-menu__separator')
    expect(screen.getByText('Ana López')).toBeVisible()
    expect(item('Mi cuenta')).toHaveFocus()
    expect(item('Mi cuenta')).toHaveAttribute('tabindex', '-1')
    await expectNoAxeViolations()
  })

  it('flechas en bucle, Inicio y Fin', async () => {
    const user = userEvent.setup()
    renderMenu()
    button().focus()

    await user.keyboard('{ArrowDown}')
    expect(item('Mi cuenta')).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(item('Administración')).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(item('Cerrar sesión')).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(item('Mi cuenta')).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(item('Cerrar sesión')).toHaveFocus()
    await user.keyboard('{Home}')
    expect(item('Mi cuenta')).toHaveFocus()
    await user.keyboard('{End}')
    expect(item('Cerrar sesión')).toHaveFocus()
  })

  it('flecha arriba en el botón abre con el foco en la última', async () => {
    const user = userEvent.setup()
    renderMenu()
    button().focus()

    await user.keyboard('{ArrowUp}')
    expect(item('Cerrar sesión')).toHaveFocus()
  })

  it('Intro abre; Escape cierra y devuelve el foco al botón', async () => {
    const user = userEvent.setup()
    renderMenu()
    button().focus()

    await user.keyboard('{Enter}')
    expect(item('Mi cuenta')).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(button()).toHaveFocus()
    expect(button()).toHaveAttribute('aria-expanded', 'false')
  })

  it('Tab cierra y sigue al siguiente control: no atrapa el foco', async () => {
    const user = userEvent.setup()
    renderMenu()

    await user.click(button())
    await user.tab()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Después' })).toHaveFocus()
  })

  it('un clic fuera cierra', async () => {
    const user = userEvent.setup()
    renderMenu()

    await user.click(button())
    fireEvent.pointerDown(screen.getByText('En la colección'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('un enlace navega y cierra; una acción se ejecuta y cierra', async () => {
    const user = userEvent.setup()
    renderMenu()

    await user.click(button())
    await user.click(item('Mi cuenta'))
    expect(screen.getByText('En la cuenta')).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(button())
    await user.keyboard('{End}{Enter}')
    expect(onSignOut).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(button()).toHaveFocus()
  })
})
