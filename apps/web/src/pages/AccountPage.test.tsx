import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountDeletionGate } from '../account/AccountDeletionGate.tsx'
import { setAccountDeletionPhase } from '../account/deletion-status.ts'
import { getOfflineIdentity, rememberUser } from '../auth/offline-identity.ts'
import { RequireAuth } from '../auth/RouteGuards.tsx'
import { CollectionProvider } from '../collection/CollectionProvider.tsx'
import { inventoryCsv } from '../collection/export-csv.ts'
import {
  markAccountDeletionStarted,
  resetAccountDeletionMarkers,
} from '../lib/account-deletion-marker.ts'
import { textPageBack } from '../routes/text-page-origin.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import { fakeCollectionSource } from '../test/collection-source.ts'
import { CATTLEYA, plant } from '../test/collection.ts'
import {
  changeFakeUser,
  deleteUser,
  fakeClerk,
  FAKE_USER_EMAIL,
  FAKE_USER_ID,
  openUserProfile,
  resetFakeClerk,
  setActive,
  setFakeClerk,
} from '../test/clerk-mock.tsx'
import { AccountPage } from './AccountPage.tsx'
import { HomeRoute } from './HomeRoute.tsx'

vi.mock('@clerk/react', () => import('../test/clerk-mock.tsx'))

const order: string[] = []
const dataEffects = {
  deletePhotos: vi.fn((userId: string) => {
    order.push(`photos:${userId}`)
    return Promise.resolve()
  }),
  deletePlants: vi.fn((userId: string) => {
    order.push(`plants:${userId}`)
    return Promise.resolve()
  }),
  deleteProfile: vi.fn((userId: string) => {
    order.push(`profile:${userId}`)
    return Promise.resolve()
  }),
}

/** La privacidad, reducida a su enlace de volver según el origen. */
function PrivacyBack() {
  const back = textPageBack(useLocation().state)
  return <a href={back.to}>{back.label}</a>
}

// La ruta actual del enrutador, oculta.
function LocationProbe() {
  return (
    <div hidden data-testid="ruta">
      {useLocation().pathname}
    </div>
  )
}

function currentPath() {
  return screen.getByTestId('ruta').textContent
}

// Las mismas rutas que App.tsx para /cuenta, con la colección compartida
// (CollectionProvider, como en AuthProvider) leída de una fuente simulada.
function renderAt(path: string, source = fakeCollectionSource()) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <CollectionProvider source={source} thumbnailSync={null}>
        <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/iniciar-sesion" element={<p>Pantalla de acceso</p>} />
          <Route path="/coleccion" element={<p>Pantalla de la colección</p>} />
          <Route path="/privacidad" element={<PrivacyBack />} />
          <Route element={<AccountDeletionGate />}>
            <Route element={<RequireAuth />}>
              <Route
                path="/cuenta"
                element={<AccountPage dataEffects={dataEffects} />}
              />
            </Route>
          </Route>
        </Routes>
        <LocationProbe />
      </CollectionProvider>
    </MemoryRouter>,
  )
  return source
}

