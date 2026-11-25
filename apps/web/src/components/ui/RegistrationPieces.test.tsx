import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '../../test/axe.ts'
import { Button } from './Button.tsx'
import { Chip } from './Chip.tsx'
import { ChipGroup } from './ChipGroup.tsx'
import { FormActions, FormLayout, FormPair } from './FormLayout.tsx'
import { galleryPhotoLabel } from './gallery-label.ts'
import { MatchBadge } from './MatchBadge.tsx'
import { PageHeader } from './PageHeader.tsx'
import { PhotoGallery, type GalleryPhoto } from './PhotoGallery.tsx'

// Piezas del registro con galería (#220): galería de fotos, insignia de
// coincidencia, grupo de opciones segmentado, formulario a dos columnas, pie
// de acciones y la ilustración de la cabecera que no carga.

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'Prueba'
})

const ready = (id: string): GalleryPhoto => ({
  id,
  src: `blob:${id}`,
  state: { status: 'ready' },
})

describe('galleryPhotoLabel', () => {
  it('la primera es la principal; las demás, con su posición', () => {
    expect(galleryPhotoLabel(0, 3)).toBe('Foto principal')
    expect(galleryPhotoLabel(1, 3)).toBe('Foto 2 de 3')
    expect(galleryPhotoLabel(5, 6)).toBe('Foto 6 de 6')
  })
})

