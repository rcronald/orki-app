import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '../test/axe.ts'
import { ErrorBoundary } from './ErrorBoundary.tsx'

function Broken(): never {
  throw new Error('Componente roto')
}

// Lo que lanza lazy() cuando el chunk de una ruta ya no existe (#278).
function MissingChunk(): never {
  throw new TypeError(
    'Failed to fetch dynamically imported module: https://orqui.app/assets/CreditsPage-BJFUgrOu.js',
  )
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

  it('un chunk que no llega tras un despliegue recarga la página sin pantalla de fallo ni reporte', () => {
    const report = vi.fn()
    const recover = vi.fn(() => true)
    render(
      <ErrorBoundary reporter={{ report }} recover={recover}>
        <MissingChunk />
      </ErrorBoundary>,
    )

    expect(recover).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Cargando la versión nueva…',
    )
    expect(
      screen.queryByRole('heading', { name: 'Algo salió mal' }),
    ).not.toBeInTheDocument()
    expect(report).not.toHaveBeenCalled()
  })

  it('si no se puede recargar (ya se recargó, o sin conexión), muestra la pantalla de fallo y lo reporta', () => {
    const report = vi.fn()
    render(
      <ErrorBoundary reporter={{ report }} recover={() => false}>
        <MissingChunk />
      </ErrorBoundary>,
    )

    expect(
      screen.getByRole('heading', { level: 1, name: 'Algo salió mal' }),
    ).toBeInTheDocument()
    expect(report).toHaveBeenCalledTimes(1)
  })

  it('otro error no intenta recargar', () => {
    const recover = vi.fn(() => true)
    render(
      <ErrorBoundary reporter={{ report: vi.fn() }} recover={recover}>
        <Broken />
      </ErrorBoundary>,
    )

    expect(recover).not.toHaveBeenCalled()
    expect(
      screen.getByRole('heading', { name: 'Algo salió mal' }),
    ).toBeInTheDocument()
  })
})
