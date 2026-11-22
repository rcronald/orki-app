import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  accountDeletionMarkerKey,
  isAccountDeletionPending,
  markAccountDeletionStarted,
  resetAccountDeletionMarkers,
} from '../lib/account-deletion-marker.ts'
import { SessionUnverifiedContext } from '../collection/useReadOnly.ts'
import { plantDraftKey } from '../registration/draft.ts'
import {
  setProductEventsRuntimeLoader,
  setProductEventsSession,
} from '../telemetry/product-events.ts'
import type { ProductEventsRuntime } from '../telemetry/runtime.ts'
import { expectNoAxeViolations } from '../test/axe.ts'
import { AccountView } from './AccountView.tsx'
import {
  AccountDeletionError,
  DELETION_STEPS,
  type AccountDeletionEffects,
  type DeletionStep,
} from './deletion.ts'
import { setAccountDeletionPhase } from './deletion-status.ts'

const USER = 'user_prueba'

interface Deferred {
  resolve: () => void
  reject: (error: unknown) => void
}

/**
 * Efectos controlados: cada llamada queda pendiente hasta que la prueba la
 * resuelve (`next`), o se resuelven solos con `auto`.
 */
function controlledEffects({ auto = false } = {}) {
  const calls: DeletionStep[] = []
  const pending: Deferred[] = []
  const failOnce = new Map<DeletionStep, Error>()
  const step = (name: DeletionStep) => () => {
    calls.push(name)
    const failure = failOnce.get(name)
    if (failure !== undefined) {
      failOnce.delete(name)
      return Promise.reject(failure)
    }
    if (auto) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      pending.push({ resolve, reject })
    })
  }
  const effects: AccountDeletionEffects = {
    deletePhotos: step('photos'),
    deletePlants: step('plants'),
    deleteProfile: step('profile'),
    deleteAccount: step('account'),
  }
  return {
    effects,
    calls,
    failOnce,
    async next() {
      // El primer paso empieza tras vaciar la cola de eventos (asíncrono).
      await vi.waitFor(() => {
        if (pending.length === 0)
          throw new Error('No hay ningún paso pendiente.')
      })
      const deferred = pending.shift()
      if (!deferred) throw new Error('No hay ningún paso pendiente.')
      await act(async () => {
        deferred.resolve()
        await Promise.resolve()
      })
    },
  }
}

function renderView(
  props: Partial<Parameters<typeof AccountView>[0]> & {
    effects: AccountDeletionEffects
  },
  { unverified = false } = {},
) {
  const onDeleted = vi.fn()
  const onKeepUsing = vi.fn()
  render(
    <MemoryRouter>
      <SessionUnverifiedContext value={unverified}>
        <main>
          <button type="button">Antes</button>
          <AccountView
            userId={USER}
            email="persona@example.com"
            canDeleteAccount
            onDeleted={onDeleted}
            onKeepUsing={onKeepUsing}
            {...props}
          />
        </main>
      </SessionUnverifiedContext>
    </MemoryRouter>,
  )
  return { onDeleted, onKeepUsing }
}

/** Cola de eventos simulada: lo que se le pide, en orden, junto a los pasos. */
function fakeEventsRuntime(log: string[]): ProductEventsRuntime {
  return {
    setSession: (session) => {
      log.push(session === null ? 'eventos:sin-sesion' : 'eventos:sesion')
    },
    record: () => {
      log.push('eventos:registrado')
    },
    flush: () => Promise.resolve(),
    settle: () => {
      log.push('eventos:vaciada')
      return Promise.resolve()
    },
  }
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Eliminar mi cuenta' }))
  return screen.getByRole('dialog', { name: '¿Eliminar tu cuenta?' })
}

async function confirm(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await openDialog(user)
  await user.type(
    within(dialog).getByLabelText('Para confirmar, escribe ELIMINAR'),
    'ELIMINAR',
  )
  await user.click(
    within(dialog).getByRole('button', {
      name: 'Eliminar mi cuenta para siempre',
    }),
  )
  return dialog
}

let eventsLog: string[] = []