beforeEach(() => {
  resetFakeClerk()
  setFakeClerk({ signedIn: true })
  document.documentElement.lang = 'es'
  document.title = 'orqui.apps'
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  order.length = 0
  // Al eliminar la cuenta, Clerk deja de tener sesión.
  deleteUser.mockImplementation(() => {
    order.push('clerk')
    fakeClerk.signedIn = false
    return Promise.resolve()
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  resetAccountDeletionMarkers()
  setAccountDeletionPhase('idle')
})

async function deleteFromPage(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Eliminar mi cuenta' }))
  const dialog = screen.getByRole('dialog')
  await user.type(
    within(dialog).getByLabelText('Para confirmar, escribe ELIMINAR'),
    'eliminar',
  )
  await user.click(
    within(dialog).getByRole('button', {
      name: 'Eliminar mi cuenta para siempre',
    }),
  )
}

describe('AccountPage', () => {
  it('con sesión: título, correo de Clerk y axe', async () => {
    renderAt('/cuenta')
    expect(
      screen.getByRole('heading', { level: 1, name: 'Tu cuenta' }),
    ).toBeInTheDocument()
    expect(document.title).toBe('Tu cuenta · orqui.apps')
    expect(screen.getByText(FAKE_USER_EMAIL)).toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('«Editar perfil» abre el editor de Clerk sin su «Eliminar cuenta» (#207)', async () => {
    const user = userEvent.setup()
    renderAt('/cuenta')
    await user.click(screen.getByRole('button', { name: 'Editar perfil' }))
    expect(openUserProfile).toHaveBeenCalledWith({
      appearance: { elements: { profileSection__danger: { display: 'none' } } },
    })
  })

  it('sin sesión: al inicio de sesión', () => {
    setFakeClerk({ signedIn: false })
    renderAt('/cuenta')
    expect(screen.getByText('Pantalla de acceso')).toBeInTheDocument()
  })

  it('elimina datos y cuenta, cierra la sesión y vuelve al inicio con el aviso', async () => {
    const user = userEvent.setup()
    renderAt('/cuenta')

    await deleteFromPage(user)

    const notice = await screen.findByText(/Tu cuenta se eliminó/)
    expect(notice.closest('[role="status"]')).not.toBeNull()
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(order).toEqual([
      `photos:${FAKE_USER_ID}`,
      `plants:${FAKE_USER_ID}`,
      `profile:${FAKE_USER_ID}`,
      'clerk',
    ])
    expect(setActive).toHaveBeenCalledWith({ session: null })
    await expectNoAxeViolations()
  })

  it('si Clerk rechaza el borrado (ajuste desactivado), se queda con el mensaje', async () => {
    const user = userEvent.setup()
    deleteUser.mockRejectedValue({
      status: 403,
      errors: [{ code: 'not_allowed' }],
    })
    renderAt('/cuenta')

    await deleteFromPage(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Todavía no se puede eliminar la cuenta desde orqui.apps.',
    )
    expect(setActive).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('si Clerk dice de antemano que no deja eliminar, no se borra nada', () => {
    setFakeClerk({ deleteSelfEnabled: false })
    renderAt('/cuenta')
    const button = screen.getByRole('button', { name: 'Eliminar mi cuenta' })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription(
      /Todavía no se puede eliminar la cuenta/,
    )
    expect(order).toEqual([])
  })
})

const PLANTS = [
  plant({ displayName: 'Phalaenopsis amabilis', nickname: '=1+1' }),
  plant({ displayName: 'Cattleya maxima', genus: CATTLEYA }),
  plant({ displayName: 'Phalaenopsis aphrodite', status: 'lost' }),
]

const BLOB_URL = 'blob:http://localhost/prueba'

/** El texto del archivo, con su marca de orden de bytes. */
async function csvOf(blob: Blob | undefined): Promise<string> {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(
    await blob?.arrayBuffer(),
  )
}

describe('AccountPage: rediseño de «Tu cuenta» (#214)', () => {
  let created: Blob[] = []

  beforeEach(() => {
    created = []
    // jsdom no implementa las URL de objeto ni descarga al pulsar un enlace.
    URL.createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob)
      return BLOB_URL
    })
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  const profile = () => screen.getByRole('region', { name: 'Perfil' })
  const data = () => screen.getByRole('region', { name: 'Datos y privacidad' })
  const exportRow = () =>
    within(data()).getByRole('button', { name: /^Exportar inventario a CSV/ })

  async function withPlants(plants = PLANTS) {
    const source = renderAt('/cuenta')
    await act(async () => {
      source.last().resolve(plants)
      await Promise.resolve()
    })
    return source
  }

  it('cabecera, un h1 y tres paneles h2; «Volver a Mi colección» lleva a la colección', async () => {
    const user = userEvent.setup()
    await withPlants()
    expect(
      screen
        .getAllByRole('heading')
        .map((heading) => `${heading.tagName} ${heading.textContent}`),
    ).toEqual([
      'H1 Tu cuenta',
      'H2 Perfil',
      'H2 Datos y privacidad',
      'H2 Eliminar cuenta',
    ])
    await expectNoAxeViolations()
    await user.click(
      screen.getByRole('link', { name: 'Volver a Mi colección' }),
    )
    expect(currentPath()).toBe('/coleccion')
  })

  it('perfil con nombre y foto: la foto, el nombre y el correo', () => {
    setFakeClerk({ imageUrl: 'https://img.clerk.invalid/ana.png' })
    renderAt('/cuenta')
    const panel = profile()
    expect(within(panel).getByText('Persona de Prueba')).toBeInTheDocument()
    expect(within(panel).getByText(FAKE_USER_EMAIL)).toBeInTheDocument()
    expect(panel.querySelector('img')).toHaveAttribute(
      'src',
      'https://img.clerk.invalid/ana.png',
    )
  })

  it('perfil sin foto: las iniciales', () => {
    renderAt('/cuenta')
    const panel = profile()
    expect(panel.querySelector('img')).toBeNull()
    expect(within(panel).getByText('PP')).toBeInTheDocument()
  })

  it('perfil sin nombre: el correo como identificación y el icono de perfil', async () => {
    setFakeClerk({ fullName: null })
    renderAt('/cuenta')
    const panel = profile()
    expect(within(panel).getAllByText(FAKE_USER_EMAIL)).toHaveLength(1)
    expect(panel.querySelector('.orki-profile__name')).toHaveTextContent(
      FAKE_USER_EMAIL,
    )
    expect(panel.querySelector('.lucide-user')).not.toBeNull()
    await expectNoAxeViolations()
  })

  it('«Editar perfil» abre el editor y, al cerrarlo, los cambios se ven sin recargar', async () => {
    const user = userEvent.setup()
    // Como Clerk: se guarda en el editor y useUser() trae los datos nuevos.
    openUserProfile.mockImplementation(() =>
      changeFakeUser({
        fullName: 'Ana López',
        imageUrl: 'https://img.clerk.invalid/ana.png',
      }),
    )
    renderAt('/cuenta')
    expect(within(profile()).getByText('PP')).toBeInTheDocument()
    await user.click(
      within(profile()).getByRole('button', { name: 'Editar perfil' }),
    )
    expect(openUserProfile).toHaveBeenCalledTimes(1)
    expect(within(profile()).getByText('Ana López')).toBeInTheDocument()
    expect(profile().querySelector('img')).toHaveAttribute(
      'src',
      'https://img.clerk.invalid/ana.png',
    )
  })

  it('exportar con plantas: el mismo CSV que «Mi colección» y el resultado anunciado', async () => {
    const user = userEvent.setup()
    await withPlants()
    expect(exportRow()).toHaveAccessibleName(
      'Exportar inventario a CSV El archivo CSV no incluye las fotos.',
    )
    await user.click(exportRow())
    expect(created).toHaveLength(1)
    expect(await csvOf(created[0])).toBe(inventoryCsv(PLANTS))
    expect(within(data()).getByRole('status')).toHaveTextContent(
      /^Listo: orqui-apps-inventario-\d{4}-\d{2}-\d{2}\.csv, con 3 plantas\.$/,
    )
  })

  it('exportar sin plantas: el archivo solo con la cabecera, como en «Mi colección»', async () => {
    const user = userEvent.setup()
    await withPlants([])
    await user.click(exportRow())
    expect(await csvOf(created[0])).toBe(inventoryCsv([]))
    expect(within(data()).getByRole('status')).toHaveTextContent(
      'con 0 plantas.',
    )
  })

  it('si no se puede crear el archivo, lo dice', async () => {
    const user = userEvent.setup()
    URL.createObjectURL = vi.fn(() => {
      throw new Error('sin memoria')
    })
    await withPlants()
    await user.click(exportRow())
    expect(within(data()).getByRole('status')).toHaveTextContent(
      'No se pudo crear el archivo. Vuelve a intentarlo.',
    )
  })

  it('mientras carga la colección, la fila lo dice y no exporta', async () => {
    const user = userEvent.setup()
    renderAt('/cuenta')
    const row = exportRow()
    expect(row).toHaveAttribute('aria-disabled', 'true')
    expect(row).toHaveAccessibleName(
      'Exportar inventario a CSV Cargando tu colección para exportarla…',
    )
    await user.click(row)
    expect(created).toEqual([])
    await expectNoAxeViolations()
  })

  it('si la colección no carga, lo dice y deja volver a cargarla', async () => {
    const user = userEvent.setup()
    const source = renderAt('/cuenta')
    await act(async () => {
      source.last().reject(new Error('fallo'))
      await Promise.resolve()
    })
    expect(exportRow()).toHaveAccessibleName(
      'Exportar inventario a CSV No se pudo cargar tu colección. Vuelve a intentarlo.',
    )
    await user.click(
      screen.getByRole('button', { name: 'Volver a cargar la colección' }),
    )
    expect(source.loads).toHaveLength(2)
    await act(async () => {
      source.last().resolve(PLANTS)
      await Promise.resolve()
    })
    expect(exportRow()).not.toHaveAttribute('aria-disabled')
  })

  it('«Aviso de privacidad» abre la privacidad con «Volver a Tu cuenta»', async () => {
    const user = userEvent.setup()
    renderAt('/cuenta')
    const link = within(data()).getByRole('link', {
      name: 'Aviso de privacidad Consulta qué datos guardamos y quién puede verlos.',
    })
    await user.click(link)
    expect(currentPath()).toBe('/privacidad')
    expect(
      screen.getByRole('link', { name: 'Volver a Tu cuenta' }),
    ).toHaveAttribute('href', '/cuenta')
  })

  it('«Eliminar mi cuenta» abre la confirmación; «Cancelar» devuelve el foco y no borra nada', async () => {
    const user = userEvent.setup()
    renderAt('/cuenta')
    const opener = within(
      screen.getByRole('region', { name: 'Eliminar cuenta' }),
    ).getByRole('button', { name: 'Eliminar mi cuenta' })
    expect(opener).toHaveClass('orki-btn--danger-outline')
    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: '¿Eliminar tu cuenta?' })
    expect(
      within(dialog).getByRole('button', {
        name: 'Eliminar mi cuenta para siempre',
      }),
    ).toHaveClass('orki-btn--danger')
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    expect(order).toEqual([])
  })

  it('con una eliminación a medias, ofrece continuarla o seguir usando orqui.apps', async () => {
    markAccountDeletionStarted(FAKE_USER_ID)
    renderAt('/cuenta')
    expect(
      screen.getByRole('button', { name: 'Continuar la eliminación' }),
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Seguir usando orqui.apps' }),
    ).toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('«Cerrar sesión», fuera del panel de peligro, cierra la sesión de la app', async () => {
    const user = userEvent.setup()
    renderAt('/cuenta')
    const signOut = screen.getByRole('button', { name: 'Cerrar sesión' })
    expect(signOut.closest('.orki-panel')).toBeNull()
    await user.click(signOut)
    expect(currentPath()).toBe('/')
    expect(getOfflineIdentity().pendingSignOut).toBe(FAKE_USER_ID)
  })

  it('sin conexión: el perfil se ve; editar y eliminar, deshabilitados con su motivo; exportar, la privacidad y cerrar sesión funcionan', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await withPlants()

    expect(within(profile()).getByText('Persona de Prueba')).toBeInTheDocument()
    const edit = within(profile()).getByRole('button', {
      name: 'Editar perfil',
    })
    expect(edit).toBeDisabled()
    expect(edit).toHaveAccessibleDescription(/Sin conexión/)
    const remove = screen.getByRole('button', { name: 'Eliminar mi cuenta' })
    expect(remove).toBeDisabled()
    expect(remove).toHaveAccessibleDescription(/Sin conexión/)
    await expectNoAxeViolations()

    await user.click(exportRow())
    expect(await csvOf(created[0])).toBe(inventoryCsv(PLANTS))
    expect(
      within(data()).getByRole('link', { name: /^Aviso de privacidad/ }),
    ).toHaveAttribute('href', '/privacidad')
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    expect(currentPath()).toBe('/')
  })

  it('con la sesión recordada sin confirmar: perfil neutro con la explicación; exportar, privacidad y cerrar sesión siguen', async () => {
    const user = userEvent.setup()
    setFakeClerk({ status: 'error', signedIn: false })
    rememberUser(FAKE_USER_ID)
    await withPlants()

    const panel = profile()
    expect(panel.querySelector('.lucide-user')).not.toBeNull()
    expect(within(panel).queryByText(FAKE_USER_EMAIL)).toBeNull()
    const edit = within(panel).getByRole('button', { name: 'Editar perfil' })
    expect(edit).toBeDisabled()
    expect(edit).toHaveAccessibleDescription(
      /No se pudo confirmar tu sesión: el servicio de acceso no responde\. Tus datos de perfil se verán/,
    )
    const remove = screen.getByRole('button', { name: 'Eliminar mi cuenta' })
    expect(remove).toBeDisabled()
    expect(remove).toHaveAccessibleDescription(
      /Para eliminar la cuenta hace falta conexión y la sesión confirmada/,
    )
    expect(
      within(data()).getByRole('link', { name: /^Aviso de privacidad/ }),
    ).toHaveAttribute('href', '/privacidad')
    await expectNoAxeViolations()

    await user.click(exportRow())
    expect(await csvOf(created[0])).toBe(inventoryCsv(PLANTS))
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    expect(currentPath()).toBe('/')
    expect(getOfflineIdentity().pendingSignOut).toBe(FAKE_USER_ID)
  })
})
