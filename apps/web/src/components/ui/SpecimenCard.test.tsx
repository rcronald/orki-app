import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SpecimenCard } from './SpecimenCard.tsx'

describe('SpecimenCard', () => {
  it('muestra la foto, los nombres, la insignia y los metadatos', () => {
    render(
      <SpecimenCard
        scientificName="Phalaenopsis amabilis"
        commonName="Orquídea mariposa"
        status="validated"
        meta="Vivero Moyobamba - 19/11/2026"
        photo={{
          src: '/fotos/amabilis.jpg',
          alt: 'Phalaenopsis amabilis en floración',
        }}
      />,
    )

    const card = screen.getByRole('article', { name: 'Phalaenopsis amabilis' })
    expect(card).toHaveClass('orki-card')

    const photo = within(card).getByRole('img', {
      name: 'Phalaenopsis amabilis en floración',
    })
    expect(photo).toHaveClass('orki-card__photo')
    expect(photo).toHaveAttribute('src', '/fotos/amabilis.jpg')

    const name = within(card).getByRole('heading', {
      level: 3,
      name: 'Phalaenopsis amabilis',
    })
    expect(name).toHaveClass('orki-card__name')
    expect(within(card).getByText('Orquídea mariposa')).toHaveClass(
      'orki-card__common',
    )
    expect(within(card).getByText('Validada')).toHaveClass('orki-badge')
    expect(within(card).getByText('Vivero Moyobamba - 19/11/2026')).toHaveClass(
      'orki-card__meta',
    )
  })

  it('sin foto usa el marcador sin-foto.svg con texto alternativo', () => {
    render(<SpecimenCard scientificName="Masdevallia" status="pending" />)

    const photo = screen.getByRole('img', { name: 'Sin foto' })
    expect(photo).toHaveClass('orki-card__photo')
    expect(photo.getAttribute('src')).toMatch(/sin-foto|^data:image\/svg\+xml/)
    expect(screen.getByText('Nombre por validar')).toHaveClass(
      'orki-badge--pending',
    )
  })

  it('sin nombre común ni metadatos no deja párrafos vacíos', () => {
    const { container } = render(
      <SpecimenCard scientificName="Masdevallia" status="pending" />,
    )

    expect(container.querySelector('.orki-card__common')).toBeNull()
    expect(container.querySelector('.orki-card__meta')).toBeNull()
  })

  it('cambia el nivel del encabezado', () => {
    render(
      <SpecimenCard
        scientificName="Cattleya maxima"
        status="validated"
        headingLevel={2}
      />,
    )

    expect(
      screen.getByRole('heading', { level: 2, name: 'Cattleya maxima' }),
    ).toBeInTheDocument()
  })

  it('puede recibir foco si se le da tabIndex', async () => {
    const user = userEvent.setup()
    render(
      <SpecimenCard
        scientificName="Cattleya maxima"
        status="validated"
        tabIndex={0}
        className="extra"
      />,
    )

    await user.tab()
    const card = screen.getByRole('article', { name: 'Cattleya maxima' })
    expect(card).toHaveFocus()
    expect(card).toHaveClass('orki-card', 'extra')
  })
})
