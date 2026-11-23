import { Component, type ErrorInfo, type ReactNode } from 'react'
import { quitarPortadaPrevia } from '../prerender/portada-previa.ts'
import {
  esFalloDeCargaDeChunk,
  recargarPorVersion,
} from '../pwa/recarga-por-version.ts'
import { CrashScreen } from './CrashScreen.tsx'
import { errorReporter, type ErrorReporter } from './reporter.ts'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Solo para pruebas: dónde se reporta el error. */
  reporter?: Pick<ErrorReporter, 'report'>
  /** Solo para pruebas: qué hace el botón de recargar. */
  onReload?: () => void
  /**
   * Solo para pruebas: la red de seguridad de los chunks que no llegan tras
   * un despliegue (#278). Devuelve true si recarga la página.
   */
  recover?: (error: unknown) => boolean
}

interface ErrorBoundaryState {
  failed: boolean
  /**
   * El error es un chunk que no llegó y la página se está recargando (o se
   * está decidiendo si recargarla): no se muestra la pantalla de fallo.
   */
  reloading: boolean
}

// Límite de errores de React para toda la app: si un componente lanza al
// pintarse, muestra la pantalla de fallo en lugar de una página en blanco y
// reporta el error con la pila de componentes. Es propio y no el de
// @sentry/react porque va en el JavaScript inicial y el SDK se carga después;
// si el SDK aún no ha llegado, el cargador guarda el error y lo envía luego.
//
// Un chunk que no llega con conexión (una ruta diferida tras un despliegue,
// #278) no muestra la pantalla de fallo ni se reporta: la página se recarga
// una vez con la versión nueva (ver pwa/recarga-por-version.ts). Si ya se
// recargó hace poco, es un fallo real y sigue el camino de siempre.
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { failed: false, reloading: false }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { failed: true, reloading: esFalloDeCargaDeChunk(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (this.state.reloading) {
      const recover = this.props.recover ?? recargarPorVersion
      if (recover(error)) return
      this.setState({ reloading: false })
    }
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
    if (this.state.failed && this.state.reloading) {
      // Lo que dura la recarga: la portada prerrenderada, si sigue a la
      // vista, se queda hasta que llegue la página nueva.
      return (
        <main className="flex min-h-dvh items-center justify-center bg-neutral-0 px-space-4 text-neutral-900">
          <p role="status">Cargando la versión nueva…</p>
        </main>
      )
    }
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
