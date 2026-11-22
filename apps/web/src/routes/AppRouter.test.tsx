import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../config/env.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import {
  lastAuthComponentProps,
  lastProviderProps,
  resetFakeClerk,
  setFakeClerk,
} from '../test/clerk-mock.tsx'
import {
  LAST_USER_KEY,
  resetOfflineIdentity,
} from '../auth/offline-identity.ts'
import { AppRouter } from './AppRouter.tsx'

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

beforeEach(() => {
  resetFakeClerk()
  // Como en index.html.
  document.documentElement.lang = 'es'
  document.title = 'orqui.apps'
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  localStorage.clear()
  resetOfflineIdentity()
})

/** Este dispositivo recuerda a un usuario con sesión (#18, #120). */
function rememberUserOnDevice() {
  localStorage.setItem(LAST_USER_KEY, 'user_recordado')
  resetOfflineIdentity()
}

// Muestra la ubicación actual del enrutador para comprobar redirecciones.
function LocationProbe() {
  const location = useLocation()
  return (
    <div data-testid="location">
      {`${location.pathname}${location.search}${location.hash}`}
    </div>
  )
}

function renderAt(path: string, appEnv: AppEnv = 'dev') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRouter
        appEnv={appEnv}
        clerkPublishableKey="pk_test_clave_de_prueba"
      />
      <LocationProbe />
    </MemoryRouter>,
  )
}

function currentLocation() {
  return screen.getByTestId('location').textContent
}

// El h1 de la página; espera a que cargue el chunk diferido de la app.
function findHeading(name: string | RegExp) {
  return screen.findByRole('heading', { level: 1, name })
}

function routerPush(to: string) {
  const push = lastProviderProps?.routerPush as (to: string) => unknown
  return act(async () => {
    await push(to)
  })
}

describe('rutas públicas', () => {
  it('el inicio se abre sin sesión, con la cabecera pública y sin chips', async () => {
    renderAt('/')

    expect(await findHeading(/./)).toBeInTheDocument()
    expect(document.title).toBe('orqui.apps')
    expect(currentLocation()).toBe('/')
    expect(
      screen.queryByRole('navigation', { name: 'Principal' }),
    ).not.toBeInTheDocument()
    const banner = screen.getByRole('banner')
    expect(
      within(banner).getByRole('link', { name: 'Inicio de orqui.apps' }),
    ).toHaveAttribute('href', '/')
    expect(
      within(banner).getByRole('link', { name: 'Iniciar sesión' }),
    ).toHaveAttribute('href', '/iniciar-sesion')
    expect(
      within(banner).getByRole('link', { name: 'Crear cuenta gratis' }),
    ).toHaveAttribute('href', '/registro')
    expect(
      screen.getByRole('link', { name: 'Saltar al contenido' }),
    ).toHaveAttribute('href', '#contenido')
    expect(screen.getByRole('main')).toHaveAttribute('id', 'contenido')
    await expectNoAxeViolations()
  })

  it('el catálogo se abre sin sesión', async () => {
    renderAt('/catalogo')

    expect(await findHeading('Catálogo')).toBeInTheDocument()
    expect(document.title).toBe('Catálogo · orqui.apps')
    expect(currentLocation()).toBe('/catalogo')
    await expectNoAxeViolations()
  })

  it.each([
    ['si Clerk no carga', 'error', true],
    ['sin conexión y con Clerk sin cargar', 'loading', false],
  ] as const)(
    'el inicio no queda en blanco %s: la portada, sin redirigir',
    async (_case, status, online) => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online)
      setFakeClerk({ status })
      renderAt('/')

      expect(await findHeading(/./)).toBeInTheDocument()
      expect(
        within(screen.getByRole('banner')).getByRole('link', {
          name: 'Crear cuenta gratis',
        }),
      ).toBeInTheDocument()
      expect(currentLocation()).toBe('/')
    },
  )

  it('mientras Clerk carga y nadie está recordado: la portada al momento', async () => {
    setFakeClerk({ status: 'loading' })
    renderAt('/')

    expect(await findHeading(/./)).toBeInTheDocument()
    expect(
      within(screen.getByRole('banner')).getByRole('link', {
        name: 'Crear cuenta gratis',
      }),
    ).toBeInTheDocument()
    expect(currentLocation()).toBe('/')
  })

  it('una ruta que no existe muestra "no encontrado"', async () => {
    renderAt('/no-existe')

    expect(await findHeading('Página no encontrada')).toBeInTheDocument()
    expect(document.title).toBe('Página no encontrada · orqui.apps')
    expect(screen.getByRole('link', { name: 'Ir al inicio' })).toHaveAttribute(
      'href',
      '/',
    )
    await expectNoAxeViolations()
  })
})

