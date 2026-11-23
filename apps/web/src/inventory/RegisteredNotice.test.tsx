import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '../test/axe.ts'
import { RegisteredNotice } from './RegisteredNotice.tsx'

// El aviso tras registrar una planta (#85, #261): con «Ver ficha» del
// ejemplar recién creado (#296) y «Registrar otra».

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'orqui.app'
})

function renderNotice(onDismiss = vi.fn()) {
  render(
    <MemoryRouter>
      <main>
        <RegisteredNotice
          plant={{
            id: 'planta 1',
            name: 'Phalaenopsis amabilis',
            scientific: true,
            status: 'validated',
          }}
          onDismiss={onDismiss}
        />
      </main>
    </MemoryRouter>,
  )
}

describe('RegisteredNotice', () => {
  it('«Ver ficha» lleva al ejemplar recién creado y «Registrar otra» se conserva', async () => {
    renderNotice()
    const view = await screen.findByRole('link', { name: 'Ver ficha' })
    expect(view).toHaveAttribute('href', '/coleccion/planta%201')
    expect(
      screen.getByRole('link', { name: 'Registrar otra' }),
    ).toHaveAttribute('href', '/coleccion/nueva')
    // La principal de «Mi colección» es «Registrar orquídea», en la cabecera:
    // en el aviso, las dos son secundarias.
    expect(view).toHaveClass('orki-btn--secondary')
    expect(screen.getByRole('link', { name: 'Registrar otra' })).toHaveClass(
      'orki-btn--secondary',
    )
    await expectNoAxeViolations()
  })

  it('se cierra con «Cerrar el aviso»', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    renderNotice(onDismiss)
    await user.click(
      await screen.findByRole('button', { name: 'Cerrar el aviso' }),
    )
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
