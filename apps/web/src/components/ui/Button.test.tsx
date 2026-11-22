import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button.tsx'

describe('Button', () => {
  it('es secundario por defecto y de tipo button', () => {
    render(<Button>Tomar foto</Button>)

    const button = screen.getByRole('button', { name: 'Tomar foto' })
    expect(button).toHaveClass('orki-btn', 'orki-btn--secondary')
    expect(button).not.toHaveClass('orki-btn--block')
    expect(button).toHaveAttribute('type', 'button')
  })

  it.each([
    ['primary', 'orki-btn--primary'],
    ['strong', 'orki-btn--strong'],
    ['secondary', 'orki-btn--secondary'],
    ['danger', 'orki-btn--danger'],
  ] as const)('variante %s', (variant, className) => {
    render(<Button variant={variant}>Guardar</Button>)

    expect(screen.getByRole('button', { name: 'Guardar' })).toHaveClass(
      'orki-btn',
      className,
    )
  })

  it('ocupa el ancho completo con block y suma className', () => {
    render(
      <Button variant="primary" block className="mt-space-4">
        Registrar orquídea
      </Button>,
    )

    expect(screen.getByRole('button')).toHaveClass(
      'orki-btn',
      'orki-btn--primary',
      'orki-btn--block',
      'mt-space-4',
    )
  })

  it('pone el icono antes del texto, oculto para el lector de pantalla', () => {
    render(
      <Button variant="primary" icon="plus">
        Registrar orquídea
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Registrar orquídea' })
    const icon = button.firstElementChild
    expect(icon?.tagName.toLowerCase()).toBe('svg')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(icon).toHaveAttribute('stroke', 'currentColor')
    expect(button).toHaveTextContent(/^Registrar orquídea$/)
  })

  it('sin icono no lleva svg', () => {
    render(<Button>Guardar</Button>)

    expect(screen.getByRole('button').querySelector('svg')).toBeNull()
  })

  it('se activa con clic, Enter y Espacio', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Guardar</Button>)

    const button = screen.getByRole('button', { name: 'Guardar' })
    await user.tab()
    expect(button).toHaveFocus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onClick).toHaveBeenCalledTimes(2)
    await user.click(button)
    expect(onClick).toHaveBeenCalledTimes(3)
  })

  it('inactivo: no recibe foco ni se activa', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <>
        <Button disabled onClick={onClick}>
          Guardar
        </Button>
        <Button>Tomar foto</Button>
      </>,
    )

    const disabled = screen.getByRole('button', { name: 'Guardar' })
    expect(disabled).toBeDisabled()
    await user.click(disabled)
    await user.tab()
    expect(screen.getByRole('button', { name: 'Tomar foto' })).toHaveFocus()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('acepta type submit, atributos nativos y ref', () => {
    const ref = createRef<HTMLButtonElement>()
    render(
      <Button ref={ref} type="submit" aria-describedby="ayuda" name="accion">
        Guardar
      </Button>,
    )

    const button = screen.getByRole('button')
    expect(ref.current).toBe(button)
    expect(button).toHaveAttribute('type', 'submit')
    expect(button).toHaveAttribute('aria-describedby', 'ayuda')
    expect(button).toHaveAttribute('name', 'accion')
  })
})
