import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '../test/axe.ts'
import { ErrorBoundary } from './ErrorBoundary.tsx'

function Broken(): never {
  throw new Error('Componente roto')
}

beforeEach(() => {
  document.documentElement.lang = 'es'
  document.title = 'orqui.app'
  // React escribe en la consola cada error capturado; aquí es esperado.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('sin errores, pinta la app', () => {
    render(
      <ErrorBoundary reporter={{ report: vi.fn() }}>
        <p>La app</p>
      </ErrorBoundary>,
    )

    expect(screen.getByText('La app')).toBeInTheDocument()
  })

  it('si un componente falla, muestra la pantalla de fallo y lo reporta', async () => {
    const report = vi.fn()
    render(
      <ErrorBoundary reporter={{ report }}>
        <Broken />
      </ErrorBoundary>,
    )

    const heading = screen.getByRole('heading', {
      level: 1,
      name: 'Algo salió mal',
    })
    // El error no se comunica solo con color, y el foco va al título.
    expect(screen.getByText('Error')).toBeInTheDocument()
    expect(heading).toHaveFocus()
    expect(report).toHaveBeenCalledTimes(1)
    const [error, details] = report.mock.calls[0] as [
      Error,
      { componentStack: string },
    ]
    expect(error.message).toBe('Componente roto')
    expect(details.componentStack).toContain('Broken')
    await expectNoAxeViolations()
  })

  it('el botón recarga la página', async () => {
    const onReload = vi.fn()
    render(
      <ErrorBoundary reporter={{ report: vi.fn() }} onReload={onReload}>
        <Broken />
      </ErrorBoundary>,
    )

    await userEvent.click(
      screen.getByRole('button', { name: 'Recargar la página' }),
    )

    expect(onReload).toHaveBeenCalledTimes(1)
  })
})
