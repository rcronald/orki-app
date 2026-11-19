import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Chip } from './Chip.tsx'

function ToggleChip() {
  const [selected, setSelected] = useState(false)
  return (
    <Chip selected={selected} onClick={() => setSelected((value) => !value)}>
      En floración
    </Chip>
  )
}

describe('Chip', () => {
  it('sin seleccionar: aria-pressed false y sin icono', () => {
    render(<Chip selected={false}>Cattleya</Chip>)

    const chip = screen.getByRole('button', {
      name: 'Cattleya',
      pressed: false,
    })
    expect(chip).toHaveClass('orki-chip')
    expect(chip).toHaveAttribute('type', 'button')
    expect(chip.querySelector('svg')).toBeNull()
  })

  it('seleccionado: aria-pressed true y el icono check antes del texto', () => {
    render(<Chip selected>Phalaenopsis</Chip>)

    const chip = screen.getByRole('button', {
      name: 'Phalaenopsis',
      pressed: true,
    })
    const icon = chip.firstElementChild
    expect(icon?.tagName.toLowerCase()).toBe('svg')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(icon).toHaveClass('lucide-check')
  })

  it('se alterna con clic, Enter y Espacio', async () => {
    const user = userEvent.setup()
    render(<ToggleChip />)

    const chip = screen.getByRole('button', { name: 'En floración' })
    await user.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'true')

    await user.keyboard('{Enter}')
    expect(chip).toHaveAttribute('aria-pressed', 'false')

    await user.keyboard(' ')
    expect(chip).toHaveAttribute('aria-pressed', 'true')
  })

  it('recibe foco con Tab', async () => {
    const user = userEvent.setup()
    render(<Chip selected={false}>Oncidium</Chip>)

    await user.tab()
    expect(screen.getByRole('button', { name: 'Oncidium' })).toHaveFocus()
  })

  it('acepta className, atributos nativos y ref', () => {
    const ref = createRef<HTMLButtonElement>()
    const onClick = vi.fn()
    render(
      <Chip
        ref={ref}
        selected={false}
        className="extra"
        disabled
        onClick={onClick}
      >
        Masdevallia
      </Chip>,
    )

    const chip = screen.getByRole('button')
    expect(ref.current).toBe(chip)
    expect(chip).toHaveClass('orki-chip', 'extra')
    expect(chip).toBeDisabled()
  })
})
