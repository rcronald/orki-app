import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountDeletionGate } from '../account/AccountDeletionGate.tsx'
import { setAccountDeletionPhase } from '../account/deletion-status.ts'
import { RequireAuth } from '../auth/RouteGuards.tsx'
import { resetAccountDeletionMarkers } from '../lib/account-deletion-marker.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import {
  deleteUser,
  fakeClerk,
  FAKE_USER_EMAIL,
  FAKE_USER_ID,
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

// Las mismas rutas que App.tsx para /cuenta.
function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/iniciar-sesion" element={<p>Pantalla de acceso</p>} />
        <Route element={<AccountDeletionGate />}>
          <Route element={<RequireAuth />}>
            <Route
              path="/cuenta"
              element={<AccountPage dataEffects={dataEffects} />}
            />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>,
  )
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
    expect(
      screen.getByRole('button', { name: 'Eliminar mi cuenta' }),
    ).toBeDisabled()
    expect(order).toEqual([])
  })
})
