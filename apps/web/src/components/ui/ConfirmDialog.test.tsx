import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '../../test/axe.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'Prueba · orqui.app'
})

function Harness({
  onConfirm = () => {},
  busy = false,
}: {
  onConfirm?: () => void
  busy?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <main>
      <button type="button" onClick={() => setOpen(true)}>
        Borrar
      </button>
      <a href="#otro">Otro enlace</a>
      {open && (
        <ConfirmDialog
          title="¿Borrar la nota?"
          description="No se puede deshacer."
          confirmLabel="Borrar definitivamente"
          confirmVariant="danger"
          initialFocus="cancel"
          busy={busy}
          onConfirm={onConfirm}
          onCancel={() => setOpen(false)}
        />
      )}
    </main>
  )
}

describe('ConfirmDialog', () => {
  it('es un diálogo modal con nombre y descripción, y pasa la revisión', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Borrar' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('¿Borrar la nota?')
    expect(dialog).toHaveAccessibleDescription('No se puede deshacer.')
    expect(
      screen.getByRole('button', { name: 'Borrar definitivamente' }),
    ).toHaveClass('orki-btn--danger')
    await expectNoAxeViolations()
  })

  it('atrapa el foco, Escape cancela y el foco vuelve al botón que lo abrió', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Borrar' })
    await user.click(trigger)
    const cancel = screen.getByRole('button', { name: 'Cancelar' })
    const confirm = screen.getByRole('button', {
      name: 'Borrar definitivamente',
    })
    expect(cancel).toHaveFocus()
    // Lo de detrás queda inerte.
    expect(trigger.closest('[inert]')).not.toBeNull()
    await user.tab()
    expect(confirm).toHaveFocus()
    await user.tab()
    expect(cancel).toHaveFocus()
    await user.tab({ shift: true })
    expect(confirm).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trigger).toHaveFocus()
    expect(document.querySelector('[inert]')).toBeNull()
  })

  it('mientras está ocupado no se cierra ni vuelve a confirmar', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(<Harness busy onConfirm={onConfirm} />)
    await user.click(screen.getByRole('button', { name: 'Borrar' }))
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'Borrar definitivamente' }),
    )
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
