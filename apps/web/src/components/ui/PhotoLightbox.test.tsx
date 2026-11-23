import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '../../test/axe.ts'
import { PhotoLightbox } from './PhotoLightbox.tsx'

// Visor a pantalla completa (#183): contador, anterior y siguiente, teclado,
// deslizar, Escape y el foco devuelto.

function Example({ count = 3, onClose = vi.fn() }) {
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  return (
    <main>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir
      </button>
      {open && (
        <PhotoLightbox
          title="Fotos de la planta"
          count={count}
          index={index}
          onIndexChange={setIndex}
          onClose={() => {
            onClose()
            setOpen(false)
          }}
          caption={<p>Nota de la foto {index + 1}</p>}
        >
          <img
            className="orki-lightbox__photo"
            src={`foto-${String(index + 1)}.webp`}
            alt={`Foto ${String(index + 1)}`}
          />
        </PhotoLightbox>
      )}
    </main>
  )
}

/** Un deslizamiento con el dedo sobre la foto. */
function swipe(dx: number, dy = 0) {
  const stage = document.querySelector('.orki-lightbox__stage')
  if (!stage) throw new Error('Sin escenario')
  const init = { pointerId: 1, pointerType: 'touch', isPrimary: true }
  fireEvent.pointerDown(stage, { ...init, clientX: 200, clientY: 300 })
  fireEvent.pointerUp(stage, {
    ...init,
    clientX: 200 + dx,
    clientY: 300 + dy,
  })
}

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'Visor · orqui.app'
})

describe('PhotoLightbox', () => {
  it('es un diálogo con nombre, contador, foco en «Cerrar» y axe sin incumplimientos', async () => {
    const user = userEvent.setup()
    render(<Example />)
    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    const dialog = screen.getByRole('dialog', { name: 'Fotos de la planta' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus()
    expect(screen.getByText('Foto 1 de 3')).toHaveAttribute(
      'aria-live',
      'polite',
    )
    expect(screen.getByText('Nota de la foto 1')).toBeVisible()
    await expectNoAxeViolations()
  })

  it('anterior y siguiente, con botones y flechas, sin dar la vuelta', async () => {
    const user = userEvent.setup()
    render(<Example />)
    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    const previous = screen.getByRole('button', { name: 'Foto anterior' })
    const next = screen.getByRole('button', { name: 'Foto siguiente' })
    expect(previous).toHaveAttribute('aria-disabled', 'true')

    await user.click(previous)
    expect(screen.getByText('Foto 1 de 3')).toBeVisible()
    await user.click(next)
    expect(screen.getByRole('img', { name: 'Foto 2' })).toBeVisible()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByText('Foto 3 de 3')).toBeVisible()
    expect(next).toHaveAttribute('aria-disabled', 'true')
    await user.keyboard('{ArrowRight}')
    expect(screen.getByText('Foto 3 de 3')).toBeVisible()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByText('Foto 2 de 3')).toBeVisible()
  })

  it('deslizar con el dedo pasa de foto; un gesto corto o vertical, no', async () => {
    const user = userEvent.setup()
    render(<Example />)
    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    swipe(-120)
    expect(screen.getByText('Foto 2 de 3')).toBeVisible()
    swipe(120)
    expect(screen.getByText('Foto 1 de 3')).toBeVisible()
    swipe(-20)
    swipe(-60, 200)
    expect(screen.getByText('Foto 1 de 3')).toBeVisible()
  })

  it('con una sola foto no hay anterior ni siguiente', async () => {
    const user = userEvent.setup()
    render(<Example count={1} />)
    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    expect(screen.queryByRole('button', { name: 'Foto siguiente' })).toBeNull()
    expect(screen.getByText('Foto 1 de 1')).toBeVisible()
  })

  it('Escape cierra y el foco vuelve a lo que lo abrió; Tab no sale', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<Example onClose={onClose} />)
    const opener = screen.getByRole('button', { name: 'Abrir' })
    await user.click(opener)
    const dialog = screen.getByRole('dialog')
    for (let step = 0; step < 4; step += 1) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).toHaveFocus()
  })
})
