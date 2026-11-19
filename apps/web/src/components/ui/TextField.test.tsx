import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { TextField } from './TextField.tsx'

describe('TextField', () => {
  it('etiqueta visible enlazada al input, sin ayuda ni error', () => {
    render(<TextField label="Origen" placeholder="Tienda o vivero" />)

    const input = screen.getByRole('textbox', { name: 'Origen' })
    expect(input).toHaveClass('orki-field__input')
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveAttribute('placeholder', 'Tienda o vivero')
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input).not.toHaveAttribute('aria-describedby')
    expect(screen.getByText('Origen')).toHaveClass('orki-field__label')
    expect(input.closest('.orki-field')).not.toBeNull()
  })

  it('la ayuda describe el campo y no forma parte de su nombre', () => {
    render(<TextField label="Origen" hint="Recordamos los que ya usaste." />)

    const input = screen.getByRole('textbox', { name: 'Origen' })
    expect(input).toHaveAccessibleDescription('Recordamos los que ya usaste.')
    expect(screen.getByText('Recordamos los que ya usaste.')).toHaveClass(
      'orki-field__hint',
    )
  })

  it('error: aria-invalid, icono triangle-alert y mensaje enlazado', () => {
    render(
      <TextField
        label="Fecha de adquisición"
        hint="Día, mes y año."
        error="Escribe una fecha válida."
      />,
    )

    const input = screen.getByRole('textbox', { name: 'Fecha de adquisición' })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription(
      'Escribe una fecha válida. Día, mes y año.',
    )

    const message = screen.getByText('Escribe una fecha válida.')
    expect(message).toHaveClass('orki-field__error')
    const icon = message.querySelector('svg')
    expect(icon).toHaveClass('lucide-triangle-alert')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('suma su descripción a un aria-describedby propio', () => {
    render(
      <>
        <p id="extra">Opcional.</p>
        <TextField
          label="Origen"
          hint="Tienda o vivero."
          aria-describedby="extra"
        />
      </>,
    )

    expect(screen.getByRole('textbox')).toHaveAccessibleDescription(
      'Opcional. Tienda o vivero.',
    )
  })

  it('usa el id propio si llega', () => {
    render(<TextField id="origen" label="Origen" hint="Ayuda" />)

    const input = screen.getByRole('textbox', { name: 'Origen' })
    expect(input).toHaveAttribute('id', 'origen')
    expect(input).toHaveAttribute('aria-describedby', 'origen-hint')
  })

  it('reenvía atributos nativos, className del contenedor y ref', async () => {
    const user = userEvent.setup()
    const ref = createRef<HTMLInputElement>()
    const onChange = vi.fn()
    render(
      <TextField
        ref={ref}
        label="Correo"
        type="email"
        name="correo"
        autoComplete="email"
        required
        className="extra"
        onChange={onChange}
      />,
    )

    const input = screen.getByRole('textbox', { name: 'Correo' })
    expect(ref.current).toBe(input)
    expect(input).toHaveAttribute('type', 'email')
    expect(input).toHaveAttribute('name', 'correo')
    expect(input).toHaveAttribute('autocomplete', 'email')
    expect(input).toBeRequired()
    expect(input.closest('.orki-field')).toHaveClass('extra')

    await user.type(input, 'ana')
    expect(onChange).toHaveBeenCalledTimes(3)
    expect(input).toHaveValue('ana')
  })

  it('recibe foco con Tab y al pulsar la etiqueta', async () => {
    const user = userEvent.setup()
    render(
      <>
        <TextField label="Origen" />
        <TextField label="Fecha de adquisición" />
      </>,
    )

    await user.tab()
    expect(screen.getByRole('textbox', { name: 'Origen' })).toHaveFocus()
    await user.click(screen.getByText('Fecha de adquisición'))
    expect(
      screen.getByRole('textbox', { name: 'Fecha de adquisición' }),
    ).toHaveFocus()
  })
})
