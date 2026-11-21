import { useEffect, useRef } from 'react'

interface CrashScreenProps {
  /** Recarga la página; en la app, window.location.reload. */
  onReload: () => void
}

// Pantalla que sustituye a la app cuando un componente falla al pintarse (ver
// ErrorBoundary.tsx). Sigue el formato de la pantalla de error de
// configuración. El foco pasa al título para que un lector de pantalla anuncie
// el cambio. El botón usa las clases del design system directamente (no
// components/ui/Button) para no meter sus iconos en el JavaScript inicial.
export function CrashScreen({ onReload }: CrashScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-neutral-0 px-space-4 py-space-6 text-neutral-900">
      <div className="flex w-full max-w-lg flex-col gap-space-4">
        <div className="flex flex-col gap-space-1">
          <p className="text-sm font-semibold text-danger">Error</p>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="font-display text-display font-semibold text-neutral-900"
          >
            Algo salió mal
          </h1>
        </div>
        <p>
          La app tuvo un problema inesperado. Recarga la página para seguir; las
          plantas que ya guardaste no se pierden.
        </p>
        <button
          type="button"
          className="orki-btn orki-btn--primary orki-btn--block"
          onClick={onReload}
        >
          Recargar la página
        </button>
      </div>
    </main>
  )
}
