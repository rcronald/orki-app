import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '../test/axe.ts'
import { AuthLoading, AuthNotice, AuthUnavailable } from './AuthStatus.tsx'

beforeEach(() => {
  // Como en index.html.
  document.documentElement.lang = 'es'
  document.title = 'orqui.app'
})

describe('AuthLoading', () => {
  it('se anuncia como estado y pasa axe', async () => {
    render(<AuthLoading />)

    expect(screen.getByRole('status')).toHaveTextContent('Cargando el acceso…')
    await expectNoAxeViolations()
  })
})

describe('AuthUnavailable', () => {
  it.each([
    ['offline', 'Sin conexión'],
    ['failed', 'No se pudo cargar el acceso'],
  ] as const)(
    '%s: se anuncia como alerta y pasa axe',
    async (reason, title) => {
      render(<AuthUnavailable reason={reason} onRetry={() => {}} />)

      expect(screen.getByRole('alert')).toHaveTextContent(title)
      await expectNoAxeViolations()
    },
  )

  it('permite volver a intentarlo', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<AuthUnavailable reason="failed" onRetry={onRetry} />)

    await user.click(screen.getByRole('button', { name: 'Volver a intentar' }))

    expect(onRetry).toHaveBeenCalledOnce()
  })
})

describe('AuthNotice', () => {
  it('avisa sin interrumpir y pasa axe', async () => {
    render(<AuthNotice reason="offline" />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'Sin conexión: el acceso a tu cuenta no está disponible.',
    )
    await expectNoAxeViolations()
  })
})
