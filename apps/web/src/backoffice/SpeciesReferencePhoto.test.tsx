import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogSpeciesDetail } from '../lib/catalogAdmin.ts'
import { CatalogWriteError } from '../lib/catalogWrites.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import type { CatalogAdminSource } from './source.ts'
import { SpeciesReferencePhoto } from './SpeciesReferencePhoto.tsx'

// Foto de referencia en el detalle de una especie del backoffice (#234):
// verla con su crédito y retirarla con motivo y confirmación.

const SPECIES: CatalogSpeciesDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  scientificName: 'Cattleya maxima',
  genusId: '22222222-2222-4222-8222-222222222222',
  genusName: 'Cattleya',
  type: 'species',
  status: 'validated',
  source: 'col',
  sourceRef: 'C4XM',
  createdAt: '2026-11-20T14:37:00Z',
  updatedAt: '2026-11-21T08:15:00Z',
  names: [],
  referencePhoto: {
    medium: { src: '/media.webp', width: 480, height: 360 },
    thumbnail: { src: '/miniatura.webp', width: 160, height: 120 },
    credit: {
      author: 'Ana Pérez',
      license: 'cc-by',
      sourceUrl: 'https://www.inaturalist.org/photos/12345',
      modified: true,
    },
    sourcePhotoId: '12345',
  },
}

const retire = vi.fn<CatalogAdminSource['retireSpeciesPhoto']>()
const onChanged = vi.fn<(message: string) => void>()

function renderPhoto(species = SPECIES) {
  render(
    <main>
      <SpeciesReferencePhoto
        species={species}
        source={{ retireSpeciesPhoto: retire } as unknown as CatalogAdminSource}
        onChanged={onChanged}
      />
    </main>,
  )
}

const confirmButton = () =>
  within(screen.getByRole('alertdialog')).getByRole('button', {
    name: 'Retirar foto',
  })

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'Prueba'
  retire.mockReset()
  onChanged.mockReset()
})

describe('SpeciesReferencePhoto', () => {
  it('sin foto lo dice y no ofrece retirar', () => {
    renderPhoto({ ...SPECIES, referencePhoto: null })
    expect(screen.getByText('No tiene foto de referencia.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Retirar foto' })).toBeNull()
  })

  it('retira la foto vista con el motivo elegido, tras confirmarlo', async () => {
    const user = userEvent.setup()
    retire.mockResolvedValue(undefined)
    renderPhoto()
    expect(
      screen.getByRole('img', {
        name: 'Foto de referencia de Cattleya maxima',
      }),
    ).toBeVisible()
    expect(screen.getByText(/Foto: Ana Pérez/)).toBeVisible()
    await expectNoAxeViolations()

    await user.click(screen.getByRole('button', { name: 'Retirar foto' }))
    expect(
      screen.getByRole('alertdialog', {
        name: 'Retirar la foto de «Cattleya maxima»',
      }),
    ).toBeVisible()
    // Sin motivo no se envía nada.
    await user.click(confirmButton())
    expect(retire).not.toHaveBeenCalled()
    expect(
      within(screen.getByRole('alertdialog')).getByRole('alert'),
    ).toHaveTextContent('Elige por qué se retira la foto')
    await expectNoAxeViolations()

    await user.click(screen.getByRole('radio', { name: 'Mal identificada' }))
    await user.click(confirmButton())
    expect(retire).toHaveBeenCalledWith(SPECIES.id, '12345', 'misidentified')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(onChanged).toHaveBeenCalledWith(
      'Se retiró la foto de referencia de «Cattleya maxima» (mal identificada). La carga no la volverá a poner.',
    )
  })

  it('si la foto cambió entretanto, cierra, avisa y el detalle se relee', async () => {
    const user = userEvent.setup()
    retire.mockRejectedValue(new CatalogWriteError('species-photo-not-found'))
    renderPhoto()
    await user.click(screen.getByRole('button', { name: 'Retirar foto' }))
    await user.click(screen.getByRole('radio', { name: 'Otro motivo' }))
    await user.click(confirmButton())
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(onChanged).toHaveBeenCalledWith(
      expect.stringContaining('La foto de referencia de esta especie cambió'),
    )
  })

  it('otro fallo se queda en el diálogo para reintentar', async () => {
    const user = userEvent.setup()
    retire.mockRejectedValue(new CatalogWriteError('offline'))
    renderPhoto()
    await user.click(screen.getByRole('button', { name: 'Retirar foto' }))
    await user.click(screen.getByRole('radio', { name: 'Inapropiada' }))
    await user.click(confirmButton())
    expect(
      await within(screen.getByRole('alertdialog')).findByRole('alert'),
    ).toHaveTextContent('Sin conexión')
    expect(onChanged).not.toHaveBeenCalled()
  })
})