beforeEach(() => {
  eventsLog = []
  setProductEventsRuntimeLoader(() =>
    Promise.resolve(fakeEventsRuntime(eventsLog)),
  )
  // Como en index.html.
  document.documentElement.lang = 'es'
  document.title = 'orqui.apps'
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

afterEach(() => {
  setProductEventsRuntimeLoader(null)
  vi.restoreAllMocks()
  resetAccountDeletionMarkers()
  setAccountDeletionPhase('idle')
})

describe('AccountView', () => {
  it('muestra el correo, explica qué se borra y enlaza la privacidad', async () => {
    const { effects } = controlledEffects()
    renderView({ effects })
    expect(screen.getByText('persona@example.com')).toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: 'Qué datos guarda orqui.apps (privacidad)',
      }),
    ).toHaveAttribute('href', '/privacidad')
    expect(
      screen.getByText(
        /se borran tus plantas con todos sus detalles, sus fotos, tu perfil/,
      ),
    ).toBeInTheDocument()
    await expectNoAxeViolations()
  })

  it('la confirmación no se activa por accidente', async () => {
    const user = userEvent.setup()
    const { effects, calls } = controlledEffects()
    renderView({ effects })

    const dialog = await openDialog(user)
    const field = within(dialog).getByLabelText(
      'Para confirmar, escribe ELIMINAR',
    )
    const confirmButton = within(dialog).getByRole('button', {
      name: 'Eliminar mi cuenta para siempre',
    })
    expect(within(dialog).getByText(/No se puede deshacer/)).toBeInTheDocument()
    expect(confirmButton).toBeDisabled()

    // Enter sin escribir nada, o con una palabra a medias, no hace nada.
    await user.type(field, '{Enter}')
    await user.type(field, 'ELIMINA{Enter}')
    expect(confirmButton).toBeDisabled()
    expect(calls).toEqual([])

    // Con la palabra entera (sin importar mayúsculas) se habilita.
    await user.type(field, 'r')
    expect(confirmButton).toBeEnabled()
  })

  it('con teclado: foco atrapado, Escape cancela y el foco vuelve al botón', async () => {
    const user = userEvent.setup()
    const { effects } = controlledEffects()
    renderView({ effects })

    const opener = screen.getByRole('button', { name: 'Eliminar mi cuenta' })
    opener.focus()
    await user.keyboard('{Enter}')
    const dialog = screen.getByRole('dialog', { name: '¿Eliminar tu cuenta?' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const field = within(dialog).getByLabelText(
      'Para confirmar, escribe ELIMINAR',
    )
    expect(field).toHaveFocus()
    await expectNoAxeViolations()

    // El confirmar está deshabilitado: Tab va del campo a Cancelar y vuelve.
    const cancel = within(dialog).getByRole('button', { name: 'Cancelar' })
    await user.tab()
    expect(cancel).toHaveFocus()
    await user.tab()
    expect(field).toHaveFocus()
    await user.tab({ shift: true })
    expect(cancel).toHaveFocus()

    // El resto de la página queda inerte mientras está abierto.
    expect(
      screen
        .getByRole('button', { name: 'Antes', hidden: true })
        .closest('[inert]'),
    ).not.toBeNull()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    expect(document.querySelector('[inert]')).toBeNull()
  })

  it('borra en orden, anuncia cada paso, limpia el dispositivo y termina', async () => {
    const user = userEvent.setup()
    const control = controlledEffects()
    localStorage.setItem(plantDraftKey(USER), '{}')
    const { onDeleted } = renderView({ effects: control.effects })

    const dialog = await confirm(user)
    const status = within(dialog).getByRole('status')
    expect(isAccountDeletionPending(USER)).toBe(true)

    expect(status).toHaveTextContent('Paso 1 de 4: borrando tus fotos…')
    // Sin doble envío: el botón queda deshabilitado y no hay Cancelar.
    expect(
      within(dialog).getByRole('button', {
        name: 'Eliminar mi cuenta para siempre',
      }),
    ).toBeDisabled()
    expect(
      within(dialog).queryByRole('button', { name: 'Cancelar' }),
    ).toBeNull()
    // Escape no cierra a mitad.
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await control.next()
    expect(status).toHaveTextContent('Paso 2 de 4: borrando tus plantas…')
    await control.next()
    expect(status).toHaveTextContent('Paso 3 de 4: borrando tu perfil…')
    await control.next()
    // Tras el perfil se limpia el dispositivo (asíncrono) antes del paso 4.
    await vi.waitFor(() =>
      expect(status).toHaveTextContent(
        'Paso 4 de 4: eliminando tu cuenta de acceso…',
      ),
    )
    // Con los datos borrados ya se limpió el dispositivo, salvo la marca.
    expect(localStorage.getItem(plantDraftKey(USER))).toBeNull()
    expect(localStorage.getItem(accountDeletionMarkerKey(USER))).not.toBeNull()
    expect(onDeleted).not.toHaveBeenCalled()

    await control.next()
    expect(control.calls).toEqual([...DELETION_STEPS])
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
    expect(isAccountDeletionPending(USER)).toBe(false)
  })

  it('antes de borrar nada vacía la cola de eventos y no registra ninguno más (#110)', async () => {
    const user = userEvent.setup()
    const control = controlledEffects()
    setProductEventsSession({ userId: USER, confirmed: true, online: true })
    renderView({ effects: control.effects })
    await vi.waitFor(() => expect(eventsLog).toContain('eventos:sesion'))
    eventsLog.length = 0

    await confirm(user)
    await vi.waitFor(() => expect(control.calls).toEqual(['photos']))
    // La cola se quedó sin sesión (se borran las colas) y se esperó a que
    // terminara antes de borrar las fotos.
    expect(eventsLog).toEqual(['eventos:sin-sesion', 'eventos:vaciada'])
  })

  it('un fallo inesperado fuera de los pasos no sale como error sin capturar', async () => {
    const user = userEvent.setup()
    const control = controlledEffects({ auto: true })
    const onDeleted = vi.fn(() =>
      Promise.reject(new Error('persona@example.com')),
    )
    renderView({
      effects: control.effects,
      onDeleted,
      device: {
        beforeDeletion: () => Promise.resolve(),
        afterDataDeleted: () => Promise.resolve(),
        afterAccountDeleted: () =>
          Promise.reject(new Error('persona@example.com')),
      },
    })
    const unhandled = vi.fn()
    window.addEventListener('unhandledrejection', unhandled)
    try {
      await confirm(user)
      await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('unhandledrejection', unhandled)
    }
  })

  it('con la sesión sin confirmar, la acción se deshabilita con el motivo', async () => {
    const { effects } = controlledEffects()
    renderView({ effects }, { unverified: true })
    const button = screen.getByRole('button', { name: 'Eliminar mi cuenta' })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription(/No se pudo confirmar tu sesión/)
    await expectNoAxeViolations()
  })

  it.each(DELETION_STEPS)(
    'si falla %s se detiene, lo explica y el reintento termina',
    async (failingStep) => {
      const user = userEvent.setup()
      const control = controlledEffects({ auto: true })
      control.failOnce.set(failingStep, new AccountDeletionError('offline'))
      const { onDeleted } = renderView({ effects: control.effects })

      const dialog = await confirm(user)
      const alert = await within(dialog).findByRole('alert')
      expect(alert).toHaveTextContent('No hay conexión.')
      const index = DELETION_STEPS.indexOf(failingStep)
      expect(control.calls).toEqual(DELETION_STEPS.slice(0, index + 1))
      expect(onDeleted).not.toHaveBeenCalled()
      await expectNoAxeViolations()

      await user.click(
        within(dialog).getByRole('button', { name: 'Volver a intentarlo' }),
      )
      await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
      // El reintento sigue desde el paso que falló.
      expect(control.calls).toEqual([
        ...DELETION_STEPS.slice(0, index + 1),
        ...DELETION_STEPS.slice(index),
      ])
    },
  )

  it('si Clerk rechaza al final: los datos ya se borraron y dice a quién escribir', async () => {
    const user = userEvent.setup()
    const control = controlledEffects({ auto: true })
    control.failOnce.set('account', new AccountDeletionError('not-allowed'))
    renderView({ effects: control.effects })

    const dialog = await confirm(user)
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent(
      'Tus fotos, tus plantas y tu perfil ya se borraron; solo queda tu cuenta de acceso, vacía.',
    )
    expect(alert).toHaveTextContent(
      'escribe al contacto de la página de privacidad',
    )
    expect(
      within(dialog).getByRole('link', { name: 'Ver la página de privacidad' }),
    ).toHaveAttribute('href', '/privacidad')
    // La marca sigue: el perfil no se recrea y al volver se ofrece terminar.
    expect(isAccountDeletionPending(USER)).toBe(true)

    await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }))
    expect(
      screen.getByRole('heading', {
        name: 'La eliminación de tu cuenta quedó a medias',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Continuar la eliminación' }),
    ).toHaveFocus()
  })

  it('si la persona cierra la reverificación de Clerk, lo dice y se puede reintentar', async () => {
    const user = userEvent.setup()
    const control = controlledEffects({ auto: true })
    control.failOnce.set(
      'account',
      new AccountDeletionError('reverification-cancelled'),
    )
    const { onDeleted } = renderView({ effects: control.effects })

    const dialog = await confirm(user)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'confirmar que eres tú',
    )
    await user.click(
      within(dialog).getByRole('button', { name: 'Volver a intentarlo' }),
    )
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
    expect(control.calls).toEqual([...DELETION_STEPS, 'account'])
  })

  it('si Clerk no deja eliminar la cuenta, el botón está deshabilitado con el motivo', () => {
    const { effects, calls } = controlledEffects()
    renderView({ effects, canDeleteAccount: false })
    const button = screen.getByRole('button', { name: 'Eliminar mi cuenta' })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription(
      /Todavía no se puede eliminar la cuenta desde orqui\.apps\. No se ha borrado nada/,
    )
    expect(calls).toEqual([])
  })

  it('sin conexión, la acción se deshabilita con el motivo', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { effects } = controlledEffects()
    renderView({ effects })
    const button = screen.getByRole('button', { name: 'Eliminar mi cuenta' })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription(/Sin conexión/)
    await expectNoAxeViolations()
  })

  it('con una eliminación a medias, ofrece continuarla o seguir usando orqui.apps', async () => {
    const user = userEvent.setup()
    markAccountDeletionStarted(USER)
    const { effects } = controlledEffects()
    const { onKeepUsing } = renderView({ effects })

    expect(
      screen.getByRole('button', { name: 'Continuar la eliminación' }),
    ).toBeEnabled()
    await expectNoAxeViolations()
    await user.click(
      screen.getByRole('button', { name: 'Seguir usando orqui.apps' }),
    )
    expect(onKeepUsing).toHaveBeenCalledTimes(1)
    expect(isAccountDeletionPending(USER)).toBe(false)
    expect(
      screen.getByRole('button', { name: 'Eliminar mi cuenta' }),
    ).toBeInTheDocument()
  })
})
