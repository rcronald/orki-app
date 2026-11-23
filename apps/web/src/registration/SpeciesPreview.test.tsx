import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetReferencePhotos } from '../lib/useReferencePhoto.ts'
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

let online = true

beforeEach(() => {
  forgetReferencePhotos()
  online = true
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SpeciesPreview', () => {
  it('sin conexión no pide nada ni pinta nada', () => {
    online = false
    const load = vi.fn<LoadReferencePhoto>()
    const { container } = render(
      <SpeciesPreview
        speciesId="a"
        scientificName="Cattleya maxima"
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
      load,
    }
    const { rerender } = render(<SpeciesPreview {...props} />)
    expect(await screen.findByText('Así es esta especie')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /dominio público/ })).toBeVisible()
    rerender(<SpeciesPreview {...props} />)
    expect(load).toHaveBeenCalledTimes(1)
    rerender(<SpeciesPreview {...props} speciesId="b" />)
    expect(load).toHaveBeenCalledTimes(2)
    // Volver a la primera no repite la consulta.
    rerender(<SpeciesPreview {...props} />)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('un fallo no se recuerda: se vuelve a pedir al volver a elegirla', async () => {
    const load = vi
      .fn<LoadReferencePhoto>()
      .mockRejectedValueOnce(new Error('fallo'))
      .mockResolvedValue(picture)
    const props = { speciesId: 'a', scientificName: 'C. maxima', load }
    const { unmount } = render(<SpeciesPreview {...props} />)
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    unmount()
    render(<SpeciesPreview {...props} />)
    expect(await screen.findByText('Así es esta especie')).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
