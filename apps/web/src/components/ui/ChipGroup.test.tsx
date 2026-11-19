import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Chip } from './Chip.tsx'
import { ChipGroup } from './ChipGroup.tsx'

describe('ChipGroup', () => {
  it('agrupa los chips en orki-chips con su nombre', () => {
    render(
      <ChipGroup aria-label="Género" className="extra">
        <Chip selected>Phalaenopsis</Chip>
        <Chip selected={false}>Cattleya</Chip>
      </ChipGroup>,
    )

    const group = screen.getByRole('group', { name: 'Género' })
    expect(group).toHaveClass('orki-chips', 'extra')
    expect(within(group).getAllByRole('button')).toHaveLength(2)
  })

  it('permite cambiar el rol', () => {
    render(
      <ChipGroup role="toolbar" aria-label="Filtros">
        <Chip selected={false}>En floración</Chip>
      </ChipGroup>,
    )

    expect(screen.getByRole('toolbar', { name: 'Filtros' })).toHaveClass(
      'orki-chips',
    )
  })

  it('se recorre con Tab en orden', async () => {
    const user = userEvent.setup()
    render(
      <ChipGroup aria-label="Género">
        <Chip selected>Phalaenopsis</Chip>
        <Chip selected={false}>Cattleya</Chip>
      </ChipGroup>,
    )

    await user.tab()
    expect(screen.getByRole('button', { name: 'Phalaenopsis' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Cattleya' })).toHaveFocus()
  })
})
