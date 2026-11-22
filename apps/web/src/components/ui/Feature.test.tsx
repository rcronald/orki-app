import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Feature, FeatureList } from './Feature.tsx'

describe('Feature', () => {
  it('lista de ventajas con icono oculto, título h2 y una línea', () => {
    render(
      <FeatureList>
        <Feature icon="sprout" title="Organiza tus plantas">
          Registra cada orquídea con su foto y sus datos.
        </Feature>
        <Feature icon="book-open" title="Nombres confiables">
          Más de 32 000 especies e híbridos.
        </Feature>
      </FeatureList>,
    )

    const list = screen.getByRole('list')
    expect(list).toHaveClass('orki-features')
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveClass('orki-feature')

    const heading = screen.getByRole('heading', {
      level: 2,
      name: 'Organiza tus plantas',
    })
    expect(heading).toHaveClass('orki-feature__title')
    expect(
      screen.getByText('Registra cada orquídea con su foto y sus datos.'),
    ).toHaveClass('orki-feature__text')

    const icon = items[0]?.querySelector('.orki-feature__icon svg')
    expect(icon).toHaveClass('lucide-sprout')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('la variante plain quita el recuadro del icono (orki-features--plain)', () => {
    render(
      <FeatureList plain>
        <Feature icon="square-plus" title="Registra una orquídea">
          Elige un nombre sugerido y añade la fecha de adquisición.
        </Feature>
      </FeatureList>,
    )
    expect(screen.getByRole('list')).toHaveClass(
      'orki-features',
      'orki-features--plain',
    )
    // Sin utilidades de la app alrededor: las separaciones son del sistema.
    expect(screen.getByRole('listitem')).toHaveAttribute(
      'class',
      'orki-feature',
    )
  })

  it('el título puede ser h3', () => {
    render(
      <FeatureList>
        <Feature icon="search" title="¿Ya la tengo?" headingLevel={3}>
          Compruébalo en segundos, también sin conexión.
        </Feature>
      </FeatureList>,
    )
    expect(
      screen.getByRole('heading', { level: 3, name: '¿Ya la tengo?' }),
    ).toBeInTheDocument()
  })
})
