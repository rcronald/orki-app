import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OwnershipAnswer } from './OwnershipAnswer.tsx'

describe('OwnershipAnswer', () => {
  it('positiva: título, cantidad y nombre científico con ScientificName', () => {
    render(
      <OwnershipAnswer
        owned
        specimenCount={2}
        scientificName="Cattleya maxima"
      />,
    )

    const answer = screen.getByRole('status')
    expect(answer).toHaveClass('orki-answer', 'orki-answer--yes')
    expect(screen.getByText('Sí, la tienes')).toHaveClass('orki-answer__title')
    expect(answer).toHaveTextContent(
      'Sí, la tienesTienes 2 ejemplares de Cattleya maxima.',
    )
    // Con ScientificName (#336): cada tramo en su inclinación, dentro de <em>.
    expect(screen.getByText('Cattleya maxima').closest('em')).not.toBeNull()
    const icon = answer.querySelector('.orki-answer__icon svg')
    expect(icon).toHaveClass('lucide-check')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('positiva con un solo ejemplar', () => {
    render(
      <OwnershipAnswer
        owned
        specimenCount={1}
        scientificName="Cattleya maxima"
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(
      'Tienes 1 ejemplar de Cattleya maxima.',
    )
  })

  it('negativa: neutra, "Aún no la tienes"', () => {
    render(
      <OwnershipAnswer
        owned={false}
        scientificName="Masdevallia veitchiana"
        className="extra"
      />,
    )

    const answer = screen.getByRole('status')
    expect(answer).toHaveClass('orki-answer', 'extra')
    expect(answer).not.toHaveClass('orki-answer--yes')
    expect(screen.getByText('Aún no la tienes')).toHaveClass(
      'orki-answer__title',
    )
    expect(answer).toHaveTextContent(
      'Masdevallia veitchiana no está en tu colección.',
    )
    expect(
      screen.getByText('Masdevallia veitchiana').closest('em'),
    ).not.toBeNull()
    expect(answer.querySelector('.orki-answer__icon svg')).toHaveClass(
      'lucide-search',
    )
  })

  it('un híbrido con cultivar: el «×» y el cultivar en redonda (#336)', () => {
    render(
      <OwnershipAnswer
        owned
        specimenCount={1}
        scientificName="× Brassolaeliocattleya 'Rojo'"
      />,
    )

    expect(screen.getByText('×')).toHaveClass('not-italic')
    expect(screen.getByText('Brassolaeliocattleya')).toHaveClass('italic')
    expect(screen.getByRole('status')).toHaveTextContent(
      "Tienes 1 ejemplar de × Brassolaeliocattleya 'Rojo'.",
    )
  })

  it('un nombre por validar va en redonda y lo escrito, entre comillas (#336)', () => {
    const { rerender } = render(
      <OwnershipAnswer
        owned
        specimenCount={1}
        scientificName="Catleya rosada"
        nameKind="entered"
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Tienes 1 ejemplar de Catleya rosada.',
    )
    expect(screen.getByRole('status').querySelector('em')).toBeNull()

    rerender(
      <OwnershipAnswer owned={false} scientificName="phal" nameKind="typed" />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      '«phal» no está en tu colección.',
    )
    expect(screen.getByRole('status').querySelector('em')).toBeNull()
  })

  it('con announce={false} no es una región de estado propia', () => {
    render(
      <div role="status">
        <OwnershipAnswer
          owned
          specimenCount={1}
          scientificName="Cattleya maxima"
          announce={false}
        />
      </div>,
    )

    // Solo la región que la contiene.
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('Sí, la tienes')
  })
})
