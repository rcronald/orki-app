import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '../../test/axe.ts'
import { ActionList, ActionRow } from './ActionRow.tsx'
import { Avatar } from './Avatar.tsx'
import { Button } from './Button.tsx'
import { initialsOf } from './initials.ts'
import { Panel } from './Panel.tsx'
import { ProfileSummary } from './ProfileSummary.tsx'

// Piezas de «Tu cuenta» (#213): avatar, datos del perfil, sección con borde,
// sección de peligro, filas de acción y botón de peligro con borde.

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'Prueba'
})

describe('initialsOf', () => {
  it.each([
    ['Ana López', 'AL'],
    ['ana maría lópez ruiz', 'AR'],
    ['  Ana  ', 'A'],
    ['Ñandú Écija', 'ÑÉ'],
    ['', ''],
    [null, ''],
    [undefined, ''],
  ])('%s → «%s»', (name, expected) => {
    expect(initialsOf(name)).toBe(expected)
  })
})

describe('Avatar', () => {
  it('con foto: imagen decorativa', () => {
    const { container } = render(
      <Avatar name="Ana López" imageUrl="https://img.example/ana.jpg" />,
    )

    const avatar = container.querySelector('.orki-avatar')
    expect(avatar).toHaveAttribute('aria-hidden', 'true')
    expect(avatar).not.toHaveClass('orki-avatar--lg')
    expect(avatar?.querySelector('img')).toHaveAttribute('alt', '')
    expect(avatar).not.toHaveTextContent('AL')
  })

  it('si la foto no carga, las iniciales', () => {
    const { container } = render(
      <Avatar name="Ana López" imageUrl="https://img.example/rota.jpg" />,
    )

    const img = container.querySelector('img')
    if (!img) throw new Error('Falta la imagen')
    fireEvent.error(img)
    expect(container.querySelector('.orki-avatar')).toHaveTextContent('AL')
  })

  it('sin foto: iniciales; sin nombre: icono user; tamaño grande', () => {
    const { container, rerender } = render(<Avatar name="Ana López" />)
    expect(container.querySelector('.orki-avatar')).toHaveTextContent('AL')

    rerender(<Avatar size="lg" />)
    const avatar = container.querySelector('.orki-avatar')
    expect(avatar).toHaveClass('orki-avatar--lg')
    expect(avatar?.querySelector('svg')).toHaveClass('lucide-user')
  })
})

describe('ProfileSummary', () => {
  it('nombre, correo y la acción', async () => {
    render(
      <main>
        <ProfileSummary
          name="Ana López"
          email="ana@example.com"
          action={<Button>Editar perfil</Button>}
        />
      </main>,
    )

    expect(screen.getByText('Ana López')).toHaveClass('orki-profile__name')
    expect(screen.getByText('ana@example.com')).toHaveClass(
      'orki-profile__email',
    )
    expect(document.querySelector('.orki-avatar')).toHaveTextContent('AL')
    expect(
      screen.getByRole('button', { name: 'Editar perfil' }),
    ).toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('sin nombre: el correo como identificación y el icono user', () => {
    render(<ProfileSummary name={null} email="ana@example.com" />)

    expect(screen.getByText('ana@example.com')).toHaveClass(
      'orki-profile__name',
    )
    expect(document.querySelector('.orki-profile__email')).toBeNull()
    expect(document.querySelector('.orki-avatar svg')).toHaveClass(
      'lucide-user',
    )
  })

  it('sin nombre ni correo: solo el avatar neutro', () => {
    render(<ProfileSummary />)

    expect(document.querySelector('.orki-profile__name')).toBeNull()
    expect(document.querySelector('.orki-avatar svg')).toHaveClass(
      'lucide-user',
    )
  })
})

describe('Panel', () => {
  it('sección con nombre, título h2 y contenido', async () => {
    render(
      <main>
        <Panel title="Perfil">
          <p className="orki-panel__text">Contenido</p>
        </Panel>
      </main>,
    )

    const panel = screen.getByRole('region', { name: 'Perfil' })
    expect(panel).toHaveClass('orki-panel')
    expect(panel).not.toHaveClass('orki-panel--danger')
    expect(
      within(panel).getByRole('heading', { level: 2, name: 'Perfil' }),
    ).toHaveClass('orki-panel__title')
    await expectNoAxeViolations()
  })

  it('de peligro, con el botón de borde', async () => {
    render(
      <main>
        <Panel title="Eliminar cuenta" tone="danger" headingLevel={3}>
          <p className="orki-panel__text">Esta acción es irreversible.</p>
          <Button variant="danger-outline">Eliminar mi cuenta</Button>
        </Panel>
      </main>,
    )

    expect(screen.getByRole('region', { name: 'Eliminar cuenta' })).toHaveClass(
      'orki-panel',
      'orki-panel--danger',
    )
    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Eliminar mi cuenta' }),
    ).toHaveClass('orki-btn--danger-outline')
    await expectNoAxeViolations()
  })
})

describe('ActionRow', () => {
  it('como enlace, como botón y deshabilitada con su motivo', async () => {
    const user = userEvent.setup()
    const onExport = vi.fn()
    render(
      <MemoryRouter>
        <main>
          <ActionList aria-label="Datos y privacidad">
            <li>
              <ActionRow
                icon="file"
                title="Exportar inventario a CSV"
                description="El archivo CSV no incluye las fotos."
                onClick={onExport}
              />
            </li>
            <li>
              <ActionRow
                icon="shield"
                title="Aviso de privacidad"
                description="Consulta qué datos guardamos y quién puede verlos."
                to="/privacidad"
                state={{ origen: 'cuenta' }}
              />
            </li>
            <li>
              <ActionRow
                icon="user"
                title="Editar perfil"
                description="No se ve"
                disabledReason="Necesitas conexión para editar tu perfil."
              />
            </li>
          </ActionList>
        </main>
      </MemoryRouter>,
    )

    expect(screen.getByRole('list')).toHaveClass('orki-actions')
    // El nombre lleva todo el texto visible, el título primero (WCAG 2.5.3).
    const exportRow = screen.getByRole('button', {
      name: 'Exportar inventario a CSV El archivo CSV no incluye las fotos.',
    })
    expect(exportRow).toHaveClass('orki-action')
    expect(exportRow.querySelector('svg:last-child')).toHaveClass(
      'lucide-chevron-right',
    )
    await user.click(exportRow)
    expect(onExport).toHaveBeenCalledOnce()

    const privacy = screen.getByRole('link', { name: /^Aviso de privacidad/ })
    expect(privacy).toHaveAttribute('href', '/privacidad')

    const disabled = screen.getByRole('button', {
      name: 'Editar perfil Necesitas conexión para editar tu perfil.',
    })
    expect(disabled).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByText('No se ve')).not.toBeInTheDocument()
    await expectNoAxeViolations()
  })
})
