import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '../../test/axe.ts'
import { CollectionCard } from './CollectionCard.tsx'
import { StatusBadge } from './StatusBadge.tsx'

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'Prueba'
})

describe('CollectionCard', () => {
  it('cuadrícula: borde fino, foto, nombre en cursiva y ubicación', async () => {
    render(
      <main>
        <CollectionCard
          scientificName="Cattleya trianae"
          location="Invernadero Este"
          photo={{ src: '/foto.jpg', alt: 'Cattleya trianae en flor' }}
        />
      </main>,
    )

    const card = screen.getByRole('article', { name: 'Cattleya trianae' })
    expect(card).toHaveClass('orki-card', 'orki-card--outline')
    expect(card).not.toHaveClass('orki-card--row')
    expect(
      screen.getByRole('heading', { level: 3, name: 'Cattleya trianae' }),
    ).toHaveClass('orki-card__name')
    expect(screen.getByRole('img')).toHaveAttribute(
      'alt',
      'Cattleya trianae en flor',
    )
    const place = screen.getByText('Invernadero Este')
    expect(place).toHaveClass('orki-card__place')
    expect(place).toHaveTextContent('Ubicación: Invernadero Este')
    expect(place.querySelector('svg')).toHaveClass('lucide-map-pin')
    await expectNoAxeViolations()
  })

  it('sin foto, sin ubicación ni apodo: el marcador y solo el nombre', () => {
    render(<CollectionCard scientificName="Vanda coerulea" />)

    expect(screen.getByRole('img')).toHaveAttribute('alt', 'Sin foto')
    expect(document.querySelector('.orki-card__place')).toBeNull()
    expect(document.querySelector('.orki-card__common')).toBeNull()
  })

  it('apodo, insignia y nombre por validar sin cursiva', () => {
    render(
      <CollectionCard
        scientificName="Dendrobium Stardust"
        nameStyle="plain"
        nickname="La de la abuela"
        badge={<StatusBadge status="pending" />}
      />,
    )

    expect(screen.getByRole('heading')).toHaveClass('font-body', 'not-italic')
    expect(screen.getByText('La de la abuela')).toHaveClass('orki-card__common')
    expect(screen.getByText('Nombre por validar')).toBeInTheDocument()
  })

  it('lista: orki-card--row, con encabezado h2 y enlace que cubre la tarjeta', async () => {
    render(
      <main>
        <CollectionCard
          scientificName="Phalaenopsis bellina"
          layout="list"
          headingLevel={2}
          renderName={(name) => (
            <a className="orki-card__link" href="/coleccion/1">
              {name}
            </a>
          )}
        />
      </main>,
    )

    expect(screen.getByRole('article')).toHaveClass('orki-card--row')
    const link = screen.getByRole('link', { name: 'Phalaenopsis bellina' })
    expect(link).toHaveClass('orki-card__link')
    expect(
      screen.getByRole('heading', { level: 2, name: 'Phalaenopsis bellina' }),
    ).toContainElement(link)
    await expectNoAxeViolations()
  })
})