describe('PhotoGallery', () => {
  it('vacía: título, contador 0 de 6, estado vacío y las dos acciones', async () => {
    const take = vi.fn()
    const choose = vi.fn()
    render(
      <main>
        <PhotoGallery
          photos={[]}
          max={6}
          onTakePhoto={take}
          onChoosePhotos={choose}
        />
      </main>,
    )
    const region = screen.getByRole('region', { name: 'Fotos (opcional)' })
    expect(region).toHaveClass('orki-gallery')
    expect(within(region).getByText('0 de 6')).toHaveClass(
      'orki-gallery__count',
    )
    expect(within(region).getByText('Aún no hay fotos.')).toBeInTheDocument()
    expect(within(region).queryByRole('list')).not.toBeInTheDocument()
    expect(
      within(region).getByText('Puedes añadir hasta 6 fotos.'),
    ).toHaveClass('orki-gallery__help')
    await userEvent.click(
      within(region).getByRole('button', { name: 'Tomar foto' }),
    )
    await userEvent.click(
      within(region).getByRole('button', { name: 'Añadir fotos' }),
    )
    expect(take).toHaveBeenCalledTimes(1)
    expect(choose).toHaveBeenCalledTimes(1)
    await expectNoAxeViolations()
  })

  it('parcial: cada miniatura con nombre, «Principal» en la primera y quitar en la esquina', async () => {
    render(
      <main>
        <PhotoGallery
          photos={[ready('a'), ready('b'), ready('c')]}
          max={6}
          onRemove={vi.fn()}
          onChoosePhotos={vi.fn()}
        />
      </main>,
    )
    expect(screen.getByText('3 de 6')).toBeInTheDocument()
    const items = within(
      screen.getByRole('list', { name: 'Fotos elegidas' }),
    ).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(
      screen.getAllByRole('img').map((img) => img.getAttribute('alt')),
    ).toEqual(['Foto principal', 'Foto 2 de 3', 'Foto 3 de 3'])
    expect(within(items[0]).getByText('Principal')).toHaveClass(
      'orki-gallery__badge',
    )
    expect(within(items[1]).queryByText('Principal')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Quitar foto principal' }),
    ).toHaveClass('orki-gallery__remove')
    expect(
      screen.getByRole('button', { name: 'Quitar foto 3 de 3' }),
    ).toBeInTheDocument()
    // Sin cámara: solo «Añadir fotos».
    expect(screen.queryByRole('button', { name: 'Tomar foto' })).toBeNull()
    await expectNoAxeViolations()
  })

  it('al quitar, el foco pasa a la que ocupa su lugar; sin ninguna, a «Añadir fotos»', async () => {
    function Live() {
      const [photos, setPhotos] = useState([ready('a'), ready('b')])
      return (
        <PhotoGallery
          photos={photos}
          max={6}
          onRemove={(id) =>
            setPhotos((list) => list.filter((p) => p.id !== id))
          }
          onChoosePhotos={vi.fn()}
        />
      )
    }
    const user = userEvent.setup()
    render(<Live />)
    await user.click(
      screen.getByRole('button', { name: 'Quitar foto principal' }),
    )
    // La que era la 2 pasa a ser la principal y recibe el foco.
    expect(
      screen.getByRole('button', { name: 'Quitar foto principal' }),
    ).toHaveFocus()
    expect(screen.getByText('1 de 6')).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Añadir fotos' })).toHaveFocus()
    expect(screen.getByText('Aún no hay fotos.')).toBeInTheDocument()
  })

  it('llena: las acciones quedan deshabilitadas con el motivo enlazado', async () => {
    const choose = vi.fn()
    const take = vi.fn()
    render(
      <main>
        <PhotoGallery
          photos={['a', 'b', 'c', 'd', 'e', 'f'].map(ready)}
          max={6}
          onRemove={vi.fn()}
          onTakePhoto={take}
          onChoosePhotos={choose}
        />
      </main>,
    )
    for (const name of ['Tomar foto', 'Añadir fotos']) {
      const button = screen.getByRole('button', { name })
      expect(button).toHaveAttribute('aria-disabled', 'true')
      expect(button).toHaveAccessibleDescription(
        'Ya tienes 6 fotos. Quita una para añadir otra.',
      )
      fireEvent.click(button)
    }
    expect(choose).not.toHaveBeenCalled()
    expect(take).not.toHaveBeenCalled()
    await expectNoAxeViolations()
  })

  it('estados: preparando, subiendo con progreso, guardada y con error con «Reintentar»', async () => {
    const retry = vi.fn()
    render(
      <main>
        <PhotoGallery
          photos={[
            { id: 'a', src: 'blob:a', state: { status: 'saved' } },
            {
              id: 'b',
              src: 'blob:b',
              state: { status: 'uploading', progress: 0.42 },
            },
            { id: 'c', src: 'blob:c', state: { status: 'error' } },
            { id: 'd', state: { status: 'preparing' } },
          ]}
          max={6}
          onRemove={vi.fn()}
          onRetry={retry}
          onChoosePhotos={vi.fn()}
        />
      </main>,
    )
    expect(screen.getByText('Guardada')).toBeInTheDocument()
    // Espacio duro antes de «%»: la cifra no se separa de su signo (#247).
    expect(
      screen.getByText('Subiendo… 42\u00a0%', { normalizer: (t) => t }),
    ).toBeInTheDocument()
    expect(screen.getByText('No se subió')).toBeInTheDocument()
    expect(screen.getByText('Preparando…')).toBeInTheDocument()
    // La que se prepara aún no tiene imagen, pero sí nombre y el hueco
    // cuadrado de la foto (en celular, el estado va debajo, #247).
    const placeholder = screen.getByRole('img', { name: 'Foto 4 de 4' })
    expect(placeholder).not.toHaveAttribute('src')
    expect(placeholder).toHaveClass('orki-gallery__photo')
    // Ni subiendo ni guardada se pueden quitar.
    expect(
      screen.queryByRole('button', { name: 'Quitar foto principal' }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Quitar foto 2 de 4' }),
    ).toBeNull()
    await userEvent.click(
      screen.getByRole('button', { name: 'Reintentar foto 3 de 4' }),
    )
    expect(retry).toHaveBeenCalledWith('c')
    await expectNoAxeViolations()
  })

  it('deshabilitada: no añade ni quita, pero sigue en el orden del tabulador', () => {
    const remove = vi.fn()
    const choose = vi.fn()
    render(
      <PhotoGallery
        photos={[ready('a')]}
        max={6}
        disabled
        onRemove={remove}
        onChoosePhotos={choose}
      />,
    )
    const quitar = screen.getByRole('button', { name: 'Quitar foto principal' })
    expect(quitar).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(quitar)
    fireEvent.click(screen.getByRole('button', { name: 'Añadir fotos' }))
    expect(remove).not.toHaveBeenCalled()
    expect(choose).not.toHaveBeenCalled()
  })

  it('el aviso describe el recuadro', () => {
    render(
      <PhotoGallery
        photos={[]}
        max={6}
        onChoosePhotos={vi.fn()}
        notice="El equipo del catálogo podrá ver estas fotos."
      />,
    )
    expect(
      screen.getByRole('region', { name: 'Fotos (opcional)' }),
    ).toHaveAccessibleDescription(
      'El equipo del catálogo podrá ver estas fotos.',
    )
  })
})

describe('MatchBadge', () => {
  it('«Coincidencia en el catálogo» con check, en orki-match', () => {
    const { container } = render(<MatchBadge />)
    const badge = screen.getByText('Coincidencia en el catálogo')
    expect(badge).toHaveClass('orki-match')
    expect(container.querySelector('svg')).toHaveClass('lucide-check')
  })
})

describe('ChipGroup segmented', () => {
  it('añade orki-chips--segmented y los chips siguen siendo botones de alternar', async () => {
    render(
      <main>
        <ChipGroup aria-label="Tipo" segmented>
          <Chip selected>Especie</Chip>
          <Chip selected={false}>Híbrido</Chip>
        </ChipGroup>
      </main>,
    )
    const group = screen.getByRole('group', { name: 'Tipo' })
    expect(group).toHaveClass('orki-chips', 'orki-chips--segmented')
    expect(
      within(group).getByRole('button', { name: 'Especie' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expectNoAxeViolations()
  })
})

describe('FormLayout, FormPair y FormActions', () => {
  it('main, aside y extra en ese orden; el pie con la secundaria y la principal', async () => {
    render(
      <main>
        <form aria-label="Ejemplo">
          <FormLayout
            main={
              <FormPair>
                <input aria-label="Uno" />
                <input aria-label="Dos" />
              </FormPair>
            }
            aside={<p>Galería</p>}
            extra={<p>Más</p>}
          />
          <FormActions>
            <Button className="orki-formactions__secondary">Cancelar</Button>
            <Button variant="primary">Registrar orquídea</Button>
          </FormActions>
        </form>
      </main>,
    )
    const layout = document.querySelector('.orki-form')
    expect(
      [...(layout?.children ?? [])].map((child) => child.className),
    ).toEqual(['orki-form__main', 'orki-form__aside', 'orki-form__extra'])
    expect(document.querySelector('.orki-form__pair')?.children).toHaveLength(2)
    const actions = document.querySelector('.orki-formactions')
    expect(
      [...(actions?.children ?? [])].map((child) => child.textContent),
    ).toEqual(['Cancelar', 'Registrar orquídea'])
    expect(
      screen.getByRole('button', { name: 'Registrar orquídea' }),
    ).toHaveClass('orki-btn--primary')
    await expectNoAxeViolations()
  })

  it('sin aside ni extra, solo main', () => {
    render(<FormLayout main={<p>Datos</p>} />)
    expect(document.querySelector('.orki-form')?.children).toHaveLength(1)
  })
})

describe('PageHeader sin la ilustración', () => {
  it('si la ilustración no carga (sin conexión), se quita en lugar de dejar el hueco roto', () => {
    render(<PageHeader title="Mi colección" />)
    const art = document.querySelector('img.orki-pagehead__art')
    expect(art).not.toBeNull()
    fireEvent.error(art as Element)
    expect(document.querySelector('.orki-pagehead__art')).toBeNull()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Mi colección' }),
    ).toBeInTheDocument()
  })
})
