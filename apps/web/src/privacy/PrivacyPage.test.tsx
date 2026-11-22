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
  document.title = 'orqui.apps'
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

/** La sección con ese encabezado de nivel 2. */
function section(title: string): HTMLElement {
  const found = screen
    .getByRole('heading', { level: 2, name: title })
    .closest('section')
  if (!found) throw new Error(`Falta la sección «${title}».`)
  return found
}

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
    expect(document.title).toBe('Privacidad · orqui.apps')
    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)
    expect(headings).toEqual([
      'Qué datos guarda orqui.apps',
      'Mediciones de uso y errores',
      'Dónde se guardan y quién los procesa',
      'Quién puede ver tus datos',
      'Qué se guarda en tu dispositivo',
      'Cómo eliminar tu cuenta y tus datos',
      'Fuente del catálogo',
      'Contacto',
    ])
    expect(screen.getByText(/Última actualización/)).toBeInTheDocument()
    expect(screen.getByText('21 de noviembre de 2026')).toHaveAttribute(
      'datetime',
      '2026-11-21',
    )
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

  it('explica los eventos de uso y Sentry, y ya no dice que no hay analítica', async () => {
    renderAt('/privacidad')
    await screen.findByRole('heading', { level: 1, name: 'Privacidad' })
    expect(document.body).not.toHaveTextContent(/no usa analítica/)

    const measures = section('Mediciones de uso y errores')
    expect(measures).toHaveTextContent('Cuando registras una planta')
    expect(measures).toHaveTextContent('Cuando buscas si ya tienes una planta')
    expect(measures).toHaveTextContent(
      'No lleva el texto que buscaste, los nombres de tus plantas',
    )
    expect(measures).toHaveTextContent('envía el error a Sentry')
    expect(measures).toHaveTextContent('En orqui.apps no hay publicidad')

    const providers = section('Dónde se guardan y quién los procesa')
    expect(providers).toHaveTextContent('Sentry recibe los informes de errores')
    expect(providers).toHaveTextContent(
      'Supabase guarda tu perfil, tus plantas, sus fotos y tus eventos de uso',
    )
  })

  it('describe la cola de propuestas, lo guardado en el dispositivo y la exportación', async () => {
    renderAt('/privacidad')
    await screen.findByRole('heading', { level: 1, name: 'Privacidad' })
    expect(document.body).not.toHaveTextContent(/aún no tiene la pantalla/)
    expect(document.body).not.toHaveTextContent(
      /no tiene una opción para descargar/,
    )

    expect(section('Quién puede ver tus datos')).toHaveTextContent(
      'el nombre tal como lo escribió la mayoría',
    )
    const device = section('Qué se guarda en tu dispositivo')
    for (const item of [
      'Una copia de tu inventario',
      'Las miniaturas de tus fotos',
      'Los eventos de uso que aún no se enviaron',
      'Tu identificador de usuario',
    ]) {
      expect(device).toHaveTextContent(item)
    }

    const deletion = section('Cómo eliminar tu cuenta y tus datos')
    expect(deletion).toHaveTextContent('tus eventos de uso')
    expect(deletion).toHaveTextContent('No incluye las fotos.')
    expect(
      within(deletion).getByRole('link', { name: 'Mi colección' }),
    ).toHaveAttribute('href', '/coleccion')
  })

  it('muestra el contacto como enlace de correo, nunca el marcador', async () => {
    renderAt('/privacidad')
    await screen.findByRole('heading', { level: 1, name: 'Privacidad' })
    expect(document.body).not.toHaveTextContent(PRIVACY_CONTACT_PLACEHOLDER)
    expect(screen.getByRole('link', { name: PRIVACY_CONTACT })).toHaveAttribute(
      'href',
      `mailto:${PRIVACY_CONTACT}`,
    )
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
  it('hay un contacto real publicado', () => {
    expect(isPrivacyContactPending()).toBe(false)
    expect(isPrivacyContactPending(PRIVACY_CONTACT_PLACEHOLDER)).toBe(true)
    expect(isPrivacyContactPending('  ')).toBe(true)
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
