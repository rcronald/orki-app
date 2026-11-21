import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRouter } from '../routes/AppRouter.tsx'
import { expectNoAxeViolations } from '../test/axe.ts'
import { resetFakeClerk, setFakeClerk } from '../test/clerk-mock.tsx'
import {
  isPrivacyContactPending,
  PRIVACY_CONTACT,
  PRIVACY_CONTACT_PLACEHOLDER,
  privacyContactHref,
} from './contact.ts'

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

beforeEach(() => {
  resetFakeClerk()
  document.documentElement.lang = 'es'
  document.title = 'Orki'
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRouter appEnv="dev" clerkPublishableKey="pk_test_clave_de_prueba" />
    </MemoryRouter>,
  )
}

describe('PrivacyPage', () => {
  it('se abre sin sesión, con su título, encabezados en orden y axe', async () => {
    renderAt('/privacidad')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Privacidad' }),
    ).toBeInTheDocument()
    expect(document.title).toBe('Privacidad · Orki')
    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)
    expect(headings).toEqual([
      'Qué datos guarda Orki',
      'Dónde se guardan y quién los procesa',
      'Quién puede ver tus datos',
      'Qué se guarda en tu dispositivo',
      'Cómo eliminar tu cuenta y tus datos',
      'Fuente del catálogo',
      'Contacto',
    ])
    expect(screen.getByText(/Última actualización/)).toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('también se abre si Clerk no carga', async () => {
    setFakeClerk({ status: 'error' })
    renderAt('/privacidad')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Privacidad' }),
    ).toBeInTheDocument()
  })

  it('enlaza la eliminación de la cuenta y la fuente del catálogo', async () => {
    renderAt('/privacidad')
    await screen.findByRole('heading', { level: 1, name: 'Privacidad' })

    expect(
      screen.getByRole('link', { name: 'Tu cuenta, Eliminar mi cuenta' }),
    ).toHaveAttribute('href', '/cuenta')
    const catalog = screen
      .getByRole('heading', { name: 'Fuente del catálogo' })
      .closest('section')
    if (!catalog) throw new Error('Falta la sección del catálogo.')
    expect(catalog).toHaveTextContent('COL26.10 XR')
    const doi = within(catalog).getByRole('link', {
      name: /^https:\/\/doi\.org\/10\.48580\/dgzlf\s+\(se abre en otra pestaña\)$/,
    })
    expect(doi).toHaveAttribute('href', 'https://doi.org/10.48580/dgzlf')
    expect(doi).toHaveAttribute('rel', 'noopener noreferrer')
    expect(
      within(catalog).getByRole('link', {
        name: /^CC BY 4\.0\s+\(se abre en otra pestaña\)$/,
      }),
    ).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/')
  })

  it('no muestra el marcador del contacto como si fuera real', async () => {
    renderAt('/privacidad')
    await screen.findByRole('heading', { level: 1, name: 'Privacidad' })
    expect(document.body).not.toHaveTextContent(PRIVACY_CONTACT_PLACEHOLDER)
    expect(
      screen.getByText(/Todavía no hay un medio de contacto publicado/),
    ).toBeInTheDocument()
  })

  it('se llega desde el pie de la app y desde la pantalla de acceso', async () => {
    const user = userEvent.setup()
    renderAt('/')
    await user.click(await screen.findByRole('link', { name: 'Privacidad' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Privacidad' }),
    ).toBeInTheDocument()
  })

  it('la pantalla de acceso enlaza la privacidad', async () => {
    renderAt('/iniciar-sesion')
    expect(
      await screen.findByRole('link', { name: 'Privacidad' }),
    ).toHaveAttribute('href', '/privacidad')
  })
})

describe('contacto de privacidad', () => {
  it('el valor actual es el marcador pendiente', () => {
    expect(PRIVACY_CONTACT).toBe(PRIVACY_CONTACT_PLACEHOLDER)
    expect(isPrivacyContactPending()).toBe(true)
  })

  it('con un contacto real deja de estar pendiente y se enlaza', () => {
    expect(isPrivacyContactPending('privacidad@ejemplo.test')).toBe(false)
    expect(privacyContactHref('privacidad@ejemplo.test')).toBe(
      'mailto:privacidad@ejemplo.test',
    )
    expect(privacyContactHref('https://ejemplo.test/contacto')).toBe(
      'https://ejemplo.test/contacto',
    )
  })
})
