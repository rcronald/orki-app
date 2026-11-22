import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, type InitialEntry } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRouter } from '../routes/AppRouter.tsx'
import { expectNoAxeViolations } from '../test/axe.ts'
import { resetFakeClerk, setFakeClerk } from '../test/clerk-mock.tsx'

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

beforeEach(() => {
  resetFakeClerk()
  document.documentElement.lang = 'es'
  document.title = 'orqui.apps'
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

function renderAt(path: InitialEntry) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRouter appEnv="dev" clerkPublishableKey="pk_test_clave_de_prueba" />
    </MemoryRouter>,
  )
}

function findTitle() {
  return screen.findByRole('heading', { level: 1, name: 'Créditos y fuentes' })
}

function section(title: string): HTMLElement {
  const found = screen
    .getByRole('heading', { level: 2, name: title })
    .closest('section')
  if (!found) throw new Error(`Falta la sección «${title}».`)
  return found
}

describe('CreditsPage', () => {
  it('se abre sin sesión, con su índice, «Volver al inicio» y axe', async () => {
    renderAt('/creditos')

    expect(await findTitle()).toBeInTheDocument()
    expect(document.title).toBe('Créditos y fuentes · orqui.apps')
    const toc = screen.getByRole('navigation', { name: 'En esta página' })
    expect(
      within(toc)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Catálogo de especies', 'Imágenes', 'Tipografías', 'Iconos'])
    expect(
      screen.getByRole('link', { name: 'Volver al inicio' }),
    ).toHaveAttribute('href', '/')
    await expectNoAxeViolations()
  })

  it('también se abre si Clerk no carga', async () => {
    setFakeClerk({ status: 'error' })
    renderAt('/creditos')
    expect(await findTitle()).toBeInTheDocument()
  })

  it('atribuye el catálogo como pide CC BY 4.0: versión, DOI, licencia y cambios', async () => {
    renderAt('/creditos')
    await findTitle()

    const catalog = section('Catálogo de especies')
    expect(catalog).toHaveTextContent('Catalogue of Life (COL26.10 XR)')
    expect(catalog).toHaveTextContent(
      'En orqui.apps se filtró a las orquídeas y se normalizó.',
    )
    expect(catalog).toHaveTextContent('lista curada')
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

  it('dice el origen de las imágenes, sin hablar de sus derechos', async () => {
    renderAt('/creditos')
    await findTitle()

    const images = section('Imágenes')
    expect(images).toHaveTextContent('generadas con IA (OpenAI)')
    expect(images).toHaveTextContent(
      'No son fotos de plantas reales de ninguna colección.',
    )
    expect(images).not.toHaveTextContent(/licencia|derechos/i)
  })

  it('nombra las tipografías y los iconos con sus licencias', async () => {
    renderAt('/creditos')
    await findTitle()

    const fonts = section('Tipografías')
    expect(fonts).toHaveTextContent('Playfair Display')
    expect(fonts).toHaveTextContent('Inter')
    expect(fonts).toHaveTextContent('SIL Open Font License 1.1')
    const icons = section('Iconos')
    expect(icons).toHaveTextContent('Lucide')
    expect(icons).toHaveTextContent('licencia ISC')
    expect(icons).toHaveTextContent('Feather')
  })

  it('se llega desde la privacidad, con el mismo enlace de volver', async () => {
    const user = userEvent.setup()
    renderAt({ pathname: '/privacidad', state: { origen: 'coleccion' } })
    const privacy = await screen.findByRole('heading', {
      level: 2,
      name: 'Qué datos guardamos',
    })
    const privacySection = privacy.closest('section')
    if (!privacySection) throw new Error('Falta la sección.')
    await user.click(
      within(privacySection).getByRole('link', { name: 'Créditos y fuentes' }),
    )
    expect(await findTitle()).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Volver a Mi colección' }),
    ).toHaveAttribute('href', '/coleccion')
  })

  it('se llega desde el pie', async () => {
    renderAt('/')
    expect(
      within(await screen.findByRole('contentinfo')).getByRole('link', {
        name: 'Créditos y fuentes',
      }),
    ).toHaveAttribute('href', '/creditos')
  })
})
