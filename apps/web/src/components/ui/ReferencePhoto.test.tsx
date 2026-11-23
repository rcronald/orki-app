import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ReferencePicture } from '../../lib/referencePhotos.ts'
import { expectNoAxeViolations } from '../../test/axe.ts'
import { ReferencePhoto, ReferenceThumb } from './ReferencePhoto.tsx'

const picture: ReferencePicture = {
  medium: { src: '/media.webp', width: 480, height: 360 },
  thumbnail: { src: '/miniatura.webp', width: 160, height: 120 },
  credit: {
    author: 'Ana Pérez',
    license: 'cc-by-sa',
    sourceUrl: 'https://www.inaturalist.org/photos/12345',
    modified: true,
  },
  sourcePhotoId: '12345',
}

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'Prueba'
})

function fail(image: HTMLElement) {
  act(() => {
    image.dispatchEvent(new Event('error'))
  })
}

describe('ReferencePhoto', () => {
  it('la foto media con el rótulo, el tamaño y el crédito con sus enlaces', async () => {
    render(
      <main>
        <ReferencePhoto picture={picture} scientificName="Cattleya maxima" />
      </main>,
    )
    const image = screen.getByRole('img', {
      name: 'Foto de referencia de Cattleya maxima',
    })
    expect(image).toHaveAttribute('src', '/media.webp')
    expect(image).toHaveAttribute('width', '480')
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(screen.getByRole('figure')).toHaveTextContent('Foto de referencia')
    expect(screen.getByRole('link', { name: /CC BY-SA 4.0/ })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by-sa/4.0/legalcode.es',
    )
    expect(
      screen.getByRole('link', { name: /Ver el original en iNaturalist/ }),
    ).toHaveAttribute('target', '_blank')
    expect(screen.getByText(/reducida/)).toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('compacta: la miniatura con el título', async () => {
    render(
      <main>
        <ReferencePhoto
          picture={picture}
          scientificName="Cattleya maxima"
          variant="compact"
          title="Así es esta especie"
        />
      </main>,
    )
    expect(screen.getByRole('img')).toHaveAttribute('src', '/miniatura.webp')
    expect(screen.getByText('Así es esta especie')).toBeInTheDocument()
    expect(screen.getByText('Foto de referencia')).toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('si la imagen no carga, se retira o deja el respaldo', () => {
    const { rerender } = render(
      <ReferencePhoto picture={picture} scientificName="Cattleya maxima" />,
    )
    fail(screen.getByRole('img'))
    expect(screen.queryByRole('figure')).toBeNull()
    expect(screen.queryByText(/Ana Pérez/)).toBeNull()

    rerender(
      <ReferencePhoto
        picture={{
          ...picture,
          medium: { ...picture.thumbnail, src: '/b.webp' },
        }}
        scientificName="Cattleya maxima"
        variant="viewer"
        fallback={<p>Sin foto</p>}
      />,
    )
    fail(screen.getByRole('img'))
    expect(screen.getByText('Sin foto')).toBeInTheDocument()
  })
})

describe('ReferenceThumb', () => {
  it('decorativa; sin imagen, el hueco solo si se reserva', () => {
    const { container, rerender } = render(
      <ReferenceThumb image={picture.thumbnail} reserve={false} />,
    )
    expect(container.querySelector('img')).toHaveAttribute('alt', '')
    fail(container.querySelector('img') as HTMLElement)
    expect(container.firstChild).toBeNull()
    rerender(<ReferenceThumb image={null} reserve />)
    expect(container.querySelector('span[aria-hidden="true"]')).not.toBeNull()
  })
})
