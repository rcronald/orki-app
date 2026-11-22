import { Component, type ErrorInfo, type ReactNode } from 'react'
import { quitarPortadaPrevia } from '../prerender/portada-previa.ts'
import { CrashScreen } from './CrashScreen.tsx'
import { errorReporter, type ErrorReporter } from './reporter.ts'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Solo para pruebas: dónde se reporta el error. */
  reporter?: Pick<ErrorReporter, 'report'>
  /** Solo para pruebas: qué hace el botón de recargar. */
  onReload?: () => void
}

interface ErrorBoundaryState {
  failed: boolean
}

// Límite de errores de React para toda la app: si un componente lanza al
// pintarse, muestra la pantalla de fallo en lugar de una página en blanco y
// reporta el error con la pila de componentes. Es propio y no el de
// @sentry/react porque va en el JavaScript inicial y el SDK se carga después;
// si el SDK aún no ha llegado, el cargador guarda el error y lo envía luego.
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // La pantalla de fallo no queda debajo de la portada prerrenderada (#204).
    quitarPortadaPrevia()
    const reporter = this.props.reporter ?? errorReporter
    reporter.report(
      error,
      typeof info.componentStack === 'string'
        ? { componentStack: info.componentStack }
        : undefined,
    )
  }

  render() {
    if (this.state.failed) {
      return (
        <CrashScreen
          onReload={this.props.onReload ?? (() => window.location.reload())}
        />
      )
    }
    return this.props.children
  }
}