describe('el inicio con sesión', () => {
  it('lleva a «Mi colección» sin pintar la portada', async () => {
    setFakeClerk({ signedIn: true })
    renderAt('/')

    expect(await findHeading('Mi colección')).toBeInTheDocument()
    expect(currentLocation()).toBe('/coleccion')
    expect(
      screen.queryByRole('link', { name: 'Crear cuenta gratis' }),
    ).not.toBeInTheDocument()
  })

  it('con la sesión recordada sin confirmar (sin conexión) lleva a la colección', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    setFakeClerk({ status: 'loading' })
    rememberUserOnDevice()
    renderAt('/')

    expect(await findHeading('Mi colección')).toBeInTheDocument()
    expect(currentLocation()).toBe('/coleccion')
  })

  it('mientras Clerk carga con un usuario recordado: «Cargando el acceso…», sin la portada', async () => {
    setFakeClerk({ status: 'loading' })
    rememberUserOnDevice()
    renderAt('/')

    expect(
      await screen.findByText('Cargando el acceso…', {
        selector: 'main [role="status"]',
      }),
    ).toBeInTheDocument()
    expect(currentLocation()).toBe('/')
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Crear cuenta gratis' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Inicio de orqui.apps' }),
    ).toBeInTheDocument()
  })

  it('el logotipo de la cabecera lleva al inicio, que vuelve a la colección', async () => {
    const user = userEvent.setup()
    setFakeClerk({ signedIn: true })
    renderAt('/cuenta')

    await findHeading('Tu cuenta')
    await user.click(screen.getByRole('link', { name: 'Inicio de orqui.apps' }))
    expect(await findHeading('Mi colección')).toBeInTheDocument()
    expect(currentLocation()).toBe('/coleccion')
  })
})

describe('rutas con sesión', () => {
  it('sin sesión, la colección lleva al inicio de sesión y, al entrar, vuelve a ella', async () => {
    renderAt('/coleccion')

    expect(await screen.findByTestId('clerk-sign-in')).toBeInTheDocument()
    expect(currentLocation()).toBe('/iniciar-sesion?redirect_url=%2Fcoleccion')
    expect(lastAuthComponentProps()).toMatchObject({
      routing: 'path',
      path: '/iniciar-sesion',
      forceRedirectUrl: '/coleccion',
      signUpForceRedirectUrl: '/coleccion',
    })

    // Clerk inicia la sesión y navega al destino con el enrutador.
    setFakeClerk({ signedIn: true })
    await routerPush('/coleccion')

    expect(await findHeading('Mi colección')).toBeInTheDocument()
    expect(currentLocation()).toBe('/coleccion')
  })

  it('conserva la búsqueda y el hash de la página pedida', async () => {
    renderAt('/coleccion/nueva?especie=1#foto')

    expect(await screen.findByTestId('clerk-sign-in')).toBeInTheDocument()
    expect(lastAuthComponentProps()?.forceRedirectUrl).toBe(
      '/coleccion/nueva?especie=1#foto',
    )
  })

  it('con sesión, la colección y el registro de planta se abren', async () => {
    const user = userEvent.setup()
    setFakeClerk({ signedIn: true })
    renderAt('/coleccion')

    expect(await findHeading('Mi colección')).toBeInTheDocument()
    await expectNoAxeViolations()

    await user.click(screen.getByRole('link', { name: 'Registrar orquídea' }))
    expect(await findHeading('Registrar una orquídea')).toBeInTheDocument()
    expect(currentLocation()).toBe('/coleccion/nueva')
    expect(document.title).toBe('Registrar una orquídea · orqui.apps')
    await expectNoAxeViolations()
  })

  it('el detalle de una planta exige sesión y vuelve a él al entrar', async () => {
    const path = '/coleccion/6f1c2a4e-8b3d-4e5f-9a7b-0c1d2e3f4a5b'
    renderAt(path)

    expect(await screen.findByTestId('clerk-sign-in')).toBeInTheDocument()
    expect(lastAuthComponentProps()?.forceRedirectUrl).toBe(path)

    // Con sesión, abrir la dirección (una recarga) llega al detalle, no a
    // "no encontrado": la pantalla espera a la colección.
    setFakeClerk({ signedIn: true })
    await routerPush(path)
    expect(
      await findHeading(
        /^(Cargando la planta…|No se pudo cargar la planta|Planta no encontrada)$/,
      ),
    ).toBeInTheDocument()
    expect(currentLocation()).toBe(path)
  })

  it('sin sesión, la pantalla de cuenta lleva al inicio de sesión', async () => {
    renderAt('/cuenta')
    await screen.findByTestId('clerk-sign-in')
    expect(currentLocation()).toBe('/iniciar-sesion?redirect_url=%2Fcuenta')
  })

  it('con sesión, la pantalla de cuenta se abre desde el menú «Tu cuenta»', async () => {
    const user = userEvent.setup()
    setFakeClerk({ signedIn: true })
    renderAt('/coleccion')
    await user.click(await screen.findByRole('button', { name: 'Tu cuenta' }))
    await user.click(screen.getByRole('menuitem', { name: 'Mi cuenta' }))
    expect(await findHeading('Tu cuenta')).toBeInTheDocument()
    expect(currentLocation()).toBe('/cuenta')
    await expectNoAxeViolations()
  })

  it('mientras Clerk carga: estado de carga, sin redirigir', async () => {
    setFakeClerk({ status: 'loading' })
    renderAt('/coleccion')

    expect(
      await screen.findByText('Cargando el acceso…', {
        selector: 'main [role="status"]',
      }),
    ).toBeInTheDocument()
    expect(currentLocation()).toBe('/coleccion')
  })

  it.each([
    ['si Clerk falla', 'error', true, 'No se pudo cargar el acceso'],
    ['sin conexión', 'loading', false, 'Sin conexión'],
  ] as const)(
    '%s: el aviso con la opción de reintentar, sin redirigir',
    async (_case, status, online, title) => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online)
      setFakeClerk({ status })
      renderAt('/coleccion')

      expect(await screen.findByRole('alert')).toHaveTextContent(title)
      expect(
        screen.getByRole('button', { name: 'Volver a intentar' }),
      ).toBeInTheDocument()
      expect(currentLocation()).toBe('/coleccion')
      await expectNoAxeViolations()
    },
  )
})

