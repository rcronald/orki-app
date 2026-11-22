import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '../../test/axe.ts'
import { Modal } from './Modal.tsx'

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'Prueba · Orki'
})

function Harness({
  children,
  busy = false,
  returnFocusTo,
  removeOpener = false,
}: {
  children?: (close: () => void) => ReactNode
  busy?: boolean
  returnFocusTo?: () => HTMLElement | null
  removeOpener?: boolean
}) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  return (
    <main>
      {!(removeOpener && open) && (
        <button type="button" onClick={() => setOpen(true)}>
          Abrir
        </button>
      )}
      <button type="button" id="otro">
        Otro botón
      </button>
      {open && (
        <Modal
          title="Título del diálogo"
          describedBy="explicacion"
          busy={busy}
          onCancel={close}
          returnFocusTo={returnFocusTo}
        >
          <p id="explicacion">Qué va a pasar.</p>
          {children ? (
            children(close)
          ) : (
            <>
              <button type="button">Uno</button>
              <button type="button" onClick={close}>
                Dos
              </button>
            </>
          )}
        </Modal>
      )}
    </main>
  )
}

async function openWith(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Abrir' }))
}

describe('Modal', () => {
  it('es un diálogo modal con nombre y descripción, y pasa la revisión', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openWith(user)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('Título del diálogo')
    expect(dialog).toHaveAccessibleDescription('Qué va a pasar.')
    expect(
      screen.getByRole('heading', { level: 2, name: 'Título del diálogo' }),
    ).toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('sin initialFocus, el foco va al primer control', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openWith(user)
    expect(screen.getByRole('button', { name: 'Uno' })).toHaveFocus()
  })

  it('sin controles, el foco va al diálogo y Tab no sale de él', async () => {
    const user = userEvent.setup()
    render(<Harness>{() => <p>Solo texto.</p>}</Harness>)
    await openWith(user)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveFocus()
    await user.tab()
    expect(dialog).toHaveFocus()
  })

  it('deja inerte el resto de la página y lo suelta al cerrar', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Abrir' })
    await openWith(user)
    expect(opener.closest('[inert]')).not.toBeNull()
    expect(screen.getByRole('dialog').closest('[inert]')).toBeNull()
    await user.keyboard('{Escape}')
    expect(document.querySelector('[inert]')).toBeNull()
  })

  it('atrapa el foco con Tab y Mayús+Tab, también si se quedó en el body', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openWith(user)
    const uno = screen.getByRole('button', { name: 'Uno' })
    const dos = screen.getByRole('button', { name: 'Dos' })
    await user.tab()
    expect(dos).toHaveFocus()
    await user.tab()
    expect(uno).toHaveFocus()
    await user.tab({ shift: true })
    expect(dos).toHaveFocus()

    // El botón con el foco desaparece: el foco cae en el body.
    dos.blur()
    expect(document.body).toHaveFocus()
    await user.tab()
    expect(uno).toHaveFocus()
    uno.blur()
    await user.tab({ shift: true })
    expect(dos).toHaveFocus()
  })

  it('en un grupo de botones de opción, Mayús+Tab desde el marcado da la vuelta', async () => {
    const user = userEvent.setup()
    render(
      <Harness>
        {() => (
          <>
            <fieldset>
              <legend>Motivo</legend>
              <label>
                <input type="radio" name="motivo" value="a" />A
              </label>
              <label>
                <input type="radio" name="motivo" value="b" defaultChecked />B
              </label>
            </fieldset>
            <button type="button">Aceptar</button>
          </>
        )}
      </Harness>,
    )
    await openWith(user)
    // El primero al que llega Tab es el marcado, no el primero del grupo.
    const marcado = screen.getByRole('radio', { name: 'B' })
    expect(marcado).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Aceptar' })).toHaveFocus()
    await user.tab()
    expect(marcado).toHaveFocus()
  })

  it('Escape cierra y el foco vuelve al botón que lo abrió', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Abrir' })
    await openWith(user)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).toHaveFocus()
  })

  it('el foco va a returnFocusTo si lo da, o se queda si el que abrió ya no está', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <Harness returnFocusTo={() => document.getElementById('otro')} />,
    )
    await openWith(user)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Otro botón' })).toHaveFocus()
    unmount()

    render(<Harness removeOpener />)
    await openWith(user)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.body).toHaveFocus()
  })

  it('mientras está ocupado, Escape no cierra y se marca aria-busy', async () => {
    const user = userEvent.setup()
    render(<Harness busy />)
    await openWith(user)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-busy', 'true')
    await user.keyboard('{Escape}')
    expect(dialog).toBeInTheDocument()
  })

  it('no se cierra con un Escape que ya usó un control de dentro', async () => {
    const user = userEvent.setup()
    const onEscape = vi.fn()
    render(
      <Harness>
        {() => (
          <input
            aria-label="Buscar"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                onEscape()
              }
            }}
          />
        )}
      </Harness>,
    )
    await openWith(user)
    await user.keyboard('{Escape}')
    expect(onEscape).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('uno encima de otro: solo responde el de arriba y al cerrarlo vuelve al de abajo', async () => {
    const user = userEvent.setup()
    function Inner() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Abrir el segundo
          </button>
          {open && (
            <Modal title="Segundo" onCancel={() => setOpen(false)}>
              <button type="button">Dentro del segundo</button>
            </Modal>
          )}
        </>
      )
    }
    render(<Harness>{() => <Inner />}</Harness>)
    await openWith(user)
    const secondOpener = screen.getByRole('button', {
      name: 'Abrir el segundo',
    })
    await user.click(secondOpener)
    const first = screen.getByRole('dialog', { name: 'Título del diálogo' })
    expect(first.closest('[inert]')).not.toBeNull()
    expect(
      screen.getByRole('button', { name: 'Dentro del segundo' }),
    ).toHaveFocus()

    // Escape cierra solo el de arriba.
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Segundo' })).toBeNull()
    expect(first).toBeInTheDocument()
    expect(first.closest('[inert]')).toBeNull()
    expect(secondOpener).toHaveFocus()
    // Lo de detrás del primero sigue inerte.
    expect(
      screen.getByRole('button', { name: 'Abrir' }).closest('[inert]'),
    ).not.toBeNull()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.querySelector('[inert]')).toBeNull()
  })
})
