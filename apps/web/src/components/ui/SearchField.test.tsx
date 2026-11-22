import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '../../test/axe.ts'
import { SearchField } from './SearchField.tsx'

function Harness({ hideLabel = false }: { hideLabel?: boolean }) {
  const [value, setValue] = useState('')
  return (
    <main>
      <SearchField
        label="Buscar en mi colección"
        hideLabel={hideLabel}
        placeholder="Busca en mis orquídeas…"
        value={value}
        onValueChange={setValue}
      />
      <button type="button">Después</button>
    </main>
  )
}

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'Prueba'
})

describe('SearchField', () => {
  it('campo de búsqueda con etiqueta, lupa y sin botón de borrar vacío', async () => {
    render(<Harness />)

    const input = screen.getByRole('searchbox', {
      name: 'Buscar en mi colección',
    })
    expect(input).toHaveClass('orki-field__input', 'orki-search__input')
    expect(screen.getByText('Buscar en mi colección')).toHaveClass(
      'orki-field__label',
    )
    expect(input.parentElement).toHaveClass('orki-search')
    expect(
      input.parentElement?.querySelector('.orki-search__icon'),
    ).toHaveAttribute('aria-hidden', 'true')
    expect(
      screen.queryByRole('button', { name: 'Borrar la búsqueda' }),
    ).not.toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('con texto, el botón de borrar lo vacía y devuelve el foco', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const input = screen.getByRole('searchbox')

    await user.type(input, 'cattleya')
    const clear = screen.getByRole('button', { name: 'Borrar la búsqueda' })
    expect(clear).toHaveClass('orki-search__clear')
    await expectNoAxeViolations()

    await user.click(clear)
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
  })

  it('Escape borra el texto', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const input = screen.getByRole('searchbox')

    await user.type(input, 'vanda{Escape}')
    expect(input).toHaveValue('')
  })

  it('con hideLabel, la etiqueta queda solo para el lector de pantalla', async () => {
    render(<Harness hideLabel />)

    expect(screen.getByText('Buscar en mi colección')).toHaveClass('sr-only')
    expect(
      screen.getByRole('searchbox', { name: 'Buscar en mi colección' }),
    ).toBeInTheDocument()
    await expectNoAxeViolations()
  })
})