describe('administración del catálogo', () => {
  it('sin sesión, lleva al inicio de sesión', async () => {
    renderAt('/administracion/catalogo')

    expect(await screen.findByTestId('clerk-sign-in')).toBeInTheDocument()
    expect(lastAuthComponentProps()?.forceRedirectUrl).toBe(
      '/administracion/catalogo',
    )
  })

  it.each([
    ['sin rol', null],
    ['con otro rol', 'user'],
  ])(
    '%s: no ve la opción del menú y, si abre la ruta, "no tienes acceso"',
    async (_case, appRole) => {
      const user = userEvent.setup()
      setFakeClerk({ signedIn: true, appRole })
      renderAt('/administracion/catalogo')

      expect(await findHeading('No tienes acceso')).toBeInTheDocument()
      expect(currentLocation()).toBe('/administracion/catalogo')
      expect(
        screen.queryByRole('heading', { name: 'Administración del catálogo' }),
      ).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Tu cuenta' }))
      expect(
        screen.getAllByRole('menuitem').map((item) => item.textContent),
      ).toEqual(['Mi cuenta', 'Cerrar sesión'])
      await expectNoAxeViolations()
    },
  )

  it('con el rol catalog_admin: ve la opción del menú y la página', async () => {
    const user = userEvent.setup()
    setFakeClerk({ signedIn: true, appRole: 'catalog_admin' })
    renderAt('/coleccion')

    await findHeading('Mi colección')
    await user.click(screen.getByRole('button', { name: 'Tu cuenta' }))
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent),
    ).toEqual(['Mi cuenta', 'Administración', 'Cerrar sesión'])
    await user.click(screen.getByRole('menuitem', { name: 'Administración' }))

    expect(await findHeading('Administración del catálogo')).toBeInTheDocument()
    expect(currentLocation()).toBe('/administracion/catalogo')
    await expectNoAxeViolations()
  })
})

describe('pantallas de acceso', () => {
  it('montan Clerk con rutas del enrutador, también en sus subrutas', async () => {
    renderAt('/iniciar-sesion/factor-one')
    expect(await screen.findByTestId('clerk-sign-in')).toHaveAttribute(
      'data-routing',
      'path',
    )
    expect(lastAuthComponentProps()?.forceRedirectUrl).toBeUndefined()
  })

  it('el registro de cuenta tiene su propia ruta', async () => {
    renderAt('/registro?redirect_url=%2Fcatalogo')

    expect(await screen.findByTestId('clerk-sign-up')).toBeInTheDocument()
    expect(lastAuthComponentProps()).toMatchObject({
      routing: 'path',
      path: '/registro',
      forceRedirectUrl: '/catalogo',
      signInForceRedirectUrl: '/catalogo',
    })
  })

  it.each([
    'https://malicioso.example/coleccion',
    '//malicioso.example/coleccion',
    '/\\malicioso.example',
    'javascript:alert(1)',
    '/iniciar-sesion',
  ])('rechaza el destino %s y vuelve al inicio', async (destination) => {
    renderAt(
      `/iniciar-sesion?${new URLSearchParams({ redirect_url: destination }).toString()}`,
    )

    expect(await screen.findByTestId('clerk-sign-in')).toBeInTheDocument()
    expect(lastAuthComponentProps()?.forceRedirectUrl).toBe('/')
    expect(lastAuthComponentProps()?.signUpForceRedirectUrl).toBe('/')
  })

  it('Clerk navega con el enrutador, sin recargar', async () => {
    renderAt('/iniciar-sesion')
    await screen.findByTestId('clerk-sign-in')

    await routerPush('/iniciar-sesion/factor-one')
    expect(currentLocation()).toBe('/iniciar-sesion/factor-one')

    const replace = lastProviderProps?.routerReplace as (to: string) => unknown
    await act(async () => {
      await replace(`${window.location.origin}/catalogo`)
    })
    expect(await findHeading('Catálogo')).toBeInTheDocument()
  })
})

