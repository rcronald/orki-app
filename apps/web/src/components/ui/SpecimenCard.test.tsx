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

  it('el nombre científico va en cursiva y el signo "×" y el grex en redonda', () => {
    render(
      <SpecimenCard
        scientificName="× Rhyncholaeliocattleya Memoria Anna Balmores"
        status="validated"
      />,
    )

    const name = screen.getByRole('heading', {
      name: '× Rhyncholaeliocattleya Memoria Anna Balmores',
    })
    expect(name).toHaveClass('orki-card__name')
    expect(within(name).getByText('×')).toHaveClass('not-italic')
    expect(within(name).getByText('Rhyncholaeliocattleya')).toHaveClass(
      'italic',
    )
    expect(within(name).getByText('Memoria Anna Balmores')).toHaveClass(
      'not-italic',
    )
  })

  it('con nameStyle="plain" el nombre va sin cursiva y en la fuente de cuerpo', () => {
    render(
      <SpecimenCard
        scientificName="la naranja del mercado"
        nameStyle="plain"
        status="pending"
      />,
    )

    const name = screen.getByRole('heading', { name: 'la naranja del mercado' })
    expect(name).toHaveClass('orki-card__name', 'not-italic', 'font-body')
    expect(name.querySelector('.italic')).toBeNull()
  })

  it('en fila pone la miniatura cuadrada a la izquierda', () => {
    render(
      <SpecimenCard
        scientificName="Cattleya maxima"
        status="validated"
        layout="row"
      />,
    )

    const card = screen.getByRole('article', { name: 'Cattleya maxima' })
    expect(card).toHaveClass('orki-card', 'flex-row')
    expect(within(card).getByRole('img', { name: 'Sin foto' })).toHaveClass(
      'orki-card__photo',
      'aspect-square',
    )
  })

  it('renderName envuelve el nombre sin cambiar el nombre accesible', () => {
    render(
      <SpecimenCard
        scientificName="Cattleya maxima"
        status="validated"
        renderName={(name) => <a href="/detalle">{name}</a>}
      />,
    )

    const card = screen.getByRole('article', { name: 'Cattleya maxima' })
    expect(
      within(card).getByRole('link', { name: 'Cattleya maxima' }),
    ).toHaveAttribute('href', '/detalle')
  })
})
