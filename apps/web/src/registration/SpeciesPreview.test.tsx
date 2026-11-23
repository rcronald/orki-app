import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReferencePicture } from '../lib/referencePhotos.ts'
import { SpeciesPreview, type LoadReferencePhoto } from './SpeciesPreview.tsx'

const picture: ReferencePicture = {
  medium: null,
  thumbnail: { src: '/miniatura.webp', width: 160, height: 120 },
  credit: {
    author: 'Ana Pérez',
    license: 'pd',
    sourceUrl: 'https://www.inaturalist.org/photos/7',
    modified: false,
  },
  sourcePhotoId: '7',
}

describe('SpeciesPreview', () => {
  it('sin conexión no pide nada ni pinta nada', () => {
    const load = vi.fn<LoadReferencePhoto>()
    const { container } = render(
      <SpeciesPreview
        speciesId="a"
        scientificName="Cattleya maxima"
        online={false}
        load={load}
      />,
    )
    expect(load).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })

  it('una consulta por especie elegida; repintar no vuelve a pedir', async () => {
    const load = vi.fn<LoadReferencePhoto>().mockResolvedValue(picture)
    const props = {
      speciesId: 'a',
      scientificName: 'Cattleya maxima',
      online: true,
      load,
    }
    const { rerender } = render(<SpeciesPreview {...props} />)
    expect(await screen.findByText('Así es esta especie')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /dominio público/ })).toBeVisible()
    rerender(<SpeciesPreview {...props} />)
    expect(load).toHaveBeenCalledTimes(1)
    rerender(<SpeciesPreview {...props} speciesId="b" />)
    expect(load).toHaveBeenCalledTimes(2)
  })
})
