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

  describe('identificador', () => {
    it.each(['grid', 'list'] as const)(
      '%s: bajo el nombre, discreto, y en la descripción',
      async (layout) => {
        render(
          <main>
            <CollectionCard
              scientificName="Phalaenopsis amabilis"
              layout={layout}
              code="PHA-001"
              photoCount={2}
            />
          </main>,
        )

        const card = screen.getByRole('article', {
          name: 'Phalaenopsis amabilis',
          description: 'Identificador PHA-001. 2 fotos',
        })
        const code = screen.getByText('PHA-001')
        expect(code).toHaveClass('orki-card__meta')
        // Justo después del nombre.
        expect(card.querySelector('.orki-card__name')?.nextElementSibling).toBe(
          code,
        )
        await expectNoAxeViolations()
      },
    )

    it('sin identificador, ni línea ni descripción', () => {
      render(<CollectionCard scientificName="Phalaenopsis amabilis" />)
      const card = screen.getByRole('article', {
        name: 'Phalaenopsis amabilis',
      })
      expect(card.querySelector('.orki-card__meta')).toBeNull()
      expect(card).not.toHaveAttribute('aria-describedby')
    })
  })

  describe('número de fotos', () => {
    const PHOTO = { src: '/foto.jpg', alt: 'Cattleya trianae en flor' }

    it.each([undefined, 0, 1])(
      'con %s fotos no se muestra nada ni hay descripción',
      (photoCount) => {
        render(
          <CollectionCard
            scientificName="Cattleya trianae"
            photo={PHOTO}
            photoCount={photoCount}
          />,
        )

        const card = screen.getByRole('article', { name: 'Cattleya trianae' })
        expect(card.querySelector('.orki-count')).toBeNull()
        expect(card).not.toHaveAttribute('aria-describedby')
        expect(card).not.toHaveTextContent('fotos')
      },
    )

    it.each([
      ['grid', 'right-space-2'],
      ['list', 'left-space-2'],
    ] as const)(
      '%s: con 2 fotos, la píldora sobre la foto y «2 fotos» como descripción',
      async (layout, corner) => {
        render(
          <main>
            <CollectionCard
              scientificName="Cattleya trianae"
              layout={layout}
              photo={PHOTO}
              photoCount={2}
              renderName={(name) => (
                <a className="orki-card__link" href="/coleccion/1">
                  {name}
                </a>
              )}
            />
          </main>,
        )

        // El nombre no cambia: es el del encabezado.
        const card = screen.getByRole('article', {
          name: 'Cattleya trianae',
          description: '2 fotos',
        })
        expect(
          screen.getByRole('link', { name: 'Cattleya trianae' }),
        ).toBeInTheDocument()
        const count = card.querySelector('.orki-count')
        expect(count).toHaveClass('absolute', 'top-space-2', corner)
        expect(count).toHaveClass('pointer-events-none')
        expect(count?.querySelector('svg')).toHaveClass('lucide-image')
        expect(count?.querySelector('svg')).toHaveAttribute(
          'aria-hidden',
          'true',
        )
        // El número visible no se lee suelto: se lee «2 fotos».
        expect(
          count?.querySelector('[aria-hidden="true"]:not(svg)'),
        ).toHaveTextContent(/^2$/)
        expect(screen.getByText('2 fotos')).toHaveClass('sr-only')
        await expectNoAxeViolations()
      },
    )

    it('con 6 fotos, «6»; también sin foto principal cargada', async () => {
      render(
        <main>
          <CollectionCard scientificName="Vanda coerulea" photoCount={6} />
        </main>,
      )

      const card = screen.getByRole('article', {
        name: 'Vanda coerulea',
        description: '6 fotos',
      })
      expect(card.querySelector('.orki-count')).toHaveTextContent('6')
      await expectNoAxeViolations()
    })
  })
})
