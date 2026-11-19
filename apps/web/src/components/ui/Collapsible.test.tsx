import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Collapsible } from './Collapsible.tsx'

function renderDetails(props: { defaultOpen?: boolean } = {}) {
  return render(
    <Collapsible title="Más detalles" {...props}>
      <label>
        Apodo
        <input type="text" />
      </label>
    </Collapsible>,
  )
}

describe('Collapsible', () => {
  it('empieza cerrada, con el contenido fuera del teclado y de la lectura', () => {
    renderDetails()
    const button = screen.getByRole('button', { name: 'Más detalles' })

    expect(button).toHaveAttribute('aria-expanded', 'false')
    const contentId = button.getAttribute('aria-controls')
    expect(contentId).toBeTruthy()
    const content = document.getElementById(contentId ?? '')
    expect(content).not.toBeVisible()
    expect(content).toHaveAttribute('hidden')
    expect(
      screen.queryByRole('textbox', { name: 'Apodo' }),
    ).not.toBeInTheDocument()
  })

  it('se abre y se cierra con la cabecera y conserva el foco', () => {
    renderDetails()
    const button = screen.getByRole('button', { name: 'Más detalles' })
    button.focus()

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('textbox', { name: 'Apodo' })).toBeVisible()
    expect(button).toHaveFocus()

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.queryByRole('textbox', { name: 'Apodo' }),
    ).not.toBeInTheDocument()
    expect(button).toHaveFocus()
  })

  it('la cabecera es un botón nativo, que se activa con Enter y Espacio', () => {
    renderDetails()
    const button = screen.getByRole('button', { name: 'Más detalles' })

    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('type', 'button')
  })

  it('puede abrirse desde el principio', () => {
    renderDetails({ defaultOpen: true })

    expect(
      screen.getByRole('button', { name: 'Más detalles' }),
    ).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('textbox', { name: 'Apodo' })).toBeVisible()
  })

  it('admite modo controlado', () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <Collapsible
        title="Más detalles"
        open={false}
        onOpenChange={onOpenChange}
      >
        Contenido
      </Collapsible>,
    )
    const button = screen.getByRole('button', { name: 'Más detalles' })

    fireEvent.click(button)
    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(button).toHaveAttribute('aria-expanded', 'false')

    rerender(
      <Collapsible title="Más detalles" open onOpenChange={onOpenChange}>
        Contenido
      </Collapsible>,
    )
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Contenido')).toBeVisible()
  })

  it('pone la cabecera dentro de un encabezado si se pide', () => {
    render(
      <Collapsible title="Más detalles" headingLevel={3}>
        Contenido
      </Collapsible>,
    )

    expect(
      screen.getByRole('heading', { level: 3, name: 'Más detalles' }),
    ).toContainElement(screen.getByRole('button', { name: 'Más detalles' }))
  })

  it('reenvía ref y atributos al contenedor', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <Collapsible ref={ref} title="Más detalles" data-testid="seccion">
        Contenido
      </Collapsible>,
    )

    expect(ref.current).toBe(screen.getByTestId('seccion'))
    expect(ref.current).toHaveClass('orki-collapsible')
  })
})