describe('página de muestra', () => {
  it('existe fuera de producción', async () => {
    renderAt('/muestra', 'dev')

    expect(await findHeading('Muestra del design system')).toBeInTheDocument()
    // Queda fuera de Clerk: no se monta el proveedor.
    expect(lastProviderProps).toBeUndefined()
  })

  it('no existe en producción', async () => {
    renderAt('/muestra', 'prod')

    expect(await findHeading('Página no encontrada')).toBeInTheDocument()
  })
})

describe('navegación', () => {
  it('barra de la app: solo «Mi colección»; marca la página actual y se usa con el teclado', async () => {
    const user = userEvent.setup()
    setFakeClerk({ signedIn: true })
    renderAt('/cuenta')

    await findHeading('Tu cuenta')
    const nav = screen.getByRole('navigation', { name: 'Principal' })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Mi colección'])

    // Saltar al contenido, el logotipo y la pestaña «Mi colección»; después,
    // el botón del menú «Tu cuenta».
    await user.tab()
    expect(
      screen.getByRole('link', { name: 'Saltar al contenido' }),
    ).toHaveFocus()
    await user.tab()
    expect(
      screen.getByRole('link', { name: 'Inicio de orqui.apps' }),
    ).toHaveFocus()
    await user.tab()
    const collection = within(nav).getByRole('link', { name: 'Mi colección' })
    expect(collection).toHaveFocus()
    expect(collection).not.toHaveAttribute('aria-current')
    await user.keyboard('{Enter}')

    // El foco pasa al título de la página nueva y la pestaña cambia.
    const heading = await findHeading('Mi colección')
    expect(heading).toHaveFocus()
    expect(document.title).toBe('Mi colección · orqui.apps')
    expect(collection).toHaveAttribute('aria-current', 'page')
    await expectNoAxeViolations()
  })

  it('al cargar no mueve el foco', async () => {
    renderAt('/catalogo')

    expect(await findHeading('Catálogo')).not.toHaveFocus()
  })

  it('el catálogo sigue existiendo, sin enlace en la barra', async () => {
    setFakeClerk({ signedIn: true })
    renderAt('/catalogo')

    expect(await findHeading('Catálogo')).toBeInTheDocument()
    const banner = screen.getByRole('banner')
    expect(
      within(banner).queryByRole('link', { name: 'Catálogo' }),
    ).not.toBeInTheDocument()
  })

  it('sin sesión, las páginas de la app llevan la barra pública', async () => {
    const user = userEvent.setup()
    renderAt('/catalogo')

    await findHeading('Catálogo')
    expect(
      screen.queryByRole('navigation', { name: 'Principal' }),
    ).not.toBeInTheDocument()
    const banner = screen.getByRole('banner')
    expect(banner).toHaveClass('orki-nav')
    expect(
      within(banner).getByRole('link', { name: 'Crear cuenta gratis' }),
    ).toHaveClass('orki-btn--strong')
    await user.click(
      within(banner).getByRole('link', { name: 'Iniciar sesión' }),
    )

    expect(await screen.findByTestId('clerk-sign-in')).toBeInTheDocument()
    expect(currentLocation()).toBe('/iniciar-sesion')
    // Al llegar navegando, el foco va al contenido de la pantalla de acceso.
    expect(screen.getByRole('main', { name: 'Iniciar sesión' })).toHaveFocus()
  })

  it('desde la portada, «Crear cuenta gratis» lleva al registro con el foco en su contenido', async () => {
    const user = userEvent.setup()
    renderAt('/')

    await findHeading(/./)
    await user.click(
      within(screen.getByRole('banner')).getByRole('link', {
        name: 'Crear cuenta gratis',
      }),
    )

    expect(await screen.findByTestId('clerk-sign-up')).toBeInTheDocument()
    expect(currentLocation()).toBe('/registro')
    expect(screen.getByRole('main', { name: 'Crear cuenta' })).toHaveFocus()
  })
})
